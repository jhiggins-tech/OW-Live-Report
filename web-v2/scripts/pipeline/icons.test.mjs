// Tests I1-I5: the rank-insignia map (icons.mjs) and rank-icons.json.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyRankIcons, noteRankIcons, rankIconCount, rankIconsFile } from './icons.mjs';
import { ingestPoll } from './rollup.mjs';
import { emptyStore, loadStore, saveStore } from './store.mjs';
import { at, fixtureSamples, makeSample, tmpDir } from './__fixtures__/helpers.mjs';

const T1 = at('2026-10-24T09:37:00Z');
const T2 = at('2026-10-24T21:37:00Z');
const T3 = at('2026-10-25T09:37:00Z');
const ICONS_REL = 'snapshots/rank-icons.json';

const rankIcon = (name, tag = 'a') => `https://static.example.invalid/rank/${name}.${tag}.png`;
const tierIcon = (n, tag = 'a') => `https://static.example.invalid/tier/${n}.${tag}.png`;
// An extractSample ranks[] entry carrying its two insignia URLs.
const rank = (division, tier, { season = 25, role = 'damage', tag = 'a' } = {}) => ({
  role, tier, division, season, rankIcon: rankIcon(division, tag), tierIcon: tierIcon(tier, tag),
});
// A poll of one player at `t` holding the given ranks.
const poll = (store, player, t, ranks, rankSeason = ranks[0]?.season ?? 25) => {
  ingestPoll(store, [makeSample(player, t, { rankSeason, ranks })], { now: t });
};
const entries = (map) => Object.fromEntries([...map].map(([k, v]) => [k, `${v.url.split('/').pop()}@${v.season}`]));
const read = (dir) => readFileSync(join(dir, ICONS_REL), 'utf8');

test('I1: a higher season wins; on a tie the newer poll wins, whatever the ingest order', () => {
  const offer = (icons, r, season, when) => noteRankIcons(icons, r, { season, at: when });

  // A lower season never replaces a higher one, in either order.
  for (const order of [[22, 23], [23, 22]]) {
    const icons = emptyRankIcons();
    for (const [i, season] of order.entries()) offer(icons, rank('bronze', 2, { tag: `s${season}` }), season, T1 + i);
    assert.deepEqual(entries(icons.divisions), { bronze: 'bronze.s23.png@23' }, `order ${order}`);
    assert.deepEqual(entries(icons.tiers), { 2: '2.s23.png@23' }, `order ${order}`);
  }

  // The same season: the newer poll replaces the older one, an older poll arriving late does not.
  const icons = emptyRankIcons();
  offer(icons, rank('gold', 3, { tag: 'old' }), 25, T1);
  offer(icons, rank('gold', 3, { tag: 'new' }), 25, T2);
  offer(icons, rank('gold', 3, { tag: 'older' }), 25, T1 - 1);
  assert.deepEqual(entries(icons.divisions), { gold: 'gold.new.png@25' });

  // One poll disagreeing with itself resolves the same way in both orders.
  const a = emptyRankIcons();
  const b = emptyRankIcons();
  offer(a, rank('gold', 3, { tag: 'x' }), 25, T1);
  offer(a, rank('gold', 3, { tag: 'y' }), 25, T1);
  offer(b, rank('gold', 3, { tag: 'y' }), 25, T1);
  offer(b, rank('gold', 3, { tag: 'x' }), 25, T1);
  assert.deepEqual(entries(a.divisions), entries(b.divisions));
  assert.deepEqual(entries(a.tiers), entries(b.tiers));
});

test('I1: ranks without usable icons do not touch the map', () => {
  const icons = emptyRankIcons();
  const note = (r, season = 25) => noteRankIcons(icons, r, { season, at: T1 });
  note({ role: 'tank', tier: 2, division: 'silver', season: 25, rankIcon: null, tierIcon: null });
  note({ role: 'tank', tier: 2, division: 'silver', season: 25 }); // a legacy sample has no icon keys
  note({ ...rank('gold', 3), rankIcon: 'http://insecure.example/gold.png', tierIcon: '/relative/3.png' });
  note({ ...rank('gold', 6) }); // not a division number
  note(rank('gold', 3), null); // no season to file it under
  assert.equal(rankIconCount(icons), 1, 'only the badge of "gold 6" is usable');
  assert.deepEqual(entries(icons.divisions), { gold: 'gold.a.png@25' });
  assert.deepEqual(entries(icons.tiers), {});

  // Half a rank still counts: the badge without the number, and the reverse.
  const half = emptyRankIcons();
  noteRankIcons(half, { ...rank('platinum', 4), tierIcon: null }, { season: 25, at: T1 });
  noteRankIcons(half, { ...rank('diamond', 5), rankIcon: null }, { season: 25, at: T1 });
  assert.deepEqual(entries(half.divisions), { platinum: 'platinum.a.png@25' });
  assert.deepEqual(entries(half.tiers), { 5: '5.a.png@25' });

  // Division names are keyed in lower case.
  const upper = emptyRankIcons();
  noteRankIcons(upper, rank('Gold', 1), { season: 25, at: T1 });
  assert.deepEqual([...upper.divisions.keys()], ['gold']);
});

