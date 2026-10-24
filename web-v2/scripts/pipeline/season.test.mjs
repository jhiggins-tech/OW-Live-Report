// Tests S1-S11 (+ S12/S13): per-player season assignment in ingestPoll.
// Each scenario seeds a store through ingestPoll itself (rank season -> the
// player's first season), then polls again at a later `now`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEASON_DATASETS } from './constants.mjs';
import { ingestPoll } from './rollup.mjs';
import { countersChanged, isCounterReset } from './season.mjs';
import { emptyStore, seasonRows } from './store.mjs';
import { DAY, HOUR, at, careerOf, makeSample } from './__fixtures__/helpers.mjs';

const T0 = at('2026-09-01T12:00:00Z');
const DARTH = 'DarthKcaj-1443';
const KIENESS = 'Kieness-6123';
const TONES = 'Tones-11680';
const KIDDO = 'Kiddo-11482';

// Players' first sample: { player, season (rank season), career overrides }.
function seed(entries, now = T0) {
  const store = emptyStore();
  const samples = entries.map((e) => makeSample(e.player, now, { rankSeason: e.season, career: e.career, profile: e.profile }));
  ingestPoll(store, samples, { now });
  return store;
}

// All of one player's season-file rows, for before/after comparisons.
function rowsFor(store, player) {
  const out = {};
  for (const season of [...store.seasons.keys()].sort()) {
    for (const name of Object.keys(SEASON_DATASETS)) {
      const rows = seasonRows(store, season, name).filter((r) => r.player === player);
      if (rows.length) out[`${season}/${name}`] = rows;
    }
  }
  return out;
}

const OLD = { gamesPlayed: 307, timePlayed: 200_000, eliminations: 6000, deaths: 4000, assists: 3000 };
const RESET = { gamesPlayed: 8, timePlayed: 6000, eliminations: 150, deaths: 100, assists: 60 };

test('S1: rank season rises -> player and global move to the new season', () => {
  const store = seed([{ player: DARTH, season: 24, career: OLD }]);
  assert.equal(store.state.currentSeason, 24);
  assert.equal(store.state.currentSeasonDetectedAt, T0);

  const now = T0 + 37 * DAY;
  const r = ingestPoll(store, [makeSample(DARTH, now, { rankSeason: 25, career: { ...RESET, gamesPlayed: 4 } })], { now });
  assert.deepEqual(r.assignments, [{ player: DARTH, season: 25, reason: 'rank-season' }]);
  assert.equal(r.currentSeason, 25);
  assert.equal(store.state.currentSeason, 25);
  assert.equal(store.state.currentSeasonDetectedAt, now);
  assert.deepEqual(store.state.players[DARTH], { season: 25, lastFetchedAt: now, lastReason: 'rank-season' });
  // The old season keeps its last row; the new one starts from gp 4.
  assert.deepEqual(seasonRows(store, 24, 'careerDaily').map((x) => x.gamesPlayed), [307]);
  assert.deepEqual(seasonRows(store, 25, 'careerDaily').map((x) => x.gamesPlayed), [4]);
  assert.equal(seasonRows(store, 25, 'rankDaily')[0].season, 25);
});

test('S2: counter reset with a stale rank season -> next season, stale rank row not added to the old one', () => {
  const store = seed([
    { player: DARTH, season: 24 },
    { player: KIENESS, season: 23, career: { gamesPlayed: 191, timePlayed: 90_000, eliminations: 3000 } },
  ]);
  const detectedAt = store.state.currentSeasonDetectedAt;
  const now = T0 + 30 * DAY;
  const r = ingestPoll(store, [makeSample(KIENESS, now, { rankSeason: 23, career: RESET })], { now });
  assert.deepEqual(r.assignments, [{ player: KIENESS, season: 24, reason: 'counter-reset' }]);
  assert.equal(r.currentSeason, 24);
  assert.equal(store.state.currentSeasonDetectedAt, detectedAt, 'global season unchanged');

  // Counters went to S24; S23 still ends at gp 191.
  assert.deepEqual(seasonRows(store, 23, 'careerDaily').filter((x) => x.player === KIENESS).map((x) => x.gamesPlayed), [191]);
  assert.deepEqual(seasonRows(store, 24, 'careerDaily').filter((x) => x.player === KIENESS).map((x) => x.gamesPlayed), [8]);
  // The rank still says S23 and equals the last S23 row, so nothing is added there or in S24.
  assert.equal(seasonRows(store, 23, 'rankDaily').filter((x) => x.player === KIENESS).length, 1);
  assert.equal(seasonRows(store, 24, 'rankDaily').filter((x) => x.player === KIENESS).length, 0);
  // rank-current still follows the sample.
  assert.equal(store.rankCurrent.get(`${KIENESS}|damage`).time, now);
  assert.equal(store.rankCurrent.get(`${KIENESS}|damage`).season, 23);
});

