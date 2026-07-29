import { loadRankCurrent, loadRankDaily } from '../snapshotClient';
import type { RosterPlayer } from '../../types/models';
import { playerIdSet } from './_shared';

// Mirrors the old InfluxQL pair (max("season"), then first("season") at that
// season) against the rank snapshots: the newest season any of the given
// players has reached, then the earliest sample carrying it. Day resolution —
// the daily table is the only history that survives raw retention.
export async function fetchCurrentCompetitiveSeasonStart(
  players: RosterPlayer[] | readonly string[],
): Promise<number | null> {
  if (!players.length) return null;
  const ids = playerIdSet(players);
  const [current, daily] = await Promise.all([loadRankCurrent(), loadRankDaily()]);

  let latestSeason: number | null = null;
  for (const r of current.rows) {
    if (!ids.has(r.player) || r.season === null) continue;
    if (latestSeason === null || r.season > latestSeason) latestSeason = r.season;
  }
  if (latestSeason === null) return null;

  let start: number | null = null;
  for (const r of daily.rows) {
    if (!ids.has(r.player) || r.season !== latestSeason) continue;
    if (start === null || r.day < start) start = r.day;
  }
  if (start === null) {
    // Season flipped so recently the daily aggregate has no row carrying it
    // yet; fall back to the latest raw sample times.
    for (const r of current.rows) {
      if (!ids.has(r.player) || r.season !== latestSeason) continue;
      if (start === null || r.time < start) start = r.time;
    }
  }
  return start;
}

// Replaces the old currentSeasonTimePredicate: returns the epoch-ms cutoff
// callers filter rows against (row.time >= cutoff).
export async function currentSeasonCutoff(
  players: RosterPlayer[] | readonly string[],
  fallbackWindowMs: number,
): Promise<number> {
  try {
    const start = await fetchCurrentCompetitiveSeasonStart(players);
    if (start !== null) return start;
  } catch {
    // Keep charts usable if the rank snapshots are temporarily unavailable.
  }
  return Date.now() - fallbackWindowMs;
}
