// Supporting stats that complement the headline win-rate / KDA numbers:
// assists per death, total healing done, and healing per 10 minutes.
// All values are read from the `all-heroes` aggregate rows so they reflect
// each player's career totals rather than a single hero.

import { parseStatementSeries, runInfluxMultiQuery } from '../influxClient';
import { safeNumber } from '../normalize/kda';
import { buildPlayerRegex } from './_shared';
import { getGamemode } from './charts/_constants';

export interface SupportingStats {
  assists: number | null;
  deaths: number | null;
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

  const combatQ = `SELECT last("deaths") AS d FROM "career_stats_combat" WHERE ${where} GROUP BY "player"`;
  const assistsQ = `SELECT last("assists") AS a, last("healing_done") AS hd FROM "career_stats_assists" WHERE ${where} GROUP BY "player"`;
  const avgQ = `SELECT last("healing_done_avg_per_10_min") AS h10 FROM "career_stats_average" WHERE ${where} GROUP BY "player"`;

  const [combat, assists, avg] = await runInfluxMultiQuery([combatQ, assistsQ, avgQ]);

  const ensure = (pid: string): SupportingStats => {
    let s = out.get(pid);
    if (!s) {
      s = { assists: null, deaths: null, assistsPerDeath: null, healingDone: null, healingPer10Min: null };
      out.set(pid, s);
    }
    return s;
  };

  for (const s of parseStatementSeries<{ d: number | null }>(combat)) {
    ensure(s.tags.player ?? '').deaths = safeNumber(s.rows[0]?.d);
  }
  for (const s of parseStatementSeries<{ a: number | null; hd: number | null }>(assists)) {
    const stats = ensure(s.tags.player ?? '');
    stats.assists = safeNumber(s.rows[0]?.a);
    stats.healingDone = safeNumber(s.rows[0]?.hd);
  }
  for (const s of parseStatementSeries<{ h10: number | null }>(avg)) {
    ensure(s.tags.player ?? '').healingPer10Min = safeNumber(s.rows[0]?.h10);
  }

  for (const stats of out.values()) {
    stats.assistsPerDeath = assistsPerDeathFrom(stats.assists, stats.deaths);
  }

  return out;
}
