import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { BUCKETS, GAMEMODE, TIME_WINDOWS } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamKdaPoint {
  time: number;
  teamKda: number | null;
  byPlayer: Record<string, number | null>;
}

export async function fetchTeamKdaOverTime(players: RosterPlayer[]): Promise<TeamKdaPoint[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.teamSeason;
  const bucket = BUCKETS.teamKda;

  const combatQ = `SELECT mean("eliminations") AS e, mean("deaths") AS d FROM "career_stats_combat" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}), "player" fill(none)`;
  const assistsQ = `SELECT mean("assists") AS a FROM "career_stats_assists" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}), "player" fill(none)`;

  const [combatBody, assistsBody] = await Promise.all([
    runInfluxQuery(combatQ),
    runInfluxQuery(assistsQ),
  ]);

  const buckets = new Map<number, Map<string, { e?: number; d?: number; a?: number }>>();
  const getBucket = (time: number, player: string) => {
    let m = buckets.get(time);
    if (!m) { m = new Map(); buckets.set(time, m); }
    let r = m.get(player);
    if (!r) { r = {}; m.set(player, r); }
    return r;
  };

  for (const s of parseSeries<{ time: number; e: number | null; d: number | null }>(combatBody)) {
    const tag = s.tags.player ?? '';
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      const r = getBucket(t, tag);
      const e = safeNumber(row.e);
      const d = safeNumber(row.d);
      if (e !== null) r.e = e;
      if (d !== null) r.d = d;
    }
  }
  for (const s of parseSeries<{ time: number; a: number | null }>(assistsBody)) {
    const tag = s.tags.player ?? '';
    for (const row of s.rows) {
      const t = Number(row.time);
      if (!Number.isFinite(t)) continue;
      const r = getBucket(t, tag);
      const a = safeNumber(row.a);
      if (a !== null) r.a = a;
    }
  }

  const times = [...buckets.keys()].sort((a, b) => a - b);
  return times.map((time) => {
    const m = buckets.get(time)!;
    const byPlayer: Record<string, number | null> = {};
    const values: number[] = [];
    for (const [tag, r] of m) {
      const k = kdaFrom(r.e, r.a, r.d);
      byPlayer[tag] = k;
      if (k !== null) values.push(k);
    }
    return {
      time,
      teamKda: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      byPlayer,
    };
  });
}
