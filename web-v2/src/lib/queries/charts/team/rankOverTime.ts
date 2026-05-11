import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { rankOrdinal } from '../../../normalize/rankOrdinal';
import { buildPlayerRegex } from '../../_shared';
import { BUCKETS, TIME_WINDOWS } from '../_constants';
import type { Role, RosterPlayer } from '../../../../types/models';

export interface TeamRankPoint {
  time: number;
  byRole: Record<Role, number | null>;
}

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

export async function fetchTeamRankOverTime(players: RosterPlayer[]): Promise<TeamRankPoint[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.teamSeason;
  const bucket = BUCKETS.teamRank;
  const q = `SELECT last("tier") AS tier, last("division") AS division FROM "competitive_rank" WHERE "player" =~ /${regex}/ AND time > now() - ${window} GROUP BY time(${bucket}), "player", "role" fill(none)`;
  const body = await runInfluxQuery(q);

  const points = new Map<number, Record<Role, number[]>>();
  const ensure = (t: number) => {
    let p = points.get(t);
    if (!p) { p = { tank: [], damage: [], support: [] }; points.set(t, p); }
    return p;
  };

  for (const s of parseSeries<{ time: number; tier: string | null; division: number | string | null }>(body)) {
    const role = (s.tags.role ?? '').toLowerCase();
    const normalizedRole: Role | null = role === 'dps' ? 'damage' : (ROLES as readonly string[]).includes(role) ? (role as Role) : null;
    if (!normalizedRole) continue;
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      const ord = rankOrdinal(row.tier as string | null, row.division as number | string | null);
      if (ord === null) continue;
      ensure(t)[normalizedRole].push(ord);
    }
  }

  return [...points.keys()].sort((a, b) => a - b).map((time) => {
    const p = points.get(time)!;
    const mean = (arr: number[]): number | null => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return {
      time,
      byRole: { tank: mean(p.tank), damage: mean(p.damage), support: mean(p.support) },
    };
  });
}