test('I2: ingestPoll fills the map from every rank; rows keep their contracts', () => {
  const store = emptyStore();
  // Kiddo is stuck in season 22 and serves old-format URLs; Darth is current.
  ingestPoll(store, [
    makeSample('Kiddo-11482', T1, { rankSeason: 22, ranks: [rank('bronze', 2, { season: 22, tag: 'old' })] }),
    makeSample('DarthKcaj-1443', T1, {
      rankSeason: 25,
      ranks: [rank('bronze', 1, { tag: 'new' }), rank('gold', 3, { role: 'support', tag: 'new' })],
    }),
  ], { now: T1 });
  assert.deepEqual(entries(store.rankIcons.divisions), { bronze: 'bronze.new.png@25', gold: 'gold.new.png@25' });
  assert.deepEqual(entries(store.rankIcons.tiers), { 1: '1.new.png@25', 2: '2.old.png@22', 3: '3.new.png@25' });

  // Later, only the stale season is seen again: it must not win back "bronze".
  ingestPoll(store, [makeSample('Kiddo-11482', T2, { rankSeason: 22, ranks: [rank('bronze', 2, { season: 22, tag: 'old' })] })], { now: T2 });
  assert.equal(store.rankIcons.divisions.get('bronze').season, 25);

  // A rank with a null season is filed under its player's season.
  const nullSeason = emptyStore();
  ingestPoll(nullSeason, [
    makeSample('Tones-11680', T1, { rankSeason: 24, ranks: [rank('gold', 3, { season: 24 })] }),
  ], { now: T1 });
  ingestPoll(nullSeason, [
    makeSample('Tones-11680', T2, { rankSeason: null, ranks: [{ ...rank('gold', 3, { tag: 'later' }), season: null }] }),
  ], { now: T2 });
  assert.deepEqual(entries(nullSeason.rankIcons.divisions), { gold: 'gold.later.png@24' });

  // The rank rows themselves carry no icon fields.
  const rows = [...store.rankCurrent.values()];
  assert.ok(rows.length > 0);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['player', 'role', 'time', 'tier', 'division', 'season']);
  const daily = [...store.bucket(25).rankDaily.values()].flatMap((days) => [...days.values()]);
  for (const row of daily) assert.deepEqual(Object.keys(row), ['player', 'role', 'day', 'tier', 'division', 'season']);
});

