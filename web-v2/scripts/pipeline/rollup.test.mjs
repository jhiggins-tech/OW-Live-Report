// Tests R1-R4: how a sample is compacted into the daily roll-ups (merge rule,
// forward-fill for the current season, change-only for every other season).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingestPoll } from './rollup.mjs';
import { emptyStore, seasonRows } from './store.mjs';
import { at, careerOf, makeSample } from './__fixtures__/helpers.mjs';

const DARTH = 'DarthKcaj-1443';
const KIDDO = 'Kiddo-11482';
const rank = (tier, season = 25) => [{ role: 'support', tier, division: 'gold', season }];
const rowsOf = (store, season, name) => seasonRows(store, season, name);

test('R1: two polls on the same UTC day merge into one row per key', () => {
  const store = emptyStore();
  const p1 = at('2026-10-10T09:37:00Z');
  const p2 = at('2026-10-10T21:37:00Z');
  ingestPoll(store, [makeSample(DARTH, p1, {
    rankSeason: 25,
    ranks: rank(3),
    career: {
      'all-heroes': careerOf({ eliminations: 900, deaths: 480, assists: 538, gamesWon: 30, gamesPlayed: 57, timePlayed: 40_000, healingPer10Min: 3000, winPercentage: 50 }),
      ana: careerOf({ eliminations: 3, gamesPlayed: 2, timePlayed: 219, healingPer10Min: 5040, winPercentage: 30 }),
    },
  })], { now: p1 });
  const r = ingestPoll(store, [makeSample(DARTH, p2, {
    rankSeason: 25,
    ranks: rank(2),
    career: {
      'all-heroes': careerOf({ eliminations: 924, deaths: 480, assists: null, gamesWon: 31, gamesPlayed: 58, timePlayed: 40_237, healingPer10Min: 3248, winPercentage: null }),
      ana: careerOf({ eliminations: 4, gamesPlayed: 2, timePlayed: 250, healingPer10Min: 4000, winPercentage: 35 }),
    },
  })], { now: p2 });
  assert.deepEqual(r.warnings, []);

  const day = at('2026-10-10T00:00:00Z');
  // career-daily: counters MAX (null loses to a number).
  assert.deepEqual(rowsOf(store, 25, 'careerDaily'), [
    { player: DARTH, day, eliminations: 924, deaths: 480, assists: 538, gamesWon: 31, gamesPlayed: 58 },
  ]);
  assert.deepEqual(rowsOf(store, 25, 'careerHeroDaily'), [
    { player: DARTH, hero: 'ana', day, eliminations: 4, deaths: 80, assists: 40, gamesPlayed: 2, timePlayed: 250 },
  ]);
  // rank: last value of the day.
  assert.deepEqual(rowsOf(store, 25, 'rankDaily'), [
    { player: DARTH, role: 'support', day, tier: 2, division: 'gold', season: 25 },
  ]);
  // career-latest: counters MAX, rates last-wins (null included), time = later poll.
  const latest = rowsOf(store, 25, 'careerLatest');
  assert.equal(latest.length, 2);
  const all = latest.find((x) => x.hero === 'all-heroes');
  assert.equal(all.time, p2);
  assert.equal(all.eliminations, 924);
  assert.equal(all.assists, 538);
  assert.equal(all.healingPer10Min, 3248);
  assert.equal(all.winPercentage, null);
  const ana = latest.find((x) => x.hero === 'ana');
  assert.equal(ana.healingPer10Min, 4000);
  assert.equal(ana.winPercentage, 35);
  assert.equal(store.rankCurrent.get(`${DARTH}|support`).time, p2);
  assert.equal(store.rankCurrent.get(`${DARTH}|support`).tier, 2);
});

