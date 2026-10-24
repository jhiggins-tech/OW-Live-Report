// Shared builders for the pipeline tests. Not a test file itself (the npm
// script only globs *.test.mjs), so `node --test` never runs it directly.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSample } from '../extract.mjs';
import { utcDay } from '../util.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const FIXTURE_PLAYERS_DIR = join(here, 'players');
// The committed legacy snapshots the replay test (RP) reads: docs/data/snapshots.
export const LEGACY_SNAPSHOTS_DIR = join(here, '..', '..', '..', '..', 'docs', 'data', 'snapshots');

export const at = (iso) => Date.parse(iso);

// A fresh temp directory, removed when the test process exits.
const tmpDirs = [];
process.on('exit', () => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});
export function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'owr-pipeline-'));
  tmpDirs.push(dir);
  return dir;
}

export function loadFixture(playerId) {
  return JSON.parse(readFileSync(join(FIXTURE_PLAYERS_DIR, `${playerId}.json`), 'utf8'));
}

export const FIXTURE_PLAYERS = [
  'Kieness-6123', 'DarthKcaj-1443', 'KiwiCore-1324', 'Shotdownboyz-1119', 'Tones-11680', 'Lank-21912', 'Kiddo-11482',
];

// All seven fixture players as Samples fetched at `fetchedAt`. `tweak(id, body)`
// can edit a deep copy of a response first (to fake a later day's numbers).
export function fixtureSamples(fetchedAt, tweak = () => {}) {
  return FIXTURE_PLAYERS.map((id) => {
    const body = structuredClone(loadFixture(id));
    tweak(id, body);
    return extractSample(id, body, fetchedAt);
  });
}

// A complete all-heroes style career object with sensible defaults.
export function careerOf(over = {}) {
  return {
    eliminations: 100, deaths: 80, assists: 40, healingDone: null, healingPer10Min: null,
    gamesWon: 5, gamesPlayed: 10, winPercentage: null, timePlayed: 3600, ...over,
  };
}

// Builds a Sample by hand. `career` is the all-heroes override (or null for a
// private profile, or a full { hero: career } object when it has `all-heroes`).
export function makeSample(player, fetchedAt, { rankSeason = null, ranks, career, profile = null } = {}) {
  let careerObj;
  if (career === null) careerObj = null;
  else if (career && 'all-heroes' in career) careerObj = career;
  else careerObj = { 'all-heroes': careerOf(career ?? {}) };
  return {
    player,
    fetchedAt,
    day: utcDay(fetchedAt),
    rankSeason,
    ranks: ranks ?? (rankSeason == null ? [] : [{ role: 'damage', tier: 3, division: 'gold', season: rankSeason }]),
    profile,
    career: careerObj,
  };
}
