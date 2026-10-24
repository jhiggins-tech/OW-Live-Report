// Tests O1-O11: the OverFast client's retry, backoff and error handling, driven
// by a fake fetchImpl and a recording sleep so nothing touches the network or
// the clock. O11 alone uses a real fetch, against a server on 127.0.0.1.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { DEFAULT_BASE_URL, USER_AGENT, fetchPlayer } from './overfast.mjs';

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const status = (code, headers = {}) => new Response('upstream says no', { status: code, headers });

// A fetchImpl that plays back `script` in order (a Response, or an Error to
// throw) and remembers each call.
function scripted(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = script[calls.length - 1];
    if (step === undefined) throw new Error(`unexpected request #${calls.length}`);
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetchImpl, calls };
}

function recordSleeps() {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
}

test('O1: a 200 returns the parsed body, with the PRD headers and a timeout signal', async () => {
  const { fetchImpl, calls } = scripted([json({ summary: { username: 'Kie' } })]);
  const { delays, sleep } = recordSleeps();
  const res = await fetchPlayer('Kieness-6123', { baseUrl: 'https://example.test', fetchImpl, sleep });
  assert.deepEqual(res, { ok: true, status: 200, body: { summary: { username: 'Kie' } } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/players/Kieness-6123');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal(calls[0].init.headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /^OW-Live-Report-poller\/1\.0 \(\+https:\/\/github\.com\/mattjsawyer\/ow-live-report\)$/);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(delays, []);
});

test('O2: a 503 that recovers is retried after 2 s', async () => {
  const { fetchImpl, calls } = scripted([status(503), json({ ok: 1 })]);
  const { delays, sleep } = recordSleeps();
  const retries = [];
  const res = await fetchPlayer('A-1', {
    baseUrl: 'https://example.test', fetchImpl, sleep, onRetry: (r) => retries.push(r),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.body, { ok: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [2_000]);
  assert.deepEqual(retries, [{ playerId: 'A-1', attempt: 1, delayMs: 2_000, reason: 'HTTP 503' }]);
});

test('O3: a persistent 5xx gives up after 3 retries with 2/4/8 s backoff', async () => {
  const { fetchImpl, calls } = scripted([status(503), status(502), status(500), status(503)]);
  const { delays, sleep } = recordSleeps();
  const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep });
  assert.deepEqual(res, { ok: false, status: 503, error: 'HTTP 503' });
  assert.equal(calls.length, 4);
  assert.deepEqual(delays, [2_000, 4_000, 8_000]);
});

test('O4: a 429 honours Retry-After (seconds), capped at 60 s; junk falls back to backoff', async () => {
  const cases = [
    ['7', 7_000],
    ['0', 0],
    ['3600', 60_000],
    ['soon', 2_000],
    ['Wed, 21 Oct 2026 07:28:00 GMT', 2_000],
  ];
  for (const [header, expected] of cases) {
    const { fetchImpl } = scripted([status(429, { 'Retry-After': header }), json({})]);
    const { delays, sleep } = recordSleeps();
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep });
    assert.equal(res.ok, true, `Retry-After ${header}`);
    assert.deepEqual(delays, [expected], `Retry-After ${header}`);
  }

  // Without the header a 429 uses the normal 2 s / 4 s steps.
  const { fetchImpl } = scripted([status(429), status(429), json({})]);
  const { delays, sleep } = recordSleeps();
  assert.equal((await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep })).ok, true);
  assert.deepEqual(delays, [2_000, 4_000]);
});

test('O5: a 404 is not retried and says the player may not be indexed yet', async () => {
  const { fetchImpl, calls } = scripted([status(404), json({})]);
  const { delays, sleep } = recordSleeps();
  const res = await fetchPlayer('Nobody-1', { baseUrl: 'https://example.test', fetchImpl, sleep });
  assert.deepEqual(res, {
    ok: false,
    status: 404,
    error: 'player not found (OverFast may not have indexed them yet)',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test('O6: any other 4xx fails at once without a retry', async () => {
  for (const code of [400, 401, 403, 410, 422]) {
    const { fetchImpl, calls } = scripted([status(code), json({})]);
    const { delays, sleep } = recordSleeps();
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep });
    assert.deepEqual(res, { ok: false, status: code, error: `HTTP ${code}` });
    assert.equal(calls.length, 1, `HTTP ${code}`);
    assert.deepEqual(delays, []);
  }
});

test('O7: network errors and timeouts are retried; the failure keeps a readable reason', async () => {
  // A dropped connection that recovers.
  {
    const cause = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
    const { fetchImpl, calls } = scripted([new TypeError('fetch failed', { cause }), json({ ok: 1 })]);
    const { delays, sleep } = recordSleeps();
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [2_000]);
  }
  // Every attempt hits the timeout.
  {
    const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { fetchImpl, calls } = scripted([timeout(), timeout(), timeout(), timeout()]);
    const { delays, sleep } = recordSleeps();
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', timeoutMs: 1_234, fetchImpl, sleep });
    assert.deepEqual(res, { ok: false, status: null, error: 'timed out after 1234 ms' });
    assert.equal(calls.length, 4);
    assert.deepEqual(delays, [2_000, 4_000, 8_000]);
  }
  // Every attempt fails to connect.
  {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const err = () => new TypeError('fetch failed', { cause });
    const { fetchImpl } = scripted([err(), err(), err(), err()]);
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep: async () => {} });
    assert.equal(res.ok, false);
    assert.equal(res.status, null);
    assert.equal(res.error, 'network error: fetch failed (ENOTFOUND)');
  }
});

