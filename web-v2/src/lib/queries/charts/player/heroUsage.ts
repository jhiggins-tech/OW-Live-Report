import { loadCareerHeroDaily } from '../../../snapshotClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { currentSeasonCutoff } from '../../seasonWindow';
import { BUCKETS, TIME_WINDOWS, getTopHeroCount } from '../_constants';

export interface PlayerHeroUsagePoint {
  time: number;
  byHero: Record<string, number>; // hero key -> seconds in bucket
}

export interface PlayerHeroUsageResult {
  points: PlayerHeroUsagePoint[];
  heroOrder: Array<{ key: string; pretty: string; total: number }>;
}

export async function fetchPlayerHeroUsage(playerId: string): Promise<PlayerHeroUsageResult> {
  const bucket = BUCKETS.heroUsage;
  const cutoff = await currentSeasonCutoff([playerId], TIME_WINDOWS.playerSeason);
  const { rows } = await loadCareerHeroDaily();

  // Weekly buckets over the daily series; the last day in a bucket wins,
  // mirroring the old GROUP BY time(1w) + last() roll-up of a cumulative
  // season-to-date counter.
  const totals = new Map<string, number>();
  const byTime = new Map<number, Record<string, number>>();
  const sorted = rows
    .filter((r) => r.player === playerId && r.day >= cutoff)
    .sort((a, b) => a.day - b.day);
  for (const r of sorted) {
    const key = heroKey(r.hero);
    if (!key || key === 'all-heroes' || key === 'all') continue;
    const tp = safeNumber(r.timePlayed) ?? 0;
    if (tp <= 0) continue;
    const t = r.day - (r.day % bucket);
    totals.set(key, tp);
    const bucketRec = byTime.get(t) ?? {};
    bucketRec[key] = tp;
    byTime.set(t, bucketRec);
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
