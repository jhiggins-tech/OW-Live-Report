import { parseStatementSeries, runInfluxMultiQuery } from '../../../influxClient';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { GAMEMODE, TIME_WINDOWS } from '../_constants';
import type { PlayerStatPoint, RosterPlayer } from '../../../../types/models';

export async function fetchPlayerScatter(players: RosterPlayer[]): Promise<PlayerStatPoint[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.scatter;

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "player"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "player"`;
  const gameQ = `SELECT last("win_percentage") AS wp, last("games_played") AS gp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "player"`;

  const [combat, assists, game] = await runInfluxMultiQuery([combatQ, assistsQ, gameQ]);

  const cByP = new Map<string, { e: number | null; d: number | null }>();
  for (const s of parseStatementSeries<{ e: number | null; d: number | null }>(combat)) {
    cByP.set(s.tags.player ?? '', { e: safeNumber(s.rows[0]?.e), d: safeNumber(s.rows[0]?.d) });
  }
  const aByP = new Map<string, number | null>();
  for (const s of parseStatementSeries<{ a: number | null }>(assists)) {
    aByP.set(s.tags.player ?? '', safeNumber(s.rows[0]?.a));
  }
  const gByP = new Map<string, { wp: number | null; gp: number | null; t: number | null }>();
  for (const s of parseStatementSeries<{ time: number; wp: number | null; gp: number | null }>(game)) {
    gByP.set(s.tags.player ?? '', {
      wp: safeNumber(s.rows[0]?.wp),
      gp: safeNumber(s.rows[0]?.gp),
      t: safeNumber(s.rows[0]?.time),
    });
  }

  return players.map((p) => {
    const comb = cByP.get(p.playerId);
    const assistsVal = aByP.get(p.playerId) ?? null;
    const gameVal = gByP.get(p.playerId);
    return {
      player: p.playerId,
      display: p.display,
      slug: p.slug,
      kda: kdaFrom(comb?.e, assistsVal, comb?.d),
      winRate: gameVal?.wp ?? null,
      gamesPlayed: gameVal?.gp ?? null,
      lastSeen: gameVal?.t ?? null,
      rankOrdinal: null,
    };
  });
}
