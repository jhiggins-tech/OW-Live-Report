import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { GAMEMODE, TIME_WINDOWS } from '../_constants';
import type { Role, RoleBreakdownEntry } from '../../../../types/models';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

export async function fetchPlayerRoleBreakdown(battleTag: string): Promise<RoleBreakdownEntry[]> {
  const window = TIME_WINDOWS.playerSeason;
  const player = quoteValue(battleTag);

  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "role"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "role"`;
  const gameQ = `SELECT last("win_percentage") AS wp, last("games_played") AS gp, last("time_played") AS tp FROM "career_stats_game" WHERE "player"='${player}' AND "gamemode"='${GAMEMODE}' AND time > now() - ${window} GROUP BY "role"`;

  const [c, a, g] = await Promise.all([runInfluxQuery(combatQ), runInfluxQuery(assistsQ), runInfluxQuery(gameQ)]);

  const cByRole = new Map<string, { e: number | null; d: number | null }>();
  for (const s of parseSeries<{ e: number | null; d: number | null }>(c)) {
    cByRole.set((s.tags.role ?? '').toLowerCase(), { e: safeNumber(s.rows[0]?.e), d: safeNumber(s.rows[0]?.d) });
  }
  const aByRole = new Map<string, number | null>();
  for (const s of parseSeries<{ a: number | null }>(a)) {
    aByRole.set((s.tags.role ?? '').toLowerCase(), safeNumber(s.rows[0]?.a));
  }
  const gByRole = new Map<string, { wp: number | null; gp: number | null; tp: number | null }>();
  for (const s of parseSeries<{ wp: number | null; gp: number | null; tp: number | null }>(g)) {
    gByRole.set((s.tags.role ?? '').toLowerCase(), {
      wp: safeNumber(s.rows[0]?.wp),
      gp: safeNumber(s.rows[0]?.gp),
      tp: safeNumber(s.rows[0]?.tp),
    });
  }

  return ROLES.map((role) => {
    const tagRole = role === 'damage' ? ['damage', 'dps'] : [role];
    let comb: { e: number | null; d: number | null } | undefined;
    let assists: number | null = null;
    let game: { wp: number | null; gp: number | null; tp: number | null } | undefined;
    for (const t of tagRole) {
      comb = comb ?? cByRole.get(t);
      assists = assists ?? aByRole.get(t) ?? null;
      game = game ?? gByRole.get(t);
    }
    return {
      role,
      kda: kdaFrom(comb?.e, assists, comb?.d),
      winRate: game?.wp ?? null,
      gamesPlayed: game?.gp ?? null,
      timePlayedSeconds: game?.tp ?? null,
    };
  });
}
