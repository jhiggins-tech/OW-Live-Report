import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { rankOrdinal } from '../../../normalize/rankOrdinal';
import { quoteValue } from '../../_shared';
import { BUCKETS, TIME_WINDOWS } from '../_constants';
import type { Role } from '../../../../types/models';

export interface PlayerRankPoint {
  time: number;
  byRole: Record<Role, number | null>;
}

export async function fetchPlayerRankTrend(battleTag: string): Promise<PlayerRankPoint[]> {
  const window = TIME_WINDOWS.playerSeason;
  const bucket = BUCKETS.playerRank;
  const q = `SELECT last("tier") AS tier, last("division") AS division FROM "competitive_rank" WHERE "player"='${quoteValue(battleTag)}' AND time > now() - ${window} GROUP BY time(${bucket}), "role" fill(none)`;
  const body = await runInfluxQuery(q);

  const points = new Map<number, Record<Role, number | null>>();
  const ensure = (t: number) => {
    let p = points.get(t);
    if (!p) { p = { tank: null, damage: null, support: null }; points.set(t, p); }
    return p;
  };

  for (const s of parseSeries<{ time: number; tier: string | null; division: number | string | null }>(body)) {
    const roleRaw = (s.tags.role ?? '').toLowerCase();
    const role: Role | null = roleRaw === 'dps' ? 'damage' : (['tank', 'damage', 'support'] as const).includes(roleRaw as Role) ? (roleRaw as Role) : null;
    if (!role) continue;
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      const ord = rankOrdinal(row.tier as string | null, row.division as number | string | null);
      if (ord === null) continue;
      ensure(t)[role] = ord;
    }
  }

  return [...points.keys()].sort((a, b) => a - b).map((time) => ({ time, byRole: points.get(time)! }));
}
