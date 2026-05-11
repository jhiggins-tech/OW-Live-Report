import { parseStatementSeries, runInfluxMultiQuery } from '../../../influxClient';
import { heroRole } from '../../../heroCatalog';
import { heroKey } from '../../../normalize/heroKey';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { GAMEMODE, TIME_WINDOWS } from '../_constants';
import type { Role, RoleBreakdownEntry } from '../../../../types/models';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

// career_stats_* doesn't tag rows with role, so role is derived from hero via
// HERO_CATALOG. Heroes not in the catalog are skipped to avoid mislabeling.
export async function fetchPlayerRoleBreakdown(playerId: string): Promise<RoleBreakdownEntry[]> {
  const window = TIME_WINDOWS.playerSeason;
  const player = quoteValue(playerId);

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "hero"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "hero"`;
  const gameQ = `SELECT last("games_played") AS gp, last("win_percentage") AS wp, last("time_played") AS tp FROM "career_stats_game" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "hero"`;

  const [combat, assists, game] = await runInfluxMultiQuery([combatQ, assistsQ, gameQ]);

  interface PerHero {
    e: number | null;
    d: number | null;
    a: number | null;
    gp: number | null;
    wp: number | null;
    tp: number | null;
  }
  const byHero = new Map<string, PerHero>();
  const ensure = (h: string): PerHero => {
    let r = byHero.get(h);
    if (!r) { r = { e: null, d: null, a: null, gp: null, wp: null, tp: null }; byHero.set(h, r); }
    return r;
  };

  for (const s of parseStatementSeries<{ e: number | null; d: number | null }>(combat)) {
    const h = heroKey(s.tags.hero ?? '');
    if (!h || h === 'all-heroes') continue;
    const r = ensure(h);
    r.e = safeNumber(s.rows[0]?.e);
    r.d = safeNumber(s.rows[0]?.d);
  }
  for (const s of parseStatementSeries<{ a: number | null }>(assists)) {
    const h = heroKey(s.tags.hero ?? '');
    if (!h || h === 'all-heroes') continue;
    ensure(h).a = safeNumber(s.rows[0]?.a);
  }
  for (const s of parseStatementSeries<{ gp: number | null; wp: number | null; tp: number | null }>(game)) {
    const h = heroKey(s.tags.hero ?? '');
    if (!h || h === 'all-heroes') continue;
    const r = ensure(h);
    r.gp = safeNumber(s.rows[0]?.gp);
    r.wp = safeNumber(s.rows[0]?.wp);
    r.tp = safeNumber(s.rows[0]?.tp);
  }

  return ROLES.map((role) => {
    let gamesPlayed = 0;
    let timePlayed = 0;
    let weightedWinTotal = 0;
    let weightedWinDenom = 0;
    let weightedKdaTotal = 0;
    let weightedKdaDenom = 0;
    for (const [h, stats] of byHero) {
      if (heroRole(h) !== role) continue;
      const gp = stats.gp ?? 0;
      const tp = stats.tp ?? 0;
      const kda = kdaFrom(stats.e, stats.a, stats.d);
      gamesPlayed += gp;
      timePlayed += tp;
      if (stats.wp !== null && gp > 0) {
        weightedWinTotal += stats.wp * gp;
        weightedWinDenom += gp;
      }
      if (kda !== null && gp > 0) {
        weightedKdaTotal += kda * gp;
        weightedKdaDenom += gp;
      }
    }
    return {
      role,
      kda: weightedKdaDenom > 0 ? weightedKdaTotal / weightedKdaDenom : null,
      winRate: weightedWinDenom > 0 ? weightedWinTotal / weightedWinDenom : null,
      gamesPlayed: gamesPlayed > 0 ? gamesPlayed : null,
      timePlayedSeconds: timePlayed > 0 ? timePlayed : null,
    };
  });
}
