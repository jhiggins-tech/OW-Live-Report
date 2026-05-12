import { parseSeries, runInfluxQuery } from '../influxClient';
import { lastSelectClause, quoteValue } from './_shared';

// Schema as of 2026-05: avatar/namecard/title/username are string,
// endorsement_level is float, endorsement_frame is string.
// There is NO last_updated_at field — derive the timestamp from the
// `time` column that `last()` returns automatically.
const PROFILE_FIELDS = [
  'avatar',
  'namecard',
  'endorsement_level',
  'endorsement_frame',
  'title',
  'username',
] as const;

export interface PlayerProfile {
  playerId: string;
  avatar: string | null;
  namecard: string | null;
  endorsement: number | null;
  endorsementFrame: string | null;
  title: string | null;
  username: string | null;
  lastUpdatedAt: number | null;
}

export async function fetchLatestPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  // GROUP BY "player" keeps last()'s row time as the actual last timestamp;
  // without it, InfluxDB returns a synthesized time of 0.
  const q = `SELECT ${lastSelectClause(PROFILE_FIELDS)} FROM "player_summary" WHERE "player"='${quoteValue(playerId)}' GROUP BY "player"`;
  const body = await runInfluxQuery(q);
  const series = parseSeries<Record<string, number | string | null>>(body);
  const first = series[0]?.rows?.[0];
  if (!first) return null;
  return {
    playerId,
    avatar: (first.avatar as string | null) ?? null,
    namecard: (first.namecard as string | null) ?? null,
    endorsement: typeof first.endorsement_level === 'number' ? first.endorsement_level : null,
    endorsementFrame: (first.endorsement_frame as string | null) ?? null,
    title: (first.title as string | null) ?? null,
    username: (first.username as string | null) ?? null,
    lastUpdatedAt: typeof first.time === 'number' ? first.time : null,
  };
}