test('R2: a counter that falls within the same season keeps its max and warns', () => {
  const store = emptyStore();
  const p1 = at('2026-10-10T09:37:00Z');
  const p2 = at('2026-10-10T21:37:00Z');
  ingestPoll(store, [makeSample(DARTH, p1, { rankSeason: 25, career: { eliminations: 500, gamesPlayed: 10 } })], { now: p1 });
  const r = ingestPoll(store, [makeSample(DARTH, p2, { rankSeason: 25, career: { eliminations: 490, gamesPlayed: 11 } })], { now: p2 });

  assert.equal(rowsOf(store, 25, 'careerDaily')[0].eliminations, 500, 'MAX keeps the higher value');
  assert.equal(rowsOf(store, 25, 'careerDaily')[0].gamesPlayed, 11);
  assert.equal(rowsOf(store, 25, 'careerLatest')[0].eliminations, 500);
  assert.deepEqual(r.assignments, [{ player: DARTH, season: 25, reason: 'unchanged' }]);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, 'non-monotonic');
  assert.equal(r.warnings[0].player, DARTH);
  assert.match(r.warnings[0].message, /all-heroes\.eliminations 500->490/);
});

test('R3: a current-season player is forward-filled, one row per day', () => {
  const store = emptyStore();
  const d1 = at('2026-10-10T21:37:00Z');
  const d2 = at('2026-10-11T21:37:00Z');
  const same = (t) => makeSample(DARTH, t, { rankSeason: 25, ranks: rank(3), career: { 'all-heroes': careerOf(), ana: careerOf({ gamesPlayed: 2 }) } });
  ingestPoll(store, [same(d1)], { now: d1 });
  ingestPoll(store, [same(d2)], { now: d2 });
  const days = [at('2026-10-10T00:00:00Z'), at('2026-10-11T00:00:00Z')];
  assert.deepEqual(rowsOf(store, 25, 'careerDaily').map((x) => x.day), days);
  assert.deepEqual(rowsOf(store, 25, 'careerHeroDaily').map((x) => x.day), days);
  assert.deepEqual(rowsOf(store, 25, 'rankDaily').map((x) => x.day), days);
  // career-latest is one row per hero whose time follows the newest poll.
  assert.deepEqual(rowsOf(store, 25, 'careerLatest').map((x) => [x.hero, x.time]), [['all-heroes', d2], ['ana', d2]]);
});

test('R4: another season is change-only: an unchanged sample writes nothing', () => {
  const store = emptyStore();
  const t1 = at('2026-10-10T21:37:00Z');
  // Darth keeps the global season at 25; Kiddo is stuck in S22.
  const poll = (t, tier = 2) => ingestPoll(store, [
    makeSample(DARTH, t, { rankSeason: 25, career: { gamesPlayed: 5 } }),
    makeSample(KIDDO, t, { rankSeason: 22, ranks: rank(tier, 22), career: { 'all-heroes': careerOf({ gamesPlayed: 31 }), ana: careerOf({ gamesPlayed: 1 }) } }),
  ], { now: t });
  const kiddoRows = () => ['rankDaily', 'careerDaily', 'careerHeroDaily', 'careerLatest']
    .map((n) => rowsOf(store, 22, n));

  poll(t1);
  const first = kiddoRows();
  assert.deepEqual(first.map((rows) => rows.length), [1, 1, 1, 2]);

  for (const days of [1, 2, 3]) poll(t1 + days * 86_400_000);
  assert.deepEqual(kiddoRows(), first, 'three more identical days wrote zero rows (time untouched too)');
  assert.equal(store.rankCurrent.get(`${KIDDO}|support`).time, t1 + 3 * 86_400_000, 'rank-current still follows the poll');
  // Darth, in the current season, got a row every day.
  assert.equal(rowsOf(store, 25, 'careerDaily').filter((x) => x.player === DARTH).length, 4);

  // A real change to the old season's rank is still caught (a new row, once).
  const t5 = t1 + 4 * 86_400_000;
  poll(t5, 1);
  poll(t5 + 3_600_000, 1);
  const ranks = rowsOf(store, 22, 'rankDaily');
  assert.deepEqual(ranks.map((x) => x.tier), [2, 1]);
  assert.equal(ranks[1].day, at('2026-10-14T00:00:00Z'));
  assert.deepEqual(kiddoRows().slice(1), first.slice(1), 'career rows still untouched');
});
