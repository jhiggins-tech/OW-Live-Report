// Tests P1-P11: poll.mjs driven in-process through runPoll() with --fixtures or
// a fake fetchImpl, against fs.mkdtempSync data dirs. No network, no real
// sleeps. The CLI entry point gets two spawned smoke tests (P11).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DEFAULT_DATA_DIR, DEFAULT_ROSTER, runPoll } from './poll.mjs';
import { loadRoster } from './roster.mjs';
import { validateDataDir } from './validate.mjs';
import { FIXTURE_PLAYERS, FIXTURE_PLAYERS_DIR, at, loadFixture, tmpDir } from './__fixtures__/helpers.mjs';

const DAY1_AM = at('2026-10-24T09:37:00Z');
const DAY1_PM = at('2026-10-24T21:37:00Z');
const DAY2_AM = at('2026-10-25T09:37:00Z');
const iso = (ms) => new Date(ms).toISOString();
const DAY1_MS = at('2026-10-24T00:00:00Z');
const DAY2_MS = at('2026-10-25T00:00:00Z');

// --- helpers -----------------------------------------------------------------

// A scratch area: a roster file naming the fixture players, plus a data dir
// path (not created yet, like the first run on a fresh checkout).
function scratch() {
  const root = tmpDir();
  const roster = join(root, 'roster.txt');
  writeFileSync(roster, `${FIXTURE_PLAYERS.map((id) => `${id.split('-')[0]} | ${id.replace('-', '#')}`).join('\n')}\n`);
  return { root, roster, dataDir: join(root, 'data'), rawDir: join(root, 'raw') };
}

// Runs the CLI in-process. `env` is empty by default so the outer
// environment (FORCE_SEASON, GITHUB_STEP_SUMMARY) can't leak in.
async function run(argv, opts = {}) {
  const lines = [];
  const sleeps = [];
  const code = await runPoll(argv, {
    sleep: async (ms) => { sleeps.push(ms); },
    env: {},
    stdout: { write: (s) => lines.push(s) },
    ...opts,
  });
  return { code, out: lines.join(''), sleeps };
}

const fixtureRun = (s, fixtures, now, extra = [], opts = {}) => run(
  ['--roster', s.roster, '--data-dir', s.dataDir, '--fixtures', fixtures, '--now', iso(now), ...extra],
  opts,
);

// A copy of the fixture players with `tweak(id, body)` applied to each response.
function fixturesWith(root, name, tweak) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const id of FIXTURE_PLAYERS) {
    const body = structuredClone(loadFixture(id));
    tweak(id, body);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(body));
  }
  return dir;
}

// Day 2: DarthKcaj played a few games. Everyone else is unchanged.
const COUNTER_KEYS = new Set(['eliminations', 'deaths', 'assists', 'healing_done', 'games_played', 'games_won', 'time_played']);
function playDarthKcaj(id, body) {
  if (id !== 'DarthKcaj-1443') return;
  for (const categories of Object.values(body.stats.pc.competitive.career_stats)) {
    for (const category of categories) {
      for (const stat of category.stats) if (COUNTER_KEYS.has(stat.key)) stat.value += 10;
    }
  }
}

const readJson = (dataDir, rel) => JSON.parse(readFileSync(join(dataDir, rel), 'utf8'));

// Every file under `dir` -> its text, keyed by relative path ({} if missing).
function readTree(dir, rel = '') {
  const out = new Map();
  if (!existsSync(join(dir, rel))) return out;
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [k, v] of readTree(dir, path)) out.set(k, v);
    else out.set(path, readFileSync(join(dir, path), 'utf8'));
  }
  return out;
}

// Rows of a dataset file whose series key is `keyOf(row)`, grouped by key.
function bySeries(dataDir, rel, keyOf) {
  const out = new Map();
  for (const row of readJson(dataDir, rel).rows) {
    const key = keyOf(row);
    out.set(key, [...(out.get(key) ?? []), row.day]);
  }
  return out;
}

const DAILY_FILES = ['rank-daily', 'career-daily', 'career-hero-daily'];

