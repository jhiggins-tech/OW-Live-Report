import { loadProfiles } from '../snapshotClient';

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
  const { rows } = await loadProfiles();
  const row = rows.find((r) => r.player === playerId);
  if (!row) return null;
  return {
    playerId,
    avatar: row.avatar,
    namecard: row.namecard,
    endorsement: row.endorsementLevel,
    endorsementFrame: row.endorsementFrame,
    title: row.title,
    username: row.username,
    lastUpdatedAt: Number.isFinite(row.time) ? row.time : null,
  };
}
