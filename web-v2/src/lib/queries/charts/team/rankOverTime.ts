import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { rankOrdinal } from '../../../normalize/rankOrdinal';
import { buildPlayerRegex } from '../../_shared';
import { BUCKETS, TIME_WINDOWS } from '../_constants';
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
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.teamSeason;
  const bucket = BUCKETS.teamRank;
  const q = `SELECT last("tier") AS tier, last("division") AS division FROM "competitive_rank" WHERE "player" =~ /${regex}/ AND time > now() - ${window} GROUP BY time(${bucket}), "player", "role" fill(none)`;
  const body = await runInfluxQuery(q);

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

  for (const s of parseSeries<{ time: number; tier: string | null; division: number | string | null }>(body)) {
    const role = (s.tags.role ?? '').toLowerCase();
    const normalizedRole: Role | null = role === 'dps' ? 'damage' : (ROLES as readonly string[]).includes(role) ? (role as Role) : null;
    if (!normalizedRole) continue;
    const playerTag = s.tags.player ?? '';
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      const ord = rankOrdinal(row.tier as string | null, row.division as number | string | null);
      if (ord === null) continue;
      const acc = ensure(t);
      acc.byRoleOrdinals[normalizedRole].push(ord);
      const cur = acc.byPlayerOrdinals.get(playerTag) ?? [];
      cur.push(ord);
      acc.byPlayerOrdinals.set(playerTag, cur);
    }
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
