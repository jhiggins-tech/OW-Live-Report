// Tests E1-E5 (+ E6 edge cases): OverFast response -> Sample.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSample } from './extract.mjs';
import { at, loadFixture } from './__fixtures__/helpers.mjs';

const FETCHED_AT = at('2026-10-24T21:37:00Z');
const CAREER_KEYS = [
  'eliminations', 'deaths', 'assists', 'healingDone', 'healingPer10Min',
  'gamesWon', 'gamesPlayed', 'winPercentage', 'timePlayed',
];

const darth = () => structuredClone(loadFixture('DarthKcaj-1443'));
const sampleOf = (body) => extractSample('DarthKcaj-1443', body, FETCHED_AT);

test('E1: full public profile -> ranks, rankSeason, all-heroes and per-hero career', () => {
  const s = sampleOf(darth());
  assert.equal(s.player, 'DarthKcaj-1443');
  assert.equal(s.fetchedAt, FETCHED_AT);
  assert.equal(s.day, at('2026-10-24T00:00:00Z'));
  assert.equal(s.rankSeason, 25);
  // One entry per present role (open is null in the fixture), in role order.
  const icons = (division, tier) => ({
    rankIcon: `https://static.example.invalid/overwatch/ranks/${division}.png`,
    tierIcon: `https://static.example.invalid/overwatch/tiers/${tier}.png`,
  });
  assert.deepEqual(s.ranks, [
    { role: 'tank', tier: 2, division: 'silver', season: 25, ...icons('silver', 2) },
    { role: 'damage', tier: 1, division: 'gold', season: 25, ...icons('gold', 1) },
    { role: 'support', tier: 4, division: 'gold', season: 25, ...icons('gold', 4) },
  ]);
  assert.deepEqual(s.profile, {
    username: 'DarthKcaj',
    avatar: 'https://d15f34w2p8l1cc.cloudfront.net/overwatch/f6ccbdcbad91bc261226d2a2cdc63030ac8352b9886d7b315a07d578a3de7e9a.png',
    namecard: 'https://d15f34w2p8l1cc.cloudfront.net/overwatch/9a9d5e2fd7b89e3cfd21638bfbcffced9ed47bc1451d05e142f6d05ae78567bc.png',
    title: 'None',
    endorsementLevel: 4,
    endorsementFrame: 'https://static.playoverwatch.com/images/pages/career/icons/endorsement/4.3b2140459f3c83ff3e9ce180646c692184aa2833.svg#icon',
    lastUpdatedAt: 1792801696000,
  });

  assert.deepEqual(Object.keys(s.career), ['all-heroes', 'hazard', 'mei', 'mercy', 'orisa', 'torbjorn', 'wuyang']);
  // Competitive numbers, not the quickplay block (eliminations 99999).
  assert.deepEqual(s.career['all-heroes'], {
    eliminations: 924, deaths: 480, assists: 538, healingDone: 217847, healingPer10Min: 3248,
    gamesWon: 31, gamesPlayed: 58, winPercentage: null, timePlayed: 40237,
  });
  assert.deepEqual(s.career.mercy, {
    eliminations: 5, deaths: 48, assists: 180, healingDone: 74955, healingPer10Min: 10078,
    gamesWon: 4, gamesPlayed: 6, winPercentage: 62, timePlayed: 4463,
  });
  // Blizzard omits zero-valued stats; they must come through as null, not 0.
  assert.equal(s.career.torbjorn.healingDone, null);
  assert.equal(s.career.torbjorn.healingPer10Min, null);
  assert.equal(s.career.torbjorn.winPercentage, 74);
  for (const c of Object.values(s.career)) assert.deepEqual(Object.keys(c), CAREER_KEYS);
});

test('E2: private profile (stats: null) -> career null, profile still filled', () => {
  const body = darth();
  body.stats = null;
  const s = sampleOf(body);
  assert.equal(s.career, null);
  assert.equal(s.profile.username, 'DarthKcaj');
  assert.equal(s.profile.endorsementLevel, 4);
  assert.equal(s.ranks.length, 3);

  // Same for a missing platform, gamemode or career_stats.
  for (const stats of [{ pc: null }, { pc: { quickplay: {} } }, { pc: { competitive: { heroes_comparisons: {} } } }]) {
    const b = darth();
    b.stats = stats;
    assert.equal(sampleOf(b).career, null);
  }
});

test('E3: summary.competitive null -> no ranks, rankSeason null', () => {
  const body = darth();
  body.summary.competitive = null;
  const s = sampleOf(body);
  assert.deepEqual(s.ranks, []);
  assert.equal(s.rankSeason, null);
  assert.equal(s.profile.username, 'DarthKcaj');
  assert.ok(s.career['all-heroes']);

  // A pc block without a season (never placed) behaves the same way.
  const b2 = darth();
  b2.summary.competitive = { pc: { season: null, tank: null, damage: null, support: null, open: null } };
  const s2 = sampleOf(b2);
  assert.deepEqual(s2.ranks, []);
  assert.equal(s2.rankSeason, null);

  // A null summary gives no profile either.
  const b3 = darth();
  b3.summary = null;
  const s3 = sampleOf(b3);
  assert.equal(s3.profile, null);
  assert.deepEqual(s3.ranks, []);
  assert.equal(s3.rankSeason, null);
});

