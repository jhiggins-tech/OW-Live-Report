// Bucket sizes + time windows per chart. Tune here, not in the chart file.
// All durations are InfluxQL duration literals.

export const TIME_WINDOWS = {
  statCards: '14d',
  scatter: '7d',
  teamSeason: '90d',
  playerSeason: '90d',
  // Hero pool: 30d strikes a balance between current-meta relevance and
  // query cost (90d ~2.15s vs 30d ~1.77s vs 14d ~0.6s in profiling).
  heroLatest: '30d',
} as const;

export const BUCKETS = {
  teamKda: '1d',
  teamWinRate: '1d',
  teamRank: '1d',
  playerRank: '1h',
  playerKda: '1d',
  playerWinRate: '1d',
  heroUsage: '1w',
  heroPerf: '1w',
} as const;

export const GAMEMODE = import.meta.env.VITE_INFLUX_GAMEMODE ?? 'competitive';

export const TOP_HERO_COUNT = Number(import.meta.env.VITE_TOP_HERO_COUNT ?? 6);

export const ONE_GAME_OUTLIER_WIN_RATE = 100;
