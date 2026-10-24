// Test M1: buildMeta (season index, per-player season maps, heartbeat).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMeta } from './meta.mjs';
import { ingestPoll } from './rollup.mjs';
import { emptyStore } from './store.mjs';
import { DAY, at, makeSample } from './__fixtures__/helpers.mjs';

const DARTH = 'DarthKcaj-1443';
const KIENESS = 'Kieness-6123';
const KIDDO = 'Kiddo-11482';
const day = (iso) => at(`${iso}T00:00:00Z`);

test('M1: buildMeta reports the season index, per-player seasons and a carried-over heartbeat', () => {
  const store = emptyStore();
  const poll = (iso, samples) => {
    const now = at(`${iso}T12:00:00Z`);
    ingestPoll(store, samples(now), { now });
  };
  // Kieness reports a S23 support rank first, later only a S24 damage rank.
  poll('2026-07-01', (n) => [
    makeSample(KIENESS, n, { rankSeason: 23, ranks: [{ role: 'support', tier: 1, division: 'bronze', season: 23 }] }),
    makeSample(KIDDO, n, { rankSeason: 22 }),
    makeSample(DARTH, n, { rankSeason: 23 }),
  ]);
  poll('2026-07-02', (n) => [makeSample(DARTH, n, { rankSeason: 23 })]);
  // Darth's counters reset on Aug 12 (> 21 days later): global season 24.
  poll('2026-08-12', (n) => [makeSample(DARTH, n, { rankSeason: 23, career: { gamesPlayed: 3, timePlayed: 100, eliminations: 5 } })]);
  poll('2026-08-13', (n) => [
    makeSample(DARTH, n, { rankSeason: 24, career: { gamesPlayed: 4, timePlayed: 200, eliminations: 8 } }),
    makeSample(KIENESS, n, { rankSeason: 24, ranks: [{ role: 'damage', tier: 3, division: 'gold', season: 24 }] }),
  ]);

  const now = at('2026-08-13T21:37:00Z');
  const players = [KIENESS, DARTH, KIDDO];
  const meta = buildMeta(store, {
    now,
    players,
    lastPoll: { source: 'poll', ok: [DARTH], failed: [{ player: KIDDO, error: 'HTTP 503' }] },
    previousMeta: { heartbeatAt: 111 },
  });

  assert.equal(meta, store.meta, 'attached to the store for saveStore');
  assert.equal(meta.layoutVersion, 2);
  assert.equal(meta.generatedAt, now);
  assert.equal(meta.heartbeatAt, now, 'at least one player was fetched OK');
  assert.equal(meta.gamemode, 'competitive');
  assert.equal(meta.platform, 'pc');
  assert.deepEqual(meta.players, players);
  assert.equal(meta.currentSeason, 24);
  assert.equal(meta.maxSeason, 24);
  assert.equal(meta.seasonStart, day('2026-08-12'));
  // Each season's min/max day over its daily files (S22 = Kiddo's single day).
  assert.deepEqual(meta.seasons, [
    { season: 22, firstDay: day('2026-07-01'), lastDay: day('2026-07-01') },
    { season: 23, firstDay: day('2026-07-01'), lastDay: day('2026-07-02') },
    { season: 24, firstDay: day('2026-08-12'), lastDay: day('2026-08-13') },
  ]);
  // Counter seasons come from state; reported seasons from the newest rank row.
  assert.deepEqual(meta.playerSeason, { [DARTH]: 24, [KIDDO]: 22, [KIENESS]: 24 });
  assert.deepEqual(meta.seasonByPlayer, { [DARTH]: 24, [KIDDO]: 22, [KIENESS]: 24 });
  assert.deepEqual(meta.lastPoll, {
    at: now, source: 'poll', ok: [DARTH], failed: [{ player: KIDDO, error: 'HTTP 503' }],
  });

  // With nobody fetched OK the heartbeat is carried over from the previous meta.
  const stale = buildMeta(store, {
    now: now + DAY,
    players,
    lastPoll: { source: 'poll', ok: [], failed: [] },
    previousMeta: meta,
  });
  assert.equal(stale.heartbeatAt, now);
  assert.equal(stale.generatedAt, now + DAY);
  // ...and defaults to the meta that loadStore attached when none is passed.
  store.previousMeta = { heartbeatAt: 42 };
  assert.equal(buildMeta(store, { now, players, lastPoll: { source: 'poll', ok: [], failed: [] } }).heartbeatAt, 42);
  store.previousMeta = null;
  assert.equal(buildMeta(store, { now, players, lastPoll: { source: 'poll', ok: [], failed: [] } }).heartbeatAt, null);
});

test('M1: an empty store gives a null season and no seasons', () => {
  const meta = buildMeta(emptyStore(), { now: 1000, players: ['A-1'], lastPoll: { source: 'backfill', ok: ['A-1'], failed: [] } });
  assert.equal(meta.currentSeason, null);
  assert.equal(meta.maxSeason, null);
  assert.equal(meta.seasonStart, null);
  assert.deepEqual(meta.seasons, []);
  assert.deepEqual(meta.seasonByPlayer, {});
  assert.deepEqual(meta.playerSeason, {});
  assert.equal(meta.lastPoll.source, 'backfill');
});
