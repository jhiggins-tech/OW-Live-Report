// Tests W1-W2 (+ W3/W4): the deterministic file writer and loadStore.

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SEASON_DATASETS } from './constants.mjs';
import { buildMeta } from './meta.mjs';
import { ingestPoll } from './rollup.mjs';
import { emptyStore, globalRows, loadStore, saveStore, seasonRows } from './store.mjs';
import {
  FIXTURE_PLAYERS, LEGACY_SNAPSHOTS_DIR, at, fixtureSamples, makeSample, tmpDir,
} from './__fixtures__/helpers.mjs';

const DAY1 = at('2026-10-24T09:37:00Z');
const DAY2 = at('2026-10-25T09:37:00Z');
const ok = { source: 'poll', ok: FIXTURE_PLAYERS, failed: [] };

// Every file under `dir` -> its text, keyed by relative path.
function readTree(dir, rel = '') {
  const out = new Map();
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [k, v] of readTree(dir, path)) out.set(k, v);
    else out.set(path, readFileSync(join(dir, path), 'utf8'));
  }
  return out;
}

// One poll of the seven fixture players: seasons 22 (Kiddo), 23 (Shotdownboyz),
// 24 (Kieness, Tones) and 25 (Darth, plus Kiwi and Lank as new players).
function populated() {
  const store = emptyStore();
  ingestPoll(store, fixtureSamples(DAY1), { now: DAY1 });
  buildMeta(store, { now: DAY1, players: FIXTURE_PLAYERS, lastPoll: ok });
  return store;
}

