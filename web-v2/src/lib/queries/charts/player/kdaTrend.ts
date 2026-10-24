import { loadCareerDaily } from '../../../snapshotClient';
import { kdaFrom } from '../../../normalize/kda';
import { windowEnd } from '../../seasonWindow';
import { TIME_WINDOWS } from '../_constants';

export interface PlayerKdaPoint {
  time: number;
  kda: number | null;
}

export async function fetchPlayerKdaTrend(playerId: string, season?: number): Promise<PlayerKdaPoint[]> {
  const cutoff = (await windowEnd(season)) - TIME_WINDOWS.playerSeason;
  const { rows } = await loadCareerDaily(season);
  return rows
    .filter((r) => r.player === playerId && r.day >= cutoff)
    .map((r) => ({ time: r.day, kda: kdaFrom(r.eliminations, r.assists, r.deaths) }))
    .sort((a, b) => a.time - b.time);
}