// Shared setup for S3-S5: Tones is a carry-over S23 player when Darth's rank
// season flips the global season to 24 at ROLLOVER.
const TONES_S23 = { gamesPlayed: 34, timePlayed: 20_000, eliminations: 600, deaths: 300, assists: 70 };
const ROLLOVER = T0 + 30 * DAY;
function rolledOver(tonesCareer = TONES_S23) {
  const store = seed([{ player: DARTH, season: 23 }, { player: TONES, season: 23, career: tonesCareer }]);
  ingestPoll(store, [
    makeSample(DARTH, ROLLOVER, { rankSeason: 24, career: RESET }),
    makeSample(TONES, ROLLOVER, { rankSeason: 23, career: tonesCareer }),
  ], { now: ROLLOVER });
  return store;
}

test('S3: carry-over player with unchanged counters inside the grace window stays put and writes nothing', () => {
  const store = seed([{ player: DARTH, season: 23 }, { player: TONES, season: 23, career: TONES_S23 }]);
  const before = rowsFor(store, TONES);
  const r = ingestPoll(store, [
    makeSample(DARTH, ROLLOVER, { rankSeason: 24, career: RESET }),
    makeSample(TONES, ROLLOVER, { rankSeason: 23, career: TONES_S23 }),
  ], { now: ROLLOVER });
  assert.equal(r.currentSeason, 24);
  assert.equal(store.state.currentSeasonDetectedAt, ROLLOVER);
  assert.deepEqual(r.assignments.find((a) => a.player === TONES), { player: TONES, season: 23, reason: 'unchanged' });
  assert.deepEqual(rowsFor(store, TONES), before, 'no career or rank rows written for Tones anywhere');
  assert.equal(store.state.players[TONES].lastFetchedAt, ROLLOVER);
});

test('S4: a late old-season update inside the grace window is filed under the old season', () => {
  const store = rolledOver();
  const now = ROLLOVER + 12 * HOUR; // < 36h after the rollover
  const later = { gamesPlayed: 36, timePlayed: 21_000, eliminations: 640, deaths: 310, assists: 74 };
  const r = ingestPoll(store, [makeSample(TONES, now, { rankSeason: 23, career: later })], { now });
  assert.deepEqual(r.assignments, [{ player: TONES, season: 23, reason: 'unchanged' }]);
  assert.equal(store.state.currentSeason, 24);
  assert.equal(store.state.currentSeasonDetectedAt, ROLLOVER);
  const s23 = seasonRows(store, 23, 'careerDaily').filter((x) => x.player === TONES);
  assert.equal(s23.at(-1).gamesPlayed, 36);
  assert.equal(s23.at(-1).day, Math.floor(now / DAY) * DAY);
  assert.equal(seasonRows(store, 23, 'careerLatest').find((x) => x.player === TONES && x.hero === 'all-heroes').gamesPlayed, 36);
  assert.equal(seasonRows(store, 24, 'careerDaily').filter((x) => x.player === TONES).length, 0);
});

test('S5: a carry-over player whose numbers move after the grace window joins the new season', () => {
  const light = { gamesPlayed: 3, timePlayed: 900, eliminations: 20, deaths: 15, assists: 4 };
  const store = rolledOver(light);
  // Three days after the rollover Tones is still level, so nothing happens...
  const d1 = ROLLOVER + 3 * DAY;
  const same = ingestPoll(store, [makeSample(TONES, d1, { rankSeason: 23, career: light })], { now: d1 });
  assert.deepEqual(same.assignments, [{ player: TONES, season: 23, reason: 'unchanged' }]);
  // ...then gp 3 -> 5: only new-season play can explain it.
  const d2 = d1 + 12 * HOUR;
  const r = ingestPoll(store, [makeSample(TONES, d2, { rankSeason: 23, career: { ...light, gamesPlayed: 5, timePlayed: 1500, eliminations: 30 } })], { now: d2 });
  assert.deepEqual(r.assignments, [{ player: TONES, season: 24, reason: 'post-grace-change' }]);
  assert.equal(store.state.players[TONES].season, 24);
  assert.deepEqual(seasonRows(store, 24, 'careerDaily').filter((x) => x.player === TONES).map((x) => x.gamesPlayed), [5]);
  assert.equal(seasonRows(store, 23, 'careerDaily').filter((x) => x.player === TONES).at(-1).gamesPlayed, 3);
});

