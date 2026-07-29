import { loadCareerLatest } from '../../../snapshotClient';
import { heroRole } from '../../../heroCatalog';
import { heroKey } from '../../../normalize/heroKey';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { currentSeasonCutoff } from '../../seasonWindow';
import { TIME_WINDOWS } from '../_constants';
import type { Role, RoleBreakdownEntry } from '../../../../types/models';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

// career_stats_* doesn't tag rows with role, so role is derived from hero via
// HERO_CATALOG. Heroes not in the catalog are skipped to avoid mislabeling.
export async function fetchPlayerRoleBreakdown(playerId: string): Promise<RoleBreakdownEntry[]> {
  const cutoff = await currentSeasonCutoff([playerId], TIME_WINDOWS.playerSeason);
  const { rows: snapshot } = await loadCareerLatest();

  interface PerHero {
    e: number | null;
    d: number | null;
    a: number | null;
    gp: number | null;
    wp: number | null;
    tp: number | null;
  }
  const byHero = new Map<string, PerHero>();
  for (const r of snapshot) {
    if (r.player !== playerId || r.time < cutoff) continue;
    const h = heroKey(r.hero);
    if (!h || h === 'all-heroes') continue;
    byHero.set(h, {
      e: safeNumber(r.eliminations),
      d: safeNumber(r.deaths),
      a: safeNumber(r.assists),
      gp: safeNumber(r.gamesPlayed),
      wp: safeNumber(r.winPercentage),
      tp: safeNumber(r.timePlayed),
    });
  }

  return ROLES.map((role) => {
    let gamesPlayed = 0;
    let timePlayed = 0;
    let weightedWinTotal = 0;
    let weightedWinDenom = 0;
    let eliminations = 0;
    let assists = 0;
    let deaths = 0;
    let hasKdaData = false;
    for (const [h, stats] of byHero) {
      if (heroRole(h) !== role) continue;
      const gp = stats.gp ?? 0;
      const tp = stats.tp ?? 0;
      // A hero with a game or combat row this window demonstrably has career
      // data, so counters absent from the season profile are reported zeros
      // (Blizzard omits zero-valued stats), not missing data.
      const played = stats.gp !== null || stats.e !== null || stats.d !== null;
      gamesPlayed += gp;
      timePlayed += tp;
      if (stats.wp !== null && gp > 0) {
        weightedWinTotal += stats.wp * gp;
        weightedWinDenom += gp;
      }
      if (played) {
        eliminations += stats.e ?? 0;
        assists += stats.a ?? 0;
        deaths += stats.d ?? 0;
        hasKdaData = true;
      }
    }
    return {
      role,
      // Ratios must be calculated from summed counters. Averaging hero KDAs
      // (even when game-weighted) overweights heroes with few deaths.
      kda: hasKdaData ? kdaFrom(eliminations, assists, deaths) : null,
      winRate: weightedWinDenom > 0 ? weightedWinTotal / weightedWinDenom : null,
      gamesPlayed: gamesPlayed > 0 ? gamesPlayed : null,
      timePlayedSeconds: timePlayed > 0 ? timePlayed : null,
    };
  });
}
