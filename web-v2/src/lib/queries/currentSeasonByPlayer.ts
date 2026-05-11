import { parseSeries, runInfluxQuery } from '../influxClient';
import type { RosterPlayer } from '../../types/models';
import { buildPlayerRegex } from './_shared';

export interface CurrentSeasonByPlayer {
  bySlug: Record<string, number | null>;
  byBattleTag: Record<string, number | null>;
  maxSeason: number | null;
}

export async function fetchCurrentSeasonByPlayer(players: RosterPlayer[]): Promise<CurrentSeasonByPlayer> {
  const regex = buildPlayerRegex(players);
  const q = `SELECT last("season") AS "season" FROM "competitive_rank" WHERE "player" =~ /${regex}/ GROUP BY "player"`;
  const body = await runInfluxQuery(q);
  const series = parseSeries<{ time: number; season: number | null }>(body);

  const bySlug: Record<string, number | null> = {};
  const byBattleTag: Record<string, number | null> = {};
  let maxSeason: number | null = null;

  for (const s of series) {
    const tag = s.tags.player ?? '';
    const season = typeof s.rows[0]?.season === 'number' ? s.rows[0].season : null;
    byBattleTag[tag] = season;
    const player = players.find((p) => p.battleTag === tag);
    if (player) bySlug[player.slug] = season;
    if (season !== null && (maxSeason === null || season > maxSeason)) {
      maxSeason = season;
    }
  }

  return { bySlug, byBattleTag, maxSeason };
}
