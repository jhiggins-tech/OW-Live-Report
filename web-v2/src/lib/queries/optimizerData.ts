// Loads everything the team optimizer needs from the snapshot datasets:
// per-(player, hero) latest stats + per-(player, role) latest rank. The
// optimizer bucket-rolls the per-hero stats up to per-role on the JS side
// using HERO_CATALOG, matching the role-breakdown chart's strategy.

import { loadCareerLatest, loadRankCurrent } from '../snapshotClient';
import { heroRole } from '../heroCatalog';
import { heroKey, prettyHeroName } from '../normalize/heroKey';
import { kdaFrom, safeNumber } from '../normalize/kda';
import { rankOrdinal, rankLabelFromOrdinal } from '../normalize/rankOrdinal';
import { playerIdSet } from './_shared';
import { currentSeasonCutoff } from './seasonWindow';
import { TIME_WINDOWS } from './charts/_constants';
import type { Role, RosterPlayer } from '../../types/models';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];
const TOP_HERO_LIMIT = 5;

export interface PlayerRoleStats {
  role: Role;
  gamesPlayed: number;
  timePlayedSeconds: number;
  kda: number | null;
  winRate: number | null;
  rankOrdinal: number | null;
  rankLabel: string;
}

export interface PlayerHeroStat {
  hero: string;
  prettyName: string;
  gamesPlayed: number;
  timePlayedSeconds: number;
  winRate: number | null;
  kda: number | null;
  // Player-local pickrate: share of this player's time/games spent on this
  // hero within the role (0-100), denominator = role total time, fallback
  // to role total games if time data is missing.
  pickRate: number | null;
}

export interface PlayerOptimizerData {
  player: RosterPlayer;
  byRole: Record<Role, PlayerRoleStats>;
  heroesByRole: Record<Role, PlayerHeroStat[]>;
  bestRole: Role | null;
}

function blankRoleStats(role: Role): PlayerRoleStats {
  return {
    role,
    gamesPlayed: 0,
    timePlayedSeconds: 0,
    kda: null,
    winRate: null,
    rankOrdinal: null,
    rankLabel: 'Unranked',
  };
}

