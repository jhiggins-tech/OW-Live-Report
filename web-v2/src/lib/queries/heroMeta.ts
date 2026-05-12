// Fetches public hero meta (portrait, canonical role, pickrate, winrate) from
// the OverFast API. CORS is open (Access-Control-Allow-Origin: *), so the
// browser can talk to it directly. Two endpoints:
//   GET /heroes              -> [{ key, name, portrait, role, subrole, ... }]
//   GET /heroes/stats?...    -> [{ hero, pickrate, winrate }]
//
// The OverFast cache_control for /heroes is a day (we observed x-cache-status:
// hit), so TanStack-side staleTime can be aggressive too.

const OVERFAST_BASE = 'https://overfast-api.tekrop.fr';

// Defaults match V1's `provider.summary_gamemode: 'competitive'` and the team's
// region; surface as runtime config later if needed.
const META_PLATFORM = 'pc';
const META_GAMEMODE = 'competitive';
const META_REGION = 'americas';

export type OverFastRole = 'tank' | 'damage' | 'support';

export interface OverFastHero {
  key: string;
  name: string;
  portrait: string | null;
  role: OverFastRole;
  subrole: string | null;
  gamemodes: string[];
}

export interface OverFastHeroStat {
  hero: string;
  pickrate: number | null;
  winrate: number | null;
}

export interface HeroMetaEntry {
  key: string;
  name: string;
  portrait: string | null;
  role: OverFastRole;
  subrole: string | null;
  pickrate: number | null;
  winrate: number | null;
}

export interface HeroMeta {
  byKey: Record<string, HeroMetaEntry>;
  fetchedAt: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${OVERFAST_BASE}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OverFast ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchHeroMeta(): Promise<HeroMeta> {
  const statsQuery = `?platform=${META_PLATFORM}&gamemode=${META_GAMEMODE}&region=${META_REGION}`;
  const [heroes, stats] = await Promise.all([
    getJson<OverFastHero[]>('/heroes'),
    getJson<OverFastHeroStat[]>(`/heroes/stats${statsQuery}`).catch(() => [] as OverFastHeroStat[]),
  ]);

  const statByKey = new Map<string, OverFastHeroStat>();
  for (const s of stats) statByKey.set(s.hero, s);

  const byKey: Record<string, HeroMetaEntry> = {};
  for (const h of heroes) {
    const s = statByKey.get(h.key);
    byKey[h.key] = {
      key: h.key,
      name: h.name,
      portrait: h.portrait,
      role: h.role,
      subrole: h.subrole,
      pickrate: s?.pickrate ?? null,
      winrate: s?.winrate ?? null,
    };
  }
  return { byKey, fetchedAt: Date.now() };
}
