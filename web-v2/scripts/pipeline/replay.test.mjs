// Test RP: replay the committed legacy snapshots (docs/data/snapshots, baked
// from the TimescaleDB daily table) through ingestPoll, day by day, and check
// the season timeline against what actually happened (see the PRD table).
// Skips when the legacy files are gone (after the WP5 cleanup deletes them).

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SEASON_DATASETS } from './constants.mjs';
import { buildMeta } from './meta.mjs';
import { legacySamplesByDay, loadLegacySnapshots, replayDays } from './replay.mjs';
import { emptyStore, loadStore, saveStore, seasonRows } from './store.mjs';
import { validateDataDir } from './validate.mjs';
import { LEGACY_SNAPSHOTS_DIR, at, tmpDir } from './__fixtures__/helpers.mjs';
import { isoDay } from './util.mjs';

const haveLegacy = existsSync(join(LEGACY_SNAPSHOTS_DIR, 'rank-daily.json'))
  && existsSync(join(LEGACY_SNAPSHOTS_DIR, 'career-daily.json'))
  && existsSync(join(LEGACY_SNAPSHOTS_DIR, 'career-hero-daily.json'));

// The legacy files keep growing until cutover, so pin the replay to the
// window the PRD table was checked against (data through 2026-10-24).
const LAST_DAY = at('2026-10-24T00:00:00Z');

// The PRD's expected timeline. Each entry is [date the player entered the
// season, season, reason]. The first entry's date is the player's first day in
// the data (the 120-day window slides), so only its season is asserted.
const EXPECTED = {
  'DarthKcaj-1443': [[null, 23, 'new-player'], ['2026-08-12', 24, 'counter-reset'], ['2026-10-08', 25, 'rank-season']],
  'Kieness-6123': [[null, 23, 'new-player'], ['2026-08-17', 24, 'counter-reset']],
  'Tones-11680': [[null, 23, 'new-player'], ['2026-08-21', 24, 'counter-reset']],
  'KiwiCore-1324': [[null, 23, 'new-player'], ['2026-08-28', 24, 'counter-reset']],
  'Shotdownboyz-1119': [[null, 23, 'new-player']],
  'Kiddo-11482': [[null, 22, 'new-player']],
  'Lank-21912': [[null, 23, 'new-player']],
};

test('RP: replaying the legacy snapshots reproduces the real season timeline', { skip: haveLegacy ? false : 'docs/data/snapshots not present' }, () => {
  const legacy = loadLegacySnapshots(LEGACY_SNAPSHOTS_DIR);
  const byDay = legacySamplesByDay(legacy).filter(([day]) => day <= LAST_DAY);
  assert.ok(byDay.length > 100, `expected ~106 days of history, got ${byDay.length}`);
  // Ascending, one sample per player per day, noon UTC, no profile.
  assert.deepEqual(byDay.map(([d]) => d), [...byDay.map(([d]) => d)].sort((a, b) => a - b));
  for (const [day, samples] of byDay) {
    assert.equal(new Set(samples.map((s) => s.player)).size, samples.length);
    for (const s of samples) {
      assert.equal(s.fetchedAt, day + 12 * 3_600_000);
      assert.equal(s.day, day);
      assert.equal(s.profile, null);
    }
  }

  // Replay, recording every season change per player and for the global season.
  const store = emptyStore();
  const timeline = {};
  const global = [];
  const warnings = [];
  replayDays(store, byDay, {}, (day, result) => {
    if (global.at(-1)?.season !== result.currentSeason) global.push({ day: isoDay(day), season: result.currentSeason });
    warnings.push(...result.warnings);
    for (const a of result.assignments) {
      const list = (timeline[a.player] ??= []);
      if (list.at(-1)?.season !== a.season) list.push({ day: isoDay(day), season: a.season, reason: a.reason });
    }
  });

  assert.deepEqual(global.map((g) => g.season), [23, 24, 25]);
  assert.deepEqual(global.slice(1).map((g) => g.day), ['2026-08-12', '2026-10-08']);
  assert.deepEqual(Object.keys(timeline).sort(), Object.keys(EXPECTED).sort());
  for (const [player, expected] of Object.entries(EXPECTED)) {
    const actual = timeline[player].map((t, i) => [i === 0 ? null : t.day, t.season, t.reason]);
    assert.deepEqual(actual, expected, player);
  }
  assert.deepEqual(warnings, [], 'one sample per player per day: nothing to merge or block');

  // Where everyone ended up, and the season index.
  assert.equal(store.state.currentSeason, 25);
  assert.equal(store.state.currentSeasonDetectedAt, at('2026-10-08T12:00:00Z'));
  assert.deepEqual(
    Object.fromEntries(Object.entries(store.state.players).map(([p, s]) => [p, s.season])),
    {
      'DarthKcaj-1443': 25, 'Kieness-6123': 24, 'Tones-11680': 24, 'KiwiCore-1324': 24,
      'Shotdownboyz-1119': 23, 'Kiddo-11482': 22, 'Lank-21912': 23,
    },
  );

  // Compaction: the current season is dense for the players in it...
  const darthS25 = seasonRows(store, 25, 'careerDaily').filter((r) => r.player === 'DarthKcaj-1443');
  const legacyDarthS25 = legacy.careerDaily.filter((r) => r.player === 'DarthKcaj-1443' && r.day >= at('2026-10-08T00:00:00Z') && r.day <= LAST_DAY);
  assert.equal(darthS25.length, legacyDarthS25.length);
  assert.deepEqual(darthS25.map((r) => r.day), legacyDarthS25.map((r) => r.day));
  assert.deepEqual(darthS25.map((r) => r.gamesPlayed), legacyDarthS25.map((r) => r.gamesPlayed));
  // ...and once a season stops being current, a series only gains rows when it changes.
  const stopped = { 22: at('2026-06-27T00:00:00Z'), 23: at('2026-08-12T00:00:00Z'), 24: at('2026-10-08T00:00:00Z') };
  for (const [season, since] of Object.entries(stopped)) {
    for (const [name, spec] of Object.entries(SEASON_DATASETS)) {
      if (spec.kind !== 'daily') continue;
      const lastBySeries = new Map();
      for (const row of seasonRows(store, Number(season), name)) {
        const key = spec.series.map((f) => row[f]).join('|');
        const prev = lastBySeries.get(key);
        if (prev && row.day >= since) {
          const same = Object.keys(row).every((k) => k === 'day' || row[k] === prev[k]);
          assert.ok(!same, `S${season} ${name} ${key}: flat-lined row on ${isoDay(row.day)}`);
        }
        lastBySeries.set(key, row);
      }
    }
  }
  assert.equal(seasonRows(store, 22, 'careerDaily').filter((r) => r.player === 'Kiddo-11482').length, 1, 'inactive Kiddo has one row');

  // The result is a valid data tree that round-trips through the store. (A
  // backfill takes profiles as they are from the legacy file.)
  for (const p of legacy.profiles) store.profiles.set(p.player, { ...p });
  const now = LAST_DAY + 12 * 3_600_000;
  const players = Object.keys(EXPECTED);
  const meta = buildMeta(store, { now, players, lastPoll: { source: 'backfill', ok: players, failed: [] } });
  assert.equal(meta.currentSeason, 25);
  assert.equal(meta.seasonStart, at('2026-10-08T00:00:00Z'));
  assert.deepEqual(meta.seasons.map((s) => s.season), [22, 23, 24, 25]);
  assert.equal(meta.seasons.find((s) => s.season === 24).firstDay, at('2026-08-12T00:00:00Z'));
  assert.equal(meta.seasons.find((s) => s.season === 25).lastDay, LAST_DAY);

  const dir = tmpDir();
  saveStore(store, dir);
  const result = validateDataDir(dir, { now });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.filter((w) => !/counter values fall/.test(w)), []);
  const second = saveStore(loadStore(dir), dir);
  assert.deepEqual(second.written, ['snapshots/meta.json']);
});

