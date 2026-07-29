import { getRuntimeConfig } from '../../runtimeConfig';

// Time windows + bucket sizes per chart, in milliseconds. Tune here, not in
// the chart file. Gamemode filtering happens in the snapshot pipeline
// (scripts/fetch-snapshots.mjs), so it no longer appears here.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export const TIME_WINDOWS = {
  statCards: 14 * DAY_MS,
  scatter: 7 * DAY_MS,
  teamSeason: 90 * DAY_MS,
  playerSeason: 90 * DAY_MS,
  heroLatest: 30 * DAY_MS,
} as const;

// The daily snapshot table fixes most series at one sample per UTC day; the
// only coarser roll-up left is the weekly bucketing used by the per-player
// hero usage/perf charts.
export const BUCKETS = {
  heroUsage: WEEK_MS,
  heroPerf: WEEK_MS,
} as const;

// Read from runtime config at call time so values can change between renders.
// Getter (not const) because the config loads after module init.
export function getTopHeroCount(): number {
  return getRuntimeConfig().ui.topHeroCount;
}

export const ONE_GAME_OUTLIER_WIN_RATE = 100;
