// Loads the JSON snapshot datasets that scripts/fetch-snapshots.mjs bakes
// from the TimescaleDB stats backend. The SPA no longer queries a database
// at view time — browsers can't speak the Postgres wire protocol — so these
// static files, refreshed hourly by CI, are the app's entire data source.

import type {
  CareerDailyRow,
  CareerHeroDailyRow,
  CareerLatestRow,
  ProfileRow,
  RankDailyRow,
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
// Snapshots refresh hourly; past this age the pipeline is presumed stuck
// and the StaleBanner is told about it.
const SNAPSHOT_STALE_MS = 4 * 60 * 60 * 1000;

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

async function fetchSnapshot<T>(name: string): Promise<T> {
  const mem = memory.get(name);
  if (mem && Date.now() - mem.at <= FRESH_TTL_MS) return mem.body as T;

  const pending = inflight.get(name);
  if (pending) return pending as Promise<T>;

  const load = (async () => {
    const cached = mem ?? safeSessionRead(name);
    if (cached && Date.now() - cached.at <= FRESH_TTL_MS) {
      memory.set(name, cached);
      return cached.body as T;
    }
    const url = `${import.meta.env.BASE_URL}data/snapshots/${name}.json`.replace(/\/+/g, '/');
    try {
      const res = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new SnapshotFetchError(`HTTP ${res.status} fetching snapshot '${name}'`, name, res.status);
      }
      const body = (await res.json()) as T;
      memory.set(name, { at: Date.now(), body });
      safeSessionSet(name, body);
      return body;
    } catch (err) {
      // Fall back to any cached body still within the 24h stale window and
      // notify listeners (StaleBanner) so the UI can flag the staleness.
      if (cached) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        dispatchStale(name, Date.now() - cached.at, wrapped);
        memory.set(name, cached);
        return cached.body as T;
      }
      throw err;
    }
  })();

  inflight.set(name, load);
  try {
    return await load;
  } finally {
    inflight.delete(name);
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

export function loadRankCurrent(): Promise<SnapshotFile<RankRow>> {
  return fetchSnapshot('rank-current');
}

export function loadRankDaily(): Promise<SnapshotFile<RankDailyRow>> {
  return fetchSnapshot('rank-daily');
}

export function loadCareerLatest(): Promise<SnapshotFile<CareerLatestRow>> {
  return fetchSnapshot('career-latest');
}

export function loadCareerDaily(): Promise<SnapshotFile<CareerDailyRow>> {
  return fetchSnapshot('career-daily');
}

export function loadCareerHeroDaily(): Promise<SnapshotFile<CareerHeroDailyRow>> {
  return fetchSnapshot('career-hero-daily');
}

export function loadProfiles(): Promise<SnapshotFile<ProfileRow>> {
  return fetchSnapshot('profiles');
}