test('W1: saveStore is deterministic, one row per line, sorted, and only rewrites changed files', () => {
  const store = populated();
  const a = tmpDir();
  const b = tmpDir();
  const first = saveStore(store, a);
  saveStore(store, b);
  assert.deepEqual(readTree(a), readTree(b), 'two saves of the same store are byte-identical');
  assert.ok(first.written.includes('seasons/25/career-daily.json'));
  assert.ok(first.written.includes('snapshots/meta.json'));
  assert.ok(first.written.includes('pipeline/state.json'));
  assert.deepEqual(first.unchanged, []);

  // Format: header line, one row per line with commas, closing line, final newline.
  const text = readFileSync(join(a, 'seasons/25/rank-daily.json'), 'utf8');
  const lines = text.split('\n');
  assert.equal(lines.at(-1), '', 'ends with a newline');
  assert.equal(lines[0], `{"season":25,"generatedAt":${DAY1},"rows":[`);
  assert.equal(lines.at(-2), ']}');
  const rowLines = lines.slice(1, -2);
  assert.ok(rowLines.length >= 3);
  rowLines.forEach((line, i) => assert.ok(i === rowLines.length - 1 ? !line.endsWith(',') : line.endsWith(',')));
  const rows = rowLines.map((l) => JSON.parse(l.replace(/,$/, '')));
  assert.deepEqual(Object.keys(rows[0]), ['player', 'role', 'day', 'tier', 'division', 'season']);
  assert.deepEqual(JSON.parse(text).rows, rows);
  const order = rows.map((r) => `${r.day}|${r.player}|${r.role}`);
  assert.deepEqual(order, [...order].sort());

  // Key order for every dataset matches the contract.
  const keysOf = (rel) => Object.keys(JSON.parse(readFileSync(join(a, rel), 'utf8')).rows[0]);
  assert.deepEqual(keysOf('seasons/25/career-daily.json'),
    ['player', 'day', 'eliminations', 'deaths', 'assists', 'gamesWon', 'gamesPlayed']);
  assert.deepEqual(keysOf('seasons/25/career-hero-daily.json'),
    ['player', 'hero', 'day', 'eliminations', 'deaths', 'assists', 'gamesPlayed', 'timePlayed']);
  assert.deepEqual(keysOf('seasons/25/career-latest.json'),
    ['player', 'hero', 'time', 'eliminations', 'deaths', 'assists', 'healingDone', 'healingPer10Min', 'gamesWon', 'gamesPlayed', 'winPercentage', 'timePlayed']);
  assert.deepEqual(keysOf('snapshots/rank-current.json'), ['player', 'role', 'time', 'tier', 'division', 'season']);
  assert.deepEqual(keysOf('snapshots/profiles.json'),
    ['player', 'time', 'username', 'avatar', 'namecard', 'title', 'endorsementLevel', 'endorsementFrame', 'lastUpdatedAt']);
  // Global files have no "season" header; meta/state are pretty-printed.
  assert.match(readFileSync(join(a, 'snapshots/rank-current.json'), 'utf8'), /^\{"generatedAt":\d+,"rows":\[\n/);
  assert.match(readFileSync(join(a, 'snapshots/meta.json'), 'utf8'), /^\{\n {2}"layoutVersion": 2,\n/);
  assert.match(readFileSync(join(a, 'pipeline/state.json'), 'utf8'), /^\{\n {2}"version": 1,\n/);

  // Saving again changes nothing but meta.json.
  const before = readTree(a);
  const again = saveStore(store, a);
  assert.deepEqual(again.written, ['snapshots/meta.json']);
  assert.ok(again.unchanged.includes('seasons/25/career-daily.json'));
  assert.deepEqual(readTree(a), before);

  // A second day changes the current season's files only; frozen seasons keep
  // their bytes (and so their generatedAt).
  ingestPoll(store, fixtureSamples(DAY2, (id, body) => {
    if (id === 'DarthKcaj-1443') body.summary.last_updated_at += 3600;
  }), { now: DAY2 });
  buildMeta(store, { now: DAY2, players: FIXTURE_PLAYERS, lastPoll: ok });
  const day2 = saveStore(store, a);
  const after = readTree(a);
  for (const season of [22, 23, 24]) {
    for (const spec of Object.values(SEASON_DATASETS)) {
      const rel = `seasons/${season}/${spec.file}.json`;
      assert.ok(day2.unchanged.includes(rel), `${rel} unchanged`);
      assert.equal(after.get(rel), before.get(rel));
    }
  }
  assert.ok(day2.written.includes('seasons/25/career-daily.json'));
  assert.match(after.get('seasons/25/career-daily.json'), new RegExp(`"generatedAt":${DAY2},`));
  assert.match(after.get('seasons/24/career-daily.json'), new RegExp(`"generatedAt":${DAY1},`));
});

test('W1: an empty dataset is written as "rows":[]', () => {
  const store = emptyStore();
  ingestPoll(store, [makeSample('Lank-21912', DAY1, { rankSeason: 25, career: null })], { now: DAY1 });
  buildMeta(store, { now: DAY1, players: ['Lank-21912'], lastPoll: { source: 'poll', ok: ['Lank-21912'], failed: [] } });
  const dir = tmpDir();
  saveStore(store, dir);
  assert.equal(readFileSync(join(dir, 'seasons/25/career-daily.json'), 'utf8'), `{"season":25,"generatedAt":${DAY1},"rows":[]}\n`);
  assert.equal(readFileSync(join(dir, 'snapshots/profiles.json'), 'utf8'), `{"generatedAt":${DAY1},"rows":[]}\n`);
  assert.equal(seasonRows(loadStore(dir), 25, 'rankDaily').length, 1);
});

test('W2: loadStore -> saveStore on a populated dir is a no-op', () => {
  const store = populated();
  const dir = tmpDir();
  saveStore(store, dir);
  const before = readTree(dir);

  const loaded = loadStore(dir);
  assert.deepEqual(loaded.state, store.state);
  assert.deepEqual(loaded.previousMeta, store.meta);
  assert.deepEqual(globalRows(loaded, 'rankCurrent'), globalRows(store, 'rankCurrent'));
  assert.deepEqual(globalRows(loaded, 'profiles'), globalRows(store, 'profiles'));
  for (const season of [22, 23, 24, 25]) {
    for (const name of Object.keys(SEASON_DATASETS)) {
      assert.deepEqual(seasonRows(loaded, season, name), seasonRows(store, season, name));
    }
  }

  const result = saveStore(loaded, dir);
  assert.deepEqual(result.written, ['snapshots/meta.json']);
  assert.deepEqual(readTree(dir), before);

  // And a poll on top of the loaded store behaves like one on the original.
  ingestPoll(loaded, fixtureSamples(DAY2), { now: DAY2 });
  ingestPoll(store, fixtureSamples(DAY2), { now: DAY2 });
  assert.deepEqual(loaded.state, store.state);
  assert.deepEqual(seasonRows(loaded, 25, 'careerDaily'), seasonRows(store, 25, 'careerDaily'));
});

test('W3: loadStore copes with a missing or empty tree and refuses corrupt files', () => {
  const blank = { version: 1, currentSeason: null, currentSeasonDetectedAt: null, players: {} };
  const missing = loadStore(join(tmpDir(), 'nope'));
  assert.deepEqual(missing.state, blank);
  assert.equal(missing.seasons.size, 0);
  assert.equal(missing.previousMeta, null);
  assert.equal(missing.rankCurrent.size + missing.profiles.size, 0);

  const dir = tmpDir();
  mkdirSync(join(dir, 'seasons'));
  mkdirSync(join(dir, 'snapshots'));
  assert.deepEqual(loadStore(dir).state, blank);

  // A corrupt file must stop the run rather than be treated as empty.
  mkdirSync(join(dir, 'seasons', '25'));
  writeFileSync(join(dir, 'seasons', '25', 'career-daily.json'), '{"season":25,"rows":[');
  assert.throws(() => loadStore(dir), /career-daily\.json/);
});

test('W4: loadStore ignores the legacy flat snapshot files', () => {
  const dir = tmpDir();
  mkdirSync(join(dir, 'snapshots'));
  for (const f of ['rank-daily', 'career-daily', 'career-hero-daily', 'career-latest']) {
    writeFileSync(join(dir, 'snapshots', `${f}.json`), '{"generatedAt":1,"rows":[{"player":"x"}]}');
  }
  const store = loadStore(dir);
  assert.equal(store.seasons.size, 0);

  // The committed snapshots/ dir (legacy flat files alongside the global
  // ones), copied out so seasons/ and pipeline/ committed next to it since
  // the cutover don't leak in: rank-current and profiles load, nothing else.
  if (!existsSync(LEGACY_SNAPSHOTS_DIR)) return;
  const copy = tmpDir();
  cpSync(LEGACY_SNAPSHOTS_DIR, join(copy, 'snapshots'), { recursive: true });
  const legacy = loadStore(copy);
  assert.equal(legacy.seasons.size, 0);
  assert.equal(legacy.profiles.size, 7);
  assert.ok(legacy.rankCurrent.size > 0);
  assert.equal(legacy.state.currentSeason, null);
});