test('E4: a role missing tier or division is skipped', () => {
  const body = darth();
  delete body.summary.competitive.pc.damage.tier;
  body.summary.competitive.pc.support.division = null;
  const s = sampleOf(body);
  assert.deepEqual(s.ranks.map((r) => [r.role, r.tier, r.division, r.season]), [['tank', 2, 'silver', 25]]);
  assert.equal(s.rankSeason, 25);
});

test('E7: rank insignia URLs are captured; a role without icons gives nulls', () => {
  const body = darth();
  const pc = body.summary.competitive.pc;
  delete pc.damage.rank_icon; // absent
  pc.damage.tier_icon = ''; // blank
  pc.support.rank_icon = null;
  pc.support.tier_icon = 42; // not a string
  delete pc.tank.rank_icon;
  delete pc.tank.tier_icon;
  const s = sampleOf(body);
  assert.deepEqual(s.ranks.map((r) => [r.role, r.rankIcon, r.tierIcon]), [
    ['tank', null, null],
    ['damage', null, null],
    ['support', null, null],
  ]);

  // Untouched, every role keeps its own two URLs (the rank is still extracted).
  const full = sampleOf(darth());
  assert.deepEqual(full.ranks.map((r) => [r.role, r.rankIcon, r.tierIcon]), [
    ['tank', 'https://static.example.invalid/overwatch/ranks/silver.png', 'https://static.example.invalid/overwatch/tiers/2.png'],
    ['damage', 'https://static.example.invalid/overwatch/ranks/gold.png', 'https://static.example.invalid/overwatch/tiers/1.png'],
    ['support', 'https://static.example.invalid/overwatch/ranks/gold.png', 'https://static.example.invalid/overwatch/tiers/4.png'],
  ]);
});

test('E5: a stat found only in another canonical category is still mapped', () => {
  const body = darth();
  const heroes = body.stats.pc.competitive.career_stats;
  // OverFast has moved stats between categories before: put eliminations under
  // "assists" and games_played under "average" instead of their usual homes.
  const cats = heroes.mei;
  const combat = cats.find((c) => c.category === 'combat');
  const game = cats.find((c) => c.category === 'game');
  const eliminations = combat.stats.find((x) => x.key === 'eliminations');
  const gamesPlayed = game.stats.find((x) => x.key === 'games_played');
  combat.stats = combat.stats.filter((x) => x !== eliminations);
  game.stats = game.stats.filter((x) => x !== gamesPlayed);
  cats.find((c) => c.category === 'assists').stats.push(eliminations);
  cats.find((c) => c.category === 'average').stats.push(gamesPlayed);
  // A key that exists only in a non-canonical category (hero_specific) is ignored.
  const deaths = combat.stats.find((x) => x.key === 'deaths');
  combat.stats = combat.stats.filter((x) => x !== deaths);
  cats.push({ category: 'hero_specific', label: 'Hero Specific', stats: [{ ...deaths, value: 7777 }] });

  const s = sampleOf(body);
  assert.equal(s.career.mei.eliminations, 123);
  assert.equal(s.career.mei.gamesPlayed, 6);
  assert.equal(s.career.mei.deaths, null);
  assert.equal(s.career.mei.assists, 57);
});

test('E6: odd values are coerced or nulled, never 0', () => {
  const body = darth();
  const all = body.stats.pc.competitive.career_stats['all-heroes'];
  const stat = (category, key) => all.find((c) => c.category === category).stats.find((x) => x.key === key);
  stat('combat', 'eliminations').value = '925';
  stat('combat', 'deaths').value = null;
  stat('assists', 'assists').value = 'n/a';
  stat('game', 'games_played').value = '';
  const c = sampleOf(body).career['all-heroes'];
  assert.equal(c.eliminations, 925);
  assert.equal(c.deaths, null);
  assert.equal(c.assists, null);
  assert.equal(c.gamesPlayed, null);
  assert.equal(c.gamesWon, 31);

  // A hero with none of the mapped stats is left out of career.
  const b2 = darth();
  b2.stats.pc.competitive.career_stats.ana = [{ category: 'best', label: 'Best', stats: [{ key: 'eliminations_most_in_game', value: 9 }] }];
  assert.ok(!('ana' in sampleOf(b2).career));

  // Non-default platform / gamemode are honoured.
  const b3 = darth();
  b3.stats.pc.quickplay.career_stats['all-heroes'][0].stats[0].value = 12;
  const qp = extractSample('DarthKcaj-1443', b3, FETCHED_AT, { gamemode: 'quickplay' });
  assert.equal(qp.career['all-heroes'].eliminations, 12);
});
