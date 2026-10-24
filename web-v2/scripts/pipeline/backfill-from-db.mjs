#!/usr/bin/env node
// One-shot history backfill for the V3 pipeline. Before the TimescaleDB stats
// backend is retired, its full daily history is replayed through the same
// season-assignment and compaction code the live poller uses (ingestPoll), so
// docs/data/seasons/<N>/ starts out with every past season already in place.
// Runs once, by hand or from .github/workflows/backfill-history.yml (a
// workflow_dispatch job), and the script is deleted along with the backend.
//
//   node scripts/pipeline/backfill-from-db.mjs --data-dir ../docs/data --force
//   node scripts/pipeline/backfill-from-db.mjs --data-dir /tmp/v2 \
//     --from-snapshots ../docs/data/snapshots
//
// Two sources:
//   db (default)      reads ow_stats_daily over the Postgres wire protocol, 14
//                     days at a time (the server enforces a 15 s statement
//                     timeout), and pivots the narrow rows into one Sample per
//                     (player, day), the same shape extractSample() produces.
//   --from-snapshots  reads the legacy flat files baked from that table
//                     (docs/data/snapshots/{rank,career,career-hero}-daily.json,
//                     ~120 days) through replay.mjs. Offline; also what the
//                     tests run.
// Every input is read before anything is written, so --from-snapshots may
// point at <data-dir>/snapshots itself. The legacy flat files are left alone.
// See plan/v3-static-season-snapshots.md, "WP3".

import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMEMODE, PLATFORM, ROLES } from './constants.mjs';
import { buildMeta } from './meta.mjs';
import { legacySamplesByDay, loadLegacySnapshots, replayDays } from './replay.mjs';
import { loadRoster } from './roster.mjs';
import { emptyStore, saveStore, seasonCounts, seasonRows } from './store.mjs';
import { DAY_MS, isoDay, toNumber, utcDay } from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const DEFAULT_ROSTER = resolve(here, '..', '..', '..', 'config', 'tracked-battletags.txt');
const DEFAULT_DB_URL = 'postgresql://readonly:owstats-readonly@owstats.jhiggins.tech:5432/ow_stats?sslmode=require';

const HALF_DAY_MS = 12 * 60 * 60 * 1000;
// The server enforces a 15 s statement timeout; a fortnight of the daily table
// for the roster is comfortably inside it.
const WINDOW_DAYS = 14;
// How far the daily table is scanned for "latest" values of series that fell
// out of the 14-day raw retention (same as fetch-snapshots.mjs).
const LATEST_FALLBACK_WINDOW = '200 days';

// [metric, Sample field, canonical measurement]. Order = Sample field order, as
// in extract.mjs. Each metric is read from its own measurement first, then
// from any of the four (OverFast has moved stats between categories before).
const CAREER_METRICS = [
  ['eliminations', 'eliminations', 'career_stats_combat'],
  ['deaths', 'deaths', 'career_stats_combat'],
  ['assists', 'assists', 'career_stats_assists'],
  ['healing_done', 'healingDone', 'career_stats_assists'],
  ['healing_done_avg_per_10_min', 'healingPer10Min', 'career_stats_average'],
  ['games_won', 'gamesWon', 'career_stats_game'],
  ['games_played', 'gamesPlayed', 'career_stats_game'],
  ['win_percentage', 'winPercentage', 'career_stats_game'],
  ['time_played', 'timePlayed', 'career_stats_game'],
];
const CAREER_BY_METRIC = new Map(CAREER_METRICS.map(([metric, field, measurement]) => [metric, { field, measurement }]));
const CAREER_FIELDS_IN_ORDER = CAREER_METRICS.map(([, field]) => field);
const RANK_METRICS = ['tier', 'division', 'season'];

// --- SQL (one statement per 14-day window) ------------------------------------

const MIN_DAY_SQL = 'SELECT min(day) AS min_day FROM ow_stats_daily';

const RANK_WINDOW_SQL = `
  SELECT player, role, metric, value, value_text, day
  FROM ow_stats_daily
  WHERE measurement = 'competitive_rank' AND player = ANY($1)
    AND metric = ANY($2) AND day >= $3 AND day < $4
  ORDER BY day`;

const CAREER_WINDOW_SQL = `
  SELECT player, hero, measurement, metric, value, day
  FROM ow_stats_daily
  WHERE measurement IN ('career_stats_combat', 'career_stats_assists', 'career_stats_average', 'career_stats_game')
    AND gamemode = $2 AND platform = $3 AND player = ANY($1)
    AND metric = ANY($4) AND day >= $5 AND day < $6
  ORDER BY day`;