// A fetchImpl that serves the fixture files by URL, with per-player overrides
// ({ id: () => Response }), and logs the order requests arrive in.
function fixtureServer(overrides = {}) {
  const requested = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (url, init) => {
    requested.push({ url, init });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setImmediate(r));
      const id = decodeURIComponent(new URL(url).pathname.replace('/players/', ''));
      if (overrides[id]) return overrides[id]();
      return new Response(JSON.stringify(loadFixture(id)), { status: 200 });
    } finally {
      inFlight -= 1;
    }
  };
  return { fetchImpl, requested, stats: () => ({ maxInFlight }) };
}

// --- tests -------------------------------------------------------------------

test('P1: day 1 twice then day 2 keeps one row per series per day and only rewrites what changed', async () => {
  const s = scratch();
  const day2Fixtures = fixturesWith(s.root, 'day2', playDarthKcaj);

  // Poll 1: day 1, 09:37.
  const first = await fixtureRun(s, FIXTURE_PLAYERS_DIR, DAY1_AM);
  assert.equal(first.code, 0, first.out);
  assert.deepEqual(first.sleeps, [], 'fixture mode never pauses');
  assert.match(first.out, /^7 of 7 players fetched; current season 25$/m);
  assert.match(first.out, /^player\s+\| status \| season \| reason$/m);
  assert.match(first.out, /^DarthKcaj-1443\s+\| ok\s+\| 25\s+\| new-player$/m);
  assert.match(first.out, /^Files written \(21\), 0 unchanged:$/m);
  assert.match(first.out, /^ {2}seasons\/25\/rank-daily\.json$/m);
  assert.match(first.out, /^ {2}snapshots\/rank-icons\.json$/m);

  const meta1 = readJson(s.dataDir, 'snapshots/meta.json');
  assert.equal(meta1.layoutVersion, 2);
  assert.equal(meta1.currentSeason, 25);
  assert.deepEqual(meta1.players, FIXTURE_PLAYERS);
  assert.deepEqual(meta1.lastPoll, { at: DAY1_AM, source: 'poll', ok: FIXTURE_PLAYERS, failed: [] });
  assert.equal(meta1.generatedAt, DAY1_AM);
  assert.deepEqual(meta1.seasons.map((x) => x.season), [22, 23, 24, 25]);
  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY1_AM }), { errors: [], warnings: [] });
  const tree1 = readTree(s.dataDir);

  // Poll 2: same day, 21:37, same responses.
  const second = await fixtureRun(s, FIXTURE_PLAYERS_DIR, DAY1_PM);
  assert.equal(second.code, 0, second.out);
  const tree2 = readTree(s.dataDir);
  const meta2 = readJson(s.dataDir, 'snapshots/meta.json');
  assert.deepEqual(meta2.lastPoll, { at: DAY1_PM, source: 'poll', ok: FIXTURE_PLAYERS, failed: [] });
  assert.equal(meta2.generatedAt, DAY1_PM);
  assert.equal(meta2.heartbeatAt, DAY1_PM);
  assert.match(second.out, /^DarthKcaj-1443\s+\| ok\s+\| 25\s+\| unchanged$/m);
  // Written: season 25's career-latest, rank-current, profiles, state and meta
  // (the icon map saw the same URLs again, so rank-icons.json is unchanged).
  assert.match(second.out, /^Files written \(5\), 16 unchanged:$/m);
  assert.ok(!second.out.includes('  snapshots/rank-icons.json'));

  // Nothing but the "last seen" timestamps moved: every daily roll-up and
  // every frozen season file is byte-identical, so `generatedAt` is kept.
  for (const season of [22, 23, 24, 25]) {
    for (const file of DAILY_FILES) {
      const rel = `seasons/${season}/${file}.json`;
      assert.equal(tree2.get(rel), tree1.get(rel), rel);
      assert.equal(JSON.parse(tree2.get(rel)).generatedAt, DAY1_AM, rel);
    }
  }
  for (const season of [22, 23, 24]) {
    const rel = `seasons/${season}/career-latest.json`;
    assert.equal(tree2.get(rel), tree1.get(rel), rel);
    assert.ok(!second.out.includes(`  ${rel}`), `${rel} should not be listed as written`);
  }
  // The current season's career-latest and the global files carry poll times.
  for (const rel of ['seasons/25/career-latest.json', 'snapshots/rank-current.json', 'snapshots/profiles.json']) {
    assert.notEqual(tree2.get(rel), tree1.get(rel), rel);
    assert.equal(JSON.parse(tree2.get(rel)).generatedAt, DAY1_PM, rel);
  }
  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY1_PM }), { errors: [], warnings: [] });

  // Poll 3: day 2, DarthKcaj has played.
  const third = await fixtureRun(s, day2Fixtures, DAY2_AM);
  assert.equal(third.code, 0, third.out);
  const tree3 = readTree(s.dataDir);
  const meta3 = readJson(s.dataDir, 'snapshots/meta.json');
  assert.deepEqual(meta3.lastPoll, { at: DAY2_AM, source: 'poll', ok: FIXTURE_PLAYERS, failed: [] });
  assert.equal(meta3.currentSeason, 25);

  // Players whose season is over don't get a flat-lined day-2 row, so
  // seasons 22-24 are byte-identical to day 1 and keep their generatedAt.
  for (const season of [22, 23, 24]) {
    for (const file of [...DAILY_FILES, 'career-latest']) {
      const rel = `seasons/${season}/${file}.json`;
      assert.equal(tree3.get(rel), tree2.get(rel), rel);
    }
  }

  // Season 25: exactly one row per (series, day), a second day for each of
  // the three current-season players, and Darth's counters moved.
  const rankSeries = bySeries(s.dataDir, 'seasons/25/rank-daily.json', (r) => `${r.player}|${r.role}`);
  assert.ok(rankSeries.size > 0);
  for (const [key, days] of rankSeries) {
    const expected = key.startsWith('DarthKcaj') || key.startsWith('KiwiCore') || key.startsWith('Lank')
      ? [DAY1_MS, DAY2_MS] : [DAY1_MS];
    assert.deepEqual(days, expected, key);
  }
  const careerSeries = bySeries(s.dataDir, 'seasons/25/career-daily.json', (r) => r.player);
  assert.deepEqual([...careerSeries.keys()].sort(), ['DarthKcaj-1443', 'KiwiCore-1324', 'Lank-21912']);
  for (const [player, days] of careerSeries) assert.deepEqual(days, [DAY1_MS, DAY2_MS], player);
  const heroSeries = bySeries(s.dataDir, 'seasons/25/career-hero-daily.json', (r) => `${r.player}|${r.hero}`);
  for (const [key, days] of heroSeries) {
    assert.deepEqual(days, [DAY1_MS, DAY2_MS], key);
  }

  const darth = readJson(s.dataDir, 'seasons/25/career-daily.json').rows.filter((r) => r.player === 'DarthKcaj-1443');
  assert.equal(darth.length, 2);
  assert.equal(darth[1].eliminations, darth[0].eliminations + 10);
  assert.equal(darth[1].gamesPlayed, darth[0].gamesPlayed + 10);
  assert.equal(readJson(s.dataDir, 'seasons/25/career-daily.json').generatedAt, DAY2_AM);

  // Frozen files untouched, so their header timestamps are still day 1's.
  assert.equal(JSON.parse(tree3.get('seasons/24/career-daily.json')).generatedAt, DAY1_AM);
  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY2_AM }), { errors: [], warnings: [] });
  assert.equal(readJson(s.dataDir, 'pipeline/state.json').players['DarthKcaj-1443'].lastFetchedAt, DAY2_AM);
});

