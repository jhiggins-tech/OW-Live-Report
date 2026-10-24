import { loadMeta, loadRankCurrent, loadRankDaily } from '../snapshotClient';
import type { RosterPlayer } from '../../types/models';
import { playerIdSet } from './_shared';
import { DAY_MS } from './charts/_constants';

// Mirrors the old InfluxQL pair (max("season"), then first("season") at that
// season) against the rank snapshots: the newest season any of the given
// players has reached, then the earliest sample carrying it. Day resolution —
// the daily table is the only history that survives raw retention.
export async function fetchCurrentCompetitiveSeasonStart(
  players: RosterPlayer[] | readonly string[],
  season?: number,
): Promise<number | null> {
  if (!players.length) return null;
  // Season files only hold one season, so it starts at the first day on
  // file. The rank-derived start below would cut off the days between a
  // counter reset and the first new-season rank.
  const meta = await loadMeta();
  if (meta.layoutVersion === 2) {
    if (season === undefined) return meta.seasonStart ?? null;
    return meta.seasons?.find((s) => s.season === season)?.firstDay ?? null;
  }
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
  season?: number,
): Promise<number> {
  try {
    const start = await fetchCurrentCompetitiveSeasonStart(players, season);
    if (start !== null) return start;
  } catch {
    // Keep charts usable if the rank snapshots are temporarily unavailable.
  }
  return Date.now() - fallbackWindowMs;
}

// Right edge for the "last N days" chart windows: now for the current season
// (and the legacy layout), the day after the last row on file for a past one,
// so its charts show the whole season instead of an empty recent window.
export async function windowEnd(season?: number): Promise<number> {
  const meta = await loadMeta();
  if (meta.layoutVersion !== 2 || season === undefined || season === meta.currentSeason) return Date.now();
  const last = meta.seasons?.find((s) => s.season === season)?.lastDay;
  return last === undefined ? Date.now() : last + DAY_MS;
}
