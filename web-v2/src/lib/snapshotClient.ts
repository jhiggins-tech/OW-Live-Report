// Loads the JSON snapshot datasets that scripts/pipeline/poll.mjs bakes from
// the OverFast API. The SPA never queries a backend at view time, so these
// static files, refreshed twice a day by CI, are the app's entire data
// source. meta.layoutVersion 2 keeps the per-day roll-ups in per-season
// directories (data/seasons/<N>/); older meta files use the flat layout.

import type {
  CareerDailyRow,
  CareerHeroDailyRow,
  CareerLatestRow,
  ProfileRow,
  RankDailyRow,
  RankIconMaps,
  RankIconsFile,
  RankRow,
  SnapshotFile,
  SnapshotMeta,
} from '../types/snapshots';

const SESSION_PREFIX = 'owr-v2:snap:';
// FRESH_TTL: results below this age are served from memory/session cache
// without refetching. SESSION_TTL: results below this age stay around as a
// stale-cache fallback when a live fetch fails (ports V1's
// fallback_to_stale_cache, same as the old InfluxDB client).
const FRESH_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// Snapshots refresh twice a day; past this age (a poll interval plus cron
// delay plus one missed run) the pipeline is presumed stuck and the
// StaleBanner is told about it.
const SNAPSHOT_STALE_MS = 30 * 60 * 60 * 1000;

export const STALE_DATA_EVENT = 'owr-v2:stale-data-served';

export interface StaleDataEventDetail {
  source: string;
  ageMs: number;
  error: Error;
}

export class SnapshotFetchError extends Error {
  status?: number;
  source: string;
  constructor(message: string, source: string, status?: number) {
    super(message);
    this.name = 'SnapshotFetchError';
    this.source = source;
    if (typeof status === 'number') this.status = status;
  }
}

interface CachedEntry {
  at: number;
  body: unknown;
}

const memory = new Map<string, CachedEntry>();
const inflight = new Map<string, Promise<unknown>>();

function safeSessionRead(name: string): CachedEntry | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_PREFIX + name);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function safeSessionSet(name: string, body: unknown): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + name, JSON.stringify({ at: Date.now(), body }));
  } catch {
    // ignore quota errors
  }
}

function dispatchStale(source: string, ageMs: number, error: Error): void {
  if (typeof window === 'undefined') return;
  const detail: StaleDataEventDetail = { source, ageMs, error };
  window.dispatchEvent(new CustomEvent<StaleDataEventDetail>(STALE_DATA_EVENT, { detail }));
}

// `cacheKey` names the memory/session cache entry; `rel` is the file path
// relative to data/ (season files use a per-season key like 's25:rank-daily').
async function fetchSnapshot<T>(cacheKey: string, rel = `snapshots/${cacheKey}.json`): Promise<T> {
  const mem = memory.get(cacheKey);
  if (mem && Date.now() - mem.at <= FRESH_TTL_MS) return mem.body as T;

  const pending = inflight.get(cacheKey);
  if (pending) return pending as Promise<T>;

  const load = (async () => {
    const cached = mem ?? safeSessionRead(cacheKey);
    if (cached && Date.now() - cached.at <= FRESH_TTL_MS) {
      memory.set(cacheKey, cached);
      return cached.body as T;
    }
    const url = `${import.meta.env.BASE_URL}data/${rel}`.replace(/\/+/g, '/');
    try {
      const res = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new SnapshotFetchError(`HTTP ${res.status} fetching snapshot '${cacheKey}'`, cacheKey, res.status);
      }
      const body = (await res.json()) as T;
      memory.set(cacheKey, { at: Date.now(), body });
      safeSessionSet(cacheKey, body);
      return body;
    } catch (err) {
      // Fall back to any cached body still within the 24h stale window and
      // notify listeners (StaleBanner) so the UI can flag the staleness.
      if (cached) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        dispatchStale(cacheKey, Date.now() - cached.at, wrapped);
        memory.set(cacheKey, cached);
        return cached.body as T;
      }
      throw err;
    }
  })();

  inflight.set(cacheKey, load);
  try {
    return await load;
  } finally {
    inflight.delete(cacheKey);
  }
}

