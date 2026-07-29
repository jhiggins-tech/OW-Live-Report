import type { RosterPlayer } from '../../types/models';

// Snapshot rows are keyed by the backend's player id (BattleTag with '#'
// replaced by '-'). Queries filter client-side so the hidden-players
// setting keeps working without refetching anything.
export function playerIdSet(players: RosterPlayer[] | readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const p of players as Array<RosterPlayer | string>) {
    const id = typeof p === 'string' ? p : p?.playerId;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return ids;
}

export function hashPlayerSet(players: RosterPlayer[]): string {
  return players
    .map((p) => p?.playerId ?? '')
    .filter(Boolean)
    .sort()
    .join(',');
}

export interface ChartRow {
  time: number;
  player?: string;
  hero?: string;
  role?: string;
  [field: string]: number | string | null | undefined;
}
