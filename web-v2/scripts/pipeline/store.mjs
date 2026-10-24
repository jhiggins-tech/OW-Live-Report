// The in-memory data store plus its deterministic file reader/writer. All of
// the pipeline's file I/O lives here (and in the CLIs), so the library modules
// stay pure. The on-disk layout and row format are specified in
// plan/v3-static-season-snapshots.md, "Data contract":
//
//   <dataDir>/snapshots/{meta,rank-current,profiles}.json   global "now" files
//   <dataDir>/snapshots/rank-icons.json                     rank insignia URLs (icons.mjs)
//   <dataDir>/seasons/<N>/{rank-daily,career-daily,career-hero-daily,career-latest}.json
//   <dataDir>/pipeline/state.json                           the poller's memory
//
// Dataset files are valid JSON written one row per line, in a fixed key and
// row order, and a file is only rewritten when its rows change, so git diffs
// show exactly what moved and frozen seasons never churn.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GLOBAL_DATASETS, SEASON_DATASETS } from './constants.mjs';
import {
  RANK_ICONS_FILE, emptyRankIcons, parseRankIcons, rankIconCount, renderRankIcons,
} from './icons.mjs';
import { compareBy } from './util.mjs';

const STATE_VERSION = 1;

export function emptyState() {
  return { version: STATE_VERSION, currentSeason: null, currentSeasonDetectedAt: null, players: {} };
}

function emptyBucket() {
  // daily datasets: Map<seriesKey, Map<day, row>>; career-latest: Map<seriesKey, row>.
  return { rankDaily: new Map(), careerDaily: new Map(), careerHeroDaily: new Map(), careerLatest: new Map() };
}

export function emptyStore() {
  const store = {
    state: emptyState(),
    previousMeta: null, // the meta.json that was loaded, if any
    meta: null, // set by buildMeta(); saveStore writes it
    lastIngestAt: null, // newest `now` ingestPoll has seen; stamps changed files
    rankCurrent: new Map(), // `${player}|${role}` -> RankRow
    profiles: new Map(), // player -> ProfileRow
    rankIcons: emptyRankIcons(), // division name / number -> insignia URL (icons.mjs)
    seasons: new Map(), // season -> bucket
    bucket(n) {
      let b = store.seasons.get(n);
      if (!b) {
        b = emptyBucket();
        store.seasons.set(n, b);
      }
      return b;
    },
  };
  return store;
}

// --- rows <-> maps -----------------------------------------------------------

const seriesKey = (spec, row) => spec.series.map((f) => row[f]).join('|');

// Copy a row into the dataset's on-disk key order (undefined becomes null).
function project(spec, row) {
  const out = {};
  for (const f of Object.keys(spec.fields)) out[f] = row[f] === undefined ? null : row[f];
  return out;
}

function putRow(spec, map, row) {
  const key = seriesKey(spec, row);
  if (spec.kind === 'daily') {
    let days = map.get(key);
    if (!days) {
      days = new Map();
      map.set(key, days);
    }
    days.set(row.day, row);
  } else {
    map.set(key, row);
  }
}

// Every row of a dataset map, projected and in on-disk order.
export function mapRows(spec, map) {
  const rows = spec.kind === 'daily'
    ? [...map.values()].flatMap((days) => [...days.values()])
    : [...map.values()];
  return rows.map((r) => project(spec, r)).sort(compareBy(spec.sort));
}

// Sorted rows of one season dataset ('rankDaily' | 'careerDaily' |
// 'careerHeroDaily' | 'careerLatest'); [] when the season has no bucket.
export function seasonRows(store, season, dataset) {
  const b = store.seasons.get(season);
  return b ? mapRows(SEASON_DATASETS[dataset], b[dataset]) : [];
}

// Sorted rows of a global dataset ('rankCurrent' | 'profiles').
export function globalRows(store, dataset) {
  return mapRows(GLOBAL_DATASETS[dataset], store[dataset]);
}

// Row counts per dataset for one season, for summaries.
export function seasonCounts(store, season) {
  const out = {};
  for (const name of Object.keys(SEASON_DATASETS)) out[name] = seasonRows(store, season, name).length;
  return out;
}

const bucketIsEmpty = (b) => Object.keys(SEASON_DATASETS).every((name) => b[name].size === 0);

// Seasons that have at least one row, ascending.
export function nonEmptySeasons(store) {
  return [...store.seasons].filter(([, b]) => !bucketIsEmpty(b)).map(([n]) => n).sort((a, b) => a - b);
}

// --- reading -----------------------------------------------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    // Never treat a corrupt file as empty: the next save would overwrite the
    // history it was holding.
    throw new Error(`Cannot read ${path}: ${err.message}`);
  }
}

function readRows(path) {
  if (!existsSync(path)) return [];
  const rows = readJson(path)?.rows;
  if (!Array.isArray(rows)) throw new Error(`Cannot read ${path}: no "rows" array`);
  return rows;
}

