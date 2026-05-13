import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { BUCKETS, TIME_WINDOWS } from '../_constants';
import { getGamemode } from '../_constants';

export interface PlayerWinRatePoint {
  time: number;
  winRate: number | null;
}

export async function fetchPlayerWinRateTrend(playerId: string): Promise<PlayerWinRatePoint[]> {
  const window = TIME_WINDOWS.playerSeason;
  const bucket = BUCKETS.playerWinRate;
  // See team/statCards.ts for why we read games_won/games_played at
  // hero='all-heroes' instead of win_percentage.
  const q = `SELECT last("games_won") AS gw, last("games_played") AS gp FROM "career_stats_game" WHERE "player"='${quoteValue(playerId)}' AND "gamemode"='${getGamemode()}' AND "hero"='all-heroes' AND time > now() - ${window} GROUP BY time(${bucket}) fill(none)`;
  const body = await runInfluxQuery(q);
  const rows = parseSeries<{ time: number; gw: number | null; gp: number | null }>(body)[0]?.rows ?? [];
  return rows
    .map((r) => {
      const gw = safeNumber(r.gw);
      const gp = safeNumber(r.gp);
      return {
        time: Number(r.time),
        winRate: gw !== null && gp !== null && gp > 0 ? (gw / gp) * 100 : null,
      };
    })
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
}