test('I3: rank-icons.json is written only when there is something to say, and only when it changes', () => {
  // A store whose ranks carry no icons never writes the file.
  const bare = emptyStore();
  poll(bare, 'Lank-21912', T1, [{ role: 'damage', tier: 3, division: 'gold', season: 25, rankIcon: null, tierIcon: null }]);
  const bareDir = tmpDir();
  assert.ok(!saveStore(bare, bareDir).written.includes(ICONS_REL));
  assert.ok(!existsSync(join(bareDir, ICONS_REL)));
  assert.ok(!saveStore(emptyStore(), tmpDir()).written.includes(ICONS_REL));

  const store = emptyStore();
  poll(store, 'Kiddo-11482', T1, [rank('bronze', 2, { season: 22, tag: 'old' })]);
  poll(store, 'DarthKcaj-1443', T1, [rank('platinum', 5), rank('gold', 3, { role: 'support' })]);
  const dir = tmpDir();
  const first = saveStore(store, dir);
  assert.ok(first.written.includes(ICONS_REL));

  // Pretty-printed, keys sorted, { url, season } entries, ends with a newline.
  const text = read(dir);
  assert.ok(text.endsWith('}\n'));
  assert.match(text, /^\{\n {2}"generatedAt": \d+,\n {2}"divisions": \{\n {4}"bronze": \{\n {6}"url": /);
  assert.deepEqual(JSON.parse(text), {
    generatedAt: T1,
    divisions: {
      bronze: { url: rankIcon('bronze', 'old'), season: 22 },
      gold: { url: rankIcon('gold'), season: 25 },
      platinum: { url: rankIcon('platinum'), season: 25 },
    },
    tiers: {
      2: { url: tierIcon(2, 'old'), season: 22 },
      3: { url: tierIcon(3), season: 25 },
      5: { url: tierIcon(5), season: 25 },
    },
  });
  assert.deepEqual(Object.keys(JSON.parse(text).divisions), ['bronze', 'gold', 'platinum']);

  // Deterministic: the same data ingested in another order gives the same bytes.
  const flipped = emptyStore();
  poll(flipped, 'DarthKcaj-1443', T1, [rank('gold', 3, { role: 'support' }), rank('platinum', 5)]);
  poll(flipped, 'Kiddo-11482', T1, [rank('bronze', 2, { season: 22, tag: 'old' })]);
  const flippedDir = tmpDir();
  saveStore(flipped, flippedDir);
  assert.equal(read(flippedDir), text);

  // Saving again, and polling again with the same URLs, leaves the file alone
  // (and keeps its generatedAt) while other files move on.
  assert.ok(saveStore(store, dir).unchanged.includes(ICONS_REL));
  poll(store, 'DarthKcaj-1443', T2, [rank('platinum', 5), rank('gold', 3, { role: 'support' })]);
  const second = saveStore(store, dir);
  assert.ok(second.unchanged.includes(ICONS_REL));
  assert.ok(second.written.includes('snapshots/rank-current.json'));
  assert.equal(read(dir), text);

  // A changed URL (Blizzard re-hashed the image) rewrites it, stamped with that poll.
  poll(store, 'DarthKcaj-1443', T3, [rank('platinum', 5, { tag: 'rehashed' })]);
  const third = saveStore(store, dir);
  assert.ok(third.written.includes(ICONS_REL));
  const after = JSON.parse(read(dir));
  assert.equal(after.generatedAt, T3);
  assert.equal(after.divisions.platinum.url, rankIcon('platinum', 'rehashed'));
  assert.equal(after.tiers['5'].url, tierIcon(5, 'rehashed'));
  assert.equal(after.divisions.gold.url, rankIcon('gold'), 'untouched entries stay');
});

test('I4: rank-icons.json round-trips through loadStore and saveStore', () => {
  const store = emptyStore();
  ingestPoll(store, fixtureSamples(T1), { now: T1 });
  const dir = tmpDir();
  saveStore(store, dir);
  const before = read(dir);

  const loaded = loadStore(dir);
  assert.deepEqual(rankIconsFile(loaded.rankIcons, 0), rankIconsFile(store.rankIcons, 0));
  assert.ok(rankIconCount(loaded.rankIcons) > 0);
  const again = saveStore(loaded, dir);
  assert.ok(again.unchanged.includes(ICONS_REL));
  assert.equal(read(dir), before);

  // A poll on top of the loaded store: the same URLs change nothing...
  ingestPoll(loaded, fixtureSamples(T2), { now: T2 });
  assert.ok(saveStore(loaded, dir).unchanged.includes(ICONS_REL));
  assert.equal(read(dir), before);
  // ...a loaded entry has no poll time, so the same season's new URL replaces it,
  // but a lower season's does not.
  const higher = loadStore(dir);
  ingestPoll(higher, [makeSample('Kiddo-11482', T3, { rankSeason: 22, ranks: [rank('gold', 3, { season: 22, tag: 'stale' })] })], { now: T3 });
  assert.equal(higher.rankIcons.divisions.get('gold').url, store.rankIcons.divisions.get('gold').url);
  const sameSeason = loadStore(dir);
  ingestPoll(sameSeason, [makeSample('DarthKcaj-1443', T3, { rankSeason: 25, ranks: [rank('gold', 3, { tag: 'fresh' })] })], { now: T3 });
  assert.equal(sameSeason.rankIcons.divisions.get('gold').url, rankIcon('gold', 'fresh'));

  // No file means no map.
  const none = loadStore(tmpDir());
  assert.equal(rankIconCount(none.rankIcons), 0);
});

test('I5: loadStore refuses a rank-icons.json it cannot read', () => {
  const bad = (text) => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'snapshots'));
    writeFileSync(join(dir, ICONS_REL), text);
    return dir;
  };
  assert.throws(() => loadStore(bad('{"generatedAt":1,"divisions":{')), /rank-icons\.json/);
  assert.throws(() => loadStore(bad('[]')), /rank-icons\.json: expected "divisions" and "tiers"/);
  assert.throws(() => loadStore(bad('{"generatedAt":1,"divisions":{"gold":"x"},"tiers":{}}')), /divisions\.gold is not \{ url, season \}/);
  assert.throws(() => loadStore(bad('{"generatedAt":1,"divisions":{},"tiers":{"3":{"url":"https://x/3.png","season":"25"}}}')), /tiers\.3/);
  // An empty-but-valid file loads as an empty map.
  assert.equal(rankIconCount(loadStore(bad('{"generatedAt":1,"divisions":{},"tiers":{}}')).rankIcons), 0);
});
