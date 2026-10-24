// Test V1: validateDataDir and the validate.mjs CLI.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildMeta } from './meta.mjs';
import { ingestPoll } from './rollup.mjs';
import { emptyStore, saveStore } from './store.mjs';
import { validateDataDir } from './validate.mjs';
import { FIXTURE_PLAYERS, at, fixtureSamples, tmpDir } from './__fixtures__/helpers.mjs';

const DAY1 = at('2026-10-23T21:37:00Z');
const DAY2 = at('2026-10-24T21:37:00Z');
const NOW = at('2026-10-25T00:00:00Z');
const VALIDATE_CLI = join(dirname(fileURLToPath(import.meta.url)), 'validate.mjs');

// Two polls of the seven fixture players, saved to a fresh temp dir.
function goodTree() {
  const store = emptyStore();
  const ok = { source: 'poll', ok: FIXTURE_PLAYERS, failed: [] };
  for (const now of [DAY1, DAY2]) {
    ingestPoll(store, fixtureSamples(now), { now });
    buildMeta(store, { now, players: FIXTURE_PLAYERS, lastPoll: ok });
  }
  const dir = tmpDir();
  saveStore(store, dir);
  return dir;
}

const readJson = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));
const writeJson = (dir, rel, value) => writeFileSync(join(dir, rel), JSON.stringify(value));
// Copies the good tree, applies `mutate(dir)`, and returns the validation result.
function validateMutated(good, mutate) {
  const dir = tmpDir();
  cpSync(good, dir, { recursive: true });
  mutate(dir);
  return validateDataDir(dir, { now: NOW });
}
const mutateJson = (rel, fn) => (dir) => {
  const json = readJson(dir, rel);
  fn(json);
  writeJson(dir, rel, json);
};
const hasError = (result, pattern) => result.errors.some((e) => pattern.test(e));