test('S6: an inactive player writes no season rows, but rank-current and profiles still update', () => {
  const profile = (title) => ({
    username: 'Kiddo', avatar: 'a', namecard: 'n', title, endorsementLevel: 3, endorsementFrame: 'f', lastUpdatedAt: 1,
  });
  const store = seed([
    { player: DARTH, season: 25 },
    { player: KIDDO, season: 22, career: { gamesPlayed: 31, timePlayed: 18_000, eliminations: 429 }, profile: profile('None') },
  ]);
  const before = rowsFor(store, KIDDO);
  const now = T0 + 5 * DAY;
  const r = ingestPoll(store, [
    makeSample(KIDDO, now, { rankSeason: 22, career: { gamesPlayed: 31, timePlayed: 18_000, eliminations: 429 }, profile: profile('Veteran') }),
  ], { now });
  assert.deepEqual(r.assignments, [{ player: KIDDO, season: 22, reason: 'unchanged' }]);
  assert.deepEqual(rowsFor(store, KIDDO), before);
  assert.equal(store.rankCurrent.get(`${KIDDO}|damage`).time, now);
  assert.equal(store.profiles.get(KIDDO).title, 'Veteran');
  assert.equal(store.profiles.get(KIDDO).time, now);
});

test('S7: a new player with no rank joins the global season', () => {
  const store = seed([{ player: DARTH, season: 25 }]);
  const now = T0 + DAY;
  const r = ingestPoll(store, [makeSample('Lank-21912', now, { rankSeason: null, career: { gamesPlayed: 1 } })], { now });
  assert.deepEqual(r.assignments, [{ player: 'Lank-21912', season: 25, reason: 'new-player' }]);
  assert.equal(seasonRows(store, 25, 'careerDaily').filter((x) => x.player === 'Lank-21912').length, 1);
});

test('S8: a single dropping counter is a glitch, not a season reset', () => {
  const store = seed([{ player: DARTH, season: 25, career: { gamesPlayed: 58, timePlayed: 40_237, eliminations: 924 } }]);
  const now = T0 + 2 * DAY;
  const glitch = makeSample(DARTH, now, { rankSeason: 25, career: { gamesPlayed: 50, timePlayed: 41_000, eliminations: 930 } });
  assert.equal(isCounterReset(store.seasons.get(25).careerLatest.get(`${DARTH}|all-heroes`), glitch.career['all-heroes']), false);
  const r = ingestPoll(store, [glitch], { now });
  assert.deepEqual(r.assignments, [{ player: DARTH, season: 25, reason: 'unchanged' }]);
  assert.equal(r.currentSeason, 25);
  assert.ok(!store.seasons.has(26));

  // The predicate itself.
  const prev = careerOf({ gamesPlayed: 58, timePlayed: 40_237, eliminations: 924 });
  assert.equal(isCounterReset(prev, careerOf({ gamesPlayed: 4, timePlayed: 100, eliminations: 5 })), true);
  assert.equal(isCounterReset(prev, careerOf({ gamesPlayed: 4, timePlayed: 50_000, eliminations: 5 })), true);
  assert.equal(isCounterReset(prev, careerOf({ gamesPlayed: 4, timePlayed: 50_000, eliminations: 5000 })), false);
  assert.equal(isCounterReset(prev, careerOf({ gamesPlayed: 60, timePlayed: 100, eliminations: 5 })), false);
  assert.equal(isCounterReset(prev, careerOf({ gamesPlayed: null, timePlayed: 100, eliminations: 5 })), false);
  assert.equal(isCounterReset(null, prev), false);
  assert.equal(isCounterReset(prev, null), false);
});

test('S9: a reset that would start a new season within 21 days is blocked with a warning', () => {
  const prevCareer = { gamesPlayed: 58, timePlayed: 40_237, eliminations: 924 };
  const store = seed([{ player: DARTH, season: 25, career: prevCareer }]);
  const before = rowsFor(store, DARTH);
  const now = T0 + 5 * DAY;
  const r = ingestPoll(store, [makeSample(DARTH, now, { rankSeason: 25, career: RESET })], { now });
  assert.deepEqual(r.assignments, [{ player: DARTH, season: 25, reason: 'reset-too-soon' }]);
  assert.equal(r.currentSeason, 25);
  assert.equal(store.state.currentSeasonDetectedAt, T0);
  assert.ok(!store.seasons.has(26));
  const after = rowsFor(store, DARTH);
  for (const name of ['careerDaily', 'careerHeroDaily', 'careerLatest']) {
    assert.deepEqual(after[`25/${name}`], before[`25/${name}`], `no ${name} rows written`);
  }
  assert.deepEqual(seasonRows(store, 25, 'careerDaily').map((x) => x.gamesPlayed), [58]);
  assert.equal(r.warnings.filter((w) => w.code === 'reset-too-soon').length, 1);
  assert.match(r.warnings[0].message, /Darth.*season 25 started only 5\.0 days ago/);
  // Rank and profile data still flow.
  assert.equal(store.rankCurrent.get(`${DARTH}|damage`).time, now);

  // The same reset is believed once the season is old enough.
  const later = T0 + 22 * DAY;
  const r2 = ingestPoll(store, [makeSample(DARTH, later, { rankSeason: 25, career: RESET })], { now: later });
  assert.deepEqual(r2.assignments, [{ player: DARTH, season: 26, reason: 'counter-reset' }]);
  assert.equal(r2.currentSeason, 26);
  assert.equal(store.state.currentSeasonDetectedAt, later);
});

