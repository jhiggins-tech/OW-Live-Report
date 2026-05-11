import { parseSeries, runInfluxQuery } from '../../../influxClient';
import { heroKey, prettyHeroName } from '../../../normalize/heroKey';
import { safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { TIME_WINDOWS } from '../_constants';
import { getGamemode, getTopHeroCount } from '../_constants';
import type { HeroPoolEntry, RosterPlayer } from '../../../../types/models';

export async function fetchTeamHeroPool(players: RosterPlayer[]): Promise<HeroPoolEntry[]> {
  if (!players.length) return [];
  const regex = buildPlayerRegex(players);
  const window = TIME_WINDOWS.heroLatest;
  const q = `SELECT sum("time_played") AS tp FROM "career_stats_game" WHERE "player" =~ /${regex}/ AND "gamemode"='${getGamemode()}' AND time > now() - ${window} GROUP BY "hero"`;
  const body = await runInfluxQuery(q);

  const totals = new Map<string, number>();
  for (const s of parseSeries<{ tp: number | null }>(body)) {
    const heroTag = s.tags.hero ?? '';
    const key = heroKey(heroTag);
    if (!key || key === 'all-heroes' || key === 'all') continue;
    const tp = safeNumber(s.rows[0]?.tp) ?? 0;
    if (tp <= 0) continue;
    totals.set(key, (totals.get(key) ?? 0) + tp);
  }

  return [...totals.entries()]
    .map(([hero, timePlayedSeconds]) => ({ hero, prettyName: prettyHeroName(hero), timePlayedSeconds }))
    .sort((a, b) => b.timePlayedSeconds - a.timePlayedSeconds)
    .slice(0, Math.max(1, getTopHeroCount() * 3));
}
