import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { BUCKETS, GAMEMODE, TIME_WINDOWS } from '../_constants';

export interface PlayerKdaPoint {
  time: number;
  kda: number | null;
}

export async function fetchPlayerKdaTrend(playerId: string): Promise<PlayerKdaPoint[]> {
  const window = TIME_WINDOWS.playerSeason;
  const bucket = BUCKETS.playerKda;
  const player = quoteValue(playerId);

  const combatQ = `SELECT mean("eliminations") AS e, mean("deaths") AS d FROM "career_stats_combat" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}) fill(none)`;
  const assistsQ = `SELECT mean("assists") AS a FROM "career_stats_assists" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}) fill(none)`;
  const [combatBody, assistsBody] = await Promise.all([runInfluxQuery(combatQ), runInfluxQuery(assistsQ)]);

  const combat = parseSeries<{ time: number; e: number | null; d: number | null }>(combatBody)[0]?.rows ?? [];
  const assists = parseSeries<{ time: number; a: number | null }>(assistsBody)[0]?.rows ?? [];

  const aByTime = new Map<number, number | null>();
  for (const r of assists) aByTime.set(Number(r.time), safeNumber(r.a));

  return combat
    .map((r) => {
      const t = Number(r.time);
      const e = safeNumber(r.e);
      const d = safeNumber(r.d);
      const a = aByTime.get(t) ?? null;
      return { time: t, kda: kdaFrom(e, a, d) };
    })
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
}