test('O8: a body that drops mid-read is a network error (retried); bad JSON is not', async () => {
  const dropped = {
    status: 200,
    headers: new Headers(),
    text: async () => { throw new TypeError('terminated'); },
  };
  {
    const { fetchImpl, calls } = scripted([dropped, json({ ok: 1 })]);
    const { delays, sleep } = recordSleeps();
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [2_000]);
  }
  {
    const { fetchImpl, calls } = scripted([new Response('<html>gateway</html>', { status: 200 }), json({})]);
    const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', fetchImpl, sleep: async () => {} });
    assert.deepEqual(res, { ok: false, status: 200, error: 'response is not valid JSON' });
    assert.equal(calls.length, 1);
  }
});

test('O9: baseUrl falls back to OVERFAST_BASE_URL, then the public API; ids are URL-encoded', async () => {
  const saved = process.env.OVERFAST_BASE_URL;
  try {
    const urlFor = async (opts) => {
      const { fetchImpl, calls } = scripted([json({})]);
      await fetchPlayer('Name#1 2', { ...opts, fetchImpl, sleep: async () => {} });
      return calls[0].url;
    };

    delete process.env.OVERFAST_BASE_URL;
    assert.equal(await urlFor({}), `${DEFAULT_BASE_URL}/players/Name%231%202`);
    assert.equal(DEFAULT_BASE_URL, 'https://overfast-api.tekrop.fr');

    process.env.OVERFAST_BASE_URL = 'https://mirror.test/';
    assert.equal(await urlFor({}), 'https://mirror.test/players/Name%231%202');

    // An explicit option beats the environment; empty strings count as unset.
    assert.equal(await urlFor({ baseUrl: 'https://explicit.test' }), 'https://explicit.test/players/Name%231%202');
    process.env.OVERFAST_BASE_URL = '';
    assert.equal(await urlFor({}), `${DEFAULT_BASE_URL}/players/Name%231%202`);
  } finally {
    if (saved === undefined) delete process.env.OVERFAST_BASE_URL;
    else process.env.OVERFAST_BASE_URL = saved;
  }
});

test('O10: retries: 0 makes a single attempt', async () => {
  const { fetchImpl, calls } = scripted([status(503), json({})]);
  const { delays, sleep } = recordSleeps();
  const res = await fetchPlayer('A-1', { baseUrl: 'https://example.test', retries: 0, fetchImpl, sleep });
  assert.deepEqual(res, { ok: false, status: 503, error: 'HTTP 503' });
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test('O11: over a real socket: headers arrive, Retry-After is honoured and a hung server times out', async () => {
  const seen = [];
  let hits = 0;
  const server = createServer((req, res) => {
    seen.push({ url: req.url, accept: req.headers.accept, agent: req.headers['user-agent'] });
    if (req.url === '/players/Hang-1') return; // never answer
    hits += 1;
    if (hits === 1) {
      res.writeHead(429, { 'Retry-After': '0' }).end('slow down');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"summary":{"username":"Real"}}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    // Default fetchImpl (the global fetch) and sleep; Retry-After: 0 keeps it instant.
    const res = await fetchPlayer('Real-1', { baseUrl });
    assert.deepEqual(res, { ok: true, status: 200, body: { summary: { username: 'Real' } } });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url, '/players/Real-1');
    assert.equal(seen[0].accept, 'application/json');
    assert.equal(seen[0].agent, USER_AGENT);

    const hung = await fetchPlayer('Hang-1', { baseUrl, timeoutMs: 100, retries: 0 });
    assert.deepEqual(hung, { ok: false, status: null, error: 'timed out after 100 ms' });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
