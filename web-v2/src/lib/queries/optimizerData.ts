// Fetches everything the team optimizer needs in a single multi-statement
// HTTP request: per-(player, hero) latest stats + per-(player, role) latest
// rank. The optimizer bucket-rolls the per-hero stats up to per-role on the
// JS side using HERO_CATALOG, matching the role-breakdown chart's strategy.

import { parseStatementSeries, runInfluxMultiQuery } from '../influxClient';
import { heroRole } from '../heroCatalog';
import { heroKey, prettyHeroName } from '../normalize/heroKey';
import { kdaFrom, safeNumber } from '../normalize/kda';
import { rankOrdinal, rankLabelFromOrdinal } from '../normalize/rankOrdinal';
import { buildPlayerRegex } from './_shared';
import { getGamemode } from './charts/_constants';
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
  const regex = buildPlayerRegex(players);
  const gm = getGamemode();
  const window = '90d';

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player" =~ /${regex}/ AND "gamemode"='${gm}' AND time > now() - ${window} GROUP BY "player", "hero"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player" =~ /${regex}/ AND "gamemode"='${gm}' AND time > now() - ${window} GROUP BY "player", "hero"`;
  const gameQ = `SELECT last("games_played") AS gp, last("win_percentage") AS wp, last("time_played") AS tp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${gm}' AND time > now() - ${window} GROUP BY "player", "hero"`;
  const rankQ = `SELECT last("tier") AS tier, last("division") AS division FROM "competitive_rank" WHERE "player" =~ /${regex}/ GROUP BY "player", "role"`;

  const [combat, assists, game, ranks] = await runInfluxMultiQuery([combatQ, assistsQ, gameQ, rankQ]);

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
  const ensure = (pid: string, hero: string): PerHero => {
    let m = heroData.get(pid);
    if (!m) { m = new Map(); heroData.set(pid, m); }
    let h = m.get(hero);
    if (!h) { h = { e: null, d: null, a: null, gp: null, wp: null, tp: null }; m.set(hero, h); }
    return h;
  };

  for (const s of parseStatementSeries<{ e: number | null; d: number | null }>(combat)) {
    const pid = s.tags.player ?? '';
    const h = heroKey(s.tags.hero ?? '');
    if (!h || h === 'all-heroes') continue;
    const r = ensure(pid, h);
    r.e = safeNumber(s.rows[0]?.e);
    r.d = safeNumber(s.rows[0]?.d);
  }
  for (const s of parseStatementSeries<{ a: number | null }>(assists)) {
    const pid = s.tags.player ?? '';
    const h = heroKey(s.tags.hero ?? '');
    if (!h || h === 'all-heroes') continue;
    ensure(pid, h).a = safeNumber(s.rows[0]?.a);
  }
  for (const s of parseStatementSeries<{ gp: number | null; wp: number | null; tp: number | null }>(game)) {
    const pid = s.tags.player ?? '';
    const h = heroKey(s.tags.hero ?? '');
    if (!h || h === 'all-heroes') continue;
    const r = ensure(pid, h);
    r.gp = safeNumber(s.rows[0]?.gp);
    r.wp = safeNumber(s.rows[0]?.wp);
    r.tp = safeNumber(s.rows[0]?.tp);
  }

  // Latest rank per (player, role).
  const rankByPlayerRole = new Map<string, Partial<Record<Role, { ordinal: number; label: string }>>>();
  for (const s of parseStatementSeries<{ tier: number | string | null; division: number | string | null }>(ranks)) {
    const pid = s.tags.player ?? '';
    const roleRaw = (s.tags.role ?? '').toLowerCase();
    const role: Role | null = roleRaw === 'dps' ? 'damage' : (ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as Role) : null;
    if (!role) continue;
    const row = s.rows[0];
    if (!row) continue;
    const ord = rankOrdinal(row.tier, row.division);
    if (ord === null) continue;
    const map = rankByPlayerRole.get(pid) ?? {};
    map[role] = { ordinal: ord, label: rankLabelFromOrdinal(ord) };
    rankByPlayerRole.set(pid, map);
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

    // Roll up per-hero stats into per-role bins, weighted by games_played.
    const heroes = heroData.get(p.playerId);
    if (heroes) {
      for (const role of ROLES) {
        let gamesPlayed = 0;
        let timePlayed = 0;
        let winNum = 0;
        let winDen = 0;
        let kdaNum = 0;
        let kdaDen = 0;
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
          const heroKdaValue = kdaFrom(stats.e, stats.a, stats.d);
          if (heroKdaValue !== null && gp > 0) {
            kdaNum += heroKdaValue * gp;
            kdaDen += gp;
          }
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
        byRole[role].kda = kdaDen > 0 ? kdaNum / kdaDen : null;

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
