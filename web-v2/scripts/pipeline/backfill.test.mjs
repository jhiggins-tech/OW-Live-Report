// Tests for backfill-from-db.mjs (WP3): the DB path against a fake pg client
// (14-day window chunking and the narrow-row pivot), the --from-snapshots path
// over the committed legacy files (the PRD's replay timeline), --force
// handling, and that the written tree passes validateDataDir. No network.

import assert from 'node:assert/strict';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  addCareerRows, addRankRows, createHistory, dayWindows, dropLaggingHeroRows, historyToSamples, overlayLatestFields,
  parseArgs, runBackfill,
} from './backfill-from-db.mjs';
import { extractSample } from './extract.mjs';
import { legacySamplesByDay, replayDays } from './replay.mjs';
import { emptyStore, globalRows, loadStore, seasonRows } from './store.mjs';
import { isoDay } from './util.mjs';
import { validateDataDir } from './validate.mjs';
import {
  DAY, FIXTURE_PLAYERS, HOUR, LEGACY_SNAPSHOTS_DIR, at, careerOf, loadFixture, makeSample, tmpDir,
} from './__fixtures__/helpers.mjs';

const DATASETS = ['rankDaily', 'careerDaily', 'careerHeroDaily', 'careerLatest'];

// Collects what runBackfill logs.
function capture() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)) };
}

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

function writeRoster(dir, lines) {
  const path = join(dir, 'roster.txt');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

// --- narrow-row helpers (what the DB would hold for a Sample) ---------------------

// Sample field -> [metric, measurement], written independently of the script's
// own table so the test checks the PRD's mapping.
const CAREER_ROWS = {
  eliminations: ['eliminations', 'career_stats_combat'],
  deaths: ['deaths', 'career_stats_combat'],
  assists: ['assists', 'career_stats_assists'],
  healingDone: ['healing_done', 'career_stats_assists'],
  healingPer10Min: ['healing_done_avg_per_10_min', 'career_stats_average'],
  gamesWon: ['games_won', 'career_stats_game'],
  gamesPlayed: ['games_played', 'career_stats_game'],
  winPercentage: ['win_percentage', 'career_stats_game'],
  timePlayed: ['time_played', 'career_stats_game'],
};

// The ow_stats_daily rows that hold one Sample: rank rows are (tier, division,
// season) per role and career rows one per stat per hero; absent (null) stats
// have no row. `numeric` columns come back from pg as strings, so a couple of
// the fields are stringified.
function narrowRows(sample) {
  const day = new Date(sample.day);
  const rank = [];
  const career = [];
  for (const r of sample.ranks) {
    const base = { player: sample.player, role: r.role, day };
    rank.push({ ...base, metric: 'tier', value: r.tier, value_text: null });
    rank.push({ ...base, metric: 'division', value: null, value_text: r.division });
    if (r.season != null) rank.push({ ...base, metric: 'season', value: r.season, value_text: null });
  }
  for (const [hero, fields] of Object.entries(sample.career ?? {})) {
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) continue;
      const [metric, measurement] = CAREER_ROWS[field];
      career.push({
        player: sample.player, hero, measurement, metric, day, gamemode: 'competitive', platform: 'pc',
        value: field === 'timePlayed' || field === 'winPercentage' ? String(value) : value,
      });
    }
  }
  return { rank, career };
}

const inWindow = (day, from, to) => day.getTime() >= Date.parse(from) && day.getTime() < Date.parse(to);

// A fake pg client: query(sql, params) returns canned rows, honouring the same
// filters the SQL applies (players, metrics, gamemode, platform and the
// [from, to) window), so a wrong parameter shows up as wrong data.
function fakePg({
  minDay, rank, career, profileRaw = [], profileDaily = [], gamesRaw = [], gamesDaily = [],
}) {
  const calls = [];
  const client = {
    calls,
    connected: false,
    ended: false,
    async connect() {
      client.connected = true;
    },
    async end() {
      client.ended = true;
    },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/min\(day\)/.test(sql)) return { rows: [{ min_day: new Date(minDay) }] };
      if (/DISTINCT ON/.test(sql)) {
        const raw = /FROM ow_stats\s/.test(sql);
        if (sql.includes("'player_summary'")) return { rows: raw ? profileRaw : profileDaily };
        if (sql.includes("'career_stats_game'")) return { rows: raw ? gamesRaw : gamesDaily };
        throw new Error(`fakePg: unexpected latest query ${sql}`);
      }
      if (sql.includes("'competitive_rank'")) {
        const [players, metrics, from, to] = params;
        return {
          rows: rank
            .filter((r) => players.includes(r.player) && metrics.includes(r.metric) && inWindow(r.day, from, to))
            .sort((a, b) => a.day - b.day),
        };
      }
      if (sql.includes("'career_stats_combat'")) {
        const [players, gamemode, platform, metrics, from, to] = params;
        return {
          rows: career
            .filter((r) => players.includes(r.player) && r.gamemode === gamemode && r.platform === platform
              && metrics.includes(r.metric) && inWindow(r.day, from, to))
            .sort((a, b) => a.day - b.day),
        };
      }
      throw new Error(`fakePg: unexpected query ${sql}`);
    },
  };
  return client;
}

// --- the DB scenario ------------------------------------------------------------
//
// Two players over 32 days from 2026-09-01. Alpha-1 reports season 24, then
// rank season 25 on day 20 with reset counters (a rank-season rollover). Beta-2's
// rank season stays 24 (it lags), its counters sit still through day 22 and
// reset on day 23 (a counter-reset into the already-current season 25), and its
// whole of day 5 is missing.

const D0 = at('2026-09-01T00:00:00Z');
const NOW = at('2026-10-03T06:00:00Z'); // day 32: windows start D0, D0+14d, D0+28d
const dayAt = (i) => D0 + i * DAY;
const stamp = (i) => dayAt(i) + 12 * HOUR;

const ZARYA = careerOf({ eliminations: 77, deaths: 10, assists: 5, gamesPlayed: 9, timePlayed: 1234 });

function alphaSample(i) {
  const old = i < 20;
  const k = old ? i : i - 20;
  const all = old
    ? { eliminations: 1000 + 20 * k, deaths: 800 + 10 * k, assists: 400 + 5 * k, gamesWon: 50 + k, gamesPlayed: 100 + 2 * k, timePlayed: 20_000 + 300 * k }
    : { eliminations: 20 + 15 * k, deaths: 15 + 8 * k, assists: 9 + 3 * k, gamesWon: k, gamesPlayed: 2 + k, timePlayed: 600 + 50 * k };
  const season = old ? 24 : 25;
  return makeSample('Alpha-1', stamp(i), {
    rankSeason: season,
    ranks: [
      ...(i >= 10 ? [{ role: 'damage', tier: 4, division: 'silver', season }] : []),
      { role: 'support', tier: old ? 3 : 2, division: 'gold', season },
    ],
    career: {
      'all-heroes': careerOf(all),
      ana: careerOf({ ...all, eliminations: all.eliminations - 100, healingDone: 900 + 10 * i, healingPer10Min: 55.5, winPercentage: 61 }),
      mercy: old
        ? careerOf({ eliminations: 40 + i, deaths: 20, assists: 30, gamesPlayed: 5, timePlayed: 700 + 10 * i })
        : careerOf({ eliminations: 4, deaths: 2, assists: 3, gamesPlayed: 1 + k, timePlayed: 80 + 10 * k }),
      // Played last season only: its last season-24 row is day 19.
      ...(old ? { zarya: ZARYA } : {}),
    },
  });
}

