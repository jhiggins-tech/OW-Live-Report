import { loadRankCurrent } from '../snapshotClient';
import { rankOrdinal } from '../normalize/rankOrdinal';
import { assessWideGroup, type WideGroupAssessment } from '../wideMatch';
import { playerIdSet } from './_shared';
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
  const ids = playerIdSet(players);
  const { rows } = await loadRankCurrent();

  const byPlayer = new Map<string, Partial<Record<Role, number>>>();
  for (const r of rows) {
    if (!ids.has(r.player)) continue;
    const role = normalizeRole(r.role);
    if (!role) continue;
    const ord = rankOrdinal(r.tier, r.division);
    if (ord === null) continue;
    const map = byPlayer.get(r.player) ?? {};
    map[role] = ord;
    byPlayer.set(r.player, map);
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
