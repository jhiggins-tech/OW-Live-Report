import { loadCareerDaily } from '../../../snapshotClient';
import { kdaFrom } from '../../../normalize/kda';
import { playerIdSet } from '../../_shared';
import { TIME_WINDOWS } from '../_constants';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamKdaPoint {
  time: number;
  teamKda: number | null;
  byPlayer: Record<string, number | null>;
}

export async function fetchTeamKdaOverTime(players: RosterPlayer[]): Promise<TeamKdaPoint[]> {
  if (!players.length) return [];
  const ids = playerIdSet(players);
  const cutoff = Date.now() - TIME_WINDOWS.teamSeason;
  const { rows } = await loadCareerDaily();

  const buckets = new Map<number, Map<string, { e: number | null; d: number | null; a: number | null }>>();
  for (const r of rows) {
    if (!ids.has(r.player) || r.day < cutoff) continue;
    let m = buckets.get(r.day);
    if (!m) { m = new Map(); buckets.set(r.day, m); }
    m.set(r.player, { e: r.eliminations, d: r.deaths, a: r.assists });
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
