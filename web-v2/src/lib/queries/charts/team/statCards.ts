import { parseStatementSeries, runInfluxMultiQuery } from '../../../influxClient';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { fetchSupportingStats } from '../../supportingStats';
import { TIME_WINDOWS } from '../_constants';
import { getGamemode } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamStatCards {
  trackedPlayers: number;
  freshPlayers: number;
  teamKda: number | null;
  teamWinRate: number | null;
  teamAssistsPerDeath: number | null;
  teamHealingDone: number | null;
  teamHealingPer10Min: number | null;
  newestSeenAt: number | null;
}

export async function fetchTeamStatCards(players: RosterPlayer[]): Promise<TeamStatCards> {
  if (!players.length) {
    return {
      trackedPlayers: 0,
      freshPlayers: 0,
      teamKda: null,
      teamWinRate: null,
      teamAssistsPerDeath: null,
      teamHealingDone: null,
      teamHealingPer10Min: null,
      newestSeenAt: null,
    };
  }
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.statCards;

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' AND time > now() - ${window} GROUP BY "player"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' AND time > now() - ${window} GROUP BY "player"`;
  // Compute team WR from games_won/games_played at hero='all-heroes' rather
  // than reading win_percentage: that field is null on all-heroes rows
  // (OverFast doesn't surface an aggregate), and last(win_percentage) without
  // a hero filter returns whichever per-hero value last() resolves to —
  // effectively a random hero's WR labeled as the player's overall.
  const gameQ = `SELECT last("games_won") AS gw, last("games_played") AS gp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' AND "hero"='all-heroes' AND time > now() - ${window} GROUP BY "player"`;
  // last(username) is the cheapest way to recover the per-player row time
  // from player_summary (there is no last_updated_at field on the schema).
  const summaryQ = `SELECT last("username") AS u FROM "player_summary" WHERE "player" =~ /${regex}/ GROUP BY "player"`;

  const [[combat, assists, game, summary], supporting] = await Promise.all([
    runInfluxMultiQuery([combatQ, assistsQ, gameQ, summaryQ]),
    fetchSupportingStats(players.map((p) => p.playerId)),
  ]);

  const eByPlayer = new Map<string, number>();
  const dByPlayer = new Map<string, number>();
  for (const s of parseStatementSeries<{ e: number | null; d: number | null }>(combat)) {
    const tag = s.tags.player ?? '';
    const e = safeNumber(s.rows[0]?.e);
    const d = safeNumber(s.rows[0]?.d);
    if (e !== null) eByPlayer.set(tag, e);
    if (d !== null) dByPlayer.set(tag, d);
  }

  const aByPlayer = new Map<string, number>();
  for (const s of parseStatementSeries<{ a: number | null }>(assists)) {
    const tag = s.tags.player ?? '';
    const a = safeNumber(s.rows[0]?.a);
    if (a !== null) aByPlayer.set(tag, a);
  }

  const wpByPlayer = new Map<string, number>();
  for (const s of parseStatementSeries<{ gw: number | null; gp: number | null }>(game)) {
    const tag = s.tags.player ?? '';
    const gw = safeNumber(s.rows[0]?.gw);
    const gp = safeNumber(s.rows[0]?.gp);
    if (gw !== null && gp !== null && gp > 0) wpByPlayer.set(tag, (gw / gp) * 100);
  }

  const newestByPlayer = new Map<string, number>();
  let newestSeenAt: number | null = null;
  for (const s of parseStatementSeries<{ time: number; u: string | null }>(summary)) {
    const tag = s.tags.player ?? '';
    const seenAt = safeNumber(s.rows[0]?.time);
    if (seenAt !== null) {
      newestByPlayer.set(tag, seenAt);
      if (newestSeenAt === null || seenAt > newestSeenAt) newestSeenAt = seenAt;
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

  // Assists/death and heal-rate average across players; healing done is a
  // team total since per-player career totals are meaningful to sum.
  const apds: number[] = [];
  const heal10s: number[] = [];
  let healingDoneTotal = 0;
  let healingDoneSeen = false;
  for (const p of players) {
    const s = supporting.get(p.playerId);
    if (!s) continue;
    if (s.assistsPerDeath !== null) apds.push(s.assistsPerDeath);
    if (s.healingPer10Min !== null) heal10s.push(s.healingPer10Min);
    if (s.healingDone !== null) {
      healingDoneTotal += s.healingDone;
      healingDoneSeen = true;
    }
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
    teamAssistsPerDeath: apds.length ? apds.reduce((a, b) => a + b, 0) / apds.length : null,
    teamHealingDone: healingDoneSeen ? healingDoneTotal : null,
    teamHealingPer10Min: heal10s.length ? heal10s.reduce((a, b) => a + b, 0) / heal10s.length : null,
    newestSeenAt,
  };
}
