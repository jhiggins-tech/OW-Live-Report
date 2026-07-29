import { loadCareerHeroDaily } from '../../../snapshotClient';
import { heroKey } from '../../../normalize/heroKey';
import { kdaFrom } from '../../../normalize/kda';
import { currentSeasonCutoff } from '../../seasonWindow';
import { BUCKETS, TIME_WINDOWS } from '../_constants';

export interface PlayerHeroPerfPoint {
  time: number;
  byHero: Record<string, number | null>; // hero key -> KDA in bucket
}

export async function fetchPlayerHeroPerf(playerId: string): Promise<PlayerHeroPerfPoint[]> {
  const bucket = BUCKETS.heroPerf;
  const cutoff = await currentSeasonCutoff([playerId], TIME_WINDOWS.playerSeason);
  const { rows } = await loadCareerHeroDaily();

  // Weekly buckets, last day in the bucket wins. A combat sample (elims or
  // deaths present) is what puts a hero on the chart for a bucket, matching
  // the old shape where the combat query drove the output.
  const combat = new Map<string, Map<number, { e: number | null; d: number | null }>>();
  const assistsByHero = new Map<string, Map<number, number | null>>();
  const sorted = rows
    .filter((r) => r.player === playerId && r.day >= cutoff)
    .sort((a, b) => a.day - b.day);
  for (const r of sorted) {
    const key = heroKey(r.hero);
    if (!key) continue;
    const t = r.day - (r.day % bucket);
    if (r.eliminations !== null || r.deaths !== null) {
      const byTime = combat.get(key) ?? new Map<number, { e: number | null; d: number | null }>();
      byTime.set(t, { e: r.eliminations, d: r.deaths });
      combat.set(key, byTime);
    }
    if (r.assists !== null) {
      const byTime = assistsByHero.get(key) ?? new Map<number, number | null>();
      byTime.set(t, r.assists);
      assistsByHero.set(key, byTime);
    }
  }

  const allTimes = new Set<number>();
  for (const byTime of combat.values()) for (const t of byTime.keys()) allTimes.add(t);

  return [...allTimes].sort((a, b) => a - b).map((time) => {
    const byHero: Record<string, number | null> = {};
    for (const [key, byTime] of combat) {
      const c2 = byTime.get(time);
      const a2 = assistsByHero.get(key)?.get(time) ?? null;
      if (!c2) continue;
      // A combat row exists in this bucket, so counters absent from the
      // season profile (assists on assist-less heroes, eliminations on
      // zero-elim windows) are reported zeros, not missing data.
      byHero[key] = kdaFrom(c2.e ?? 0, a2 ?? 0, c2.d ?? 0);
    }
    return { time, byHero };
  });
}