export async function fetchOptimizerData(players: RosterPlayer[]): Promise<PlayerOptimizerData[]> {
  if (!players.length) return [];
  const ids = playerIdSet(players);
  const cutoff = await currentSeasonCutoff(players, TIME_WINDOWS.playerSeason);

  const [career, ranks] = await Promise.all([loadCareerLatest(), loadRankCurrent()]);

  interface PerHero {
    e: number | null;
    d: number | null;
    a: number | null;
    gp: number | null;
    wp: number | null;
    tp: number | null;
  }
  // Per-player, per-hero accumulator.
  const heroData = new Map<string, Map<string, PerHero>>();
  for (const r of career.rows) {
    if (!ids.has(r.player) || r.time < cutoff) continue;
    const h = heroKey(r.hero);
    if (!h || h === 'all-heroes') continue;
    let m = heroData.get(r.player);
    if (!m) { m = new Map(); heroData.set(r.player, m); }
    m.set(h, {
      e: safeNumber(r.eliminations),
      d: safeNumber(r.deaths),
      a: safeNumber(r.assists),
      gp: safeNumber(r.gamesPlayed),
      wp: safeNumber(r.winPercentage),
      tp: safeNumber(r.timePlayed),
    });
  }

  // Latest rank per (player, role).
  const rankByPlayerRole = new Map<string, Partial<Record<Role, { ordinal: number; label: string }>>>();
  for (const r of ranks.rows) {
    if (!ids.has(r.player)) continue;
    const roleRaw = r.role.toLowerCase();
    const role: Role | null = roleRaw === 'dps' ? 'damage' : (ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as Role) : null;
    if (!role) continue;
    const ord = rankOrdinal(r.tier, r.division);
    if (ord === null) continue;
    const map = rankByPlayerRole.get(r.player) ?? {};
    map[role] = { ordinal: ord, label: rankLabelFromOrdinal(ord) };
    rankByPlayerRole.set(r.player, map);
  }

  return players.map((p) => {
    const byRole: Record<Role, PlayerRoleStats> = {
      tank: blankRoleStats('tank'),
      damage: blankRoleStats('damage'),
      support: blankRoleStats('support'),
    };
    const heroesByRole: Record<Role, PlayerHeroStat[]> = {
      tank: [],
      damage: [],
      support: [],
    };

    // Roll up per-hero stats into per-role bins.
    const heroes = heroData.get(p.playerId);
    if (heroes) {
      for (const role of ROLES) {
        let gamesPlayed = 0;
        let timePlayed = 0;
        let winNum = 0;
        let winDen = 0;
        let eliminations = 0;
        let assists = 0;
        let deaths = 0;
        let hasKdaData = false;
        for (const [h, stats] of heroes) {
          if (heroRole(h) !== role) continue;
          const gp = stats.gp ?? 0;
          if (gp <= 0 && (stats.tp ?? 0) <= 0) continue;
          gamesPlayed += gp;
          timePlayed += stats.tp ?? 0;
          if (stats.wp !== null && gp > 0) {
            winNum += stats.wp * gp;
            winDen += gp;
          }
          // The hero passed the games/time-played guard above, so it has a
          // game row this window and counters absent from the season profile
          // are reported zeros (Blizzard omits zero-valued stats).
          const heroKdaValue = kdaFrom(stats.e ?? 0, stats.a ?? 0, stats.d ?? 0);
          eliminations += stats.e ?? 0;
          assists += stats.a ?? 0;
          deaths += stats.d ?? 0;
          hasKdaData = true;
          heroesByRole[role].push({
            hero: h,
            prettyName: prettyHeroName(h),
            gamesPlayed: gp,
            timePlayedSeconds: stats.tp ?? 0,
            winRate: stats.wp ?? null,
            kda: heroKdaValue,
            pickRate: null,
          });
        }
        byRole[role].gamesPlayed = gamesPlayed;
        byRole[role].timePlayedSeconds = timePlayed;
        byRole[role].winRate = winDen > 0 ? winNum / winDen : null;
        // Aggregate the underlying counters before dividing; averaging hero
        // ratios produces a biased role KDA.
        byRole[role].kda = hasKdaData ? kdaFrom(eliminations, assists, deaths) : null;

        // Compute pickrate against the role's denominator and pick top N.
        const roleTime = timePlayed;
        const roleGames = gamesPlayed;
        for (const entry of heroesByRole[role]) {
          if (roleTime > 0) {
            entry.pickRate = (entry.timePlayedSeconds / roleTime) * 100;
          } else if (roleGames > 0) {
            entry.pickRate = (entry.gamesPlayed / roleGames) * 100;
          }
        }
        heroesByRole[role].sort((a, b) => {
          if (b.timePlayedSeconds !== a.timePlayedSeconds) {
            return b.timePlayedSeconds - a.timePlayedSeconds;
          }
          return b.gamesPlayed - a.gamesPlayed;
        });
        heroesByRole[role] = heroesByRole[role].slice(0, TOP_HERO_LIMIT);
      }
    }

    // Apply per-role rank.
    const ranksForPlayer = rankByPlayerRole.get(p.playerId) ?? {};
    let bestRole: Role | null = null;
    let bestOrd = -Infinity;
    for (const role of ROLES) {
      const r = ranksForPlayer[role];
      if (r) {
        byRole[role].rankOrdinal = r.ordinal;
        byRole[role].rankLabel = r.label;
        if (r.ordinal > bestOrd) {
          bestOrd = r.ordinal;
          bestRole = role;
        }
      }
    }

    return { player: p, byRole, heroesByRole, bestRole };
  });
}
