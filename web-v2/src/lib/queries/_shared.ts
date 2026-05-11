import type { RosterPlayer } from '../../types/models';

// InfluxDB regex character class escape for literal player tags.
// The `=~ /<regex>/` operator parses with limited escape support;
// we use char-class form `[#]`, `[+]` etc. to dodge BattleTag specials.
function escapeForRegex(input: string): string {
  return input.replace(/[\\^$.*+?()[\]{}|/]/g, (m) => `[${m}]`);
}

export function buildPlayerRegex(players: RosterPlayer[] | readonly string[]): string {
  const ids = (players as Array<RosterPlayer | string>)
    .map((p) => (typeof p === 'string' ? p : p?.playerId))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (!ids.length) return '__no_player__';
  return `^(${ids.map(escapeForRegex).join('|')})$`;
}

export function lastSelectClause(fields: readonly string[]): string {
  return fields
    .map((field) => `last("${field}") AS "${field}"`)
    .join(', ');
}

export function quoteValue(input: string): string {
  return input.replace(/'/g, "''");
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
