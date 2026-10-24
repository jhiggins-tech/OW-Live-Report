#!/usr/bin/env node
// Checks a docs/data tree written by the V3 pipeline before anything is
// committed: poll-stats.yml and backfill-history.yml run this after the poller
// and fail the job on any error, so a bad poll never reaches `main`.
//
//   node scripts/pipeline/validate.mjs --data-dir ../docs/data
//
// Errors (exit 1) are structural: layout version, files that don't parse,
// wrong row shapes, duplicate or unsorted rows, bad `day` values, season
// mismatches, a malformed snapshots/rank-icons.json (which is optional).
// Warnings are suspicious but not fatal: counters falling inside a season,
// very large files, roster players missing from profiles.json.
// Output uses GitHub's `::error::` / `::warning::` annotation syntax.
// See plan/v3-static-season-snapshots.md, "Failure handling".

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTER_FIELDS, GLOBAL_DATASETS, LAYOUT_VERSION, SEASON_DATASETS } from './constants.mjs';
import { ICON_TIER_KEYS, RANK_ICONS_FILE, isIconUrl } from './icons.mjs';
import { DAY_MS, compareBy, utcDay } from './util.mjs';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function typeOk(tag, v) {
  const nullable = tag.endsWith('?');
  if (v === null) return nullable;
  switch (nullable ? tag.slice(0, -1) : tag) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'int':
    case 'day': return Number.isInteger(v);
    default: return false;
  }
}

