import { parseSeries, runInfluxQuery } from '../influxClient';
import type { RosterPlayer } from '../../types/models';
import { buildPlayerRegex } from './_shared';

type SeasonRow = Record<string, number | string | null> & {
  time: number;
  season: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchCurrentCompetitiveSeasonStart(
  players: RosterPlayer[] | readonly string[],
): Promise<number | null> {
  if (!players.length) return null;
  const regex = buildPlayerRegex(players);
  const latestQ = `SELECT max("season") AS season FROM "competitive_rank" WHERE "player" =~ /${regex}/`;
  const latestBody = await runInfluxQuery(latestQ);
  const latestSeason = finiteNumber(parseSeries<SeasonRow>(latestBody)[0]?.rows[0]?.season);
  if (latestSeason === null) return null;

  const startQ = `SELECT first("season") AS season FROM "competitive_rank" WHERE "player" =~ /${regex}/ AND "season"=${latestSeason}`;
  const startBody = await runInfluxQuery(startQ);
  let start: number | null = null;
  for (const series of parseSeries<SeasonRow>(startBody)) {
    const time = finiteNumber(series.rows[0]?.time);
    if (time === null) continue;
    if (start === null || time < start) start = time;
  }
  return start;
}

export async function currentSeasonTimePredicate(
  players: RosterPlayer[] | readonly string[],
  fallbackWindow: string,
): Promise<string> {
  try {
    const start = await fetchCurrentCompetitiveSeasonStart(players);
    if (start !== null) {
      return `time >= '${new Date(start).toISOString()}'`;
    }
  } catch {
    // Keep charts usable if rank/season lookup is temporarily unavailable.
  }
  return `time > now() - ${fallbackWindow}`;
}
