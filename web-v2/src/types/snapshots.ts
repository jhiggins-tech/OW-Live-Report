// Shapes of the JSON snapshot datasets baked by scripts/pipeline/poll.mjs
// from the OverFast API. All timestamps are epoch milliseconds; `day` values
// are UTC day starts (the daily roll-up's bucket boundary).

export interface SnapshotFile<TRow> {
  generatedAt: number;
  // Present on the per-season files under data/seasons/<N>/ (layoutVersion 2).
  season?: number;
  rows: TRow[];
}

export interface SnapshotMeta {
  // 2 = per-season files under data/seasons/<N>/; absent = the legacy flat
  // data/snapshots/*.json layout.
  layoutVersion?: number;
  generatedAt: number;
  gamemode: string;
  platform?: string;
  players: string[];
  heartbeatAt: number | null;
  currentSeason?: number | null;
  maxSeason: number | null;
  seasonStart: number | null;
  seasonByPlayer: Record<string, number | null>;
  // The season each player's career counters belong to (layoutVersion 2).
  playerSeason?: Record<string, number>;
  seasons?: Array<{ season: number; firstDay: number; lastDay: number }>;
  lastPoll?: {
    at: number;
    source: string;
    ok: string[];
    failed: Array<{ player: string; error: string }>;
  };
}

// snapshots/rank-icons.json (optional; legacy deploys don't have it): the
// official rank insignia, captured from OverFast because the URLs carry content
// hashes and can't be derived. `divisions` is keyed by the tier NAME
// ('gold': the badge) and `tiers` by the division NUMBER ('3': the overlay),
// the same naming quirk as the rank rows below. `season` is the rank season
// the URL was last seen with.
export interface RankIconsFile {
  generatedAt: number;
  divisions: Record<string, { url: string; season: number }>;
  tiers: Record<string, { url: string; season: number }>;
}

// What loadRankIcons() hands the UI: just the URLs, empty when unavailable.
export interface RankIconMaps {
  divisions: Record<string, string>;
  tiers: Record<string, string>;
}

// competitive_rank, latest per (player, role). Field naming keeps the
// source schema's counterintuitive labels: `tier` is the division NUMBER
// (1..5) and `division` is the tier NAME (silver, gold, ...) — see
// normalize/rankOrdinal.ts, which resolves them by type.
export interface RankRow {
  player: string;
  role: string;
  time: number;
  tier: number | null;
  division: string | null;
  season: number | null;
}

export interface RankDailyRow {
  player: string;
  role: string;
  day: number;
  tier: number | null;
  division: string | null;
  season: number | null;
}

// career_stats_*, latest per (player, hero) for the configured gamemode.
// Includes the hero='all-heroes' aggregate rows.
export interface CareerLatestRow {
  player: string;
  hero: string;
  time: number;
  eliminations: number | null;
  deaths: number | null;
  assists: number | null;
  healingDone: number | null;
  healingPer10Min: number | null;
  gamesWon: number | null;
  gamesPlayed: number | null;
  winPercentage: number | null;
  timePlayed: number | null;
}

// career_stats_*, hero='all-heroes', one row per (player, UTC day).
export interface CareerDailyRow {
  player: string;
  day: number;
  eliminations: number | null;
  deaths: number | null;
  assists: number | null;
  gamesWon: number | null;
  gamesPlayed: number | null;
}

// career_stats_*, per real hero, one row per (player, hero, UTC day).
export interface CareerHeroDailyRow {
  player: string;
  hero: string;
  day: number;
  eliminations: number | null;
  deaths: number | null;
  assists: number | null;
  gamesPlayed: number | null;
  timePlayed: number | null;
}

// player_summary, latest per player.
export interface ProfileRow {
  player: string;
  time: number;
  username: string | null;
  avatar: string | null;
  namecard: string | null;
  title: string | null;
  endorsementLevel: number | null;
  endorsementFrame: string | null;
  lastUpdatedAt?: number | null;
}