test('P2: all players failing exits 1 and writes nothing (fresh dir and populated dir)', async () => {
  // Fresh checkout: the data dir is never even created.
  const s = scratch();
  const empty = join(s.root, 'no-fixtures');
  mkdirSync(empty);
  const fresh = await fixtureRun(s, empty, DAY1_AM);
  assert.equal(fresh.code, 1);
  assert.match(fresh.out, /^::error::All 7 players failed to fetch; nothing was written$/m);
  assert.match(fresh.out, /^::warning::Kieness-6123: fetch failed: fixture not found: /m);
  assert.match(fresh.out, /^Kieness-6123\s+\| failed\s+\| -\s+\| fixture not found: /m);
  assert.equal(existsSync(s.dataDir), false);

  // Populated dir, OverFast down: every request is a 503 (retried, then given up).
  const ok = await fixtureRun(s, FIXTURE_PLAYERS_DIR, DAY1_AM);
  assert.equal(ok.code, 0, ok.out);
  const before = readTree(s.dataDir);
  const down = await run(
    ['--roster', s.roster, '--data-dir', s.dataDir, '--raw-dir', s.rawDir, '--now', iso(DAY1_PM)],
    { fetchImpl: async () => new Response('Service Unavailable', { status: 503 }) },
  );
  assert.equal(down.code, 1);
  assert.match(down.out, /^::error::All 7 players failed to fetch; nothing was written$/m);
  assert.match(down.out, /^Kieness-6123: HTTP 503; retry 1 in 2s$/m);
  assert.deepEqual(readTree(s.dataDir), before, 'data dir must be untouched, meta.json included');
  assert.equal(down.sleeps.filter((ms) => ms === 8_000).length, 7, 'each player retried to the 8 s step');
  assert.equal(down.sleeps.filter((ms) => ms === 1_000).length, 6, 'a pause between players');
});