function betaSample(i) {
  if (i === 5) return null;
  const still = i <= 22;
  const j = i <= 18 ? i : 18;
  const k = i - 23;
  const all = still
    ? { eliminations: 500 + 9 * j, deaths: 400 + 7 * j, assists: 100 + j, gamesWon: 25 + j, gamesPlayed: 50 + j, timePlayed: 9000 + 120 * j }
    : { eliminations: 10 + 4 * k, deaths: 8 + 3 * k, assists: 2 + k, gamesWon: k, gamesPlayed: 1 + k, timePlayed: 300 + 40 * k };
  return makeSample('Beta-2', stamp(i), {
    rankSeason: 24,
    ranks: [{ role: 'tank', tier: 4, division: 'silver', season: 24 }],
    career: { 'all-heroes': careerOf(all), reinhardt: careerOf({ ...all, healingDone: null }) },
  });
}

function dbScenario() {
  const samples = [];
  for (let i = 0; i < 32; i += 1) samples.push(...[alphaSample(i), betaSample(i)].filter(Boolean));
  const rank = [];
  const career = [];
  for (const s of samples) {
    const rows = narrowRows(s);
    rank.push(...rows.rank);
    career.push(...rows.career);
  }
  // The daily table keeps each series' last sample of the day: on the reset day
  // (20) Zarya, untouched since, still carries her pre-reset totals. These are
  // not in `samples` (the clean history); the backfill has to drop them.
  career.push(...narrowRows({ player: 'Alpha-1', day: dayAt(20), ranks: [], career: { zarya: ZARYA } }).career);
  // Rows the SQL must keep out: another player, another gamemode, another
  // platform, and a metric nobody asked for.
  const decoyDay = new Date(dayAt(3));
  career.push(
    { player: 'Ghost-9', hero: 'all-heroes', measurement: 'career_stats_game', metric: 'games_played', value: 1, day: decoyDay, gamemode: 'competitive', platform: 'pc' },
    { player: 'Alpha-1', hero: 'ana', measurement: 'career_stats_combat', metric: 'eliminations', value: 999_999, day: decoyDay, gamemode: 'quickplay', platform: 'pc' },
    { player: 'Alpha-1', hero: 'ana', measurement: 'career_stats_combat', metric: 'eliminations', value: 888_888, day: decoyDay, gamemode: 'competitive', platform: 'console' },
    { player: 'Alpha-1', hero: 'ana', measurement: 'career_stats_game', metric: 'games_lost', value: 7, day: decoyDay, gamemode: 'competitive', platform: 'pc' },
  );
  rank.push(
    { player: 'Ghost-9', role: 'tank', metric: 'tier', value: 1, value_text: null, day: decoyDay },
    { player: 'Alpha-1', role: 'tank', metric: 'rank_icon', value: null, value_text: 'x.png', day: decoyDay },
  );

  const t = (iso) => new Date(Date.parse(iso));
  const profile = (player, time, over) => Object.entries({
    username: 'Alpha', avatar: 'a.png', title: 'Gold', endorsement_level: '3', endorsement_frame: 'f.svg', ...over,
  }).map(([metric, v]) => ({
    player,
    measurement: 'player_summary',
    metric,
    value: metric === 'endorsement_level' ? v : null,
    value_text: metric === 'endorsement_level' ? null : v,
    time,
  }));
  return {
    samples,
    minDay: dayAt(0) + 7 * HOUR, // not at midnight on purpose
    rank,
    career,
    // Raw wins over daily for Alpha; Beta only has daily rows (idle for 14+ days).
    profileRaw: profile('Alpha-1', t('2026-10-03T05:00:00Z'), {}),
    profileDaily: [
      ...profile('Alpha-1', t('2026-09-20T00:00:00Z'), { username: 'OldAlpha' }),
      ...profile('Beta-2', t('2026-09-18T00:00:00Z'), { username: 'Beta', avatar: 'b.png', title: null, endorsement_level: '1', endorsement_frame: null }),
    ],
    gamesRaw: [{ player: 'Alpha-1', hero: 'all-heroes', measurement: 'career_stats_game', metric: 'games_played', value: '13', value_text: null, time: t('2026-10-03T05:00:00Z') }],
    gamesDaily: [{ player: 'Beta-2', hero: 'all-heroes', measurement: 'career_stats_game', metric: 'games_played', value: 9, value_text: null, time: t('2026-10-02T00:00:00Z') }],
  };
}

async function runDb(scenario, { dataDir, extra = [], now = NOW } = {}) {
  const dir = dataDir ?? tmpDir();
  const roster = writeRoster(tmpDir(), ['Alpha | Alpha#1', 'Beta | Beta#2']);
  const client = fakePg(scenario);
  const out = capture();
  const result = await runBackfill(['--data-dir', dir, '--roster', roster, ...extra], {
    pgClientFactory: () => client, now, log: out.log,
  });
  return { dir, client, result, ...out };
}

// --- unit tests -------------------------------------------------------------------

test('B0: parseArgs reads the flags and rejects bad input', () => {
  const a = parseArgs(['--data-dir', 'out', '--force', '--from-snapshots', 'snap', '--initial-season', '24', '--roster', 'r.txt']);
  assert.ok(a.dataDir.endsWith('/out') && a.fromSnapshots.endsWith('/snap') && a.roster.endsWith('/r.txt'));
  assert.equal(a.force, true);
  assert.equal(a.initialSeason, 24);
  const d = parseArgs(['--data-dir', 'out']);
  assert.equal(d.force, false);
  assert.equal(d.fromSnapshots, null);
  assert.equal(d.initialSeason, null);
  assert.ok(d.roster.endsWith('/config/tracked-battletags.txt'));
  assert.ok(existsSync(d.roster), 'the default roster is the repo roster');

  assert.throws(() => parseArgs([]), /--data-dir is required/);
  assert.throws(() => parseArgs(['--data-dir']), /needs a value/);
  assert.throws(() => parseArgs(['--data-dir', 'x', '--initial-season', 'soon']), /positive integer/);
  assert.throws(() => parseArgs(['--data-dir', 'x', '--wat']), /unknown argument --wat/);
});

