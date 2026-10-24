// Assigns each polled player to a season and compacts their sample into the
// per-season daily roll-ups held by the in-memory store (store.mjs). This is
// the heart of the V3 pipeline: poll.mjs feeds it live samples twice a day,
// the backfill feeds it replayed history, and both go through ingestPoll so
// the two paths can't disagree. Pure apart from mutating `store`.
// See plan/v3-static-season-snapshots.md, "Season assignment" and "Compact".

import { COUNTER_FIELDS, GRACE_MS, MIN_SEASON_MS, SEASON_DATASETS } from './constants.mjs';
import { noteRankIcons } from './icons.mjs';
import { countersChanged, isCounterReset, prevAllHeroes } from './season.mjs';
import { utcDay } from './util.mjs';

const COUNTERS = new Set(COUNTER_FIELDS);
const KEY_FIELDS = new Set(['player', 'role', 'hero', 'day', 'time']);
// Fields compared / merged per dataset: everything that isn't part of the key.
const VALUE_FIELDS = Object.fromEntries(
  Object.entries(SEASON_DATASETS).map(([name, ds]) => [name, Object.keys(ds.fields).filter((f) => !KEY_FIELDS.has(f))]),
);

const sameValues = (fields, a, b) => fields.every((f) => (a[f] ?? null) === (b[f] ?? null));

// Collects warnings while a poll is ingested. Counter drops are grouped per
// player so one bad response doesn't print a line per hero per field.
function makeContext() {
  const warnings = [];
  const drops = new Map();
  return {
    warnings,
    drop(row, field, before, after) {
      const list = drops.get(row.player) ?? new Map();
      list.set(`${row.hero ?? 'all-heroes'}.${field}`, `${before}->${after}`);
      drops.set(row.player, list);
    },
    flush() {
      for (const [player, list] of drops) {
        const shown = [...list].slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
        const more = list.size > 5 ? ` (+${list.size - 5} more)` : '';
        warnings.push({
          code: 'non-monotonic',
          player,
          message: `${player}: counters went down within one season, kept the higher values: ${shown}${more}`,
        });
      }
      return warnings;
    },
  };
}

// D2 merge rule. Counters keep the max (null loses to any number); everything
// else (rank fields, rates, profile text) takes the incoming value, null
// included; `time` keeps the later poll.
function mergeRow(fields, existing, incoming, ctx) {
  const out = { ...incoming };
  for (const f of fields) {
    if (!COUNTERS.has(f)) continue;
    const a = existing[f] ?? null;
    const b = incoming[f] ?? null;
    if (a !== null && b !== null && b < a) ctx.drop(incoming, f, a, b);
    out[f] = a === null ? b : b === null ? a : Math.max(a, b);
  }
  if (incoming.time !== undefined) out.time = Math.max(existing.time ?? -Infinity, incoming.time);
  return out;
}

// `series` is Map<seriesKey, Map<day, row>>. Current-season rows are always
// upserted (one row per day, forward-filled); with `changeOnly` (any other
// season) a row is only stored when it differs from the series' latest row, so
// inactive players don't flat-line through old seasons.
function upsertDaily(ctx, dataset, series, key, row, { changeOnly }) {
  let days = series.get(key);
  if (!days) {
    days = new Map();
    series.set(key, days);
  }
  const fields = VALUE_FIELDS[dataset];
  const today = days.get(row.day);
  const merged = today ? mergeRow(fields, today, row, ctx) : row;
  if (changeOnly) {
    let last = null;
    for (const r of days.values()) if (!last || r.day > last.day) last = r;
    if (last && sameValues(fields, last, merged)) return;
  }
  days.set(row.day, merged);
}

// career-latest: one row per (player, hero). Counters are only max-merged with
// a row from the same UTC day (a second poll); a row from an earlier day is
// simply replaced, because "latest" means the newest sample. (Max-merging
// across days would pin a transient high reading, e.g. per-hero rows that
// lag a season reset, as the player's totals for the rest of the season.)
// change-only compares everything except `time`, so an unchanged old-season
// row keeps its original time.
function upsertLatest(ctx, map, key, row, { changeOnly }) {
  const existing = map.get(key);
  let merged = row;
  if (existing) {
    merged = utcDay(existing.time) === utcDay(row.time)
      ? mergeRow(VALUE_FIELDS.careerLatest, existing, row, ctx)
      : { ...row, time: Math.max(existing.time, row.time) };
  }
  if (changeOnly && existing && sameValues(VALUE_FIELDS.careerLatest, existing, merged)) return;
  map.set(key, merged);
}