// Reads the data tree. A missing or empty tree gives an empty store (and no
// rank-icons.json, which is optional). Legacy flat files in snapshots/
// (rank-daily.json, career-*.json) are ignored.
export function loadStore(dataDir) {
  const store = emptyStore();

  const statePath = join(dataDir, 'pipeline', 'state.json');
  if (existsSync(statePath)) {
    const raw = readJson(statePath);
    if (raw?.version !== STATE_VERSION || typeof raw.players !== 'object' || raw.players === null) {
      throw new Error(`Cannot read ${statePath}: unsupported state (expected version ${STATE_VERSION})`);
    }
    store.state = {
      version: STATE_VERSION,
      currentSeason: raw.currentSeason ?? null,
      currentSeasonDetectedAt: raw.currentSeasonDetectedAt ?? null,
      players: raw.players,
    };
  }

  const metaPath = join(dataDir, 'snapshots', 'meta.json');
  if (existsSync(metaPath)) store.previousMeta = readJson(metaPath);

  for (const [name, spec] of Object.entries(GLOBAL_DATASETS)) {
    for (const row of readRows(join(dataDir, 'snapshots', `${spec.file}.json`))) putRow(spec, store[name], row);
  }

  const iconsPath = join(dataDir, RANK_ICONS_FILE);
  if (existsSync(iconsPath)) store.rankIcons = parseRankIcons(readJson(iconsPath), iconsPath);

  const seasonsDir = join(dataDir, 'seasons');
  if (existsSync(seasonsDir)) {
    for (const entry of readdirSync(seasonsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const bucket = store.bucket(Number(entry.name));
      for (const [name, spec] of Object.entries(SEASON_DATASETS)) {
        for (const row of readRows(join(seasonsDir, entry.name, `${spec.file}.json`))) putRow(spec, bucket[name], row);
      }
    }
  }
  return store;
}

// --- writing -----------------------------------------------------------------

// `{"season":25,"generatedAt":…,"rows":[` / one row per line / `]}`.
// Global files pass season = undefined and get no "season" key.
export function renderFile({ season, generatedAt }, rows) {
  const head = season === undefined
    ? `{"generatedAt":${generatedAt},"rows":[`
    : `{"season":${season},"generatedAt":${generatedAt},"rows":[`;
  if (rows.length === 0) return `${head}]}\n`;
  return `${head}\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function normalizeState(state) {
  const players = {};
  for (const id of Object.keys(state.players).sort()) {
    const p = state.players[id];
    players[id] = { season: p.season, lastFetchedAt: p.lastFetchedAt, lastReason: p.lastReason };
  }
  return {
    version: STATE_VERSION,
    currentSeason: state.currentSeason ?? null,
    currentSeasonDetectedAt: state.currentSeasonDetectedAt ?? null,
    players,
  };
}

// Writes the data tree and returns { written, unchanged } (paths relative to
// dataDir). A dataset file is rewritten only when its rows differ from what is
// on disk, and then stamped with the time of this ingest; meta.json (the
// buildMeta() result, else the meta that was loaded) is written every time.
// `meta` can be passed explicitly instead of relying on buildMeta() having
// attached it to the store.
export function saveStore(store, dataDir, meta = store.meta ?? store.previousMeta) {
  const written = [];
  const unchanged = [];
  const generatedAt = store.lastIngestAt ?? meta?.generatedAt ?? Date.now();

  // `render(generatedAt)` gives the file's text. The file is left alone when
  // that text, rendered with the generatedAt already on disk, is what's there.
  const saveRendered = (rel, render) => {
    const path = join(dataDir, rel);
    const current = readText(path);
    if (current !== null) {
      let parsed = null;
      try {
        parsed = JSON.parse(current);
      } catch {
        // Unparseable: fall through and rewrite.
      }
      if (Number.isFinite(parsed?.generatedAt) && render(parsed.generatedAt) === current) {
        unchanged.push(rel);
        return;
      }
    }
    writeText(path, render(generatedAt));
    written.push(rel);
  };
  const saveDataset = (rel, season, rows) => saveRendered(rel, (at) => renderFile({ season, generatedAt: at }, rows));

  for (const season of nonEmptySeasons(store)) {
    for (const [name, spec] of Object.entries(SEASON_DATASETS)) {
      saveDataset(`seasons/${season}/${spec.file}.json`, season, seasonRows(store, season, name));
    }
  }
  for (const [name, spec] of Object.entries(GLOBAL_DATASETS)) {
    saveDataset(`snapshots/${spec.file}.json`, undefined, globalRows(store, name));
  }

  // Optional: nothing is written until a poll has captured at least one URL.
  if (rankIconCount(store.rankIcons) > 0) {
    saveRendered(RANK_ICONS_FILE, (at) => renderRankIcons(store.rankIcons, at));
  }

  const stateRel = 'pipeline/state.json';
  const stateText = `${JSON.stringify(normalizeState(store.state), null, 2)}\n`;
  if (readText(join(dataDir, stateRel)) === stateText) {
    unchanged.push(stateRel);
  } else {
    writeText(join(dataDir, stateRel), stateText);
    written.push(stateRel);
  }

  if (meta) {
    const metaRel = 'snapshots/meta.json';
    writeText(join(dataDir, metaRel), `${JSON.stringify(meta, null, 2)}\n`);
    written.push(metaRel);
  }
  return { written, unchanged };
}