test('B1: dayWindows tiles 14-day [from, to) windows until one covers the end', () => {
  const w = dayWindows(D0, NOW);
  assert.deepEqual(w.map((x) => [x.from, x.to]), [
    [dayAt(0), dayAt(14)], [dayAt(14), dayAt(28)], [dayAt(28), dayAt(42)],
  ]);
  // An end exactly on a window start still needs that window (a row can sit on it).
  assert.equal(dayWindows(D0, dayAt(14)).length, 2);
  assert.equal(dayWindows(D0, dayAt(14) - 1).length, 1);
  assert.deepEqual(dayWindows(D0, D0 - 1), []);
});

test('B2: narrow rows pivot into Samples shaped like extractSample output', () => {
  const day = new Date(D0);
  const history = createHistory();
  addRankRows(history, [
    { player: 'P-1', role: 'support', metric: 'tier', value: '3', value_text: null, day },
    { player: 'P-1', role: 'support', metric: 'division', value: null, value_text: 'gold', day },
    { player: 'P-1', role: 'support', metric: 'season', value: '25', value_text: null, day },
    { player: 'P-1', role: 'damage', metric: 'tier', value: 4, value_text: null, day },
    { player: 'P-1', role: 'damage', metric: 'division', value: null, value_text: 'silver', day },
    { player: 'P-1', role: 'tank', metric: 'tier', value: 2, value_text: null, day }, // no division: skipped
    { player: 'P-2', role: 'tank', metric: 'season', value: 25, value_text: null, day }, // incomplete only: dropped
  ]);
  const c = (hero, measurement, metric, value) => ({ player: 'P-1', hero, measurement, metric, value, day });
  addCareerRows(history, [
    c('all-heroes', 'career_stats_combat', 'eliminations', '10'),
    c('all-heroes', 'career_stats_combat', 'deaths', 5),
    c('all-heroes', 'career_stats_game', 'games_played', '12'),
    c('all-heroes', 'career_stats_game', 'time_played', '3600'),
    // A stat found only in another category still maps; the canonical one wins either way.
    c('ana', 'career_stats_game', 'healing_done', 100),
    c('ana', 'career_stats_assists', 'healing_done', 150),
    c('ana', 'career_stats_game', 'assists', 7),
    c('ana', 'career_stats_assists', 'assists', 9),
    c('mei', 'career_stats_combat', 'eliminations', null), // no value: hero dropped
    c('', 'career_stats_combat', 'eliminations', 3), // no hero: ignored
    c('ana', 'career_stats_combat', 'eliminations_most_in_game', 3), // unmapped metric: ignored
  ]);

  const blank = {
    eliminations: null, deaths: null, assists: null, healingDone: null, healingPer10Min: null,
    gamesWon: null, gamesPlayed: null, winPercentage: null, timePlayed: null,
  };
  assert.deepEqual(historyToSamples(history), [[D0, [{
    player: 'P-1',
    fetchedAt: D0 + 12 * HOUR,
    day: D0,
    rankSeason: 25,
    ranks: [
      { role: 'damage', tier: 4, division: 'silver', season: null },
      { role: 'support', tier: 3, division: 'gold', season: 25 },
    ],
    profile: null,
    career: {
      'all-heroes': { ...blank, eliminations: 10, deaths: 5, gamesPlayed: 12, timePlayed: 3600 },
      ana: { ...blank, healingDone: 150, assists: 9 },
    },
  }]]]);
});

test('B3: pivoting an extractSample() back from narrow rows gives the same Sample', () => {
  for (const id of FIXTURE_PLAYERS) {
    const sample = extractSample(id, loadFixture(id), D0 + 12 * HOUR);
    const rows = narrowRows(sample);
    const history = createHistory();
    addRankRows(history, rows.rank);
    addCareerRows(history, rows.career);
    const pivoted = historyToSamples(history);
    if (!sample.ranks.length && !sample.career) {
      assert.deepEqual(pivoted, [], `${id}: nothing to ingest`);
      continue;
    }
    // The DB keeps the season per role row, so a season with no ranked role is
    // lost. It keeps no insignia URLs either, so those ranks come back without.
    const expected = {
      ...sample,
      profile: null,
      rankSeason: sample.ranks.length ? sample.rankSeason : null,
      ranks: sample.ranks.map(({ rankIcon, tierIcon, ...rank }) => rank),
    };
    assert.deepEqual(pivoted, [[D0, [expected]]], id);
  }
});

test('B4: overlayLatestFields fills null healing/win fields on the last sample of each hero', () => {
  const sample = (day, career) => ({ player: 'A-1', day, fetchedAt: day + 12 * HOUR, rankSeason: null, ranks: [], profile: null, career });
  const hero = (over) => ({
    eliminations: 1, deaths: 1, assists: 1, healingDone: null, healingPer10Min: null, gamesWon: null, gamesPlayed: 1, winPercentage: null, timePlayed: 1, ...over,
  });
  const day1 = sample(D0, { 'all-heroes': hero({}), ana: hero({}), mei: hero({}) });
  const day2 = sample(D0 + DAY, { 'all-heroes': hero({}), ana: hero({ healingDone: 5 }) });
  overlayLatestFields([[D0, [day1]], [D0 + DAY, [day2]]], [
    { player: 'A-1', hero: 'all-heroes', healingDone: 800, healingPer10Min: 9, gamesWon: 4, winPercentage: 45 },
    { player: 'A-1', hero: 'ana', healingDone: 999, healingPer10Min: 12, gamesWon: 3, winPercentage: 50 },
    { player: 'A-1', hero: 'mei', healingDone: 7, healingPer10Min: null, gamesWon: 1, winPercentage: 40 },
    { player: 'Z-9', hero: 'ana', healingDone: 1, healingPer10Min: 1, gamesWon: 1, winPercentage: 1 },
  ]);
  const pick = (c) => [c.healingDone, c.healingPer10Min, c.gamesWon, c.winPercentage];
  assert.deepEqual(pick(day1.career.ana), [null, null, null, null], 'ana was seen again later, so only the later sample is filled');
  assert.deepEqual(pick(day2.career.ana), [5, 12, 3, 50], 'an existing value is kept; nulls are filled');
  assert.deepEqual(pick(day1.career.mei), [7, null, 1, 40]);
  // all-heroes gamesWon belongs to the career-daily series, so it is never borrowed.
  assert.deepEqual(pick(day2.career['all-heroes']), [800, 9, null, 45]);
  assert.deepEqual(pick(day1.career['all-heroes']), [null, null, null, null]);
});

