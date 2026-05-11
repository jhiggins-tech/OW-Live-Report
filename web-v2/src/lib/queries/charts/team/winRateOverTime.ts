import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { BUCKETS, GAMEMODE, TIME_WINDOWS } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamWinRatePoint {
  time: number;
  teamWinRate: number | null;
}

export async function fetchTeamWinRateOverTime(players: RosterPlayer[]): Promise<TeamWinRatePoint[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.teamSeason;
  const bucket = BUCKETS.teamWinRate;
  const q = `SELECT mean("win_percentage") AS wp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}), "player" fill(none)`;
  const body = await runInfluxQuery(q);

  const buckets = new Map<number, number[]>();
  for (const s of parseSeries<{ time: number; wp: number | null }>(body)) {
    for (const row of s.rows) {
      const t = Number(row.time);
      const wp = safeNumber(row.wp);
      if (!Number.isFinite(t) || wp === null) continue;
      const arr = buckets.get(t) ?? [];
      arr.push(wp);
      buckets.set(t, arr);
    }
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((time) => {
    const arr = buckets.get(time)!;
    return {
      time,
      teamWinRate: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null,
    };
  });
}
