import { loadRankCurrent } from '../snapshotClient';
import { rankLabelFromOrdinal, rankOrdinal } from '../normalize/rankOrdinal';
import type { Role } from '../../types/models';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

export interface CurrentPlayerRank {
  ordinal: number;
  label: string;
  season: number | null;
  updatedAt: number;
}

export type CurrentPlayerRanks = Record<Role, CurrentPlayerRank | null>;

function normalizeRole(raw: string): Role | null {
  const role = raw.toLowerCase();
  if (role === 'dps') return 'damage';
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : null;
}

export async function fetchCurrentPlayerRanks(playerId: string): Promise<CurrentPlayerRanks> {
  const { rows } = await loadRankCurrent();
  const byRole: CurrentPlayerRanks = {
    tank: null,
    damage: null,
    support: null,
  };

  for (const row of rows) {
    if (row.player !== playerId) continue;
    const role = normalizeRole(row.role);
    if (!role) continue;

    const ordinal = rankOrdinal(row.tier, row.division);
    if (ordinal === null || !Number.isFinite(row.time)) continue;

    const current = byRole[role];
    if (current && current.updatedAt >= row.time) continue;

    byRole[role] = {
      ordinal,
      label: rankLabelFromOrdinal(ordinal),
      season: row.season,
      updatedAt: row.time,
    };
  }

  return byRole;
}