test('B4b: dropLaggingHeroRows keeps only post-reset heroes on a counter-reset day', () => {
  const hero = (gamesPlayed, timePlayed, over = {}) => ({
    eliminations: 10, deaths: 5, assists: 3, healingDone: null, healingPer10Min: null, gamesWon: null, gamesPlayed, winPercentage: null, timePlayed, ...over,
  });
  const sample = (player, i, career) => ({ player, day: dayAt(i), fetchedAt: stamp(i), rankSeason: null, ranks: [], profile: null, career });
  // P-1 resets on day 1; Q-2 never does.
  const build = () => [
    [dayAt(0), [
      sample('P-1', 0, {
        'all-heroes': hero(100, 10_000, { eliminations: 1000 }),
        stale: hero(10, 1000), decreased: hero(20, 2000), higher: hero(10, 1000), fewerHours: hero(5, 900), gone: hero(7, 700),
      }),
      sample('Q-2', 0, { 'all-heroes': hero(50, 5000), a: hero(5, 500) }),
    ]],
    [dayAt(1), [
      sample('P-1', 1, {
        'all-heroes': hero(3, 2000, { eliminations: 20 }),
        stale: hero(10, 1000), // unchanged: a pre-reset leftover
        decreased: hero(2, 300), // went back down: played after the reset
        higher: hero(12, 1500), // higher than before is still not a new-season value
        fewerHours: hero(5, 400), // same games, less time: counts
        fresh: hero(1, 100), // new to the player
      }),
      sample('Q-2', 1, { 'all-heroes': hero(51, 5100), a: hero(5, 500) }),
    ]],
    [dayAt(2), [
      // Not a reset day, so nothing is dropped, even a hero equal to the day before.
      sample('P-1', 2, { 'all-heroes': hero(5, 2600, { eliminations: 40 }), stale: hero(10, 1000), decreased: hero(3, 400), fresh: hero(2, 200) }),
    ]],
  ];

  const days = build();
  const resets = dropLaggingHeroRows(days);
  assert.deepEqual(resets, [{ day: dayAt(1), player: 'P-1', dropped: ['stale', 'higher'], kept: 3 }]);
  assert.deepEqual(Object.keys(days[1][1][0].career), ['all-heroes', 'decreased', 'fewerHours', 'fresh']);
  assert.equal(days[1][1][0].career['all-heroes'].timePlayed, 2000, 'DB mode keeps the real all-heroes time');
  assert.deepEqual(days[1][1][1], build()[1][1][1], 'a player who did not reset is untouched');
  assert.deepEqual(days[0], build()[0], 'earlier days are untouched');
  assert.deepEqual(days[2], build()[2], 'so are later days');

  // Snapshots mode redoes the all-heroes time as the sum over the kept heroes.
  const summed = build();
  dropLaggingHeroRows(summed, { recomputeAllHeroesTime: true });
  assert.equal(summed[1][1][0].career['all-heroes'].timePlayed, 300 + 400 + 100);
  assert.equal(summed[1][1][0].career['all-heroes'].eliminations, 20);

  // Each reset is judged against the previous *unfiltered* sample: R-3 resets
  // on day 1 (x is a leftover, dropped) and again on day 2, where x is still
  // identical to its day-1 value. Judged against the filtered day 1 (where x
  // is absent) it would look new and survive.
  const twice = [
    [dayAt(0), [sample('R-3', 0, { 'all-heroes': hero(100, 10_000), x: hero(10, 1000), y: hero(20, 2000) })]],
    [dayAt(1), [sample('R-3', 1, { 'all-heroes': hero(4, 900), x: hero(10, 1000), y: hero(2, 300) })]],
    [dayAt(2), [sample('R-3', 2, { 'all-heroes': hero(1, 200), x: hero(10, 1000), y: hero(1, 100) })]],
  ];
  assert.deepEqual(dropLaggingHeroRows(twice).map((r) => [r.day, r.dropped]), [[dayAt(1), ['x']], [dayAt(2), ['x']]]);
  assert.deepEqual(Object.keys(twice[2][1][0].career), ['all-heroes', 'y']);

  // A private profile (career null) in between neither throws nor resets the comparison.
  const gap = [
    [dayAt(0), [sample('S-4', 0, { 'all-heroes': hero(100, 10_000), x: hero(10, 1000) })]],
    [dayAt(1), [sample('S-4', 1, null)]],
    [dayAt(2), [sample('S-4', 2, { 'all-heroes': hero(2, 100), x: hero(10, 1000) })]],
  ];
  assert.deepEqual(dropLaggingHeroRows(gap).map((r) => [r.day, r.dropped]), [[dayAt(2), ['x']]]);
});

// --- DB path --------------------------------------------------------------------

