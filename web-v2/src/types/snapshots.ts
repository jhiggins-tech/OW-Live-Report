// Shapes of the JSON snapshot datasets baked by scripts/fetch-snapshots.mjs
// from the TimescaleDB stats backend. All timestamps are epoch milliseconds;
// `day` values are UTC day starts (the daily table's bucket boundary).

export interface SnapshotFile<TRow> {
  generatedAt: number;
  rows: TRow[];
}

export interface SnapshotMeta {
  generatedAt: number;
  gamemode: string;
  players: string[];
  heartbeatAt: number | null;
  maxSeason: number | null;
  seasonStart: number | null;
  seasonByPlayer: Record<string, number | null>;
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
}
