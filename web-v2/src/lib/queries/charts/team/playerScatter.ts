import { loadCareerLatest } from '../../../snapshotClient';
import { kdaFrom } from '../../../normalize/kda';
import { playerIdSet } from '../../_shared';
import { TIME_WINDOWS } from '../_constants';
import type { PlayerStatPoint, RosterPlayer } from '../../../../types/models';
import type { CareerLatestRow } from '../../../../types/snapshots';

export async function fetchPlayerScatter(players: RosterPlayer[]): Promise<PlayerStatPoint[]> {
  if (!players.length) return [];
  const ids = playerIdSet(players);
  const cutoff = Date.now() - TIME_WINDOWS.scatter;
  const { rows } = await loadCareerLatest();

  // Latest all-heroes aggregate per player, provided it's fresh enough for
  // the scatter's window — matching the old `time > now() - 7d` predicate.
  const byPlayer = new Map<string, CareerLatestRow>();
  for (const r of rows) {
    if (r.hero !== 'all-heroes' || !ids.has(r.player) || r.time < cutoff) continue;
    byPlayer.set(r.player, r);
  }

  return players.map((p) => {
    const r = byPlayer.get(p.playerId);
    const gw = r?.gamesWon ?? null;
    const gp = r?.gamesPlayed ?? null;
    return {
      player: p.playerId,
      display: p.display,
      slug: p.slug,
      kda: kdaFrom(r?.eliminations, r?.assists, r?.deaths),
      // See statCards.ts for why WR derives from games_won/games_played at
      // hero='all-heroes' rather than reading win_percentage.
      winRate: gw !== null && gp !== null && gp > 0 ? (gw / gp) * 100 : null,
      gamesPlayed: gp,
      lastSeen: r?.time ?? null,
      rankOrdinal: null,
    };
  });
}