test('B5: DB mode walks ow_stats_daily in 14-day windows and pivots rows into the right seasons', async () => {
  const scenario = dbScenario();
  const { dir, client, result, lines } = await runDb(scenario);

  // Window chunking: min(day), then rank + career per window, then the two
  // "latest" lookups (raw + daily each) for profiles and for the cross-check.
  assert.ok(client.connected && client.ended, 'connects and always ends the client');
  assert.match(client.calls[0].sql, /SELECT min\(day\)/);
  const rankCalls = client.calls.filter((c) => c.sql.includes("'competitive_rank'") && !/DISTINCT ON/.test(c.sql));
  const careerCalls = client.calls.filter((c) => c.sql.includes("'career_stats_combat'"));
  assert.equal(rankCalls.length, 3);
  assert.equal(careerCalls.length, 3);
  const iso = (i) => new Date(dayAt(i)).toISOString();
  assert.deepEqual(rankCalls.map((c) => c.params.slice(2)), [[iso(0), iso(14)], [iso(14), iso(28)], [iso(28), iso(42)]]);
  assert.deepEqual(careerCalls.map((c) => c.params.slice(4)), [[iso(0), iso(14)], [iso(14), iso(28)], [iso(28), iso(42)]]);
  for (const c of rankCalls) assert.equal(Date.parse(c.params[3]) - Date.parse(c.params[2]), 14 * DAY);
  assert.deepEqual(rankCalls[0].params[0], ['Alpha-1', 'Beta-2'], 'queries are limited to the roster');
  assert.deepEqual(rankCalls[0].params[1], ['tier', 'division', 'season']);
  assert.deepEqual(careerCalls[0].params.slice(0, 3), [['Alpha-1', 'Beta-2'], 'competitive', 'pc']);
  assert.deepEqual(careerCalls[0].params[3], [
    'eliminations', 'deaths', 'assists', 'healing_done', 'healing_done_avg_per_10_min',
    'games_won', 'games_played', 'win_percentage', 'time_played',
  ]);
  assert.equal(client.calls.length, 1 + 6 + 4);
  assert.ok(lines.some((l) => l.includes('3 window(s) of 14 days')));

  // Differential check: ingesting the Samples directly gives exactly the same
  // store, so the windows lost, duplicated and mangled nothing (day 14 and day
  // 28 sit on window boundaries, day 5 is missing for Beta, and the decoy rows
  // for another player, gamemode, platform and metric stayed out).
  const byDay = new Map();
  for (const s of scenario.samples) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  const direct = emptyStore();
  replayDays(direct, [...byDay].sort(([a], [b]) => a - b), {});
  for (const season of [24, 25]) {
    for (const name of DATASETS) {
      assert.deepEqual(seasonRows(result.store, season, name), seasonRows(direct, season, name), `season ${season} ${name}`);
    }
  }
  assert.deepEqual(globalRows(result.store, 'rankCurrent'), globalRows(direct, 'rankCurrent'));
  assert.deepEqual(result.store.state.players, direct.state.players);
  assert.equal(result.store.state.currentSeason, 25);
  assert.equal(result.store.state.currentSeasonDetectedAt, stamp(20));
  assert.equal(seasonRows(result.store, 24, 'rankDaily').filter((r) => r.player === 'Beta-2').length, 20 - 1, 'day 5 missing');
  assert.ok(!result.store.state.players['Ghost-9']);
  // The stale reset-day Zarya row (last season's totals) was dropped, so she
  // lives in season 24 only, with her last real row from day 19. (The
  // differential check above already proves nothing else differs.)
  assert.deepEqual(result.lagging, [{ day: dayAt(20), player: 'Alpha-1', dropped: ['zarya'], kept: 2 }]);
  assert.deepEqual(seasonRows(result.store, 25, 'careerHeroDaily').filter((r) => r.hero === 'zarya'), []);
  assert.deepEqual(seasonRows(result.store, 25, 'careerLatest').filter((r) => r.hero === 'zarya'), []);
  assert.equal(seasonRows(result.store, 24, 'careerLatest').find((r) => r.hero === 'zarya').time, stamp(19));
  assert.ok(lines.some((l) => l.includes('2026-09-21  Alpha-1: dropped 1, kept 2')));

  // The timeline the scenario was built to produce.
  assert.deepEqual(result.events, [
    { day: '2026-09-01', player: null, from: null, to: 24, reason: 'global' },
    { day: '2026-09-21', player: null, from: 24, to: 25, reason: 'global' },
    { day: '2026-09-21', player: 'Alpha-1', from: 24, to: 25, reason: 'rank-season' },
    { day: '2026-09-24', player: 'Beta-2', from: 24, to: 25, reason: 'counter-reset' },
  ]);
  assert.deepEqual(result.finalSeasons, { 'Alpha-1': 25, 'Beta-2': 25 });
  // Beta's lagging season-24 rank rows are change-only once 24 stopped being current.
  assert.equal(seasonRows(result.store, 25, 'rankDaily').filter((r) => r.player === 'Beta-2').length, 0);

  // The pivot reached the files with every field in place.
  const alphaLatest = seasonRows(result.store, 25, 'careerLatest').filter((r) => r.player === 'Alpha-1');
  assert.deepEqual(alphaLatest.map((r) => r.hero), ['all-heroes', 'ana', 'mercy']);
  assert.deepEqual(alphaLatest.find((r) => r.hero === 'ana'), {
    player: 'Alpha-1', hero: 'ana', time: stamp(31), eliminations: 20 + 15 * 11 - 100, deaths: 15 + 8 * 11, assists: 9 + 3 * 11,
    healingDone: 900 + 310, healingPer10Min: 55.5, gamesWon: 11, gamesPlayed: 13, winPercentage: 61, timePlayed: 600 + 50 * 11,
  });
  assert.equal(alphaLatest.find((r) => r.hero === 'mercy').healingDone, null, 'absent stats stay null');
  assert.equal(alphaLatest.find((r) => r.hero === 'all-heroes').timePlayed, 600 + 50 * 11, 'all-heroes timePlayed comes from the DB row');

  // meta and profiles.
  const { meta } = result;
  assert.equal(meta.currentSeason, 25);
  assert.equal(meta.seasonStart, dayAt(20));
  assert.deepEqual(meta.seasons, [
    { season: 24, firstDay: dayAt(0), lastDay: dayAt(19) },
    { season: 25, firstDay: dayAt(20), lastDay: dayAt(31) },
  ]);
  assert.deepEqual(meta.players, ['Alpha-1', 'Beta-2']);
  assert.deepEqual(meta.lastPoll, { at: NOW, source: 'backfill', ok: ['Alpha-1', 'Beta-2'], failed: [] });
  assert.deepEqual(meta.playerSeason, { 'Alpha-1': 25, 'Beta-2': 25 });
  assert.deepEqual(globalRows(result.store, 'profiles'), [
    {
      player: 'Alpha-1', time: Date.parse('2026-10-03T05:00:00Z'), username: 'Alpha', avatar: 'a.png', namecard: null,
      title: 'Gold', endorsementLevel: 3, endorsementFrame: 'f.svg', lastUpdatedAt: null,
    },
    {
      player: 'Beta-2', time: Date.parse('2026-09-18T00:00:00Z'), username: 'Beta', avatar: 'b.png', namecard: null,
      title: null, endorsementLevel: 1, endorsementFrame: null, lastUpdatedAt: null,
    },
  ]);

  // Cross-check passes, and the written tree validates and reloads.
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(lines.some((l) => l.includes('all-heroes gamesPlayed matches')));
  const check = validateDataDir(dir, { now: NOW });
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.warnings, []);
  assert.equal(loadStore(dir).state.currentSeason, 25);
});

test('B6: DB mode warns when the replayed gamesPlayed differs from the DB latest', async () => {
  const scenario = dbScenario();
  scenario.gamesDaily = [{ ...scenario.gamesDaily[0], value: 10 }]; // replayed Beta-2 is 9
  const { result, lines } = await runDb(scenario);
  assert.deepEqual(result.mismatches, [{ player: 'Beta-2', replayed: 9, db: 10 }]);
  assert.ok(lines.some((l) => l.startsWith('::warning::cross-check: Beta-2') && l.includes('replayed 9') && l.includes('latest is 10')));
  assert.ok(lines.some((l) => l.includes('1 mismatch')));
});

test('B7: DB mode needs --initial-season when the first day has no rank season', async () => {
  const scenario = dbScenario();
  scenario.rank = scenario.rank.filter((r) => r.metric !== 'season');
  await assert.rejects(runDb(scenario), /rerun with --initial-season N/);

  // Forced to 23 on day 1; with no rank seasons only the counters move players.
  // Alpha's reset on day 20 comes 20 days after season 23 began, under the
  // 21-day minimum, so it is skipped as a glitch (with a warning) and takes
  // effect on day 21.
  const { result } = await runDb(scenario, { extra: ['--initial-season', '23'] });
  assert.deepEqual(result.events, [
    { day: '2026-09-01', player: null, from: null, to: 23, reason: 'global' },
    { day: '2026-09-22', player: null, from: 23, to: 24, reason: 'global' },
    { day: '2026-09-22', player: 'Alpha-1', from: 23, to: 24, reason: 'counter-reset' },
    { day: '2026-09-24', player: 'Beta-2', from: 23, to: 24, reason: 'counter-reset' },
  ]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^2026-09-21: Alpha-1: counters reset but season 23 started only 20\.0 days ago/);
  assert.equal(result.meta.currentSeason, 24);
  assert.deepEqual(result.finalSeasons, { 'Alpha-1': 24, 'Beta-2': 24 });
});

