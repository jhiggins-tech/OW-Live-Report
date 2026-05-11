export type Role = 'tank' | 'damage' | 'support';

export interface RosterPlayer {
  battleTag: string;
  // InfluxDB tag form — BattleTag with '#' replaced by '-'.
  playerId: string;
  display: string;
  slug: string;
  notes?: string;
}

export interface Roster {
  generatedAt: string;
  players: RosterPlayer[];
}

export interface TimePoint {
  time: number;
  [key: string]: number | string | null;
}

export interface PlayerStatPoint {
  player: string;
  display: string;
  slug: string;
  kda: number | null;
  winRate: number | null;
  gamesPlayed: number | null;
  lastSeen: number | null;
  rankOrdinal: number | null;
}

export interface HeroPoolEntry {
  hero: string;
  prettyName: string;
  timePlayedSeconds: number;
}

export interface RoleBreakdownEntry {
  role: Role;
  kda: number | null;
  winRate: number | null;
  gamesPlayed: number | null;
  timePlayedSeconds: number | null;
}

export interface HeroLeaderboardRow {
  hero: string;
  prettyName: string;
  gamesPlayed: number;
  winRate: number | null;
  kda: number | null;
  timePlayedSeconds: number;
}