// Returns { errors, warnings } (arrays of single-line messages). `now` is only
// used for the "day is later than tomorrow" check.
export function validateDataDir(dataDir, { now = Date.now() } = {}) {
  const errors = [];
  const warnings = [];
  const error = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);
  const latestDay = utcDay(now) + DAY_MS;

  // Reads and parses a JSON file, reporting missing/corrupt files as errors.
  const readJson = (rel) => {
    const path = join(dataDir, rel);
    if (!existsSync(path)) {
      error(`${rel}: file is missing`);
      return null;
    }
    const size = statSync(path).size;
    if (size > MAX_FILE_BYTES) warn(`${rel}: ${(size / 1024 / 1024).toFixed(1)} MB is over the 5 MB guideline`);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      error(`${rel}: does not parse (${err.message})`);
      return null;
    }
  };

  // Validates one dataset file; returns its rows (possibly partly invalid) or null.
  const checkDataset = (rel, spec, season) => {
    const file = readJson(rel);
    if (!file) return null;
    if (!Number.isFinite(file.generatedAt)) error(`${rel}: header has no numeric generatedAt`);
    if (season !== undefined && file.season !== season) {
      error(`${rel}: header season ${JSON.stringify(file.season)} does not match its directory (${season})`);
    }
    if (!Array.isArray(file.rows)) {
      error(`${rel}: "rows" is not an array`);
      return null;
    }

    // One message per kind of problem per file (count + first example), so a
    // systematic bug doesn't print thousands of lines.
    const problems = new Map();
    const problem = (kind, detail) => {
      const p = problems.get(kind);
      if (p) p.count += 1;
      else problems.set(kind, { count: 1, first: detail });
    };
    const optional = new Set(spec.optional ?? []);
    const seen = new Set();
    const order = compareBy(spec.sort);
    let prev = null;
    file.rows.forEach((row, i) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        problem('rows that are not objects', `row ${i}`);
        return;
      }
      let shapeOk = true;
      for (const [field, tag] of Object.entries(spec.fields)) {
        if (!(field in row)) {
          if (!optional.has(field)) problem('rows missing a key', `row ${i} lacks "${field}"`);
          shapeOk = false;
        } else if (!typeOk(tag, row[field])) {
          problem('rows with a wrongly typed value', `row ${i} ${field}=${JSON.stringify(row[field])} is not ${tag}`);
          shapeOk = false;
        }
      }
      if (!shapeOk) return;

      const key = [...spec.series, ...(spec.kind === 'daily' ? ['day'] : [])].map((f) => row[f]).join('|');
      if (seen.has(key)) problem('duplicate keys', `row ${i} ${key}`);
      seen.add(key);
      if (prev && order(prev, row) > 0) problem('rows out of order', `row ${i} ${key}`);
      prev = row;

      if (spec.kind === 'daily') {
        if (row.day % DAY_MS !== 0) problem('days that are not UTC midnight', `row ${i} day=${row.day}`);
        else if (row.day > latestDay) problem('days later than tomorrow', `row ${i} day=${row.day}`);
      }
      if (spec.file === 'rank-daily' && season !== undefined && row.season !== season) {
        problem('rank rows whose season is not the directory', `row ${i} season=${row.season}`);
      }
      if (spec.file === 'career-hero-daily' && row.hero === 'all-heroes') {
        problem('all-heroes rows (they belong in career-daily)', `row ${i} ${key}`);
      }
    });
    for (const [kind, { count, first }] of problems) error(`${rel}: ${count} ${kind} (first: ${first})`);

    // Counters only go up within a season; a fall is worth a look, not a failure.
    if (spec.kind === 'daily') {
      const fields = Object.keys(spec.fields).filter((f) => COUNTER_FIELDS.includes(f));
      const last = new Map();
      let falls = 0;
      let firstFall = '';
      for (const row of file.rows) {
        if (row === null || typeof row !== 'object') continue;
        const key = spec.series.map((f) => row[f]).join('|');
        const before = last.get(key);
        if (before) {
          for (const f of fields) {
            if (typeof row[f] === 'number' && typeof before[f] === 'number' && row[f] < before[f]) {
              falls += 1;
              if (!firstFall) firstFall = `${key} ${f} ${before[f]}->${row[f]} on day ${row.day}`;
            }
          }
        }
        last.set(key, row);
      }
      if (falls > 0) warn(`${rel}: ${falls} counter values fall from one day to the next (first: ${firstFall})`);
    }
    return file.rows;
  };

  // --- meta.json -------------------------------------------------------------
  const meta = readJson('snapshots/meta.json');
  if (meta) {
    if (meta.layoutVersion !== LAYOUT_VERSION) {
      error(`snapshots/meta.json: layoutVersion is ${JSON.stringify(meta.layoutVersion)}, expected ${LAYOUT_VERSION}`);
    }
    if (meta.currentSeason !== null && !Number.isInteger(meta.currentSeason)) {
      error(`snapshots/meta.json: currentSeason ${JSON.stringify(meta.currentSeason)} is neither an integer nor null`);
    }
    if (!Array.isArray(meta.lastPoll?.ok) || meta.lastPoll.ok.length === 0) {
      error('snapshots/meta.json: lastPoll.ok is empty, so no player was fetched successfully');
    }
  }

  // --- pipeline/state.json -----------------------------------------------------
  const state = readJson('pipeline/state.json');
  if (state && (state.version !== 1 || typeof state.players !== 'object' || state.players === null)) {
    error('pipeline/state.json: unsupported state (expected version 1 with a players object)');
  }

  // --- global files ------------------------------------------------------------
  const profileRows = checkDataset('snapshots/profiles.json', GLOBAL_DATASETS.profiles, undefined);
  checkDataset('snapshots/rank-current.json', GLOBAL_DATASETS.rankCurrent, undefined);
  if (profileRows && Array.isArray(meta?.players)) {
    const have = new Set(profileRows.map((r) => r?.player));
    for (const player of meta.players) {
      if (!have.has(player)) warn(`snapshots/profiles.json: roster player ${player} has no profile yet`);
    }
  }

  // --- rank-icons.json (optional: legacy trees and fresh stores don't have it) ---
  if (existsSync(join(dataDir, RANK_ICONS_FILE))) {
    const icons = readJson(RANK_ICONS_FILE);
    const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (icons) {
      if (!Number.isFinite(icons.generatedAt)) error(`${RANK_ICONS_FILE}: no numeric generatedAt`);
      for (const kind of ['divisions', 'tiers']) {
        if (!isObject(icons[kind])) {
          error(`${RANK_ICONS_FILE}: "${kind}" is not an object`);
          continue;
        }
        for (const [key, entry] of Object.entries(icons[kind])) {
          const at = `${RANK_ICONS_FILE}: ${kind}.${key}`;
          if (kind === 'divisions' && (key === '' || key !== key.toLowerCase())) error(`${at}: division keys must be lower case`);
          if (kind === 'tiers' && !ICON_TIER_KEYS.includes(key)) error(`${at}: tier keys must be "1" to "5"`);
          if (!isObject(entry)) {
            error(`${at}: is not { url, season }`);
            continue;
          }
          if (!isIconUrl(entry.url)) error(`${at}: url ${JSON.stringify(entry.url)} is not an https:// URL`);
          if (!Number.isInteger(entry.season)) error(`${at}: season ${JSON.stringify(entry.season)} is not an integer`);
        }
      }
    }
  }

  // --- season directories --------------------------------------------------------
  const seasonsDir = join(dataDir, 'seasons');
  const dirSeasons = [];
  if (existsSync(seasonsDir)) {
    for (const entry of readdirSync(seasonsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) dirSeasons.push(Number(entry.name));
      else warn(`seasons/${entry.name}: unexpected entry`);
    }
  }
  dirSeasons.sort((a, b) => a - b);

  const spans = new Map();
  for (const season of dirSeasons) {
    let first = Infinity;
    let last = -Infinity;
    for (const [name, spec] of Object.entries(SEASON_DATASETS)) {
      const rows = checkDataset(`seasons/${season}/${spec.file}.json`, spec, season);
      if (!rows || name === 'careerLatest') continue;
      for (const row of rows) {
        if (!Number.isFinite(row?.day)) continue;
        if (row.day < first) first = row.day;
        if (row.day > last) last = row.day;
      }
    }
    if (first !== Infinity) spans.set(season, { firstDay: first, lastDay: last });
  }

  // meta.seasons[] must describe exactly the directories that exist.
  if (meta) {
    const listed = Array.isArray(meta.seasons) ? meta.seasons : null;
    if (!listed) {
      error('snapshots/meta.json: seasons is not an array');
    } else {
      const listedNumbers = listed.map((s) => s?.season);
      if (JSON.stringify(listedNumbers) !== JSON.stringify(dirSeasons)) {
        error(`snapshots/meta.json: seasons [${listedNumbers.join(', ')}] does not match the season directories [${dirSeasons.join(', ')}]`);
      } else {
        for (const entry of listed) {
          const span = spans.get(entry.season);
          if (span && (entry.firstDay !== span.firstDay || entry.lastDay !== span.lastDay)) {
            error(`snapshots/meta.json: season ${entry.season} spans ${entry.firstDay}..${entry.lastDay}, but its files span ${span.firstDay}..${span.lastDay}`);
          }
        }
      }
    }
  }
  return { errors, warnings };
}

// --- CLI ---------------------------------------------------------------------

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const i = args.indexOf('--data-dir');
  const dataDir = resolve(process.cwd(), i >= 0 && args[i + 1] ? args[i + 1] : join(here, '..', '..', '..', 'docs', 'data'));

  const { errors, warnings } = validateDataDir(dataDir);
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`validate: ${errors.length} error(s), ${warnings.length} warning(s) in ${dataDir}`);
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
