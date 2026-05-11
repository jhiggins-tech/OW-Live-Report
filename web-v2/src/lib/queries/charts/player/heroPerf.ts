import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { heroKey } from '../../../normalize/heroKey';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { BUCKETS, GAMEMODE, TIME_WINDOWS } from '../_constants';

export interface PlayerHeroPerfPoint {
  time: number;
  byHero: Record<string, number | null>; // hero key -> KDA in bucket
}

export async function fetchPlayerHeroPerf(battleTag: string): Promise<PlayerHeroPerfPoint[]> {
  const window = TIME_WINDOWS.playerSeason;
  const bucket = BUCKETS.heroPerf;
  const player = quoteValue(battleTag);

  const combatQ = `SELECT mean("eliminations") AS e, mean("deaths") AS d FROM "career_stats_combat" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}), "hero" fill(none)`;
  const assistsQ = `SELECT mean("assists") AS a FROM "career_stats_assists" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}), "hero" fill(none)`;
  const [c, a] = await Promise.all([runInfluxQuery(combatQ), runInfluxQuery(assistsQ)]);

  const combat = new Map<string, Map<number, { e: number | null; d: number | null }>>();
  for (const s of parseSeries<{ time: number; e: number | null; d: number | null }>(c)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key) continue;
    const byTime = combat.get(key) ?? new Map();
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      byTime.set(t, { e: safeNumber(row.e), d: safeNumber(row.d) });
    }
    combat.set(key, byTime);
  }

  const assistsByHero = new Map<string, Map<number, number | null>>();
  for (const s of parseSeries<{ time: number; a: number | null }>(a)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key) continue;
    const byTime = assistsByHero.get(key) ?? new Map();
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      byTime.set(t, safeNumber(row.a));
    }
    assistsByHero.set(key, byTime);
  }

  const allTimes = new Set<number>();
  for (const byTime of combat.values()) for (const t of byTime.keys()) allTimes.add(t);

  return [...allTimes].sort((a, b) => a - b).map((time) => {
    const byHero: Record<string, number | null> = {};
    for (const [key, byTime] of combat) {
      const c2 = byTime.get(time);
      const a2 = assistsByHero.get(key)?.get(time) ?? null;
      if (!c2) continue;
      byHero[key] = kdaFrom(c2.e, a2, c2.d);
    }
    return { time, byHero };
  });
}
