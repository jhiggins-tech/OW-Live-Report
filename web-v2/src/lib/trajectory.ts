// Ports the trajectory composite scoring from
// src/internal/AnalyticsTeam.ps1:255-311 plus the narrative templates from
// Get-OwReportTrajectoryText (AnalyticsTeam.ps1:112).
//
// Inputs are three time series (rank ordinal, KDA, win rate) plus a few
// latest-snapshot scalars. Output is the per-player verdict the UI shows.

import { linearTrend, windowedSeries, type SeriesPoint } from './trend';

export type TrajectoryLabel = 'up' | 'flat' | 'down';
export type ForecastLabel = 'likely climbing' | 'likely declining' | 'likely stable';

export interface TrajectorySignal {
  metric: 'rank' | 'kda' | 'winrate';
  direction: TrajectoryLabel;
  slopePerDay: number;
  confidence: number;
  weight: number;
  score: number;
}

export interface TrajectoryResult {
  label: TrajectoryLabel;
  forecast: ForecastLabel;
  compositeScore: number;
  confidence: number;
  signals: TrajectorySignal[];
  narrative: string;
}

export interface TrajectoryInputs {
  displayName: string;
  rankSeries: SeriesPoint[];
  kdaSeries: SeriesPoint[];
  winRateSeries: SeriesPoint[];
  latest: {
    kda: number | null;
    winRate: number | null;
    rankLabel: string;
  };
}

const SHORT_WINDOW = 21;
const FLAT_RANK = 0.04;
const FLAT_KDA = 0.01;
const FLAT_WIN = 0.12;

// Slope normalisers (matches V1's score = slope / X clamping):
//   rank: ±0.08 ordinal/day saturates
//   kda: ±0.02/day saturates
//   win rate: ±0.2 percentage points/day saturates
const NORM_RANK = 0.08;
const NORM_KDA = 0.02;
const NORM_WIN = 0.2;

const WEIGHT_RANK = 0.4;
const WEIGHT_KDA = 0.35;
const WEIGHT_WIN = 0.25;

const FORECAST_CONFIDENCE = 0.35;
const LABEL_THRESHOLD = 0.2;

function buildSignal(
  metric: TrajectorySignal['metric'],
  series: SeriesPoint[],
  flatThreshold: number,
  norm: number,
  weight: number,
): TrajectorySignal | null {
  const windowed = windowedSeries(series, SHORT_WINDOW, 2, 4);
  const trend = linearTrend(windowed, flatThreshold);
  if (trend.sampleCount < 2) return null;
  const score = Math.max(-1, Math.min(1, trend.slopePerDay / norm));
  return {
    metric,
    direction: trend.direction,
    slopePerDay: trend.slopePerDay,
    confidence: trend.confidence,
    weight,
    score,
  };
}

function narrativeFor(displayName: string, label: TrajectoryLabel, latest: TrajectoryInputs['latest']): string {
  const kda = latest.kda === null ? '—' : latest.kda.toFixed(2);
  const winRate = latest.winRate === null ? '—' : latest.winRate.toFixed(1);
  switch (label) {
    case 'up':
      return `${displayName} is trending upward with a current KDA of ${kda} and win rate at ${winRate}%. Rank reads as ${latest.rankLabel}, and the recent direction is strong enough to project cautious improvement.`;
    case 'down':
      return `${displayName} is sliding right now. KDA sits at ${kda}, win rate is ${winRate}%, and rank context is ${latest.rankLabel}. The next sessions should focus on stabilizing execution before expecting visible ladder gains.`;
    default:
      return `${displayName} looks mostly stable. KDA is ${kda}, win rate is ${winRate}%, and current rank context is ${latest.rankLabel}. Progress is present but not accelerating enough yet to read as a decisive climb.`;
  }
}

export function computeTrajectory(inputs: TrajectoryInputs): TrajectoryResult {
  const signals = [
    buildSignal('rank', inputs.rankSeries, FLAT_RANK, NORM_RANK, WEIGHT_RANK),
    buildSignal('kda', inputs.kdaSeries, FLAT_KDA, NORM_KDA, WEIGHT_KDA),
    buildSignal('winrate', inputs.winRateSeries, FLAT_WIN, NORM_WIN, WEIGHT_WIN),
  ].filter((s): s is TrajectorySignal => s !== null);

  let weightedScore = 0;
  let weightSum = 0;
  for (const sig of signals) {
    const w = sig.weight * sig.confidence;
    weightedScore += sig.score * w;
    weightSum += w;
  }
  const compositeScore = weightSum > 0 ? weightedScore / weightSum : 0;
  const confidence = signals.length > 0
    ? Number((signals.reduce((a, b) => a + b.confidence, 0) / signals.length).toFixed(3))
    : 0;

  let label: TrajectoryLabel = 'flat';
  if (compositeScore >= LABEL_THRESHOLD) label = 'up';
  else if (compositeScore <= -LABEL_THRESHOLD) label = 'down';

  let forecast: ForecastLabel = 'likely stable';
  if (label === 'up' && confidence >= FORECAST_CONFIDENCE) forecast = 'likely climbing';
  else if (label === 'down' && confidence >= FORECAST_CONFIDENCE) forecast = 'likely declining';

  return {
    label,
    forecast,
    compositeScore: Number(compositeScore.toFixed(3)),
    confidence,
    signals,
    narrative: narrativeFor(inputs.displayName, label, inputs.latest),
  };
}
