import { parseSeries, runInfluxQuery } from '../influxClient';
import { rankOrdinal } from '../normalize/rankOrdinal';
import { assessWideGroup, type WideGroupAssessment } from '../wideMatch';
import { buildPlayerRegex } from './_shared';
import type { Role, RosterPlayer } from '../../types/models';

export interface PlayerBestRole {
  player: RosterPlayer;
  bestRole: Role | null;
  bestOrdinal: number | null;
  byRole: Partial<Record<Role, number>>;
}

export interface TeamWideMatch {
  assessment: WideGroupAssessment;
  perPlayer: PlayerBestRole[];
}

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

function normalizeRole(raw: string | undefined): Role | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'dps') return 'damage';
  return (ROLES as readonly string[]).includes(lower) ? (lower as Role) : null;
}

export async function fetchTeamWideMatch(players: RosterPlayer[]): Promise<TeamWideMatch> {
  if (!players.length) {
    return { assessment: assessWideGroup([]), perPlayer: [] };
  }
  const regex = buildPlayerRegex(players);
  const q = `SELECT last("tier") AS tier, last("division") AS division FROM "competitive_rank" WHERE "player" =~ /${regex}/ GROUP BY "player", "role"`;
  const body = await runInfluxQuery(q);

  const byPlayer = new Map<string, Partial<Record<Role, number>>>();
  for (const s of parseSeries<{ time: number; tier: number | string | null; division: number | string | null }>(body)) {
    const tag = s.tags.player ?? '';
    const role = normalizeRole(s.tags.role);
    if (!role) continue;
    const row = s.rows[0];
    if (!row) continue;
    const ord = rankOrdinal(row.tier as string | number | null, row.division as string | number | null);
    if (ord === null) continue;
    const map = byPlayer.get(tag) ?? {};
    map[role] = ord;
    byPlayer.set(tag, map);
  }

  const perPlayer: PlayerBestRole[] = players.map((p) => {
    const map = byPlayer.get(p.playerId) ?? {};
    let bestRole: Role | null = null;
    let bestOrdinal: number | null = null;
    for (const role of ROLES) {
      const ord = map[role];
      if (typeof ord === 'number' && (bestOrdinal === null || ord > bestOrdinal)) {
        bestRole = role;
        bestOrdinal = ord;
      }
    }
    return { player: p, bestRole, bestOrdinal, byRole: map };
  });

  const ordinals = perPlayer.map((p) => p.bestOrdinal);
  return { assessment: assessWideGroup(ordinals), perPlayer };
}
