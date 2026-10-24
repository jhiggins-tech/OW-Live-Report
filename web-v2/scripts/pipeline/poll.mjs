#!/usr/bin/env node
// The V3 poller. .github/workflows/poll-stats.yml runs this twice a day (and on
// demand): fetch every rostered player from OverFast, extract a Sample from
// each response, assign seasons and compact the samples into the daily
// roll-ups under docs/data/, then bake meta.json. validate.mjs runs next, and
// the workflow commits the result.
//
//   node scripts/pipeline/poll.mjs --data-dir ../docs/data --raw-dir ../poll-raw
//
// Flags: --data-dir, --roster, --raw-dir (keep each response body, for the
// debugging artifact), --fixtures <dir> (read <dir>/<playerId>.json instead of
// the network), --now <ISO> (tests only), --force-season N (or FORCE_SEASON in
// the environment; blank means unset).
//
// Exit 1, with nothing written to the data dir, when every fetch failed or when
// no response carries any career or rank data (probably an OverFast schema
// change). A partial failure ingests the players that worked and records the
// rest in meta.lastPoll.failed. See plan/v3-static-season-snapshots.md,
// "1. Poll" and "Failure handling".

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractSample } from './extract.mjs';
import { buildMeta } from './meta.mjs';
import { defaultSleep, fetchPlayer } from './overfast.mjs';
import { loadRoster } from './roster.mjs';
import { ingestPoll } from './rollup.mjs';
import { loadStore, saveStore } from './store.mjs';

// web-v2/scripts/pipeline -> repo root.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_DATA_DIR = join(repoRoot, 'docs', 'data');
export const DEFAULT_ROSTER = join(repoRoot, 'config', 'tracked-battletags.txt');

// OverFast is a free community API: one request at a time, a second apart.
const PAUSE_MS = 1_000;

const FLAGS = {
  '--data-dir': 'dataDir',
  '--roster': 'roster',
  '--raw-dir': 'rawDir',
  '--fixtures': 'fixtures',
  '--now': 'now',
  '--force-season': 'forceSeason',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    let flag = argv[i];
    let value;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const key = FLAGS[flag];
    if (!key) throw new Error(`Unknown argument ${argv[i]} (expected ${Object.keys(FLAGS).join(', ')})`);
    if (value === undefined) {
      i += 1;
      value = argv[i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    }
    args[key] = value;
  }
  return args;
}