test('P3: responses with no career stats and no ranks anywhere look like a schema change and write nothing', async () => {
  const s = scratch();
  const bare = fixturesWith(s.root, 'bare', (id, body) => {
    delete body.stats;
    body.summary = { username: id.split('-')[0] };
  });
  const res = await fixtureRun(s, bare, DAY1_AM);
  assert.equal(res.code, 1);
  assert.match(res.out, /^::error::No response has career stats or ranks; OverFast probably changed its schema\. Nothing was written$/m);
  assert.match(res.out, /^Kieness-6123\s+\| empty\s+\| -\s+\| no career stats and no ranks$/m);
  assert.equal(existsSync(s.dataDir), false);

  // The same through the network path, with an unrelated JSON body.
  const net = await run(
    ['--roster', s.roster, '--data-dir', s.dataDir],
    { fetchImpl: async () => new Response('{"error":"something new"}', { status: 200 }) },
  );
  assert.equal(net.code, 1);
  assert.equal(existsSync(s.dataDir), false);

  // One usable response is enough to go ahead (a private profile is normal).
  const mixed = fixturesWith(s.root, 'mixed', (id, body) => {
    if (id !== 'DarthKcaj-1443') {
      delete body.stats;
      body.summary = { username: id.split('-')[0] };
    }
  });
  const ok = await fixtureRun(s, mixed, DAY1_AM);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(readJson(s.dataDir, 'snapshots/meta.json').lastPoll.ok.length, 7);
});

