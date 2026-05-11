import type { InfluxResponse, InfluxSeries, InfluxStatementResult, ParsedSeries } from '../types/influx';

const QUERY_URL = import.meta.env.VITE_INFLUX_QUERY_URL ?? 'https://owstats.jhiggins.tech/query';
const DATABASE = import.meta.env.VITE_INFLUX_DATABASE ?? 'ow_stats_telegraf';

const MAX_CONCURRENT = 4;
const SESSION_PREFIX = 'owr-v2:influx:';
const SESSION_TTL_MS = 5 * 60 * 1000;

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

function safeSessionGet(key: string): InfluxResponse | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; body: InfluxResponse };
    if (Date.now() - parsed.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_PREFIX + key);
      return null;
    }
    return parsed.body;
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
  const cached = safeSessionGet(cacheKey);
  if (cached) return cached;

  await acquire();
  try {
    const params = new URLSearchParams({ db: DATABASE, q: query, epoch: 'ms' });
    const init: RequestInit = { method: 'GET', headers: { Accept: 'application/json' } };
    if (options?.signal) init.signal = options.signal;
    const res = await fetch(`${QUERY_URL}?${params.toString()}`, init);
    if (!res.ok) {
      throw new InfluxQueryError(`HTTP ${res.status} from InfluxDB`, query, res.status);
    }
    const body = (await res.json()) as InfluxResponse;
    if (body.error) throw new InfluxQueryError(body.error, query);
    for (const r of body.results ?? []) {
      if (r.error) throw new InfluxQueryError(r.error, query);
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

export const INFLUX_QUERY_URL = QUERY_URL;
export const INFLUX_DATABASE = DATABASE;