function parseForceSeason(args, env) {
  const raw = (args.forceSeason || env.FORCE_SEASON || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid force season "${raw}" (expected a positive integer)`);
  return n;
}

function parseNow(raw) {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`Invalid --now "${raw}" (expected an ISO timestamp)`);
  return ms;
}

// Offline mode: the same result shape fetchPlayer returns.
function readFixture(dir, playerId) {
  const path = join(dir, `${playerId}.json`);
  if (!existsSync(path)) return { ok: false, status: null, error: `fixture not found: ${path}` };
  try {
    return { ok: true, status: 200, body: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    return { ok: false, status: null, error: `fixture is not valid JSON: ${err.message}` };
  }
}

// GitHub annotations are single-line.
const annotation = (level, message) => `::${level}::${String(message).replace(/\r?\n/g, ' ')}`;

function textTable(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  const line = (r) => r.map((cell, c) => String(cell).padEnd(widths[c])).join(' | ').trimEnd();
  return [line(rows[0]), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.slice(1).map(line)];
}

const mdCell = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// The same table as markdown, for the job summary page.
function markdownReport({ title, headline, rows, written, unchanged }) {
  const lines = [`### ${title}`, '', headline, '', '| player | status | season | reason |', '|---|---|---|---|'];
  for (const r of rows.slice(1)) lines.push(`| ${r.map(mdCell).join(' | ')} |`);
  if (written) {
    lines.push('', `**Files written (${written.length})**, ${unchanged.length} unchanged:`, '');
    for (const f of written) lines.push(`- \`${f}\``);
  }
  return `${lines.join('\n')}\n`;
}

async function poll(argv, { fetchImpl, sleep, env, out }) {
  const args = parseArgs(argv);
  const dataDir = resolve(args.dataDir ?? DEFAULT_DATA_DIR);
  const rosterPath = resolve(args.roster ?? DEFAULT_ROSTER);
  const rawDir = args.rawDir ? resolve(args.rawDir) : null;
  const fixturesDir = args.fixtures ? resolve(args.fixtures) : null;
  const forceSeason = parseForceSeason(args, env);
  const fixedNow = args.now === undefined ? null : parseNow(args.now);
  const startedAt = fixedNow ?? Date.now();

  // A BattleTag listed twice would be ingested twice; keep the first.
  const ids = [...new Set(loadRoster(rosterPath).map((p) => p.playerId))];
  if (ids.length === 0) throw new Error(`No players found in ${rosterPath}`);

  // --- 1. fetch, one player at a time --------------------------------------
  const rows = [['player', 'status', 'season', 'reason']];
  const rowOf = new Map(); // playerId -> its row in `rows`
  const setRow = (id, status, season, reason) => {
    const row = [id, status, season, reason];
    const index = rowOf.get(id);
    if (index === undefined) {
      rowOf.set(id, rows.length);
      rows.push(row);
    } else {
      rows[index] = row;
    }
  };

  const samples = [];
  const failed = [];
  if (rawDir) mkdirSync(rawDir, { recursive: true });
  const onRetry = ({ playerId, attempt, delayMs, reason }) => {
    out(`${playerId}: ${reason}; retry ${attempt} in ${delayMs / 1000}s`);
  };
  for (const [i, id] of ids.entries()) {
    if (!fixturesDir && i > 0) await sleep(PAUSE_MS);
    const result = fixturesDir
      ? readFixture(fixturesDir, id)
      : await fetchPlayer(id, { baseUrl: env.OVERFAST_BASE_URL, fetchImpl, sleep, onRetry });
    if (!result.ok) {
      failed.push({ player: id, error: result.error });
      setRow(id, 'failed', '-', result.error);
      out(annotation('warning', `${id}: fetch failed: ${result.error}`));
      continue;
    }
    if (rawDir) writeFileSync(join(rawDir, `${id}.json`), `${JSON.stringify(result.body)}\n`);
    // Every sample of a poll shares one timestamp, so a poll can never
    // straddle a UTC day boundary.
    samples.push(extractSample(id, result.body, startedAt));
    setRow(id, 'ok', '-', '');
  }

  // The step summary and the log get the same table. Failures to write the
  // summary must not fail a poll whose data is already saved.
  const report = ({ headline, written, unchanged }) => {
    const title = `OverFast poll ${new Date(startedAt).toISOString().replace(/\.\d+Z$/, 'Z')}`;
    out('');
    out(headline);
    for (const line of textTable(rows)) out(line);
    if (written) {
      out('');
      out(`Files written (${written.length}), ${unchanged.length} unchanged:`);
      for (const f of written) out(`  ${f}`);
    }
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdownReport({ title, headline, rows, written, unchanged })}\n`);
      } catch (err) {
        out(annotation('warning', `Could not write the job summary: ${err.message}`));
      }
    }
  };

  // --- 2. refuse to write anything from a bad poll -------------------------
  if (samples.length === 0) {
    out(annotation('error', `All ${ids.length} players failed to fetch; nothing was written`));
    report({ headline: `0 of ${ids.length} players fetched` });
    return 1;
  }
  if (samples.every((s) => s.career === null && s.ranks.length === 0)) {
    for (const s of samples) setRow(s.player, 'empty', '-', 'no career stats and no ranks');
    out(annotation('error', 'No response has career stats or ranks; OverFast probably changed its schema. Nothing was written'));
    report({ headline: `${samples.length} of ${ids.length} players fetched, none usable` });
    return 1;
  }

  // --- 3. ingest, bake, save -----------------------------------------------
  // `now` is when the poll finished (meta.generatedAt drives the stale banner).
  const now = fixedNow ?? Date.now();
  const store = loadStore(dataDir);
  const { assignments, currentSeason, warnings } = ingestPoll(store, samples, { now, forceSeason });
  for (const w of warnings) out(annotation('warning', w.message));
  for (const a of assignments) setRow(a.player, 'ok', a.season, a.reason);

  const lastPoll = { at: now, source: 'poll', ok: samples.map((s) => s.player), failed };
  buildMeta(store, { now, players: ids, lastPoll });
  const { written, unchanged } = saveStore(store, dataDir);

  report({
    headline: `${samples.length} of ${ids.length} players fetched; current season ${currentSeason}`,
    written,
    unchanged,
  });
  return 0;
}

// Runs one poll and resolves to the process exit code. Everything the CLI
// touches from outside is injectable (fetch, sleep, environment, output), so
// the tests drive it in-process.
export async function runPoll(argv, { fetchImpl, sleep = defaultSleep, env = process.env, stdout = process.stdout } = {}) {
  const out = (line = '') => stdout.write(`${line}\n`);
  try {
    return await poll(argv, { fetchImpl, sleep, env, out });
  } catch (err) {
    out(annotation('error', err.message));
    if (env.RUNNER_DEBUG === '1') out(err.stack);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPoll(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
