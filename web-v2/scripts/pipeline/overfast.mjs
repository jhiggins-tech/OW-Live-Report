// Thin client for the OverFast API (https://overfast-api.tekrop.fr), the only
// network call the V3 pipeline makes. poll.mjs calls fetchPlayer() once per
// rostered player, one at a time; everything else in the pipeline works on the
// parsed body. fetchImpl and sleep are injectable so the tests run offline and
// instantly. See plan/v3-static-season-snapshots.md, "1. Poll".

export const DEFAULT_BASE_URL = 'https://overfast-api.tekrop.fr';
export const USER_AGENT = 'OW-Live-Report-poller/1.0 (+https://github.com/mattjsawyer/ow-live-report)';

// Waits before retry 1, 2, 3 (a Retry-After header replaces the wait).
const BACKOFF_MS = [2_000, 4_000, 8_000];
// A server asking for longer than this is treated as asking for this.
const MAX_RETRY_AFTER_MS = 60_000;

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `Retry-After` in whole or fractional seconds, capped. The HTTP-date form is
// not worth parsing here: OverFast sends seconds, and anything else just falls
// back to the normal backoff.
function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  if (raw === null || raw === undefined || !/^\s*\d+(\.\d+)?\s*$/.test(raw)) return null;
  return Math.min(Number(raw) * 1000, MAX_RETRY_AFTER_MS);
}

// Free the socket of a response whose body we are not going to read.
async function discard(res) {
  try {
    await res.body?.cancel?.();
  } catch {
    // Nothing to clean up.
  }
}

function describeError(err, timeoutMs) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `timed out after ${timeoutMs} ms`;
  // undici hides the real reason in `cause` ("fetch failed" alone is useless).
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `network error: ${err?.message ?? String(err)}${cause ? ` (${cause})` : ''}`;
}

// GET /players/{playerId}. Resolves to { ok: true, status, body } or
// { ok: false, status, error } and never throws; `status` is null when no HTTP
// response arrived (timeout, network error). 429, 5xx and network errors are
// retried up to `retries` times with 2 s / 4 s / 8 s backoff; a 404 and any
// other 4xx fail at once. `onRetry({ playerId, attempt, delayMs, reason })`, if
// given, is told about each retry so the CLI can log it.
export async function fetchPlayer(playerId, {
  baseUrl,
  timeoutMs = 30_000,
  retries = 3,
  fetchImpl = fetch,
  sleep = defaultSleep,
  onRetry,
} = {}) {
  const root = (baseUrl || process.env.OVERFAST_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${root}/players/${encodeURIComponent(playerId)}`;

  let failure = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // `wait` is only set for failures worth retrying.
    let wait = null;
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 || res.status >= 500) {
        failure = { ok: false, status: res.status, error: `HTTP ${res.status}` };
        wait = retryAfterMs(res) ?? BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        await discard(res);
      } else if (res.status === 404) {
        await discard(res);
        return { ok: false, status: 404, error: 'player not found (OverFast may not have indexed them yet)' };
      } else if (res.status < 200 || res.status >= 300) {
        await discard(res);
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      } else {
        // Read as text first so a connection dropped mid-body counts as a
        // network error (retried) rather than as bad JSON (not retried).
        const text = await res.text();
        try {
          return { ok: true, status: res.status, body: JSON.parse(text) };
        } catch {
          return { ok: false, status: res.status, error: 'response is not valid JSON' };
        }
      }
    } catch (err) {
      failure = { ok: false, status: null, error: describeError(err, timeoutMs) };
      wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    }

    if (attempt === retries) break;
    onRetry?.({ playerId, attempt: attempt + 1, delayMs: wait, reason: failure.error });
    await sleep(wait);
  }
  return failure;
}
