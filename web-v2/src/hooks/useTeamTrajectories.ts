// Computes a TrajectoryResult per visible player by piggy-backing on the
// three time-series queries the Overview Team-KDA / Team-WinRate / Team-Rank
// charts already fire. Cost is zero net Influx work on a warm Overview load
// since TanStack Query dedupes by queryKey.

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchTeamKdaOverTime } from '../lib/queries/charts/team/kdaOverTime';
import { fetchTeamWinRateOverTime } from '../lib/queries/charts/team/winRateOverTime';
import { fetchTeamRankOverTime } from '../lib/queries/charts/team/rankOverTime';
import { rankLabelFromOrdinal } from '../lib/normalize/rankOrdinal';
import { computeTrajectory, type TrajectoryResult } from '../lib/trajectory';
import { hashPlayerSet } from '../lib/queries/_shared';
import type { SeriesPoint } from '../lib/trend';
import type { RosterPlayer } from '../types/models';

export interface UseTeamTrajectories {
  byPlayerId: Record<string, TrajectoryResult>;
  isLoading: boolean;
  isError: boolean;
}

export function useTeamTrajectories(players: RosterPlayer[]): UseTeamTrajectories {
  const enabled = players.length > 0;
  const setHash = hashPlayerSet(players);

  const results = useQueries({
    queries: [
      {
        queryKey: ['team', 'kdaOverTime', setHash],
        queryFn: () => fetchTeamKdaOverTime(players),
        enabled,
      },
      {
        queryKey: ['team', 'winRateOverTime', setHash],
        queryFn: () => fetchTeamWinRateOverTime(players),
        enabled,
      },
      {
        queryKey: ['team', 'rankOverTime', setHash],
        queryFn: () => fetchTeamRankOverTime(players),
        enabled,
      },
    ],
  });
  const [kdaQ, winQ, rankQ] = results;

  const byPlayerId = useMemo<Record<string, TrajectoryResult>>(() => {
    if (!kdaQ.data || !winQ.data || !rankQ.data) return {};

    // Per-player series builders that read out one playerId at a time from
    // each bucketed result. Missing buckets simply skip — windowedSeries will
    // fall back to last-N points if the recent window is sparse.
    function series(metricBuckets: { time: number; byPlayer: Record<string, number | null> }[], pid: string): SeriesPoint[] {
      const out: SeriesPoint[] = [];
      for (const b of metricBuckets) {
        const v = b.byPlayer[pid];
        if (v === undefined) continue;
        out.push({ time: b.time, value: v });
      }
      return out;
    }

    const out: Record<string, TrajectoryResult> = {};
    for (const p of players) {
      const kdaSeries = series(kdaQ.data.map((b) => ({ time: b.time, byPlayer: b.byPlayer })), p.playerId);
      const winRateSeries = series(winQ.data, p.playerId);
      const rankSeries = series(rankQ.data, p.playerId);

      const latestKda = [...kdaSeries].reverse().find((s) => s.value !== null)?.value ?? null;
      const latestWin = [...winRateSeries].reverse().find((s) => s.value !== null)?.value ?? null;
      const latestRank = [...rankSeries].reverse().find((s) => s.value !== null)?.value ?? null;

      out[p.playerId] = computeTrajectory({
        displayName: p.display,
        rankSeries,
        kdaSeries,
        winRateSeries,
        latest: {
          kda: latestKda,
          winRate: latestWin,
          rankLabel: rankLabelFromOrdinal(latestRank),
        },
      });
    }
    return out;
  }, [kdaQ.data, winQ.data, rankQ.data, players]);

  return {
    byPlayerId,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}
