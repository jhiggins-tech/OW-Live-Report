// Ports src/internal/AnalyticsCore.ps1:741 Get-OwReportWindowedSeries and
// src/internal/AnalyticsCore.ps1:772 Get-TimeSeriesTrend.
//
// Pure functions over an array of {time (ms epoch), value (number | null)}.
// Time is the InfluxDB-canonical ms epoch we already pull from chart queries,
// so chart series can feed in here directly with minimal massage.

export interface SeriesPoint {
  time: number;
  value: number | null;
}

export interface TrendResult {
  direction: 'up' | 'flat' | 'down';
  slopePerDay: number;
  delta: number;
  confidence: number;
  spanDays: number;
  sampleCount: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function nonNullSorted(series: SeriesPoint[]): SeriesPoint[] {
  return series
    .filter((p) => p.value !== null && Number.isFinite(p.value as number) && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
}

export function windowedSeries(
  series: SeriesPoint[],
  windowDays: number,
  minimumPoints = 3,
  fallbackLastPoints = 4,
): SeriesPoint[] {
  const ordered = nonNullSorted(series);
  if (ordered.length <= 1) return ordered;
  const latest = ordered[ordered.length - 1]!.time;
  const threshold = latest - windowDays * MS_PER_DAY;
  const windowed = ordered.filter((p) => p.time >= threshold);
  if (windowed.length < minimumPoints) {
    return ordered.slice(-Math.min(fallbackLastPoints, ordered.length));
  }
  return windowed;
}

export function linearTrend(
  series: SeriesPoint[],
  flatSlopeThreshold: number,
  confidenceMultiplier = 1.0,
): TrendResult {
  const ordered = nonNullSorted(series);
  if (ordered.length < 2) {
    return {
      direction: 'flat',
      slopePerDay: 0,
      delta: 0,
      confidence: 0,
      spanDays: 0,
      sampleCount: ordered.length,
    };
  }

  const baseTime = ordered[0]!.time;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of ordered) {
    xs.push((p.time - baseTime) / MS_PER_DAY);
    ys.push(p.value as number);
  }
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i]! - xMean;
    num += dx * (ys[i]! - yMean);
    den += dx * dx;
  }
  const slopePerDay = den !== 0 ? num / den : 0;

  const delta = ys[ys.length - 1]! - ys[0]!;
  const spanDays = (ordered[ordered.length - 1]!.time - ordered[0]!.time) / MS_PER_DAY;
  const confidence = Math.min(1, ordered.length / 5) * Math.min(1, spanDays / 14) * confidenceMultiplier;

  const minDelta = flatSlopeThreshold * Math.max(spanDays, 1);
  let direction: TrendResult['direction'] = 'flat';
  if (Math.abs(slopePerDay) > flatSlopeThreshold && Math.abs(delta) > minDelta) {
    direction = slopePerDay > 0 ? 'up' : 'down';
  }

  return {
    direction,
    slopePerDay: Number(slopePerDay.toFixed(4)),
    delta: Number(delta.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    spanDays: Number(spanDays.toFixed(2)),
    sampleCount: ordered.length,
  };
}
