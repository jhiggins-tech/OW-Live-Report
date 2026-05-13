// Fetches public hero meta (portrait, canonical role, pickrate, winrate) from
// the OverFast API. CORS is open (Access-Control-Allow-Origin: *), so the
// browser can talk to it directly. Two endpoints:
//   GET /heroes              -> [{ key, name, portrait, role, subrole, ... }]
//   GET /heroes/stats?...    -> [{ hero, pickrate, winrate }]
//
// The OverFast cache_control for /heroes is a day (we observed x-cache-status:
// hit), so TanStack-side staleTime can be aggressive too.
//
// Resilience: pickrate/winrate are layered on a stale localStorage cache
// (TTL 14d) so that brief OverFast /heroes/stats outages don't blank the
// Meta Win% column. fetchHeroMeta returns a status flag that drives the
// HeroMetaBanner; it never throws when both live and cache are absent —
// callers get an empty byKey with status='unavailable'.

const OVERFAST_BASE = 'https://overfast-api.tekrop.fr';

// Defaults match V1's `provider.summary_gamemode: 'competitive'` and the team's
// region; surface as runtime config later if needed.
const META_PLATFORM = 'pc';
const META_GAMEMODE = 'competitive';
const META_REGION = 'americas';

// Bumped when the cache shape changes; mismatched entries are ignored.
const CACHE_KEY = 'owr-v2:heroMeta:v1';
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

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

export type HeroMetaStatus = 'live' | 'stale-cache' | 'unavailable';

export interface HeroMeta {
  byKey: Record<string, HeroMetaEntry>;
  fetchedAt: number;
  status: HeroMetaStatus;
  // Only set when status === 'stale-cache'; age of the cached pickrate/
  // winrate values relative to now.
  cacheAgeMs?: number;
}

interface StoredCache {
  byKey: Record<string, HeroMetaEntry>;
  fetchedAt: number;
}

function readCache(): StoredCache | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCache>;
    if (typeof parsed?.fetchedAt !== 'number' || !parsed.byKey) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_MAX_AGE_MS) return null;
    return { byKey: parsed.byKey, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeCache(payload: StoredCache): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — non-fatal.
  }
}

function hasUsableStats(byKey: Record<string, HeroMetaEntry>): boolean {
  for (const entry of Object.values(byKey)) {
    if (entry.winrate !== null) return true;
  }
  return false;
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

  let heroes: OverFastHero[] | null = null;
  let stats: OverFastHeroStat[] = [];
  try {
    [heroes, stats] = await Promise.all([
      getJson<OverFastHero[]>('/heroes'),
      getJson<OverFastHeroStat[]>(`/heroes/stats${statsQuery}`).catch(() => [] as OverFastHeroStat[]),
    ]);
  } catch {
    // /heroes itself failed; fall through to the cache-only path below.
  }

  if (heroes) {
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

    if (hasUsableStats(byKey)) {
      writeCache({ byKey, fetchedAt: Date.now() });
      return { byKey, fetchedAt: Date.now(), status: 'live' };
    }

    // /heroes worked but /heroes/stats had nothing usable. Layer cached
    // pickrate/winrate over the fresh hero list so the leaderboard keeps
    // showing Meta Win% / Pick%.
    const cache = readCache();
    if (cache) {
      const merged: Record<string, HeroMetaEntry> = { ...byKey };
      for (const [k, cached] of Object.entries(cache.byKey)) {
        const live = merged[k];
        if (live) {
          merged[k] = { ...live, pickrate: cached.pickrate, winrate: cached.winrate };
        }
      }
      return {
        byKey: merged,
        fetchedAt: cache.fetchedAt,
        status: 'stale-cache',
        cacheAgeMs: Date.now() - cache.fetchedAt,
      };
    }
    return { byKey, fetchedAt: Date.now(), status: 'unavailable' };
  }

  // /heroes failed completely. Serve the cache if we have one; otherwise
  // an empty payload so the page still renders.
  const cache = readCache();
  if (cache) {
    return {
      byKey: cache.byKey,
      fetchedAt: cache.fetchedAt,
      status: 'stale-cache',
      cacheAgeMs: Date.now() - cache.fetchedAt,
    };
  }
  return { byKey: {}, fetchedAt: Date.now(), status: 'unavailable' };
}
