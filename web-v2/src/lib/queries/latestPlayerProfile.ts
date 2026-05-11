import { parseSeries, runInfluxQuery } from '../influxClient';
import { lastSelectClause, quoteValue } from './_shared';

const PROFILE_FIELDS = [
  'avatar',
  'namecard',
  'endorsement',
  'title',
  'last_updated_at',
] as const;

export interface PlayerProfile {
  battleTag: string;
  avatar: string | null;
  namecard: string | null;
  endorsement: number | null;
  title: string | null;
  lastUpdatedAt: number | null;
}

export async function fetchLatestPlayerProfile(battleTag: string): Promise<PlayerProfile | null> {
  const q = `SELECT ${lastSelectClause(PROFILE_FIELDS)} FROM "player_summary" WHERE "player"='${quoteValue(battleTag)}'`;
  const body = await runInfluxQuery(q);
  const series = parseSeries<Record<string, number | string | null>>(body);
  const first = series[0]?.rows?.[0];
  if (!first) return null;
  return {
    battleTag,
    avatar: (first.avatar as string | null) ?? null,
    namecard: (first.namecard as string | null) ?? null,
    endorsement: typeof first.endorsement === 'number' ? first.endorsement : null,
    title: (first.title as string | null) ?? null,
    lastUpdatedAt: typeof first.last_updated_at === 'number' ? first.last_updated_at : null,
  };
}