test('B8: an empty ow_stats_daily is an error and the client is still closed', async () => {
  const client = fakePg({});
  client.query = async () => ({ rows: [{ min_day: null }] });
  const roster = writeRoster(tmpDir(), ['Alpha | Alpha#1']);
  await assert.rejects(
    runBackfill(['--data-dir', tmpDir(), '--roster', roster], { pgClientFactory: () => client, now: NOW, log: () => {} }),
    /ow_stats_daily is empty/,
  );
  assert.equal(client.ended, true);
});

// --- --force ---------------------------------------------------------------------

// A two-day legacy snapshot dir for one player, with or without rank seasons.
function writeTinyLegacy(dir, { rankSeason = 24 } = {}) {
  mkdirSync(dir, { recursive: true });
  const days = [D0, D0 + DAY];
  const file = (name, rows) => writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ generatedAt: 1, rows })}\n`);
  file('rank-daily', days.map((day) => ({ player: 'Alpha-1', role: 'tank', day, tier: 2, division: 'gold', season: rankSeason })));
  file('career-daily', days.map((day, i) => ({ player: 'Alpha-1', day, eliminations: 10 + i, deaths: 5, assists: 3, gamesWon: 1, gamesPlayed: 2 + i })));
  file('career-hero-daily', days.map((day, i) => ({ player: 'Alpha-1', hero: 'ana', day, eliminations: 10 + i, deaths: 5, assists: 3, gamesPlayed: 2 + i, timePlayed: 600 + 60 * i })));
  file('profiles', [{ player: 'Alpha-1', time: D0, username: 'Alpha', avatar: null, namecard: null, title: null, endorsementLevel: 2, endorsementFrame: null }]);
}

async function runTiny(dataDir, snapshotsDir, extra = []) {
  const roster = writeRoster(tmpDir(), ['Alpha | Alpha#1']);
  const out = capture();
  const result = await runBackfill(
    ['--data-dir', dataDir, '--roster', roster, '--from-snapshots', snapshotsDir, ...extra],
    { now: NOW, log: out.log, pgClientFactory: () => { throw new Error('the snapshots source must not open a DB connection'); } },
  );
  return { result, ...out };
}

test('B9: existing seasons/ or pipeline/state.json is refused without --force and left untouched', async () => {
  const legacy = tmpDir();
  writeTinyLegacy(legacy);
  for (const [rel, text] of [['seasons/99/rank-daily.json', '{"junk":true}\n'], ['pipeline/state.json', '{"version":1}\n']]) {
    const dataDir = tmpDir();
    mkdirSync(join(dataDir, rel, '..'), { recursive: true });
    writeFileSync(join(dataDir, rel), text);
    const before = readTree(dataDir);
    await assert.rejects(runTiny(dataDir, legacy), /already exist.*--force/s, rel);
    assert.deepEqual(readTree(dataDir), before, `${rel}: nothing written`);
  }

  // DB mode refuses before it even connects.
  const dataDir = tmpDir();
  mkdirSync(join(dataDir, 'seasons'));
  let opened = false;
  await assert.rejects(
    runBackfill(['--data-dir', dataDir, '--roster', writeRoster(tmpDir(), ['Alpha | Alpha#1'])], {
      pgClientFactory: () => { opened = true; return fakePg({}); }, log: () => {},
    }),
    /--force/,
  );
  assert.equal(opened, false);
});

test('B10: --force deletes exactly seasons/ and pipeline/state.json, then rewrites them', async () => {
  const legacy = tmpDir();
  writeTinyLegacy(legacy);
  const dataDir = tmpDir();
  mkdirSync(join(dataDir, 'seasons', '99'), { recursive: true });
  writeFileSync(join(dataDir, 'seasons', '99', 'rank-daily.json'), '{"junk":true}\n');
  mkdirSync(join(dataDir, 'pipeline'));
  writeFileSync(join(dataDir, 'pipeline', 'state.json'), '{"version":1,"stale":true}\n');
  writeFileSync(join(dataDir, 'pipeline', 'notes.txt'), 'keep me\n');
  writeFileSync(join(dataDir, 'roster.json'), '[]\n');
  mkdirSync(join(dataDir, 'snapshots'));
  writeFileSync(join(dataDir, 'snapshots', 'rank-daily.json'), '{"generatedAt":1,"rows":[]}\n');

  const { result } = await runTiny(dataDir, legacy, ['--force']);
  assert.ok(!existsSync(join(dataDir, 'seasons', '99')), 'old season dir is gone');
  assert.deepEqual(readdirSync(join(dataDir, 'seasons')), ['24']);
  const state = JSON.parse(readFileSync(join(dataDir, 'pipeline', 'state.json'), 'utf8'));
  assert.equal(state.currentSeason, 24);
  assert.ok(!('stale' in state));
  assert.equal(readFileSync(join(dataDir, 'pipeline', 'notes.txt'), 'utf8'), 'keep me\n');
  assert.equal(readFileSync(join(dataDir, 'roster.json'), 'utf8'), '[]\n');
  assert.equal(readFileSync(join(dataDir, 'snapshots', 'rank-daily.json'), 'utf8'), '{"generatedAt":1,"rows":[]}\n', 'legacy flat files stay');
  assert.deepEqual(result.finalSeasons, { 'Alpha-1': 24 });
  assert.deepEqual(validateDataDir(dataDir, { now: NOW }).errors, []);
});

test('B11: --initial-season is only used when the first day has no rank season', async () => {
  // No rank season anywhere: the first day can't be resolved without it.
  const bare = tmpDir();
  writeTinyLegacy(bare, { rankSeason: null });
  await assert.rejects(runTiny(tmpDir(), bare), /rerun with --initial-season N/);
  const { result } = await runTiny(tmpDir(), bare, ['--initial-season', '7']);
  assert.deepEqual(result.finalSeasons, { 'Alpha-1': 7 });
  assert.equal(result.meta.currentSeason, 7);
  assert.deepEqual(result.warnings, []);

  // A real rank season wins; forcing another one on top would mislabel the data.
  const ranked = tmpDir();
  writeTinyLegacy(ranked);
  const second = await runTiny(tmpDir(), ranked, ['--initial-season', '99']);
  assert.equal(second.result.meta.currentSeason, 24);
  assert.ok(second.result.warnings.some((w) => w.includes('--initial-season 99 ignored')));
  assert.ok(second.lines.some((l) => l.startsWith('::warning::--initial-season 99 ignored')));
});

// --- --from-snapshots over the committed legacy files ----------------------------------

const haveLegacy = ['rank-daily', 'career-daily', 'career-hero-daily']
  .every((name) => existsSync(join(LEGACY_SNAPSHOTS_DIR, `${name}.json`)));

// The legacy files keep growing until cutover, so pin the replay to the window
// the PRD table was checked against (data through 2026-10-24), as replay.test.mjs does.
const LAST_DAY = at('2026-10-24T00:00:00Z');

// Copies the legacy files into <dataDir>/snapshots, dropping daily rows after LAST_DAY.
function stageLegacy(dataDir) {
  const dir = join(dataDir, 'snapshots');
  mkdirSync(dir, { recursive: true });
  for (const name of ['rank-daily', 'career-daily', 'career-hero-daily']) {
    const { generatedAt, rows } = JSON.parse(readFileSync(join(LEGACY_SNAPSHOTS_DIR, `${name}.json`), 'utf8'));
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ generatedAt, rows: rows.filter((r) => r.day <= LAST_DAY) })}\n`);
  }
  for (const name of ['career-latest', 'profiles', 'rank-current', 'meta']) {
    if (existsSync(join(LEGACY_SNAPSHOTS_DIR, `${name}.json`))) copyFileSync(join(LEGACY_SNAPSHOTS_DIR, `${name}.json`), join(dir, `${name}.json`));
  }
  return dir;
}

