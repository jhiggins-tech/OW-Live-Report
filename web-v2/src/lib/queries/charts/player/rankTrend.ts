import { loadRankDaily } from '../../../snapshotClient';
import { rankOrdinal } from '../../../normalize/rankOrdinal';
import { TIME_WINDOWS } from '../_constants';
import type { Role } from '../../../../types/models';

export interface PlayerRankPoint {
  time: number;
  byRole: Record<Role, number | null>;
}

// Day resolution: raw hourly samples only survive 14 days server-side, so
// the trend reads the daily table (last sample per role per UTC day).
export async function fetchPlayerRankTrend(playerId: string): Promise<PlayerRankPoint[]> {
  const cutoff = Date.now() - TIME_WINDOWS.playerSeason;
  const { rows } = await loadRankDaily();

  const points = new Map<number, Record<Role, number | null>>();
  const ensure = (t: number) => {
    let p = points.get(t);
    if (!p) { p = { tank: null, damage: null, support: null }; points.set(t, p); }
    return p;
  };

  for (const r of rows) {
    if (r.player !== playerId || r.day < cutoff) continue;
    const roleRaw = r.role.toLowerCase();
    const role: Role | null = roleRaw === 'dps' ? 'damage' : (['tank', 'damage', 'support'] as const).includes(roleRaw as Role) ? (roleRaw as Role) : null;
    if (!role) continue;
    const ord = rankOrdinal(r.tier, r.division);
    if (ord === null) continue;
    ensure(r.day)[role] = ord;
  }

  return [...points.keys()].sort((a, b) => a - b).map((time) => ({ time, byRole: points.get(time)! }));
}
