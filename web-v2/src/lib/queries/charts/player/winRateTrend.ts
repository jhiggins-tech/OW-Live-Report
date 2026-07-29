import { loadCareerDaily } from '../../../snapshotClient';
import { safeNumber } from '../../../normalize/kda';
import { TIME_WINDOWS } from '../_constants';

export interface PlayerWinRatePoint {
  time: number;
  winRate: number | null;
}

export async function fetchPlayerWinRateTrend(playerId: string): Promise<PlayerWinRatePoint[]> {
  const cutoff = Date.now() - TIME_WINDOWS.playerSeason;
  // See team/statCards.ts for why we read games_won/games_played at
  // hero='all-heroes' instead of win_percentage.
  const { rows } = await loadCareerDaily();
  return rows
    .filter((r) => r.player === playerId && r.day >= cutoff)
    .map((r) => {
      const gw = safeNumber(r.gamesWon);
      const gp = safeNumber(r.gamesPlayed);
      return {
        time: r.day,
        winRate: gw !== null && gp !== null && gp > 0 ? (gw / gp) * 100 : null,
      };
    })
    .sort((a, b) => a.time - b.time);
}