// The first / last careerHeroDaily row of every (player, hero) series in a season.
function edgeRows(store, season, pick) {
  const out = new Map();
  for (const row of seasonRows(store, season, 'careerHeroDaily')) {
    const key = `${row.player}|${row.hero}`;
    const have = out.get(key);
    if (!have || pick(row.day, have.day)) out.set(key, row);
  }
  return out;
}
const firstRows = (store, season) => edgeRows(store, season, (a, b) => a < b);
const lastRows = (store, season) => edgeRows(store, season, (a, b) => a > b);

test('B12: --from-snapshots reproduces the PRD season timeline from the legacy files', { skip: haveLegacy ? false : 'docs/data/snapshots not present' }, async () => {
  // --from-snapshots points at <data-dir>/snapshots itself: everything must be
  // read before meta/rank-current/profiles are overwritten.
  const dataDir = tmpDir();
  const snapshots = stageLegacy(dataDir);
  const flat = ['rank-daily', 'career-daily', 'career-hero-daily', 'career-latest'];
  const flatBefore = flat.map((n) => readFileSync(join(snapshots, `${n}.json`), 'utf8'));
  const legacyProfiles = JSON.parse(readFileSync(join(snapshots, 'profiles.json'), 'utf8')).rows;
  const legacyLatest = JSON.parse(readFileSync(join(snapshots, 'career-latest.json'), 'utf8')).rows;

  const out = capture();
  const now = LAST_DAY + 14 * HOUR;
  const result = await runBackfill(['--data-dir', dataDir, '--from-snapshots', snapshots], {
    now, log: out.log, pgClientFactory: () => { throw new Error('no DB in snapshots mode'); },
  });

  // Global 23 -> 24 on 2026-08-12 -> 25 on 2026-10-08, and each player's moves.
  const changes = (player) => result.events.filter((e) => e.player === player).map((e) => [e.day, e.from, e.to, e.reason]);
  assert.deepEqual(result.events.filter((e) => e.player === null).map((e) => [e.day, e.from, e.to]), [
    ['2026-06-27', null, 23], ['2026-08-12', 23, 24], ['2026-10-08', 24, 25],
  ]);
  assert.deepEqual(changes('DarthKcaj-1443'), [['2026-08-12', 23, 24, 'counter-reset'], ['2026-10-08', 24, 25, 'rank-season']]);
  assert.deepEqual(changes('Kieness-6123'), [['2026-08-17', 23, 24, 'counter-reset']]);
  assert.deepEqual(changes('Tones-11680'), [['2026-08-21', 23, 24, 'counter-reset']]);
  assert.deepEqual(changes('KiwiCore-1324'), [['2026-08-28', 23, 24, 'counter-reset']]);
  for (const stay of ['Shotdownboyz-1119', 'Kiddo-11482', 'Lank-21912']) assert.deepEqual(changes(stay), [], stay);
  assert.deepEqual(result.finalSeasons, {
    'DarthKcaj-1443': 25, 'Kieness-6123': 24, 'Tones-11680': 24, 'KiwiCore-1324': 24,
    'Shotdownboyz-1119': 23, 'Kiddo-11482': 22, 'Lank-21912': 23,
  });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.mismatches, []);

  // The season index.
  const { meta } = result;
  assert.equal(meta.layoutVersion, 2);
  assert.equal(meta.currentSeason, 25);
  assert.equal(meta.seasonStart, at('2026-10-08T00:00:00Z'));
  assert.deepEqual(meta.seasons.map((s) => s.season), [22, 23, 24, 25]);
  assert.equal(meta.seasons.find((s) => s.season === 24).firstDay, at('2026-08-12T00:00:00Z'));
  assert.equal(meta.seasons.find((s) => s.season === 25).lastDay, LAST_DAY);
  assert.deepEqual(meta.players, ['Kieness-6123', 'DarthKcaj-1443', 'KiwiCore-1324', 'Shotdownboyz-1119', 'Tones-11680', 'Lank-21912', 'Kiddo-11482']);
  assert.deepEqual(meta.lastPoll, { at: now, source: 'backfill', ok: meta.players, failed: [] });
  assert.deepEqual(result.seasons.map((s) => s.season), [22, 23, 24, 25]);
  assert.ok(result.seasons.every((s) => s.players >= 1 && s.rows.careerLatest > 0));

  // The report.
  const text = out.lines.join('\n');
  assert.match(text, /Season summary/);
  assert.match(text, /season {2}firstDay {4}lastDay {5}players {2}rank-daily {2}career-daily {2}career-hero-daily {2}career-latest/);
  assert.match(text, /2026-08-12 {2}DarthKcaj-1443 season 23 -> 24 \(counter-reset\)/);
  assert.match(text, /Final player seasons \(current season 25, since 2026-10-08\)/);

  // Files: every season dir, the global files, state and meta; all valid.
  const tree = readTree(dataDir);
  for (const season of [22, 23, 24, 25]) {
    for (const f of ['rank-daily', 'career-daily', 'career-hero-daily', 'career-latest']) {
      assert.ok(tree.has(`seasons/${season}/${f}.json`), `seasons/${season}/${f}.json`);
    }
  }
  for (const rel of ['pipeline/state.json', 'snapshots/meta.json', 'snapshots/rank-current.json', 'snapshots/profiles.json']) assert.ok(tree.has(rel), rel);
  const check = validateDataDir(dataDir, { now });
  assert.deepEqual(check.errors, []);
  // Without the reset-day cleanup the daily table's lagging per-hero rows made
  // 69 (season 24) and 106 (season 25) counters fall. Two remain, both in
  // season 24: reset-day rows (DarthKcaj domina, orisa) that mix one stale
  // metric into an otherwise new-season row.
  const falls = check.warnings.filter((w) => /counter values fall/.test(w));
  assert.deepEqual(check.warnings.filter((w) => !/counter values fall/.test(w)), []);
  assert.ok(falls.every((w) => w.startsWith('seasons/24/career-hero-daily.json')), falls.join('\n'));
  assert.ok(falls.reduce((n, w) => n + Number(/: (\d+) counter values fall/.exec(w)[1]), 0) <= 2, falls.join('\n'));

  // Legacy flat files are untouched; profiles survived the overwrite; rank-current comes from the replay.
  assert.deepEqual(flat.map((n) => readFileSync(join(snapshots, `${n}.json`), 'utf8')), flatBefore);
  const profiles = globalRows(loadStore(dataDir), 'profiles');
  assert.deepEqual(profiles.map((p) => p.player), legacyProfiles.map((p) => p.player).sort());
  for (const p of legacyProfiles) assert.deepEqual(profiles.find((x) => x.player === p.player), { lastUpdatedAt: null, ...p });
  const rankCurrent = globalRows(result.store, 'rankCurrent');
  assert.ok(rankCurrent.length >= 7);
  assert.ok(rankCurrent.every((r) => r.time % DAY === 12 * HOUR && r.time <= LAST_DAY + 12 * HOUR));

  // Healing and win fields (absent from the legacy daily files) came from career-latest.json.
  const darth = legacyLatest.find((r) => r.player === 'DarthKcaj-1443' && r.hero === 'all-heroes');
  const replayed = seasonRows(result.store, 25, 'careerLatest').find((r) => r.player === 'DarthKcaj-1443' && r.hero === 'all-heroes');
  assert.equal(replayed.healingDone, darth.healingDone);
  assert.equal(replayed.healingPer10Min, darth.healingPer10Min);
  assert.notEqual(replayed.healingDone, null);
  // The current season is dense for its players; Darth has a row for every legacy day since 10-08.
  const legacyDays = JSON.parse(flatBefore[1]).rows.filter((r) => r.player === 'DarthKcaj-1443' && r.day >= at('2026-10-08T00:00:00Z')).map((r) => r.day);
  assert.deepEqual(seasonRows(result.store, 25, 'careerDaily').filter((r) => r.player === 'DarthKcaj-1443').map((r) => r.day), legacyDays);

  // No season starts with a verbatim copy of last season's hero rows: the
  // daily table's pre-reset leftovers on a reset day were dropped.
  assert.deepEqual(result.lagging.map((l) => [isoDay(l.day), l.player]), [
    ['2026-08-12', 'DarthKcaj-1443'], ['2026-08-17', 'Kieness-6123'], ['2026-08-21', 'Tones-11680'],
    ['2026-08-28', 'KiwiCore-1324'], ['2026-10-08', 'DarthKcaj-1443'],
  ]);
  for (const season of [24, 25]) {
    for (const [key, first] of firstRows(result.store, season)) {
      const earlier = [22, 23, 24].filter((s) => s < season)
        .map((s) => lastRows(result.store, s).get(key)).filter(Boolean).pop();
      if (!earlier || first.timePlayed === null) continue;
      assert.ok(
        first.gamesPlayed !== earlier.gamesPlayed || first.timePlayed !== earlier.timePlayed,
        `season ${season} ${key} starts with last season's final row (${isoDay(first.day)})`,
      );
    }
  }
  const darthHeroes = seasonRows(result.store, 25, 'careerLatest').filter((r) => r.player === 'DarthKcaj-1443').map((r) => r.hero);
  assert.ok(!darthHeroes.includes('baptiste') && !darthHeroes.includes('hazard'), 'stale 10-08 rows left out of season 25');
  const darthPlayed = new Set(seasonRows(result.store, 25, 'careerHeroDaily').filter((r) => r.player === 'DarthKcaj-1443').map((r) => r.hero));
  assert.deepEqual(darthHeroes.filter((h) => h !== 'all-heroes' && !darthPlayed.has(h)), [], 'every season-25 hero has a daily row');
  // They are still there, with their real totals, in season 24.
  const s24 = seasonRows(result.store, 24, 'careerLatest').filter((r) => r.player === 'DarthKcaj-1443').map((r) => r.hero);
  assert.ok(s24.includes('baptiste'));

  // A rerun needs --force, and with it rebuilds the identical tree (the legacy
  // profiles it now reads back are the ones it wrote).
  await assert.rejects(runBackfill(['--data-dir', dataDir, '--from-snapshots', snapshots], { now, log: () => {} }), /--force/);
  const first = readTree(dataDir);
  await runBackfill(['--data-dir', dataDir, '--from-snapshots', snapshots, '--force'], { now, log: () => {} });
  assert.deepEqual(readTree(dataDir), first);
});