test('P4: a partial failure ingests the rest and records the failures in meta.lastPoll', async () => {
  const s = scratch();
  const summaryPath = join(s.root, 'summary.md');
  const server = fixtureServer({
    'Tones-11680': () => new Response('{"error":"Player not found"}', { status: 404 }),
    'Lank-21912': () => new Response('Service Unavailable', { status: 503 }),
  });
  const res = await run(
    ['--roster', s.roster, '--data-dir', s.dataDir, '--raw-dir', s.rawDir, '--now', iso(DAY1_AM)],
    { fetchImpl: server.fetchImpl, env: { GITHUB_STEP_SUMMARY: summaryPath, OVERFAST_BASE_URL: 'https://mirror.test' } },
  );
  assert.equal(res.code, 0, res.out);

  // One request at a time, in roster order, to the configured base URL.
  assert.equal(server.stats().maxInFlight, 1);
  const attempts = server.requested.map((r) => new URL(r.url).pathname.replace('/players/', ''));
  const lank = attempts.filter((id) => id === 'Lank-21912').length;
  assert.equal(lank, 4, 'Lank was tried 4 times (1 + 3 retries)');
  assert.deepEqual([...new Set(attempts)], FIXTURE_PLAYERS);
  assert.ok(server.requested.every((r) => r.url.startsWith('https://mirror.test/players/')));
  // 6 pauses between the 7 players, plus Lank's 2/4/8 s backoff.
  assert.deepEqual(res.sleeps.filter((ms) => ms === 1_000).length, 6);
  assert.deepEqual(res.sleeps.filter((ms) => ms !== 1_000), [2_000, 4_000, 8_000]);

  const meta = readJson(s.dataDir, 'snapshots/meta.json');
  assert.deepEqual(meta.lastPoll, {
    at: DAY1_AM,
    source: 'poll',
    ok: FIXTURE_PLAYERS.filter((id) => id !== 'Tones-11680' && id !== 'Lank-21912'),
    failed: [
      { player: 'Tones-11680', error: 'player not found (OverFast may not have indexed them yet)' },
      { player: 'Lank-21912', error: 'HTTP 503' },
    ],
  });
  assert.deepEqual(meta.players, FIXTURE_PLAYERS, 'the roster, not just the players that answered');
  assert.equal(meta.heartbeatAt, DAY1_AM);
  assert.match(res.out, /^::warning::Tones-11680: fetch failed: player not found/m);
  assert.match(res.out, /^::warning::Lank-21912: fetch failed: HTTP 503$/m);
  assert.match(res.out, /^Tones-11680\s+\| failed\s+\| -\s+\| player not found/m);

  // Failed players have no state and no rows; the others do.
  const state = readJson(s.dataDir, 'pipeline/state.json');
  assert.deepEqual(Object.keys(state.players).sort(), meta.lastPoll.ok.slice().sort());

  // --raw-dir holds exactly the bodies that came back.
  assert.deepEqual(readdirSync(s.rawDir).sort(), meta.lastPoll.ok.map((id) => `${id}.json`).sort());
  assert.deepEqual(JSON.parse(readFileSync(join(s.rawDir, 'DarthKcaj-1443.json'), 'utf8')), loadFixture('DarthKcaj-1443'));

  // $GITHUB_STEP_SUMMARY gets the table as markdown.
  const summary = readFileSync(summaryPath, 'utf8');
  assert.match(summary, /^### OverFast poll 2026-10-24T09:37:00Z$/m);
  assert.match(summary, /^\| player \| status \| season \| reason \|$/m);
  assert.match(summary, /^\| DarthKcaj-1443 \| ok \| 25 \| new-player \|$/m);
  assert.match(summary, /^\| Lank-21912 \| failed \| - \| HTTP 503 \|$/m);
  assert.match(summary, /^- `seasons\/25\/rank-daily\.json`$/m);

  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY1_AM }).errors, []);
});

test('P5: a poll where only some players answer leaves the others\' state alone', async () => {
  const s = scratch();
  assert.equal((await fixtureRun(s, FIXTURE_PLAYERS_DIR, DAY1_AM)).code, 0);
  const metaBefore = readJson(s.dataDir, 'snapshots/meta.json');

  // Only Kiddo answers on the next poll: 6 failures are recorded, Kiddo's state moves.
  const onlyKiddo = join(s.root, 'only-kiddo');
  mkdirSync(onlyKiddo);
  writeFileSync(join(onlyKiddo, 'Kiddo-11482.json'), readFileSync(join(FIXTURE_PLAYERS_DIR, 'Kiddo-11482.json')));
  const res = await fixtureRun(s, onlyKiddo, DAY1_PM);
  assert.equal(res.code, 0, res.out);
  const meta = readJson(s.dataDir, 'snapshots/meta.json');
  assert.deepEqual(meta.lastPoll.ok, ['Kiddo-11482']);
  assert.equal(meta.lastPoll.failed.length, 6);
  assert.equal(meta.heartbeatAt, DAY1_PM);
  const state = readJson(s.dataDir, 'pipeline/state.json');
  assert.equal(state.players['Kiddo-11482'].lastFetchedAt, DAY1_PM);
  assert.equal(state.players['DarthKcaj-1443'].lastFetchedAt, DAY1_AM, 'players that failed keep their old state');
  assert.deepEqual(meta.seasons, metaBefore.seasons);
  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY1_PM }).errors, []);
});