function writeSample(ctx, store, s, { season, current, writeCareer }) {
  // Only the current season is forward-filled.
  const changeOnly = (target) => target !== current;

  if (s.profile) {
    const prev = store.profiles.get(s.player);
    store.profiles.set(s.player, {
      player: s.player, time: Math.max(prev?.time ?? -Infinity, s.fetchedAt), ...s.profile,
    });
  }
  for (const r of s.ranks) {
    // The rank row goes into the season Blizzard reported it for, which can
    // lag the player's counter season (a stale S23 rank after the S24 reset).
    const rowSeason = r.season ?? season;
    // Insignia URLs go into the global map, not into the rows (whose
    // contracts stay as they are); the highest season's URL wins.
    noteRankIcons(store.rankIcons, r, { season: rowSeason, at: s.fetchedAt });
    const key = `${s.player}|${r.role}`;
    const prev = store.rankCurrent.get(key);
    store.rankCurrent.set(key, {
      player: s.player, role: r.role, time: Math.max(prev?.time ?? -Infinity, s.fetchedAt),
      tier: r.tier, division: r.division, season: r.season,
    });
    upsertDaily(ctx, 'rankDaily', store.bucket(rowSeason).rankDaily, key, {
      player: s.player, role: r.role, day: s.day, tier: r.tier, division: r.division, season: rowSeason,
    }, { changeOnly: changeOnly(rowSeason) });
  }
  if (!writeCareer || !s.career) return;

  const b = store.bucket(season);
  const opts = { changeOnly: changeOnly(season) };
  for (const [hero, c] of Object.entries(s.career)) {
    if (hero === 'all-heroes') {
      upsertDaily(ctx, 'careerDaily', b.careerDaily, s.player, {
        player: s.player, day: s.day, eliminations: c.eliminations ?? null, deaths: c.deaths ?? null,
        assists: c.assists ?? null, gamesWon: c.gamesWon ?? null, gamesPlayed: c.gamesPlayed ?? null,
      }, opts);
    } else {
      upsertDaily(ctx, 'careerHeroDaily', b.careerHeroDaily, `${s.player}|${hero}`, {
        player: s.player, hero, day: s.day, eliminations: c.eliminations ?? null, deaths: c.deaths ?? null,
        assists: c.assists ?? null, gamesPlayed: c.gamesPlayed ?? null, timePlayed: c.timePlayed ?? null,
      }, opts);
    }
    const latest = { player: s.player, hero, time: s.fetchedAt };
    for (const f of VALUE_FIELDS.careerLatest) latest[f] = c[f] ?? null;
    upsertLatest(ctx, b.careerLatest, `${s.player}|${hero}`, latest, opts);
  }
}

// Ingest one poll's samples (one per player). Returns
// { assignments: [{ player, season, reason }], currentSeason, warnings }, where
// each warning is { code, player, message } (`non-monotonic`, `reset-too-soon`).
// Throws when no season can be determined (empty store and no rank seasons);
// pass forceSeason to bootstrap in that case.
export function ingestPoll(store, samples, { now, graceMs = GRACE_MS, minSeasonMs = MIN_SEASON_MS, forceSeason = null } = {}) {
  if (!Number.isFinite(now)) throw new TypeError('ingestPoll: `now` (epoch ms) is required');
  const st = store.state;
  const ctx = makeContext();
  if (forceSeason != null && forceSeason > (st.currentSeason ?? -Infinity)) {
    st.currentSeason = forceSeason;
    st.currentSeasonDetectedAt = now;
  }
  const g0 = st.currentSeason; // global season before this poll (may be null)
  const seasonOldEnough = st.currentSeasonDetectedAt == null
    || now - st.currentSeasonDetectedAt >= minSeasonMs;

  // Pass 1: strong signals. These may raise the global season.
  const strong = new Map();
  for (const s of samples) {
    const ps = st.players[s.player];
    if (!ps) {
      // The season may be null here; pass 2 resolves it to the global season.
      strong.set(s.player, { season: s.rankSeason ?? g0, reason: 'new-player' });
    } else if (s.rankSeason != null && s.rankSeason > ps.season) {
      strong.set(s.player, { season: s.rankSeason, reason: 'rank-season' });
    } else if (isCounterReset(prevAllHeroes(store, s.player), s.career?.['all-heroes'])) {
      const season = Math.max(g0 ?? 0, ps.season + 1);
      if (season > (g0 ?? 0) && !seasonOldEnough) {
        // A reset that would start a new global season < 21 days after the last
        // one is treated as a data glitch: skip this player's career rows this
        // poll and warn. Their rank and profile still update.
        strong.set(s.player, { blocked: true, reason: 'reset-too-soon' });
        const days = ((now - st.currentSeasonDetectedAt) / 86_400_000).toFixed(1);
        ctx.warnings.push({
          code: 'reset-too-soon',
          player: s.player,
          message: `${s.player}: counters reset but season ${g0} started only ${days} days ago; `
            + 'treating it as a data glitch and skipping career rows (use force_season to override)',
        });
      } else {
        strong.set(s.player, { season, reason: 'counter-reset' });
      }
    }
  }
  const candidates = [g0, ...samples.map((s) => s.rankSeason), ...[...strong.values()].map((v) => v.season)]
    .filter(Number.isInteger);
  if (!candidates.length) throw new Error('Cannot determine the current season; rerun with --force-season N');
  const g1 = Math.max(...candidates);
  if (g1 !== g0) {
    st.currentSeason = g1;
    st.currentSeasonDetectedAt = now;
  }
  store.lastIngestAt = Math.max(store.lastIngestAt ?? -Infinity, now);

  // Pass 2: final per-player season, then write. Players don't share rows, so
  // the result doesn't depend on roster order.
  const assignments = [];
  for (const s of samples) {
    const ps = st.players[s.player];
    const sig = strong.get(s.player);
    let season;
    let reason;
    let writeCareer = true;
    if (sig?.blocked) {
      season = ps.season;
      reason = sig.reason;
      writeCareer = false;
    } else if (sig) {
      season = sig.season ?? g1;
      reason = sig.reason;
    } else if (g1 > ps.season
      && now - st.currentSeasonDetectedAt >= graceMs
      && countersChanged(prevAllHeroes(store, s.player), s.career?.['all-heroes'])) {
      // The global season rolled over more than 36h ago and this carry-over
      // player's numbers moved: that can only be new-season play (it catches
      // light players whose new totals already exceed last season's, so
      // isCounterReset never fires).
      season = g1;
      reason = 'post-grace-change';
    } else {
      season = ps.season;
      reason = 'unchanged';
    }
    st.players[s.player] = { season, lastFetchedAt: s.fetchedAt, lastReason: reason };
    writeSample(ctx, store, s, { season, current: g1, writeCareer });
    assignments.push({ player: s.player, season, reason });
  }
  return { assignments, currentSeason: g1, warnings: ctx.flush() };
}
