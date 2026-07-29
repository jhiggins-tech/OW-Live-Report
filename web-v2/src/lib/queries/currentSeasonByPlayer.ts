import { loadRankCurrent } from '../snapshotClient';
import type { RankRow } from '../../types/snapshots';
import type { RosterPlayer } from '../../types/models';
import { playerIdSet } from './_shared';

export interface CurrentSeasonByPlayer {
  bySlug: Record<string, number | null>;
  byPlayerId: Record<string, number | null>;
  maxSeason: number | null;
}

export async function fetchCurrentSeasonByPlayer(players: RosterPlayer[]): Promise<CurrentSeasonByPlayer> {
  const ids = playerIdSet(players);
  const { rows } = await loadRankCurrent();

  // Latest sample per player (any role) — the old last("season") GROUP BY
  // "player" semantics.
  const latestByPlayer = new Map<string, RankRow>();
  for (const r of rows) {
    if (!ids.has(r.player)) continue;
    const prev = latestByPlayer.get(r.player);
    if (!prev || r.time > prev.time) latestByPlayer.set(r.player, r);
  }

  const bySlug: Record<string, number | null> = {};
  const byPlayerId: Record<string, number | null> = {};
  let maxSeason: number | null = null;

  for (const [tag, row] of latestByPlayer) {
    const season = row.season;
    byPlayerId[tag] = season;
    const player = players.find((p) => p.playerId === tag);
    if (player) bySlug[player.slug] = season;
    if (season !== null && (maxSeason === null || season > maxSeason)) {
      maxSeason = season;
    }
  }

  return { bySlug, byPlayerId, maxSeason };
}
