import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { BUCKETS, GAMEMODE, TIME_WINDOWS } from '../_constants';

export interface PlayerWinRatePoint {
  time: number;
  winRate: number | null;
}

export async function fetchPlayerWinRateTrend(playerId: string): Promise<PlayerWinRatePoint[]> {
  const window = TIME_WINDOWS.playerSeason;
  const bucket = BUCKETS.playerWinRate;
  const q = `SELECT mean("win_percentage") AS wp FROM "career_stats_game" WHERE "player"='${quoteValue(playerId)}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY time(${bucket}) fill(none)`;
  const body = await runInfluxQuery(q);
  const rows = parseSeries<{ time: number; wp: number | null }>(body)[0]?.rows ?? [];
  return rows
    .map((r) => ({ time: Number(r.time), winRate: safeNumber(r.wp) }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
}
