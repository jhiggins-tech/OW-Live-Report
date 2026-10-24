// Turns the legacy flat snapshot files (docs/data/snapshots/{rank-daily,
// career-daily,career-hero-daily}.json, baked from the TimescaleDB daily table)
// back into per-day Samples and replays them through ingestPoll. The test
// suite uses it to check season assignment against real history, and the
// backfill (backfill-from-db.mjs --from-snapshots) reuses it as its offline
// source. Pure apart from reading the legacy files in loadLegacySnapshots().

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestPoll } from './rollup.mjs';

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

function readRows(dir, file, { required }) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (required) throw new Error(`replay: ${path} not found`);
    return [];
  }
  return JSON.parse(readFileSync(path, 'utf8')).rows ?? [];
}

// Reads the legacy snapshot dir. The three daily files are required; the
// others come back as [] when absent. Returns plain row arrays:
// { rankDaily, careerDaily, careerHeroDaily, careerLatest, profiles, rankCurrent }.
export function loadLegacySnapshots(dir) {
  return {
    rankDaily: readRows(dir, 'rank-daily.json', { required: true }),
    careerDaily: readRows(dir, 'career-daily.json', { required: true }),
    careerHeroDaily: readRows(dir, 'career-hero-daily.json', { required: true }),
    careerLatest: readRows(dir, 'career-latest.json', { required: false }),
    profiles: readRows(dir, 'profiles.json', { required: false }),
    rankCurrent: readRows(dir, 'rank-current.json', { required: false }),
  };
}

// One Sample per (player, day) that has any rows, grouped by day, ascending:
// [[day, Sample[]], ...]. Each sample is stamped at noon UTC with profile null.
//   - ranks come from that day's rank-daily rows; rankSeason is the highest
//     non-null season among them.
//   - career['all-heroes'] comes from career-daily, and its timePlayed is the
//     sum of that day's per-hero timePlayed (the daily table has no all-heroes
//     time; null when there are no hero rows). healingDone, healingPer10Min
//     and winPercentage aren't in the legacy daily files, so they are null.
//   - per-hero career comes from career-hero-daily, other fields null.
export function legacySamplesByDay(legacy) {
  const byKey = new Map();
  const entry = (player, day) => {
    const key = `${day}|${player}`;
    let e = byKey.get(key);
    if (!e) {
      e = { player, day, ranks: [], all: null, heroes: [] };
      byKey.set(key, e);
    }
    return e;
  };
  for (const r of legacy.rankDaily) entry(r.player, r.day).ranks.push(r);
  for (const r of legacy.careerDaily) entry(r.player, r.day).all = r;
  for (const r of legacy.careerHeroDaily) entry(r.player, r.day).heroes.push(r);

  const days = new Map();
  for (const e of byKey.values()) {
    const seasons = e.ranks.map((r) => r.season).filter((s) => s != null);
    let career = null;
    if (e.all || e.heroes.length) {
      career = {};
      if (e.all) {
        career['all-heroes'] = {
          eliminations: e.all.eliminations ?? null,
          deaths: e.all.deaths ?? null,
          assists: e.all.assists ?? null,
          healingDone: null,
          healingPer10Min: null,
          gamesWon: e.all.gamesWon ?? null,
          gamesPlayed: e.all.gamesPlayed ?? null,
          winPercentage: null,
          timePlayed: e.heroes.length ? e.heroes.reduce((sum, h) => sum + (h.timePlayed ?? 0), 0) : null,
        };
      }
      for (const h of e.heroes) {
        career[h.hero] = {
          eliminations: h.eliminations ?? null,
          deaths: h.deaths ?? null,
          assists: h.assists ?? null,
          healingDone: null,
          healingPer10Min: null,
          gamesWon: null,
          gamesPlayed: h.gamesPlayed ?? null,
          winPercentage: null,
          timePlayed: h.timePlayed ?? null,
        };
      }
    }
    const sample = {
      player: e.player,
      fetchedAt: e.day + HALF_DAY_MS,
      day: e.day,
      rankSeason: seasons.length ? Math.max(...seasons) : null,
      ranks: e.ranks.map((r) => ({ role: r.role, tier: r.tier, division: r.division, season: r.season ?? null })),
      profile: null,
      career,
    };
    const list = days.get(e.day) ?? [];
    list.push(sample);
    days.set(e.day, list);
  }
  return [...days]
    .sort(([a], [b]) => a - b)
    .map(([day, samples]) => [day, samples.sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : 0))]);
}

// Runs ingestPoll for each [day, samples] pair in order with now = day + 12h.
// `onDay(day, result)` sees every poll's result (assignments, currentSeason,
// warnings). Returns all results. Extra ingestPoll options (graceMs, ...) can
// be passed; `now` is always derived from the day.
export function replayDays(store, samplesByDay, opts = {}, onDay = () => {}) {
  const results = [];
  for (const [day, samples] of samplesByDay) {
    const result = ingestPoll(store, samples, { ...opts, now: day + HALF_DAY_MS });
    results.push({ day, ...result });
    onDay(day, result);
  }
  return results;
}
