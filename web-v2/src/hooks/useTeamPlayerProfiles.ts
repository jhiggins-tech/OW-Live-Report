import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  fetchOverFastPlayerSummary,
  type OverFastPlayerSummary,
} from '../lib/queries/overfastPlayerSummary';
import type { RosterPlayer } from '../types/models';

const ONE_HOUR = 60 * 60 * 1000;

export interface TeamPlayerProfiles {
  byPlayerId: Record<string, OverFastPlayerSummary>;
  isPending: boolean;
  isError: boolean;
}

export function useTeamPlayerProfiles(players: RosterPlayer[]): TeamPlayerProfiles {
  const results = useQueries({
    queries: players.map((p) => ({
      queryKey: ['overfast', 'playerSummary', p.playerId],
      queryFn: () => fetchOverFastPlayerSummary(p.playerId),
      staleTime: ONE_HOUR,
      gcTime: 24 * ONE_HOUR,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
  });

  return useMemo(() => {
    const byPlayerId: Record<string, OverFastPlayerSummary> = {};
    let isPending = false;
    let isError = false;
    for (const r of results) {
      if (r.data) byPlayerId[r.data.playerId] = r.data;
      if (r.isPending) isPending = true;
      if (r.isError) isError = true;
    }
    return { byPlayerId, isPending, isError };
  }, [results]);
}
