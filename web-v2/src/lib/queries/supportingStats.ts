// Canonical player headline stats. All values come from the latest competitive
// `all-heroes` aggregate rows, so every overall KDA display uses the same
// counters rather than whichever hero series Influx happens to return.

import { parseStatementSeries, runInfluxMultiQuery } from '../influxClient';
import { kdaFrom, safeNumber } from '../normalize/kda';
import { buildPlayerRegex } from './_shared';
import { getGamemode } from './charts/_constants';

export interface SupportingStats {
  eliminations: number | null;
  assists: number | null;
  deaths: number | null;
  kda: number | null;
  gamesWon: number | null;
  gamesPlayed: number | null;
  winRate: number | null;
  assistsPerDeath: number | null;
  healingDone: number | null;
  healingPer10Min: number | null;
}

function assistsPerDeathFrom(assists: number | null, deaths: number | null): number | null {
  if (assists === null || deaths === null) return null;
  return assists / Math.max(deaths, 1);
}

export async function fetchSupportingStats(playerIds: readonly string[]): Promise<Map<string, SupportingStats>> {
  const out = new Map<string, SupportingStats>();
  if (!playerIds.length) return out;

  const regex = buildPlayerRegex(playerIds);
  const where = `"player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' AND "hero"='all-heroes'`;

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE ${where} GROUP BY "player"`;
  const assistsQ = `SELECT last("assists") AS a, last("healing_done") AS hd FROM "career_stats_assists" WHERE ${where} GROUP BY "player"`;
  const avgQ = `SELECT last("healing_done_avg_per_10_min") AS h10 FROM "career_stats_average" WHERE ${where} GROUP BY "player"`;
  const gameQ = `SELECT last("games_won") AS gw, last("games_played") AS gp FROM "career_stats_game" WHERE ${where} GROUP BY "player"`;

  const [combat, assists, avg, game] = await runInfluxMultiQuery([combatQ, assistsQ, avgQ, gameQ]);

  const ensure = (pid: string): SupportingStats => {
    let s = out.get(pid);
    if (!s) {
      s = {
        eliminations: null, assists: null, deaths: null, kda: null,
        gamesWon: null, gamesPlayed: null, winRate: null,
        assistsPerDeath: null, healingDone: null, healingPer10Min: null,
      };
      out.set(pid, s);
    }
    return s;
  };

  for (const s of parseStatementSeries<{ e: number | null; d: number | null }>(combat)) {
    const stats = ensure(s.tags.player ?? '');
    stats.eliminations = safeNumber(s.rows[0]?.e);
    stats.deaths = safeNumber(s.rows[0]?.d);
  }
  for (const s of parseStatementSeries<{ a: number | null; hd: number | null }>(assists)) {
    const stats = ensure(s.tags.player ?? '');
    stats.assists = safeNumber(s.rows[0]?.a);
    stats.healingDone = safeNumber(s.rows[0]?.hd);
  }
  for (const s of parseStatementSeries<{ h10: number | null }>(avg)) {
    ensure(s.tags.player ?? '').healingPer10Min = safeNumber(s.rows[0]?.h10);
  }
  for (const s of parseStatementSeries<{ gw: number | null; gp: number | null }>(game)) {
    const stats = ensure(s.tags.player ?? '');
    stats.gamesWon = safeNumber(s.rows[0]?.gw);
    stats.gamesPlayed = safeNumber(s.rows[0]?.gp);
  }

  for (const stats of out.values()) {
    stats.kda = kdaFrom(stats.eliminations, stats.assists, stats.deaths);
    stats.winRate = stats.gamesWon !== null && stats.gamesPlayed !== null && stats.gamesPlayed > 0
      ? (stats.gamesWon / stats.gamesPlayed) * 100
      : null;
    stats.assistsPerDeath = assistsPerDeathFrom(stats.assists, stats.deaths);
  }

  return out;
}
