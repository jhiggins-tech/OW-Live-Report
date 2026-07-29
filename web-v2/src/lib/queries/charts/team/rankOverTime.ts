import { loadRankDaily } from '../../../snapshotClient';
import { rankOrdinal } from '../../../normalize/rankOrdinal';
import { playerIdSet } from '../../_shared';
import { TIME_WINDOWS } from '../_constants';
import type { Role, RosterPlayer } from '../../../../types/models';

export interface TeamRankPoint {
  time: number;
  byRole: Record<Role, number | null>;
  // Per-player ordinal averaged across whichever roles the player has at
  // that bucket. Used by useTeamTrajectories to piggy-back on this query.
  byPlayer: Record<string, number | null>;
}

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

export async function fetchTeamRankOverTime(players: RosterPlayer[]): Promise<TeamRankPoint[]> {
  if (!players.length) return [];
  const ids = playerIdSet(players);
  const cutoff = Date.now() - TIME_WINDOWS.teamSeason;
  const { rows } = await loadRankDaily();

  interface BucketAcc {
    byRoleOrdinals: Record<Role, number[]>;
    byPlayerOrdinals: Map<string, number[]>;
  }
  const points = new Map<number, BucketAcc>();
  const ensure = (t: number): BucketAcc => {
    let p = points.get(t);
    if (!p) {
      p = {
        byRoleOrdinals: { tank: [], damage: [], support: [] },
        byPlayerOrdinals: new Map(),
      };
      points.set(t, p);
    }
    return p;
  };

  for (const r of rows) {
    if (!ids.has(r.player) || r.day < cutoff) continue;
    const role = r.role.toLowerCase();
    const normalizedRole: Role | null = role === 'dps' ? 'damage' : (ROLES as readonly string[]).includes(role) ? (role as Role) : null;
    if (!normalizedRole) continue;
    const ord = rankOrdinal(r.tier, r.division);
    if (ord === null) continue;
    const acc = ensure(r.day);
    acc.byRoleOrdinals[normalizedRole].push(ord);
    const cur = acc.byPlayerOrdinals.get(r.player) ?? [];
    cur.push(ord);
    acc.byPlayerOrdinals.set(r.player, cur);
  }

  const mean = (arr: number[]): number | null => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return [...points.keys()].sort((a, b) => a - b).map((time) => {
    const p = points.get(time)!;
    const byPlayer: Record<string, number | null> = {};
    for (const [tag, ords] of p.byPlayerOrdinals) byPlayer[tag] = mean(ords);
    return {
      time,
      byRole: {
        tank: mean(p.byRoleOrdinals.tank),
        damage: mean(p.byRoleOrdinals.damage),
        support: mean(p.byRoleOrdinals.support),
      },
      byPlayer,
    };
  });
}
