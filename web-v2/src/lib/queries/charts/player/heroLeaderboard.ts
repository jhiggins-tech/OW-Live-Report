import { loadCareerLatest } from '../../../snapshotClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { currentSeasonCutoff } from '../../seasonWindow';
import { ONE_GAME_OUTLIER_WIN_RATE, TIME_WINDOWS } from '../_constants';
import type { HeroLeaderboardRow } from '../../../../types/models';
import type { CareerLatestRow } from '../../../../types/snapshots';

export async function fetchPlayerHeroLeaderboard(playerId: string): Promise<HeroLeaderboardRow[]> {
  const cutoff = await currentSeasonCutoff([playerId], TIME_WINDOWS.playerSeason);
  const { rows: snapshot } = await loadCareerLatest();

  const byHero = new Map<string, CareerLatestRow>();
  for (const r of snapshot) {
    if (r.player !== playerId || r.time < cutoff) continue;
    const key = heroKey(r.hero);
    if (!key) continue;
    byHero.set(key, r);
  }

  const rows: HeroLeaderboardRow[] = [];
  for (const [hero, r] of byHero) {
    if (hero === 'all-heroes' || hero === 'all') continue;
    const gp = safeNumber(r.gamesPlayed) ?? 0;
    if (gp < 1) continue;
    const wp = safeNumber(r.winPercentage);
    // Filter 100%-WR one-game outliers per V1 behavior.
    if (gp <= 1 && wp === ONE_GAME_OUTLIER_WIN_RATE) continue;
    rows.push({
      hero,
      prettyName: prettyHeroName(hero),
      gamesPlayed: gp,
      winRate: wp,
      // The hero has a game row this window, so counters absent from the
      // season profile are reported zeros (Blizzard omits zero-valued stats),
      // not missing data.
      kda: kdaFrom(r.eliminations ?? 0, r.assists ?? 0, r.deaths ?? 0),
      timePlayedSeconds: safeNumber(r.timePlayed) ?? 0,
    });
  }
  rows.sort((a, b) => (b.timePlayedSeconds ?? 0) - (a.timePlayedSeconds ?? 0));
  return rows;
}
