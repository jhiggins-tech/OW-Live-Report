import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { getGamemode } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface HealingByHeroEntry {
  hero: string;
  prettyName: string;
  healingPer10Min: number;
}

// Career healing-per-10-min broken down by hero. Where multiple roster
// players play the same hero, the per-10-min rate is averaged across them
// (summing per-player rates would be meaningless for a normalised metric).
export async function fetchTeamHealingByHero(players: RosterPlayer[]): Promise<HealingByHeroEntry[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const q = `SELECT last("healing_done_avg_per_10_min") AS h10 FROM "career_stats_average" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' GROUP BY "player", "hero"`;
  const body = await runInfluxQuery(q);

  const acc = new Map<string, { total: number; count: number }>();
  for (const s of parseSeries<{ h10: number | null }>(body)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key || key === 'all-heroes' || key === 'all') continue;
    const h10 = safeNumber(s.rows[0]?.h10);
    if (h10 === null || h10 <= 0) continue;
    const entry = acc.get(key) ?? { total: 0, count: 0 };
    entry.total += h10;
    entry.count += 1;
    acc.set(key, entry);
  }

  return [...acc.entries()]
    .map(([hero, { total, count }]) => ({
      hero,
      prettyName: prettyHeroName(hero),
      healingPer10Min: total / count,
    }))
    .sort((a, b) => b.healingPer10Min - a.healingPer10Min)
    .slice(0, 15);
}