let staleSnapshotReported = false;

export async function loadMeta(): Promise<SnapshotMeta> {
  const meta = await fetchSnapshot<SnapshotMeta>('meta');
  const age = Date.now() - meta.generatedAt;
  if (!staleSnapshotReported && Number.isFinite(age) && age > SNAPSHOT_STALE_MS) {
    staleSnapshotReported = true;
    dispatchStale('meta', age, new Error('Data snapshots have not refreshed recently'));
  }
  return meta;
}

// rank-current carries every player's latest rank from any season. A past
// season has no such file, so its rows are rebuilt from that season's
// rank-daily: the last row per (player, role), i.e. the season's final ranks.
export async function loadRankCurrent(season?: number): Promise<SnapshotFile<RankRow>> {
  if (season !== undefined) {
    const meta = await loadMeta();
    if (meta.layoutVersion === 2 && season !== meta.currentSeason) {
      const daily = await loadRankDaily(season);
      const last = new Map<string, RankDailyRow>();
      for (const r of daily.rows) {
        const key = `${r.player}|${r.role}`;
        const prev = last.get(key);
        if (!prev || r.day > prev.day) last.set(key, r);
      }
      const rows = [...last.values()].map((r): RankRow => ({
        player: r.player,
        role: r.role,
        time: r.day,
        tier: r.tier,
        division: r.division,
        season: r.season,
      }));
      return { generatedAt: daily.generatedAt, rows };
    }
  }
  return fetchSnapshot('rank-current');
}

type SeasonDataset = 'rank-daily' | 'career-latest' | 'career-daily' | 'career-hero-daily';

// Per-season roll-ups: `season` defaults to meta.currentSeason. Meta files
// without layoutVersion 2 predate the season directories and keep the flat
// data/snapshots/<name>.json files.
async function fetchSeasonDataset<T>(name: SeasonDataset, season?: number): Promise<SnapshotFile<T>> {
  const meta = await loadMeta();
  if (meta.layoutVersion !== 2) return fetchSnapshot(name);
  const s = season ?? meta.currentSeason ?? null;
  if (s === null) return { generatedAt: meta.generatedAt, rows: [] };
  return fetchSnapshot(`s${s}:${name}`, `seasons/${s}/${name}.json`);
}

export function loadRankDaily(season?: number): Promise<SnapshotFile<RankDailyRow>> {
  return fetchSeasonDataset('rank-daily', season);
}

export function loadCareerLatest(season?: number): Promise<SnapshotFile<CareerLatestRow>> {
  return fetchSeasonDataset('career-latest', season);
}

export function loadCareerDaily(season?: number): Promise<SnapshotFile<CareerDailyRow>> {
  return fetchSeasonDataset('career-daily', season);
}

export function loadCareerHeroDaily(season?: number): Promise<SnapshotFile<CareerHeroDailyRow>> {
  return fetchSeasonDataset('career-hero-daily', season);
}

export function loadProfiles(): Promise<SnapshotFile<ProfileRow>> {
  return fetchSnapshot('profiles');
}

// Insignia URLs by tier name and division number. The file is optional (older
// deploys lack it, and a missing icon only costs the cosmetic badge), so a 404
// or any other failure resolves to empty maps instead of an error.
export async function loadRankIcons(): Promise<RankIconMaps> {
  const maps: RankIconMaps = { divisions: {}, tiers: {} };
  try {
    const file = await fetchSnapshot<RankIconsFile>('rank-icons');
    for (const kind of ['divisions', 'tiers'] as const) {
      for (const [key, entry] of Object.entries(file?.[kind] ?? {})) {
        // Only https image URLs are ever handed to an <img>.
        if (typeof entry?.url === 'string' && entry.url.startsWith('https://')) maps[kind][key] = entry.url;
      }
    }
  } catch {
    // Keep the empty maps.
  }
  return maps;
}
