// OverFast /players/{playerId}/summary — public profile + per-role rank
// snapshot. We use it for: avatar (already in InfluxDB, but free here),
// namecard, role_icon, rank_icon, and tier_icon for each role's
// competitive standing. Schema confirmed against live data 2026-05-11.
//
// CORS is open (Access-Control-Allow-Origin: *). Tekrop caches /summary
// for a day at the CDN, so a 1-hour client staleTime is generous.

import type { Role } from '../../../src/types/models';

const OVERFAST_BASE = 'https://overfast-api.tekrop.fr';
const PLATFORM: 'pc' | 'console' = 'pc';

interface OverFastCompetitiveRole {
  division: string | null;
  tier: number | null;
  role_icon: string | null;
  rank_icon: string | null;
  tier_icon: string | null;
}

interface OverFastPlayerSummaryRaw {
  username?: string | null;
  avatar?: string | null;
  namecard?: string | null;
  title?: { name?: string | null } | null;
  endorsement?: { level?: number | null; frame?: string | null } | null;
  competitive?: Partial<Record<'pc' | 'console', Partial<Record<Role | 'open', OverFastCompetitiveRole | null>>>> | null;
}

export interface PlayerCompetitive {
  division: string | null;
  tier: number | null;
  roleIcon: string | null;
  rankIcon: string | null;
  tierIcon: string | null;
}

export interface OverFastPlayerSummary {
  playerId: string;
  username: string | null;
  avatar: string | null;
  namecard: string | null;
  competitive: Partial<Record<Role, PlayerCompetitive>>;
  fetchedAt: number;
}

function pickRole(raw: OverFastCompetitiveRole | null | undefined): PlayerCompetitive | null {
  if (!raw) return null;
  return {
    division: raw.division ?? null,
    tier: typeof raw.tier === 'number' ? raw.tier : null,
    roleIcon: raw.role_icon ?? null,
    rankIcon: raw.rank_icon ?? null,
    tierIcon: raw.tier_icon ?? null,
  };
}

export async function fetchOverFastPlayerSummary(playerId: string): Promise<OverFastPlayerSummary> {
  const res = await fetch(`${OVERFAST_BASE}/players/${encodeURIComponent(playerId)}/summary`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OverFast /players/${playerId}/summary: HTTP ${res.status}`);
  }
  const raw = (await res.json()) as OverFastPlayerSummaryRaw;
  const platformRanks = raw.competitive?.[PLATFORM] ?? null;

  const competitive: Partial<Record<Role, PlayerCompetitive>> = {};
  if (platformRanks) {
    const tank = pickRole(platformRanks.tank);
    if (tank) competitive.tank = tank;
    const damage = pickRole(platformRanks.damage);
    if (damage) competitive.damage = damage;
    const support = pickRole(platformRanks.support);
    if (support) competitive.support = support;
  }

  return {
    playerId,
    username: raw.username ?? null,
    avatar: raw.avatar ?? null,
    namecard: raw.namecard ?? null,
    competitive,
    fetchedAt: Date.now(),
  };
}
