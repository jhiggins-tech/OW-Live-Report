import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { GAMEMODE, TIME_WINDOWS } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamStatCards {
  trackedPlayers: number;
  freshPlayers: number;
  teamKda: number | null;
  teamWinRate: number | null;
  newestSeenAt: number | null;
}

export async function fetchTeamStatCards(players: RosterPlayer[]): Promise<TeamStatCards> {
  if (!players.length) {
    return { trackedPlayers: 0, freshPlayers: 0, teamKda: null, teamWinRate: null, newestSeenAt: null };
  }
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.statCards;

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "player"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "player"`;
  const gameQ = `SELECT last("win_percentage") AS wp, last("games_played") AS gp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "player"`;
  const summaryQ = `SELECT last("last_updated_at") AS lu FROM "player_summary" WHERE "player" =~ /${regex}/ GROUP BY "player"`;

  const [combatBody, assistsBody, gameBody, summaryBody] = await Promise.all([
    runInfluxQuery(combatQ),
    runInfluxQuery(assistsQ),
    runInfluxQuery(gameQ),
    runInfluxQuery(summaryQ),
  ]);

  const eByPlayer = new Map<string, number>();
  const dByPlayer = new Map<string, number>();
  for (const s of parseSeries<{ e: number | null; d: number | null }>(combatBody)) {
    const tag = s.tags.player ?? '';
    const e = safeNumber(s.rows[0]?.e);
    const d = safeNumber(s.rows[0]?.d);
    if (e !== null) eByPlayer.set(tag, e);
    if (d !== null) dByPlayer.set(tag, d);
  }

  const aByPlayer = new Map<string, number>();
  for (const s of parseSeries<{ a: number | null }>(assistsBody)) {
    const tag = s.tags.player ?? '';
    const a = safeNumber(s.rows[0]?.a);
    if (a !== null) aByPlayer.set(tag, a);
  }

  const wpByPlayer = new Map<string, number>();
  for (const s of parseSeries<{ wp: number | null; gp: number | null }>(gameBody)) {
    const tag = s.tags.player ?? '';
    const wp = safeNumber(s.rows[0]?.wp);
    if (wp !== null) wpByPlayer.set(tag, wp);
  }

  const newestByPlayer = new Map<string, number>();
  let newestSeenAt: number | null = null;
  for (const s of parseSeries<{ lu: number | null }>(summaryBody)) {
    const tag = s.tags.player ?? '';
    const lu = safeNumber(s.rows[0]?.lu);
    if (lu !== null) {
      newestByPlayer.set(tag, lu);
      if (newestSeenAt === null || lu > newestSeenAt) newestSeenAt = lu;
    }
  }

  const kdas: number[] = [];
  const wrs: number[] = [];
  for (const p of players) {
    const k = kdaFrom(eByPlayer.get(p.playerId), aByPlayer.get(p.playerId), dByPlayer.get(p.playerId));
    if (k !== null) kdas.push(k);
    const wr = wpByPlayer.get(p.playerId);
    if (typeof wr === 'number') wrs.push(wr);
  }

  const freshCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let freshPlayers = 0;
  for (const p of players) {
    const seenAt = newestByPlayer.get(p.playerId);
    if (seenAt !== undefined && seenAt >= freshCutoff) freshPlayers += 1;
  }

  return {
    trackedPlayers: players.length,
    freshPlayers,
    teamKda: kdas.length ? kdas.reduce((a, b) => a + b, 0) / kdas.length : null,
    teamWinRate: wrs.length ? wrs.reduce((a, b) => a + b, 0) / wrs.length : null,
    newestSeenAt,
  };
}
