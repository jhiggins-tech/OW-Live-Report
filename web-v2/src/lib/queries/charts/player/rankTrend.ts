import { loadRankDaily } from '../../../snapshotClient';
import { rankOrdinal } from '../../../normalize/rankOrdinal';
import { windowEnd } from '../../seasonWindow';
import { TIME_WINDOWS } from '../_constants';
import type { Role } from '../../../../types/models';

export interface PlayerRankPoint {
  time: number;
  byRole: Record<Role, number | null>;
}

// Day resolution: the trend reads the daily roll-up (last sample per role
// per UTC day), the only history the repo keeps.
export async function fetchPlayerRankTrend(playerId: string, season?: number): Promise<PlayerRankPoint[]> {
  const cutoff = (await windowEnd(season)) - TIME_WINDOWS.playerSeason;
  const { rows } = await loadRankDaily(season);

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
