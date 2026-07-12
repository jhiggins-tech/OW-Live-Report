import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { getGamemode } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface HealingByHeroEntry {
  key: string;
  label: string;
  player: string;
  hero: string;
  prettyName: string;
  healingPer10Min: number;
}

// Career healing-per-10-min for each player/hero pairing — one entry per
// hero a roster player has logged time on. Sorted descending, top 15.
export async function fetchTeamHealingByHero(players: RosterPlayer[]): Promise<HealingByHeroEntry[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const displayById = new Map(players.map((p) => [p.playerId, p.display]));
  const q = `SELECT last("healing_done_avg_per_10_min") AS h10 FROM "career_stats_average" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' GROUP BY "player", "hero"`;
  const body = await runInfluxQuery(q);

  const entries: HealingByHeroEntry[] = [];
  for (const s of parseSeries<{ h10: number | null }>(body)) {
    const hero = heroKey(s.tags.hero ?? '');
    if (!hero || hero === 'all-heroes' || hero === 'all') continue;
    const h10 = safeNumber(s.rows[0]?.h10);
    if (h10 === null || h10 <= 0) continue;
    const playerId = s.tags.player ?? '';
    const player = displayById.get(playerId) ?? playerId;
    const prettyName = prettyHeroName(hero);
    entries.push({
      key: `${playerId}|${hero}`,
      label: `${player} | ${prettyName}`,
      player,
      hero,
      prettyName,
      healingPer10Min: h10,
    });
  }

  return entries
    .sort((a, b) => b.healingPer10Min - a.healingPer10Min)
    .slice(0, 15);
}
