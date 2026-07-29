import { loadCareerLatest } from '../../../snapshotClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { playerIdSet } from '../../_shared';
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
  const ids = playerIdSet(players);
  const displayById = new Map(players.map((p) => [p.playerId, p.display]));
  const { rows } = await loadCareerLatest();

  const entries: HealingByHeroEntry[] = [];
  for (const r of rows) {
    if (!ids.has(r.player)) continue;
    const hero = heroKey(r.hero);
    if (!hero || hero === 'all-heroes' || hero === 'all') continue;
    const h10 = safeNumber(r.healingPer10Min);
    if (h10 === null || h10 <= 0) continue;
    const player = displayById.get(r.player) ?? r.player;
    const prettyName = prettyHeroName(hero);
    entries.push({
      key: `${r.player}|${hero}`,
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
