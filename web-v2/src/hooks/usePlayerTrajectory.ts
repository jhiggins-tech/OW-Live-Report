import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchPlayerRankTrend } from '../lib/queries/charts/player/rankTrend';
import { fetchPlayerKdaTrend } from '../lib/queries/charts/player/kdaTrend';
import { fetchPlayerWinRateTrend } from '../lib/queries/charts/player/winRateTrend';
import { rankLabelFromOrdinal } from '../lib/normalize/rankOrdinal';
import { computeTrajectory, type TrajectoryResult } from '../lib/trajectory';
import type { SeriesPoint } from '../lib/trend';

export interface UsePlayerTrajectory {
  trajectory: TrajectoryResult | null;
  isLoading: boolean;
  isError: boolean;
}

export function usePlayerTrajectory(playerId: string | undefined, displayName: string): UsePlayerTrajectory {
  const enabled = !!playerId;
  const results = useQueries({
    queries: [
      {
        queryKey: ['player', 'rankTrend', playerId ?? ''],
        queryFn: () => fetchPlayerRankTrend(playerId!),
        enabled,
      },
      {
        queryKey: ['player', 'kdaTrend', playerId ?? ''],
        queryFn: () => fetchPlayerKdaTrend(playerId!),
        enabled,
      },
      {
        queryKey: ['player', 'winRateTrend', playerId ?? ''],
        queryFn: () => fetchPlayerWinRateTrend(playerId!),
        enabled,
      },
    ],
  });
  const [rankQ, kdaQ, winQ] = results;

  const trajectory = useMemo<TrajectoryResult | null>(() => {
    const rankPoints = rankQ.data ?? null;
    const kdaPoints = kdaQ.data ?? null;
    const winPoints = winQ.data ?? null;
    if (!rankPoints || !kdaPoints || !winPoints) return null;

    // Reduce per-role rank ordinals to a single scalar per timestamp by
    // averaging the non-null roles. Matches V1's average_ordinal field.
    const rankSeries: SeriesPoint[] = rankPoints.map((p) => {
      const ords = [p.byRole.tank, p.byRole.damage, p.byRole.support].filter(
        (v): v is number => typeof v === 'number',
      );
      return { time: p.time, value: ords.length > 0 ? ords.reduce((a, b) => a + b, 0) / ords.length : null };
    });

    const kdaSeries: SeriesPoint[] = kdaPoints.map((p) => ({ time: p.time, value: p.kda }));
    const winRateSeries: SeriesPoint[] = winPoints.map((p) => ({ time: p.time, value: p.winRate }));

    const latestKda = [...kdaSeries].reverse().find((p) => p.value !== null)?.value ?? null;
    const latestWin = [...winRateSeries].reverse().find((p) => p.value !== null)?.value ?? null;
    const latestRank = [...rankSeries].reverse().find((p) => p.value !== null)?.value ?? null;

    return computeTrajectory({
      displayName,
      rankSeries,
      kdaSeries,
      winRateSeries,
      latest: {
        kda: latestKda,
        winRate: latestWin,
        rankLabel: rankLabelFromOrdinal(latestRank),
      },
    });
  }, [rankQ.data, kdaQ.data, winQ.data, displayName]);

  return {
    trajectory,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}
