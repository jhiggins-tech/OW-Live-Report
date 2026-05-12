import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { kdaFrom, safeNumber } from '../../../normalize/kda';
import { quoteValue } from '../../_shared';
import { ONE_GAME_OUTLIER_WIN_RATE, TIME_WINDOWS } from '../_constants';
import { getGamemode } from '../_constants';
import type { HeroLeaderboardRow } from '../../../../types/models';

export async function fetchPlayerHeroLeaderboard(playerId: string): Promise<HeroLeaderboardRow[]> {
  const window = TIME_WINDOWS.playerSeason;
  const player = quoteValue(playerId);

  const gameQ = `SELECT last("games_played") AS gp, last("win_percentage") AS wp, last("time_played") AS tp FROM "career_stats_game" WHERE "player"='${player}' AND "gamemode"='${getGamemode()}' AND time > now() - ${window} GROUP BY "hero"`;
  const combatQ = `SELECT last("eliminations") AS e, last("deaths") AS d FROM "career_stats_combat" WHERE "player"='${player}' AND "gamemode"='${getGamemode()}' AND time > now() - ${window} GROUP BY "hero"`;
  const assistsQ = `SELECT last("assists") AS a FROM "career_stats_assists" WHERE "player"='${player}' AND "gamemode"='${getGamemode()}' AND time > now() - ${window} GROUP BY "hero"`;

  const [g, c, a] = await Promise.all([runInfluxQuery(gameQ), runInfluxQuery(combatQ), runInfluxQuery(assistsQ)]);

  const gByHero = new Map<string, { gp: number | null; wp: number | null; tp: number | null }>();
  for (const s of parseSeries<{ gp: number | null; wp: number | null; tp: number | null }>(g)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key) continue;
    gByHero.set(key, {
      gp: safeNumber(s.rows[0]?.gp),
      wp: safeNumber(s.rows[0]?.wp),
      tp: safeNumber(s.rows[0]?.tp),
    });
  }
  const cByHero = new Map<string, { e: number | null; d: number | null }>();
  for (const s of parseSeries<{ e: number | null; d: number | null }>(c)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key) continue;
    cByHero.set(key, { e: safeNumber(s.rows[0]?.e), d: safeNumber(s.rows[0]?.d) });
  }
  const aByHero = new Map<string, number | null>();
  for (const s of parseSeries<{ a: number | null }>(a)) {
    const key = heroKey(s.tags.hero ?? '');
    if (!key) continue;
    aByHero.set(key, safeNumber(s.rows[0]?.a));
  }

  const rows: HeroLeaderboardRow[] = [];
  for (const [hero, gameStats] of gByHero) {
    if (hero === 'all-heroes' || hero === 'all') continue;
    const combat = cByHero.get(hero);
    const assists = aByHero.get(hero) ?? null;
    const gp = gameStats.gp ?? 0;
    if (gp < 1) continue;
    // Filter 100%-WR one-game outliers per V1 behavior.
    if (gp <= 1 && gameStats.wp === ONE_GAME_OUTLIER_WIN_RATE) continue;
    rows.push({
      hero,
      prettyName: prettyHeroName(hero),
      gamesPlayed: gp,
      winRate: gameStats.wp,
      kda: kdaFrom(combat?.e, assists, combat?.d),
      timePlayedSeconds: gameStats.tp ?? 0,
    });
  }
  rows.sort((a, b) => (b.timePlayedSeconds ?? 0) - (a.timePlayedSeconds ?? 0));
  return rows;
}
