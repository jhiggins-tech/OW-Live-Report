import { loadCareerDaily } from '../../../snapshotClient';
import { kdaFrom } from '../../../normalize/kda';
import { TIME_WINDOWS } from '../_constants';

export interface PlayerKdaPoint {
  time: number;
  kda: number | null;
}

export async function fetchPlayerKdaTrend(playerId: string): Promise<PlayerKdaPoint[]> {
  const cutoff = Date.now() - TIME_WINDOWS.playerSeason;
  const { rows } = await loadCareerDaily();
  return rows
    .filter((r) => r.player === playerId && r.day >= cutoff)
    .map((r) => ({ time: r.day, kda: kdaFrom(r.eliminations, r.assists, r.deaths) }))
    .sort((a, b) => a.time - b.time);
}
