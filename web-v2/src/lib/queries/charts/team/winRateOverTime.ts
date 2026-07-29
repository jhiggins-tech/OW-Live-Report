import { loadCareerDaily } from '../../../snapshotClient';
import { safeNumber } from '../../../normalize/kda';
import { playerIdSet } from '../../_shared';
import { TIME_WINDOWS } from '../_constants';
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
  const ids = playerIdSet(players);
  const cutoff = Date.now() - TIME_WINDOWS.teamSeason;
  // See statCards.ts for why we read games_won/games_played at
  // hero='all-heroes' instead of win_percentage. The underlying series is
  // cumulative season-to-date counts sampled per snapshot; the daily rows
  // are the running WR snapshot at the end of each UTC day.
  const { rows } = await loadCareerDaily();

  // bucketed map: time -> playerId -> wp
  const perBucket = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (!ids.has(r.player) || r.day < cutoff) continue;
    const gw = safeNumber(r.gamesWon);
    const gp = safeNumber(r.gamesPlayed);
    if (gw === null || gp === null || gp <= 0) continue;
    const wp = (gw / gp) * 100;
    let m = perBucket.get(r.day);
    if (!m) { m = new Map(); perBucket.set(r.day, m); }
    m.set(r.player, wp);
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
