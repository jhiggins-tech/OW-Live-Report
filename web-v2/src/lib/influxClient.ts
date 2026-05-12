import type { InfluxResponse, InfluxSeries, InfluxStatementResult, ParsedSeries } from '../types/influx';
import { getRuntimeConfig } from './runtimeConfig';

const MAX_CONCURRENT = 4;
const SESSION_PREFIX = 'owr-v2:influx:';
// FRESH_TTL: results below this age are served from cache without refetching.
// SESSION_TTL: results below this age stay around as a stale-cache fallback
// when a live fetch fails (V2.1: ports V1's fallback_to_stale_cache).
const FRESH_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const STALE_DATA_EVENT = 'owr-v2:stale-data-served';

export interface StaleDataEventDetail {
  query: string;
  ageMs: number;
  error: Error;
}

let inflight = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inflight < MAX_CONCURRENT) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      inflight += 1;
      resolve();
    });
  });
}

function release(): void {
  inflight -= 1;
  const next = queue.shift();
  if (next) next();
}

interface CachedEntry { at: number; body: InfluxResponse }

function safeSessionRead(key: string): CachedEntry | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_PREFIX + key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, body: InfluxResponse): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify({ at: Date.now(), body }));
  } catch {
    // ignore quota errors
  }
}

function dispatchStale(query: string, ageMs: number, error: Error): void {
  if (typeof window === 'undefined') return;
  const detail: StaleDataEventDetail = { query, ageMs, error };
  window.dispatchEvent(new CustomEvent<StaleDataEventDetail>(STALE_DATA_EVENT, { detail }));
}

export class InfluxQueryError extends Error {
  status?: number;
  query: string;
  constructor(message: string, query: string, status?: number) {
    super(message);
    this.name = 'InfluxQueryError';
    this.query = query;
    if (typeof status === 'number') this.status = status;
  }
}

export async function runInfluxQuery(query: string, options?: { signal?: AbortSignal }): Promise<InfluxResponse> {
  const cacheKey = query;
  const cached = safeSessionRead(cacheKey);
  if (cached && Date.now() - cached.at <= FRESH_TTL_MS) {
    return cached.body;
  }

  await acquire();
  try {
    const { queryUrl, database } = getRuntimeConfig().influx;
    const params = new URLSearchParams({ db: database, q: query, epoch: 'ms' });
    const init: RequestInit = { method: 'GET', headers: { Accept: 'application/json' } };
    if (options?.signal) init.signal = options.signal;
    let body: InfluxResponse;
    try {
      const res = await fetch(`${queryUrl}?${params.toString()}`, init);
      if (!res.ok) {
        throw new InfluxQueryError(`HTTP ${res.status} from InfluxDB`, query, res.status);
      }
      body = (await res.json()) as InfluxResponse;
      if (body.error) throw new InfluxQueryError(body.error, query);
      for (const r of body.results ?? []) {
        if (r.error) throw new InfluxQueryError(r.error, query);
      }
    } catch (err) {
      // Fall back to any cached body still within the 24h stale window.
      // Notify listeners (StaleBanner) so the UI can flag the staleness.
      if (cached) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        dispatchStale(query, Date.now() - cached.at, wrapped);
        return cached.body;
      }
      throw err;
    }
    safeSessionSet(cacheKey, body);
    return body;
  } finally {
    release();
  }
}

export function parseSeries<TRow extends Record<string, number | string | null>>(
  body: InfluxResponse,
): ParsedSeries<TRow>[] {
  const out: ParsedSeries<TRow>[] = [];
  for (const result of body.results ?? []) {
    for (const series of result.series ?? []) {
      out.push(toParsed<TRow>(series));
    }
  }
  return out;
}

export function parseStatementSeries<TRow extends Record<string, number | string | null>>(
  result: InfluxStatementResult | undefined,
): ParsedSeries<TRow>[] {
  if (!result) return [];
  return (result.series ?? []).map((s) => toParsed<TRow>(s));
}

// Runs N InfluxQL statements joined by ';' as a single HTTP request and
// returns the per-statement results in order. The server processes
// statements serially regardless, but bundling saves a round-trip per
// statement (~100ms each over TLS) and avoids re-queueing on the client.
export async function runInfluxMultiQuery(
  queries: string[],
  options?: { signal?: AbortSignal },
): Promise<InfluxStatementResult[]> {
  if (queries.length === 0) return [];
  if (queries.length === 1) {
    const body = await runInfluxQuery(queries[0]!, options);
    return body.results ?? [];
  }
  const combined = queries.join('; ');
  const body = await runInfluxQuery(combined, options);
  return body.results ?? [];
}

function toParsed<TRow extends Record<string, number | string | null>>(series: InfluxSeries): ParsedSeries<TRow> {
  const cols = series.columns ?? [];
  const rows: TRow[] = (series.values ?? []).map((row) => {
    const obj: Record<string, number | string | null> = {};
    for (let i = 0; i < cols.length; i += 1) {
      const key = cols[i];
      if (key === undefined) continue;
      const value = row[i];
      obj[key] = value === undefined ? null : value;
    }
    return obj as TRow;
  });
  return {
    name: series.name ?? '',
    tags: series.tags ?? {},
    rows,
  };
}