test('V1: a store written by saveStore validates cleanly', () => {
  const result = validateDataDir(goodTree(), { now: NOW });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('V1: duplicate keys, unsorted rows, bad days and header mismatches are errors', () => {
  const good = goodTree();
  const cases = [
    ['a duplicated key', /career-daily\.json: 1 duplicate keys/, mutateJson('seasons/25/career-daily.json', (j) => j.rows.splice(1, 0, { ...j.rows[0] }))],
    ['an unsorted file', /career-hero-daily\.json: \d+ rows out of order/, mutateJson('seasons/25/career-hero-daily.json', (j) => {
      [j.rows[0], j.rows[1]] = [j.rows[1], j.rows[0]];
    })],
    ['a non-midnight day', /rank-daily\.json: 1 days that are not UTC midnight/, mutateJson('seasons/25/rank-daily.json', (j) => { j.rows.at(-1).day += 1; })],
    ['a day after tomorrow', /days later than tomorrow/, mutateJson('seasons/25/career-daily.json', (j) => { j.rows.at(-1).day += 3 * 86_400_000; })],
    ['a header season mismatch', /career-latest\.json: header season 99 does not match its directory \(25\)/, mutateJson('seasons/25/career-latest.json', (j) => { j.season = 99; })],
    ['a rank row from another season', /rank rows whose season is not the directory/, mutateJson('seasons/24/rank-daily.json', (j) => { j.rows[0].season = 25; })],
    ['a missing key', /rows missing a key \(first: row 0 lacks "deaths"\)/, mutateJson('seasons/25/career-daily.json', (j) => { delete j.rows[0].deaths; })],
    ['a wrongly typed value', /wrongly typed value/, mutateJson('seasons/25/career-daily.json', (j) => { j.rows[0].gamesPlayed = '58'; })],
    ['an all-heroes row in career-hero-daily', /all-heroes rows/, mutateJson('seasons/25/career-hero-daily.json', (j) => { j.rows[0].hero = 'all-heroes'; })],
    ['an unparseable file', /career-daily\.json: does not parse/, (dir) => writeFileSync(join(dir, 'seasons/25/career-daily.json'), '{"season":25,')],
    ['a missing season file', /rank-daily\.json: file is missing/, (dir) => rmSync(join(dir, 'seasons/24/rank-daily.json'))],
    ['an unsorted global file', /rank-current\.json: \d+ rows out of order/, mutateJson('snapshots/rank-current.json', (j) => { j.rows.reverse(); })],
  ];
  for (const [label, pattern, mutate] of cases) {
    const result = validateMutated(good, mutate);
    assert.ok(hasError(result, pattern), `${label}: expected ${pattern}, got ${JSON.stringify(result.errors)}`);
  }
});

test('V1: meta.json problems are errors', () => {
  const good = goodTree();
  const cases = [
    ['layoutVersion 1', /layoutVersion is 1, expected 2/, mutateJson('snapshots/meta.json', (m) => { m.layoutVersion = 1; })],
    ['a missing layoutVersion (legacy meta)', /layoutVersion is undefined/, mutateJson('snapshots/meta.json', (m) => { delete m.layoutVersion; })],
    ['a non-integer currentSeason', /currentSeason "25" is neither an integer nor null/, mutateJson('snapshots/meta.json', (m) => { m.currentSeason = '25'; })],
    ['seasons[] missing a directory', /does not match the season directories/, mutateJson('snapshots/meta.json', (m) => { m.seasons.pop(); })],
    ['seasons[] with the wrong span', /season 25 spans/, mutateJson('snapshots/meta.json', (m) => { m.seasons.at(-1).firstDay -= 86_400_000; })],
    ['an empty lastPoll.ok', /lastPoll\.ok is empty/, mutateJson('snapshots/meta.json', (m) => { m.lastPoll.ok = []; })],
    ['no meta.json', /meta\.json: file is missing/, (dir) => rmSync(join(dir, 'snapshots/meta.json'))],
  ];
  for (const [label, pattern, mutate] of cases) {
    const result = validateMutated(good, mutate);
    assert.ok(hasError(result, pattern), `${label}: expected ${pattern}, got ${JSON.stringify(result.errors)}`);
  }
  // null is a legal currentSeason (an empty store).
  const empty = validateMutated(good, mutateJson('snapshots/meta.json', (m) => { m.currentSeason = null; }));
  assert.ok(!hasError(empty, /currentSeason/));
});

test('V1: suspicious data is a warning, not an error', () => {
  const good = goodTree();
  // A counter that falls from one day to the next within a season.
  const fall = validateMutated(good, mutateJson('seasons/25/career-daily.json', (j) => {
    const darth = j.rows.filter((r) => r.player === 'DarthKcaj-1443');
    darth.at(-1).gamesPlayed = darth[0].gamesPlayed - 1;
  }));
  assert.deepEqual(fall.errors, []);
  assert.ok(fall.warnings.some((w) => /counter values fall .*DarthKcaj-1443 gamesPlayed/.test(w)), JSON.stringify(fall.warnings));

  // A roster player without a profile.
  const noProfile = validateMutated(good, mutateJson('snapshots/profiles.json', (j) => {
    j.rows = j.rows.filter((r) => r.player !== 'Lank-21912');
  }));
  assert.deepEqual(noProfile.errors, []);
  assert.deepEqual(noProfile.warnings, ['snapshots/profiles.json: roster player Lank-21912 has no profile yet']);

  // A file over 5 MB.
  const big = validateMutated(good, mutateJson('seasons/22/career-latest.json', (j) => {
    j.padding = 'x'.repeat(5 * 1024 * 1024);
  }));
  assert.ok(big.warnings.some((w) => /career-latest\.json: 5\.0 MB is over the 5 MB guideline/.test(w)));
});

test('V2: rank-icons.json is optional, and checked when present', () => {
  const good = goodTree();
  const rel = 'snapshots/rank-icons.json';
  // The fixture polls carry insignia URLs, so the good tree has the file.
  assert.ok(readJson(good, rel).divisions.gold);
  assert.deepEqual(validateDataDir(good, { now: NOW }).errors, []);

  // A tree without it (a legacy deploy, or a store that never saw an icon) is fine.
  const without = validateMutated(good, (dir) => rmSync(join(dir, rel)));
  assert.deepEqual(without.errors, []);
  assert.deepEqual(without.warnings, []);

  const entry = { url: 'https://static.example.invalid/x.png', season: 25 };
  const cases = [
    ['an http:// url', /rank-icons\.json: divisions\.gold: url "http:\/\/x\/gold\.png" is not an https:\/\/ URL/,
      mutateJson(rel, (j) => { j.divisions.gold.url = 'http://x/gold.png'; })],
    ['a relative url', /tiers\.3: url "\/tier\/3\.png" is not an https/,
      mutateJson(rel, (j) => { j.tiers['3'].url = '/tier/3.png'; })],
    ['a missing url', /divisions\.gold: url undefined is not an https/, mutateJson(rel, (j) => { delete j.divisions.gold.url; })],
    ['a non-integer season', /divisions\.gold: season 25\.5 is not an integer/, mutateJson(rel, (j) => { j.divisions.gold.season = 25.5; })],
    ['a string season', /tiers\.3: season "25" is not an integer/, mutateJson(rel, (j) => { j.tiers['3'].season = '25'; })],
    ['an upper-case division key', /divisions\.Gold: division keys must be lower case/, mutateJson(rel, (j) => { j.divisions.Gold = entry; })],
    ['an empty division key', /divisions\.: division keys must be lower case/, mutateJson(rel, (j) => { j.divisions[''] = entry; })],
    ['tier key 0', /tiers\.0: tier keys must be "1" to "5"/, mutateJson(rel, (j) => { j.tiers['0'] = entry; })],
    ['tier key 6', /tiers\.6: tier keys must be "1" to "5"/, mutateJson(rel, (j) => { j.tiers['6'] = entry; })],
    ['a non-numeric tier key', /tiers\.gold: tier keys must be/, mutateJson(rel, (j) => { j.tiers.gold = entry; })],
    ['an entry that is not an object', /divisions\.silver: is not \{ url, season \}/, mutateJson(rel, (j) => { j.divisions.silver = 'https://x/silver.png'; })],
    ['no divisions', /rank-icons\.json: "divisions" is not an object/, mutateJson(rel, (j) => { delete j.divisions; })],
    ['tiers as an array', /rank-icons\.json: "tiers" is not an object/, mutateJson(rel, (j) => { j.tiers = []; })],
    ['no generatedAt', /rank-icons\.json: no numeric generatedAt/, mutateJson(rel, (j) => { delete j.generatedAt; })],
    ['an unparseable file', /rank-icons\.json: does not parse/, (dir) => writeFileSync(join(dir, rel), '{"generatedAt":1,')],
  ];
  for (const [label, pattern, mutate] of cases) {
    const result = validateMutated(good, mutate);
    assert.ok(hasError(result, pattern), `${label}: expected ${pattern}, got ${JSON.stringify(result.errors)}`);
  }

  // Division names beyond the known eight are fine as long as they are lower case.
  const extra = validateMutated(good, mutateJson(rel, (j) => { j.divisions.ultimate = entry; }));
  assert.deepEqual(extra.errors, []);
});

test('V1: the CLI prints annotations and sets the exit code', () => {
  const good = goodTree();
  const run = (dir) => spawnSync(process.execPath, [VALIDATE_CLI, '--data-dir', dir], { encoding: 'utf8' });

  // The fixture days are in the past relative to the real clock, so this passes as-is.
  const pass = run(good);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /validate: 0 error\(s\), 0 warning\(s\)/);

  const bad = tmpDir();
  cpSync(good, bad, { recursive: true });
  mutateJson('seasons/25/career-daily.json', (j) => j.rows.splice(1, 0, { ...j.rows[0] }))(bad);
  mutateJson('snapshots/profiles.json', (j) => { j.rows.pop(); })(bad);
  const fail = run(bad);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /^::error::seasons\/25\/career-daily\.json: 1 duplicate keys/m);
  assert.match(fail.stdout, /^::warning::snapshots\/profiles\.json: roster player .* has no profile yet/m);
  assert.match(fail.stdout, /validate: 1 error\(s\), 1 warning\(s\)/);
});
