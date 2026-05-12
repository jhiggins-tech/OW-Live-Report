import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { BUCKETS, TIME_WINDOWS } from '../_constants';
import { getGamemode } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamWinRatePoint {
  time: number;
  teamWinRate: number | null;
  // Per-player mean win rate for the bucket. Used by useTeamTrajectories to
  // piggy-back on this query rather than firing a separate request.
  byPlayer: Record<string, number | null>;
}

export async function fetchTeamWinRateOverTime(players: RosterPlayer[]): Promise<TeamWinRatePoint[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.teamSeason;
  const bucket = BUCKETS.teamWinRate;
  // See statCards.ts for why we read games_won/games_played at
  // hero='all-heroes' instead of win_percentage. The underlying series is
  // cumulative season-to-date counts sampled per snapshot; last() per
  // bucket gives the running WR snapshot at the end of that bucket.
  const q = `SELECT last("games_won") AS gw, last("games_played") AS gp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' AND "hero"='all-heroes' AND time > now() - ${window} GROUP BY time(${bucket}), "player" fill(none)`;
  const body = await runInfluxQuery(q);

  // bucketed map: time -> playerId -> wp
  const perBucket = new Map<number, Map<string, number>>();
  for (const s of parseSeries<{ time: number; gw: number | null; gp: number | null }>(body)) {
    const tag = s.tags.player ?? '';
    for (const row of s.rows) {
      const t = Number(row.time);
      const gw = safeNumber(row.gw);
      const gp = safeNumber(row.gp);
      if (!Number.isFinite(t) || gw === null || gp === null || gp <= 0) continue;
      const wp = (gw / gp) * 100;
      let m = perBucket.get(t);
      if (!m) { m = new Map(); perBucket.set(t, m); }
      m.set(tag, wp);
    }
  }
  return [...perBucket.keys()].sort((a, b) => a - b).map((time) => {
    const m = perBucket.get(time)!;
    const byPlayer: Record<string, number | null> = {};
    const values: number[] = [];
    for (const [tag, wp] of m) {
      byPlayer[tag] = wp;
      values.push(wp);
    }
    return {
      time,
      teamWinRate: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      byPlayer,
    };
  });
}