// --- arguments ----------------------------------------------------------------

const USAGE = 'usage: backfill-from-db.mjs --data-dir <dir> [--force] [--from-snapshots <dir>] [--initial-season N] [--roster <file>]';

export function parseArgs(argv) {
  const out = { dataDir: null, force: false, fromSnapshots: null, initialSeason: null, roster: DEFAULT_ROSTER };
  const value = (i, flag) => {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value\n${USAGE}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      out.force = true;
    } else if (arg === '--data-dir') {
      out.dataDir = resolve(process.cwd(), value(i, arg));
      i += 1;
    } else if (arg === '--from-snapshots') {
      out.fromSnapshots = resolve(process.cwd(), value(i, arg));
      i += 1;
    } else if (arg === '--roster') {
      out.roster = resolve(process.cwd(), value(i, arg));
      i += 1;
    } else if (arg === '--initial-season') {
      const n = Number(value(i, arg));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--initial-season must be a positive integer\n${USAGE}`);
      out.initialSeason = n;
      i += 1;
    } else {
      throw new Error(`unknown argument ${arg}\n${USAGE}`);
    }
  }
  if (!out.dataDir) throw new Error(`--data-dir is required\n${USAGE}`);
  return out;
}

// --- DB source: narrow rows -> Samples ------------------------------------------

// pg returns timestamptz as Date; accept epoch numbers and ISO strings too.
const ms = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isFinite(n) ? n : Date.parse(v);
};
const num = (v) => (v === null || v === undefined ? null : Number(v));
const dayOf = (v) => {
  const t = ms(v);
  return t === null || Number.isNaN(t) ? null : utcDay(t);
};
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Consecutive [from, to) windows of `days` days from `startDay` (a UTC
// midnight) until one covers `endMs`. Day-aligned, so one day's rows never
// straddle two windows.
export function dayWindows(startDay, endMs, days = WINDOW_DAYS) {
  const out = [];
  for (let from = startDay; from <= endMs; from += days * DAY_MS) out.push({ from, to: from + days * DAY_MS });
  return out;
}

// History accumulates across windows as Map<day, Map<player, entry>>, where an
// entry is { ranks: Map<role, {tier, division, season}>, heroes: Map<hero, fields> }.
export function createHistory() {
  return new Map();
}

function entryFor(history, day, player) {
  let players = history.get(day);
  if (!players) {
    players = new Map();
    history.set(day, players);
  }
  let entry = players.get(player);
  if (!entry) {
    entry = { ranks: new Map(), heroes: new Map() };
    players.set(player, entry);
  }
  return entry;
}

// Rows of measurement competitive_rank: (player, role, metric, value,
// value_text, day), one row per metric.
export function addRankRows(history, rows) {
  for (const r of rows) {
    const day = dayOf(r.day);
    if (day === null || !r.player || !r.role) continue;
    const { ranks } = entryFor(history, day, r.player);
    const rank = ranks.get(r.role) ?? { tier: null, division: null, season: null };
    ranks.set(r.role, rank);
    if (r.metric === 'tier') rank.tier = toNumber(r.value);
    else if (r.metric === 'division') rank.division = typeof r.value_text === 'string' && r.value_text !== '' ? r.value_text : null;
    else if (r.metric === 'season') rank.season = toNumber(r.value);
  }
}

// Rows of the career_stats_* measurements: (player, hero, measurement, metric,
// value, day), one row per metric.
export function addCareerRows(history, rows) {
  for (const r of rows) {
    const spec = CAREER_BY_METRIC.get(r.metric);
    const day = dayOf(r.day);
    const value = toNumber(r.value);
    if (!spec || day === null || value === null || !r.player || !r.hero) continue;
    const { heroes } = entryFor(history, day, r.player);
    let fields = heroes.get(r.hero);
    if (!fields) {
      fields = Object.fromEntries(CAREER_FIELDS_IN_ORDER.map((f) => [f, null]));
      heroes.set(r.hero, fields);
    }
    // The canonical measurement wins; another one only fills a gap.
    if (fields[spec.field] === null || r.measurement === spec.measurement) fields[spec.field] = value;
  }
}

const roleOrder = (role) => {
  const i = ROLES.indexOf(role);
  return i === -1 ? ROLES.length : i;
};

// One Sample per (player, day) in ascending day order: [[day, Sample[]], ...],
// the shape replayDays() takes. Mirrors extractSample(): a role without a tier
// and division is skipped, rankSeason is the highest non-null season, career
// is null without any stats, and a (player, day) with neither ranks nor career
// is dropped. fetchedAt = day + 12h and profile is null (profiles are set once
// at the end).
export function historyToSamples(history) {
  const out = [];
  for (const [day, players] of [...history].sort(([a], [b]) => a - b)) {
    const samples = [];
    for (const [player, entry] of [...players].sort(([a], [b]) => byString(a, b))) {
      const ranks = [...entry.ranks]
        .filter(([, r]) => r.tier !== null && r.division !== null)
        .map(([role, r]) => ({ role, tier: r.tier, division: r.division, season: r.season }))
        .sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || byString(a.role, b.role));
      const heroes = [...entry.heroes]
        .filter(([, fields]) => CAREER_FIELDS_IN_ORDER.some((f) => fields[f] !== null))
        .sort(([a], [b]) => byString(a, b));
      const career = heroes.length ? Object.fromEntries(heroes) : null;
      if (!ranks.length && !career) continue;
      const seasons = ranks.map((r) => r.season).filter((s) => s !== null);
      samples.push({
        player,
        fetchedAt: day + HALF_DAY_MS,
        day,
        rankSeason: seasons.length ? Math.max(...seasons) : null,
        ranks,
        profile: null,
        career,
      });
    }
    if (samples.length) out.push([day, samples]);
  }
  return out;
}

// --- DB source: latest-per-series readers (copied from fetch-snapshots.mjs) ---------

// Latest (value, value_text, time) per grouping key, raw table first with a
// daily-table fallback for series with nothing in the raw retention window.
async function latestRows(client, { measurementFilter, metricList, players, gamemode, groupCols }) {
  const cols = groupCols.join(', ');
  const gamemodeSql = gamemode ? 'AND gamemode = $3' : '';
  const params = gamemode ? [players, metricList, gamemode] : [players, metricList];

  const rawQ = `
    SELECT DISTINCT ON (${cols}, measurement, metric)
      ${cols}, measurement, metric, value, value_text, time
    FROM ow_stats
    WHERE ${measurementFilter} AND player = ANY($1) AND metric = ANY($2) ${gamemodeSql}
    ORDER BY ${cols}, measurement, metric, time DESC`;
  const dailyQ = `
    SELECT DISTINCT ON (${cols}, measurement, metric)
      ${cols}, measurement, metric, value, value_text, day AS time
    FROM ow_stats_daily
    WHERE ${measurementFilter} AND player = ANY($1) AND metric = ANY($2) ${gamemodeSql}
      AND day > now() - interval '${LATEST_FALLBACK_WINDOW}'
    ORDER BY ${cols}, measurement, metric, day DESC`;

  const raw = await client.query(rawQ, params);
  const daily = await client.query(dailyQ, params);

  const byKey = new Map();
  const keyOf = (r) => [...groupCols.map((c) => r[c]), r.measurement, r.metric].join(' ');
  for (const r of daily.rows) byKey.set(keyOf(r), r);
  for (const r of raw.rows) byKey.set(keyOf(r), r); // raw wins: always fresher when present
  return [...byKey.values()];
}

// Pivots metric-per-row output into one object per grouping key.
function pivotLatest(rows, groupCols, assign) {
  const byKey = new Map();
  for (const r of rows) {
    const key = groupCols.map((c) => r[c]).join(' ');
    let obj = byKey.get(key);
    if (!obj) {
      obj = { time: 0 };
      for (const c of groupCols) obj[c] = r[c];
      byKey.set(key, obj);
    }
    assign(obj, r);
    const t = ms(r.time);
    if (t !== null && t > obj.time) obj.time = t;
  }
  return [...byKey.values()];
}

const PROFILE_FIELD_BY_METRIC = {
  username: ['username', 'text'],
  avatar: ['avatar', 'text'],
  namecard: ['namecard', 'text'],
  title: ['title', 'text'],
  endorsement_frame: ['endorsementFrame', 'text'],
  endorsement_level: ['endorsementLevel', 'number'],
};

async function fetchProfiles(client, players) {
  const rows = await latestRows(client, {
    measurementFilter: "measurement = 'player_summary'",
    metricList: Object.keys(PROFILE_FIELD_BY_METRIC),
    players,
    groupCols: ['player'],
  });
  return pivotLatest(rows, ['player'], (obj, r) => {
    const spec = PROFILE_FIELD_BY_METRIC[r.metric];
    if (!spec) return;
    const [field, kind] = spec;
    obj[field] = kind === 'number' ? num(r.value) : r.value_text ?? null;
  }).map((o) => ({
    player: o.player,
    time: o.time,
    username: o.username ?? null,
    avatar: o.avatar ?? null,
    namecard: o.namecard ?? null,
    title: o.title ?? null,
    endorsementLevel: o.endorsementLevel ?? null,
    endorsementFrame: o.endorsementFrame ?? null,
    lastUpdatedAt: null, // not in the DB; the live poller fills it in
  }));
}

// The DB's latest all-heroes games_played per player, for the cross-check.
async function fetchLatestGamesPlayed(client, players) {
  const rows = await latestRows(client, {
    measurementFilter: "measurement = 'career_stats_game' AND hero = 'all-heroes' AND platform = 'pc'",
    metricList: ['games_played'],
    players,
    gamemode: GAMEMODE,
    groupCols: ['player', 'hero'],
  });
  const out = new Map();
  for (const o of pivotLatest(rows, ['player', 'hero'], (obj, r) => {
    if (r.metric === 'games_played') obj.gamesPlayed = num(r.value);
  })) out.set(o.player, o.gamesPlayed ?? null);
  return out;
}

async function defaultPgClientFactory() {
  // Loaded lazily so --from-snapshots (and the tests) run without node_modules.
  const { default: pg } = await import('pg');
  // The server enforces a 15s statement timeout; mirror it client-side and
  // bound the TCP/TLS handshake so an unreachable host fails fast in CI.
  return new pg.Client({
    connectionString: process.env.STATS_DB_URL || DEFAULT_DB_URL,
    connectionTimeoutMillis: 20_000,
    query_timeout: 30_000,
  });
}

// Reads the whole DB history for `players`. Returns the samples, the latest
// profiles and the DB's latest all-heroes gamesPlayed per player.
async function readDatabase(pgClientFactory, players, { now, log }) {
  const client = await pgClientFactory();
  await client.connect();
  try {
    const { rows: [minRow] } = await client.query(MIN_DAY_SQL);
    const first = ms(minRow?.min_day);
    if (first === null || Number.isNaN(first)) throw new Error('ow_stats_daily is empty; nothing to backfill');
    const windows = dayWindows(utcDay(first), now);
    log(`backfill: reading ow_stats_daily from ${isoDay(first)} in ${windows.length} window(s) of ${WINDOW_DAYS} days`);

    const history = createHistory();
    for (const { from, to } of windows) {
      const range = [new Date(from).toISOString(), new Date(to).toISOString()];
      const rank = await client.query(RANK_WINDOW_SQL, [players, RANK_METRICS, ...range]);
      const career = await client.query(CAREER_WINDOW_SQL, [
        players, GAMEMODE, PLATFORM, CAREER_METRICS.map(([metric]) => metric), ...range,
      ]);
      addRankRows(history, rank.rows);
      addCareerRows(history, career.rows);
      log(`  ${isoDay(from)} .. ${isoDay(to - DAY_MS)}: ${rank.rows.length} rank rows, ${career.rows.length} career rows`);
    }
    const profiles = await fetchProfiles(client, players);
    const latestGamesPlayed = await fetchLatestGamesPlayed(client, players);
    return { samplesByDay: historyToSamples(history), profiles, latestGamesPlayed };
  } finally {
    await client.end();
  }
}

// --- snapshots source ---------------------------------------------------------

const OVERLAY_ALL_HEROES = ['healingDone', 'healingPer10Min', 'winPercentage'];
const OVERLAY_PER_HERO = [...OVERLAY_ALL_HEROES, 'gamesWon'];

// Healing and win fields aren't in the legacy daily files (per-hero gamesWon
// isn't either), so the last sample that carries each (player, hero) borrows
// them from the legacy career-latest.json, which holds the last-known row per
// series. Only fields that are still null are filled, and fields that feed a
// daily series (all-heroes gamesWon) or season assignment are left alone, so
// the overlay can't add or move a daily row. Mutates the samples.
export function overlayLatestFields(samplesByDay, careerLatest) {
  const lastSeen = new Map();
  for (const [, samples] of samplesByDay) {
    for (const s of samples) {
      for (const [hero, career] of Object.entries(s.career ?? {})) lastSeen.set(`${s.player}|${hero}`, career);
    }
  }
  for (const row of careerLatest) {
    const career = lastSeen.get(`${row.player}|${row.hero}`);
    if (!career) continue;
    const fields = row.hero === 'all-heroes' ? OVERLAY_ALL_HEROES : OVERLAY_PER_HERO;
    for (const f of fields) {
      if (career[f] == null && row[f] != null) career[f] = row[f];
    }
  }
}

// Reads the legacy flat files, keeps the roster's players and builds the
// samples. Everything is in memory when this returns.
function readSnapshots(dir, playerIds, { log }) {
  const legacy = loadLegacySnapshots(dir);
  const keep = (rows) => rows.filter((r) => playerIds.has(r.player));
  const dropped = new Set();
  for (const rows of [legacy.rankDaily, legacy.careerDaily, legacy.careerHeroDaily]) {
    for (const r of rows) if (!playerIds.has(r.player)) dropped.add(r.player);
  }
  if (dropped.size) log(`backfill: ignoring ${dropped.size} player(s) not in the roster: ${[...dropped].sort().join(', ')}`);

  const samplesByDay = legacySamplesByDay({
    rankDaily: keep(legacy.rankDaily),
    careerDaily: keep(legacy.careerDaily),
    careerHeroDaily: keep(legacy.careerHeroDaily),
  });
  overlayLatestFields(samplesByDay, keep(legacy.careerLatest));
  return { samplesByDay, profiles: keep(legacy.profiles).map((p) => ({ ...p })), latestGamesPlayed: null };
}

// --- output -------------------------------------------------------------------

function formatTable(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => String(c)));
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  return cells.map((r) => `  ${r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()}`);
}

// One row per non-empty season: span, players with rows, rows per dataset.
function summarizeSeasons(store, meta) {
  return meta.seasons.map(({ season, firstDay, lastDay }) => {
    const players = new Set();
    for (const name of ['rankDaily', 'careerDaily', 'careerHeroDaily', 'careerLatest']) {
      for (const r of seasonRows(store, season, name)) players.add(r.player);
    }
    return { season, firstDay, lastDay, players: players.size, rows: seasonCounts(store, season) };
  });
}

// --- the backfill -------------------------------------------------------------

// Runs the whole backfill and returns what it did (the tests read this).
// `pgClientFactory` returns an object with connect() / query(sql, params) /
// end(), so tests can inject a fake instead of a real pg.Client.
export async function runBackfill(argv, { pgClientFactory = defaultPgClientFactory, now = Date.now(), log = console.log } = {}) {
  const args = parseArgs(argv);
  const seasonsDir = join(args.dataDir, 'seasons');
  const statePath = join(args.dataDir, 'pipeline', 'state.json');

  // Refuse before touching the network or the disk.
  const existing = [seasonsDir, statePath].filter((p) => existsSync(p));
  if (existing.length && !args.force) {
    throw new Error(`${existing.join(' and ')} already exist${existing.length === 1 ? 's' : ''}; rerun with --force to replace the season history`);
  }

  const roster = loadRoster(args.roster);
  const players = roster.map((r) => r.playerId);
  if (!players.length) throw new Error(`roster ${args.roster} lists no players`);
  const source = args.fromSnapshots ? 'snapshots' : 'db';

  // Read every input first: --from-snapshots may be <data-dir>/snapshots.
  log(`backfill: source ${source}, ${players.length} roster player(s)`);
  const input = args.fromSnapshots
    ? readSnapshots(args.fromSnapshots, new Set(players), { log })
    : await readDatabase(pgClientFactory, players, { now, log });
  const { samplesByDay, profiles, latestGamesPlayed } = input;
  if (!samplesByDay.length) throw new Error(`no history found in the ${source} source; nothing to backfill`);

  // Replay day by day, noting every season change.
  const store = emptyStore();
  const warnings = [];
  const events = [];
  const playerSeason = new Map();
  let globalSeason = null;
  const onDay = (day, result) => {
    if (result.currentSeason !== globalSeason) {
      events.push({ day: isoDay(day), player: null, from: globalSeason, to: result.currentSeason, reason: 'global' });
      globalSeason = result.currentSeason;
    }
    for (const a of result.assignments) {
      const before = playerSeason.get(a.player) ?? null;
      if (before !== null && before !== a.season) {
        events.push({ day: isoDay(day), player: a.player, from: before, to: a.season, reason: a.reason });
      }
      playerSeason.set(a.player, a.season);
    }
    for (const w of result.warnings) warnings.push(`${isoDay(day)}: ${w.message}`);
  };

  // --initial-season only matters when the first day carries no rank season,
  // which is the one case ingestPoll can't resolve by itself. Forcing it on
  // top of real data would only mislabel the first season.
  const [[firstDay, firstSamples], ...rest] = samplesByDay;
  let forceSeason = args.initialSeason;
  if (forceSeason !== null && firstSamples.some((s) => s.rankSeason !== null)) {
    warnings.push(`--initial-season ${forceSeason} ignored: ${isoDay(firstDay)} already carries a rank season`);
    forceSeason = null;
  }
  try {
    replayDays(store, [[firstDay, firstSamples]], { forceSeason }, onDay);
  } catch (err) {
    throw new Error(`${isoDay(firstDay)}: cannot tell which season the first day belongs to (no rank season in the data); rerun with --initial-season N`, { cause: err });
  }
  replayDays(store, rest, {}, onDay);
  const lastDay = rest.length ? rest[rest.length - 1][0] : firstDay;

  // Profiles come as they are from the source (the replay samples carry none).
  for (const p of profiles) store.profiles.set(p.player, { ...p });
  const meta = buildMeta(store, {
    now,
    players,
    lastPoll: { at: now, source: 'backfill', ok: players, failed: [] },
  });

  // Cross-check against the DB's own latest values for everyone in the
  // current season (DB mode only).
  const mismatches = [];
  if (latestGamesPlayed) {
    const current = store.state.currentSeason;
    const replayed = new Map(seasonRows(store, current, 'careerLatest')
      .filter((r) => r.hero === 'all-heroes').map((r) => [r.player, r.gamesPlayed]));
    for (const [player, st] of Object.entries(store.state.players)) {
      if (st.season !== current) continue;
      const mine = replayed.get(player) ?? null;
      const db = latestGamesPlayed.get(player) ?? null;
      if (mine !== db) mismatches.push({ player, replayed: mine, db });
    }
    for (const m of mismatches) {
      warnings.push(`cross-check: ${m.player} all-heroes gamesPlayed replayed ${m.replayed} but the DB's latest is ${m.db}`);
    }
  }

  // Everything is read; now write. --force clears the old season history and
  // poller state first (and only those; the legacy flat files stay).
  if (args.force) {
    rmSync(seasonsDir, { recursive: true, force: true });
    rmSync(statePath, { force: true });
  }
  const written = saveStore(store, args.dataDir);

  // Report.
  const seasons = summarizeSeasons(store, meta);
  const finalSeasons = Object.fromEntries(Object.entries(store.state.players).map(([p, st]) => [p, st.season]));
  log(`\nbackfill: replayed ${samplesByDay.length} day(s), ${isoDay(firstDay)} .. ${isoDay(lastDay)}`);
  log('\nSeason changes');
  for (const e of events) {
    if (e.reason !== 'global') log(`  ${e.day}  ${e.player} season ${e.from} -> ${e.to} (${e.reason})`);
    else log(e.from === null ? `  ${e.day}  global season starts at ${e.to}` : `  ${e.day}  global season ${e.from} -> ${e.to}`);
  }
  log('\nSeason summary');
  for (const line of formatTable(
    ['season', 'firstDay', 'lastDay', 'players', 'rank-daily', 'career-daily', 'career-hero-daily', 'career-latest'],
    seasons.map((s) => [
      s.season, isoDay(s.firstDay), isoDay(s.lastDay), s.players,
      s.rows.rankDaily, s.rows.careerDaily, s.rows.careerHeroDaily, s.rows.careerLatest,
    ]),
  )) log(line);
  log(`\nFinal player seasons (current season ${meta.currentSeason}, since ${meta.seasonStart === null ? '-' : isoDay(meta.seasonStart)})`);
  for (const line of formatTable(
    ['player', 'season', 'lastReason'],
    Object.entries(store.state.players).sort(([a], [b]) => byString(a, b)).map(([p, st]) => [p, st.season, st.lastReason]),
  )) log(line);
  if (latestGamesPlayed) {
    log(mismatches.length
      ? `\nCross-check against the DB: ${mismatches.length} mismatch(es)`
      : '\nCross-check against the DB: all-heroes gamesPlayed matches for every current-season player');
  }
  for (const w of warnings) log(`::warning::${w}`);
  log(`\nbackfill: wrote ${written.written.length} file(s) to ${args.dataDir}`);

  return { source, store, meta, seasons, finalSeasons, events, warnings, mismatches, written };
}

async function main() {
  try {
    await runBackfill(process.argv.slice(2));
  } catch (err) {
    console.error(`backfill-from-db: FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
