import { loadCareerLatest } from '../../../snapshotClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { playerIdSet } from '../../_shared';
import { currentSeasonCutoff } from '../../seasonWindow';
import { TIME_WINDOWS, getTopHeroCount } from '../_constants';
import type { HeroPoolEntry, RosterPlayer } from '../../../../types/models';

export async function fetchTeamHeroPool(players: RosterPlayer[]): Promise<HeroPoolEntry[]> {
  if (!players.length) return [];
  const ids = playerIdSet(players);
  const cutoff = await currentSeasonCutoff(players, TIME_WINDOWS.heroLatest);
  const { rows } = await loadCareerLatest();

  const totals = new Map<string, number>();
  for (const r of rows) {
    if (!ids.has(r.player) || r.time < cutoff) continue;
    const key = heroKey(r.hero);
    if (!key || key === 'all-heroes' || key === 'all') continue;
    const tp = safeNumber(r.timePlayed) ?? 0;
    if (tp <= 0) continue;
    totals.set(key, (totals.get(key) ?? 0) + tp);
  }

  return [...totals.entries()]
    .map(([hero, timePlayedSeconds]) => ({ hero, prettyName: prettyHeroName(hero), timePlayedSeconds }))
    .sort((a, b) => b.timePlayedSeconds - a.timePlayedSeconds)
    .slice(0, Math.max(1, getTopHeroCount() * 3));
}
