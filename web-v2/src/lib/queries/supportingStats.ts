// Canonical player headline stats. All values come from the latest competitive
// `all-heroes` aggregate rows, so every overall KDA display uses the same
// counters rather than whichever hero series happens to sort first.

import { loadCareerLatest } from '../snapshotClient';
import { kdaFrom } from '../normalize/kda';

export interface SupportingStats {
  eliminations: number | null;
  assists: number | null;
  deaths: number | null;
  kda: number | null;
  gamesWon: number | null;
  gamesPlayed: number | null;
  winRate: number | null;
  assistsPerDeath: number | null;
  healingDone: number | null;
  healingPer10Min: number | null;
}

function assistsPerDeathFrom(assists: number | null, deaths: number | null): number | null {
  if (assists === null || deaths === null) return null;
  return assists / Math.max(deaths, 1);
}

export async function fetchSupportingStats(playerIds: readonly string[]): Promise<Map<string, SupportingStats>> {
  const out = new Map<string, SupportingStats>();
  if (!playerIds.length) return out;

  const ids = new Set(playerIds);
  const { rows } = await loadCareerLatest();

  for (const r of rows) {
    if (r.hero !== 'all-heroes' || !ids.has(r.player)) continue;
    const stats: SupportingStats = {
      eliminations: r.eliminations,
      assists: r.assists,
      deaths: r.deaths,
      kda: kdaFrom(r.eliminations, r.assists, r.deaths),
      gamesWon: r.gamesWon,
      gamesPlayed: r.gamesPlayed,
      winRate: r.gamesWon !== null && r.gamesPlayed !== null && r.gamesPlayed > 0
        ? (r.gamesWon / r.gamesPlayed) * 100
        : null,
      assistsPerDeath: assistsPerDeathFrom(r.assists, r.deaths),
      healingDone: r.healingDone,
      healingPer10Min: r.healingPer10Min,
    };
    out.set(r.player, stats);
  }

  return out;
}