test('B13: --from-snapshots matches replaying the cleaned legacySamplesByDay directly, and the cleanup matters', { skip: haveLegacy ? false : 'docs/data/snapshots not present' }, async () => {
  const dataDir = tmpDir();
  const snapshots = stageLegacy(dataDir);
  const result = await runBackfill(['--data-dir', dataDir, '--from-snapshots', snapshots], { now: LAST_DAY + 14 * HOUR, log: () => {} });

  const legacy = {
    rankDaily: JSON.parse(readFileSync(join(snapshots, 'rank-daily.json'), 'utf8')).rows,
    careerDaily: JSON.parse(readFileSync(join(snapshots, 'career-daily.json'), 'utf8')).rows,
    careerHeroDaily: JSON.parse(readFileSync(join(snapshots, 'career-hero-daily.json'), 'utf8')).rows,
  };
  const direct = emptyStore();
  const cleaned = legacySamplesByDay(legacy);
  dropLaggingHeroRows(cleaned, { recomputeAllHeroesTime: true });
  replayDays(direct, cleaned, {});
  for (const season of [22, 23, 24, 25]) {
    for (const name of ['rankDaily', 'careerDaily', 'careerHeroDaily']) {
      assert.deepEqual(seasonRows(result.store, season, name), seasonRows(direct, season, name), `season ${season} ${name}`);
    }
  }
  assert.deepEqual(result.store.state.players, direct.state.players);

  // Replaying the raw samples instead keeps the same seasons and the same
  // rank/all-heroes rows, but files last season's leftovers under the new one.
  const raw = emptyStore();
  replayDays(raw, legacySamplesByDay(legacy), {});
  assert.deepEqual(raw.state.players, direct.state.players);
  for (const season of [24, 25]) {
    for (const name of ['rankDaily', 'careerDaily']) {
      assert.deepEqual(seasonRows(raw, season, name), seasonRows(direct, season, name), `season ${season} ${name}`);
    }
    assert.ok(
      seasonRows(raw, season, 'careerHeroDaily').length > seasonRows(direct, season, 'careerHeroDaily').length,
      `season ${season}: the raw replay has leftover hero rows`,
    );
  }
});
