import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { currentSeasonTimePredicate } from '../../seasonWindow';
import { BUCKETS, TIME_WINDOWS } from '../_constants';
import { getGamemode, getTopHeroCount } from '../_constants';

export interface PlayerHeroUsagePoint {
  time: number;
  byHero: Record<string, number>; // hero key -> seconds in bucket
}

export interface PlayerHeroUsageResult {
  points: PlayerHeroUsagePoint[];
  heroOrder: Array<{ key: string; pretty: string; total: number }>;
}

export async function fetchPlayerHeroUsage(playerId: string): Promise<PlayerHeroUsageResult> {
  const window = TIME_WINDOWS.playerSeason;
  const bucket = BUCKETS.heroUsage;
  const timeFilter = await currentSeasonTimePredicate([playerId], window);
  const q = `SELECT last("time_played") AS tp FROM "career_stats_game" WHERE "player"='${quoteValue(playerId)}' AND "gamemode"='${getGamemode()}' AND ${timeFilter} GROUP BY time(${bucket}), "hero" fill(none)`;
  const body = await runInfluxQuery(q);

  const totals = new Map<string, number>();
  const byTime = new Map<number, Record<string, number>>();
  for (const s of parseSeries<{ time: number; tp: number | null }>(body)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key || key === 'all-heroes' || key === 'all') continue;
    for (const row of s.rows) {
      const t = Number(row.time);
      const tp = safeNumber(row.tp) ?? 0;
      if (!Number.isFinite(t) || tp <= 0) continue;
      totals.set(key, tp);
      const bucketRec = byTime.get(t) ?? {};
      bucketRec[key] = tp;
      byTime.set(t, bucketRec);
    }
  }

  const heroOrder = [...totals.entries()]
    .map(([key, total]) => ({ key, pretty: prettyHeroName(key), total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(1, getTopHeroCount()));

  const heroSet = new Set(heroOrder.map((h) => h.key));
  const points = [...byTime.keys()]
    .sort((a, b) => a - b)
    .map((time) => {
      const raw = byTime.get(time)!;
      const trimmed: Record<string, number> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (heroSet.has(key)) trimmed[key] = val;
      }
      return { time, byHero: trimmed };
    });

  return { points, heroOrder };
}