test('RP: legacySamplesByDay builds one sample per player-day with a summed all-heroes timePlayed', () => {
  const day = at('2026-08-12T00:00:00Z');
  const samples = legacySamplesByDay({
    rankDaily: [
      { player: 'A-1', role: 'tank', day, tier: 2, division: 'gold', season: 23 },
      { player: 'A-1', role: 'damage', day, tier: 4, division: 'silver', season: 24 },
    ],
    careerDaily: [
      { player: 'A-1', day, eliminations: 10, deaths: 5, assists: 3, gamesWon: 1, gamesPlayed: 2 },
      { player: 'B-2', day, eliminations: 1, deaths: 1, assists: 1, gamesWon: null, gamesPlayed: 1 },
    ],
    careerHeroDaily: [
      { player: 'A-1', hero: 'ana', day, eliminations: 6, deaths: 2, assists: 3, gamesPlayed: 1, timePlayed: 100 },
      { player: 'A-1', hero: 'mei', day, eliminations: 4, deaths: 3, assists: 0, gamesPlayed: 1, timePlayed: 250 },
    ],
  });
  assert.equal(samples.length, 1);
  const [d, list] = samples[0];
  assert.equal(d, day);
  const [a, b] = list;
  assert.equal(a.player, 'A-1');
  assert.equal(b.player, 'B-2');
  assert.equal(a.fetchedAt, day + 12 * 3_600_000);
  assert.equal(a.rankSeason, 24, 'max non-null rank season of the day');
  assert.deepEqual(a.ranks.map((r) => [r.role, r.season]), [['tank', 23], ['damage', 24]]);
  assert.deepEqual(a.career['all-heroes'], {
    eliminations: 10, deaths: 5, assists: 3, healingDone: null, healingPer10Min: null,
    gamesWon: 1, gamesPlayed: 2, winPercentage: null, timePlayed: 350,
  });
  assert.deepEqual(a.career.mei, {
    eliminations: 4, deaths: 3, assists: 0, healingDone: null, healingPer10Min: null,
    gamesWon: null, gamesPlayed: 1, winPercentage: null, timePlayed: 250,
  });
  // No hero rows -> all-heroes timePlayed is null; no rank rows -> no rank season.
  assert.equal(b.career['all-heroes'].timePlayed, null);
  assert.equal(b.rankSeason, null);
  assert.deepEqual(b.ranks, []);
});