test('P6: FORCE_SEASON (env) and --force-season (flag) are respected; blank means unset', async () => {
  // Blank env, the scheduled-run case: auto-detected season 25.
  const blank = scratch();
  assert.equal((await fixtureRun(blank, FIXTURE_PLAYERS_DIR, DAY1_AM, [], { env: { FORCE_SEASON: '' } })).code, 0);
  assert.equal(readJson(blank.dataDir, 'snapshots/meta.json').currentSeason, 25);
  const blank2 = scratch();
  assert.equal((await fixtureRun(blank2, FIXTURE_PLAYERS_DIR, DAY1_AM, [], { env: { FORCE_SEASON: '  ' } })).code, 0);
  assert.equal(readJson(blank2.dataDir, 'snapshots/meta.json').currentSeason, 25);

  // FORCE_SEASON=26 makes 26 the current season.
  const env = scratch();
  const res = await fixtureRun(env, FIXTURE_PLAYERS_DIR, DAY1_AM, [], { env: { FORCE_SEASON: '26' } });
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /current season 26$/m);
  const meta = readJson(env.dataDir, 'snapshots/meta.json');
  assert.equal(meta.currentSeason, 26);
  assert.equal(meta.maxSeason, 26);
  const state = readJson(env.dataDir, 'pipeline/state.json');
  assert.equal(state.currentSeason, 26);
  assert.equal(state.currentSeasonDetectedAt, DAY1_AM);
  // KiwiCore and Lank report no rank season, so they follow the forced one.
  assert.equal(state.players['KiwiCore-1324'].season, 26);
  assert.equal(state.players['Lank-21912'].season, 26);
  assert.equal(state.players['DarthKcaj-1443'].season, 25);
  assert.deepEqual(validateDataDir(env.dataDir, { now: DAY1_AM }).errors, []);

  // The flag does the same, and wins over the environment.
  const flag = scratch();
  const viaFlag = await fixtureRun(flag, FIXTURE_PLAYERS_DIR, DAY1_AM, ['--force-season', '26'], { env: { FORCE_SEASON: '24' } });
  assert.equal(viaFlag.code, 0, viaFlag.out);
  assert.equal(readJson(flag.dataDir, 'snapshots/meta.json').currentSeason, 26);
  const eq = scratch();
  assert.equal((await fixtureRun(eq, FIXTURE_PLAYERS_DIR, DAY1_AM, ['--force-season=26'])).code, 0);
  assert.equal(readJson(eq.dataDir, 'pipeline/state.json').currentSeason, 26);

  // Junk is an error, not silently ignored.
  const bad = scratch();
  for (const junk of ['abc', '0', '25.5', '-3']) {
    const r = await fixtureRun(bad, FIXTURE_PLAYERS_DIR, DAY1_AM, [], { env: { FORCE_SEASON: junk } });
    assert.equal(r.code, 1, junk);
    assert.match(r.out, /^::error::Invalid force season /m, junk);
  }
  assert.equal(existsSync(bad.dataDir), false);
});

test('P7: no season can be determined on an empty store until one is forced', async () => {
  const s = scratch();
  const unranked = fixturesWith(s.root, 'unranked', (id, body) => { delete body.summary.competitive; });
  const res = await fixtureRun(s, unranked, DAY1_AM);
  assert.equal(res.code, 1);
  assert.match(res.out, /^::error::Cannot determine the current season; rerun with --force-season N$/m);
  assert.equal(existsSync(s.dataDir), false);

  const forced = await fixtureRun(s, unranked, DAY1_AM, ['--force-season', '25']);
  assert.equal(forced.code, 0, forced.out);
  assert.equal(readJson(s.dataDir, 'snapshots/meta.json').currentSeason, 25);
  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY1_AM }).errors, []);
});