test('S10: forceSeason raises the global season and stamps it', () => {
  const store = seed([{ player: DARTH, season: 25 }]);
  const now = T0 + DAY;
  const r = ingestPoll(store, [makeSample(DARTH, now, { rankSeason: 25 })], { now, forceSeason: 26 });
  assert.equal(r.currentSeason, 26);
  assert.equal(store.state.currentSeason, 26);
  assert.equal(store.state.currentSeasonDetectedAt, now);
  assert.equal(store.state.players[DARTH].season, 25, 'players move on their own signals');

  // Forcing a lower season later is ignored.
  const later = now + DAY;
  ingestPoll(store, [makeSample(DARTH, later, { rankSeason: 25 })], { now: later, forceSeason: 24 });
  assert.equal(store.state.currentSeason, 26);
  assert.equal(store.state.currentSeasonDetectedAt, now);
});

test('S11: an empty store with no rank seasons cannot pick a season', () => {
  const store = emptyStore();
  const now = T0;
  assert.throws(
    () => ingestPoll(store, [makeSample(DARTH, now, { rankSeason: null })], { now }),
    /rerun with --force-season/,
  );
  assert.equal(store.state.currentSeason, null);
  assert.deepEqual(store.state.players, {});
  assert.equal(store.seasons.size, 0);

  // forceSeason bootstraps it.
  const r = ingestPoll(store, [makeSample(DARTH, now, { rankSeason: null })], { now, forceSeason: 25 });
  assert.deepEqual(r.assignments, [{ player: DARTH, season: 25, reason: 'new-player' }]);
  assert.equal(r.currentSeason, 25);
});

test('S12: the outcome does not depend on the order of the samples in a poll', () => {
  const run = (order) => {
    const store = seed([
      { player: DARTH, season: 23 }, { player: TONES, season: 23, career: TONES_S23 }, { player: KIENESS, season: 23 },
    ]);
    const polls = [
      [makeSample(DARTH, ROLLOVER, { rankSeason: 24, career: RESET }), makeSample(TONES, ROLLOVER, { rankSeason: 23, career: TONES_S23 }),
        makeSample(KIENESS, ROLLOVER, { rankSeason: 23, career: RESET })],
    ];
    for (const samples of polls) ingestPoll(store, order(samples), { now: ROLLOVER });
    return {
      state: store.state,
      rows: [...store.seasons.keys()].map((s) => Object.keys(SEASON_DATASETS).map((n) => seasonRows(store, s, n))),
    };
  };
  assert.deepEqual(run((s) => s), run((s) => [...s].reverse()));
});

test('S13: countersChanged only trusts games played', () => {
  const prev = careerOf();
  assert.equal(countersChanged(prev, careerOf()), false);
  assert.equal(countersChanged(prev, careerOf({ gamesPlayed: (prev.gamesPlayed ?? 0) + 1 })), true);
  assert.equal(countersChanged(prev, careerOf({ deaths: 81 })), false, 'other counters alone are not play');
  assert.equal(countersChanged(prev, careerOf({ timePlayed: (prev.timePlayed ?? 0) + 2 })), false, 'time jitter is not play');
  assert.equal(countersChanged(prev, careerOf({ gamesPlayed: null })), false);
  assert.equal(countersChanged(null, careerOf()), true);
  assert.equal(countersChanged(prev, null), false);
});

test('S14: time-played jitter after the grace window keeps an inactive player in their season', () => {
  // Regression: the first poll after a backfill saw all-heroes timePlayed off
  // by 1-2 s (per-hero sums vs the real total) and moved Kiddo from S22 into
  // the current season as post-grace-change.
  const idle = { gamesPlayed: 3, timePlayed: 900, eliminations: 20, deaths: 15, assists: 4 };
  const store = rolledOver(idle);
  const d1 = ROLLOVER + 3 * DAY;
  const r = ingestPoll(store, [makeSample(TONES, d1, { rankSeason: 23, career: { ...idle, timePlayed: 902 } })], { now: d1 });
  assert.deepEqual(r.assignments, [{ player: TONES, season: 23, reason: 'unchanged' }]);
  assert.equal(seasonRows(store, 24, 'careerDaily').filter((x) => x.player === TONES).length, 0);
});