test('P8: a missing fixture counts as a fetch failure for that player only', async () => {
  const s = scratch();
  const partial = fixturesWith(s.root, 'partial', () => {});
  writeFileSync(join(partial, 'Lank-21912.json'), '{ not json');
  const res = await fixtureRun(s, partial, DAY1_AM);
  assert.equal(res.code, 0, res.out);
  const { failed, ok } = readJson(s.dataDir, 'snapshots/meta.json').lastPoll;
  assert.equal(ok.length, 6);
  assert.deepEqual(failed.map((f) => f.player), ['Lank-21912']);
  assert.match(failed[0].error, /^fixture is not valid JSON: /);

  const missing = await run(['--roster', s.roster, '--data-dir', s.dataDir, '--fixtures', join(s.root, 'nope'), '--now', iso(DAY1_PM)]);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /fixture not found: /);
});

test('P9: bad arguments fail with an ::error:: and write nothing', async () => {
  const s = scratch();
  const cases = [
    [['--bogus'], /^::error::Unknown argument --bogus /m],
    [['--data-dir'], /^::error::--data-dir needs a value$/m],
    [['--now', 'yesterday-ish'], /^::error::Invalid --now "yesterday-ish"/m],
    [['--roster', join(s.root, 'missing.txt')], /^::error::.*ENOENT/m],
  ];
  for (const [argv, pattern] of cases) {
    const res = await run(['--data-dir', s.dataDir, '--fixtures', FIXTURE_PLAYERS_DIR, ...argv]);
    assert.equal(res.code, 1, argv.join(' '));
    assert.match(res.out, pattern, argv.join(' '));
  }
  const empty = join(s.root, 'empty-roster.txt');
  writeFileSync(empty, '# nobody\n');
  const none = await run(['--roster', empty, '--data-dir', s.dataDir, '--fixtures', FIXTURE_PLAYERS_DIR]);
  assert.equal(none.code, 1);
  assert.match(none.out, /^::error::No players found in /m);
  assert.equal(existsSync(s.dataDir), false);
});

test('P10: the defaults point at the repo roster and docs/data; a duplicate roster line is polled once', async () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
  assert.equal(DEFAULT_DATA_DIR, join(repoRoot, 'docs', 'data'));
  assert.equal(DEFAULT_ROSTER, join(repoRoot, 'config', 'tracked-battletags.txt'));
  assert.ok(loadRoster(DEFAULT_ROSTER).length > 0);

  const s = scratch();
  writeFileSync(s.roster, 'Kieness#6123\nKieness#6123\nDarthKcaj#1443\n');
  const server = fixtureServer();
  const res = await run(
    ['--roster', s.roster, '--data-dir', s.dataDir, '--now', iso(DAY1_AM)],
    { fetchImpl: server.fetchImpl },
  );
  assert.equal(res.code, 0, res.out);
  assert.equal(server.requested.length, 2);
  assert.deepEqual(readJson(s.dataDir, 'snapshots/meta.json').players, ['Kieness-6123', 'DarthKcaj-1443']);
});

test('P11: the CLI entry point runs, prints the table and sets the exit code', () => {
  const s = scratch();
  const script = join(fileURLToPath(import.meta.url), '..', 'poll.mjs');
  const env = { ...process.env };
  delete env.FORCE_SEASON;
  delete env.GITHUB_STEP_SUMMARY;

  const ok = spawnSync(process.execPath, [
    script, '--roster', s.roster, '--data-dir', s.dataDir, '--fixtures', FIXTURE_PLAYERS_DIR, '--now', iso(DAY1_PM),
  ], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^player\s+\| status \| season \| reason$/m);
  assert.match(ok.stdout, /^Files written \(21\)/m);
  assert.deepEqual(validateDataDir(s.dataDir, { now: DAY1_PM }), { errors: [], warnings: [] });

  const before = readTree(s.dataDir);
  const bad = spawnSync(process.execPath, [
    script, '--roster', s.roster, '--data-dir', s.dataDir, '--fixtures', join(s.root, 'nowhere'), '--now', iso(DAY2_AM),
  ], { encoding: 'utf8', env });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^::error::All 7 players failed to fetch/m);
  assert.deepEqual(readTree(s.dataDir), before);
});
