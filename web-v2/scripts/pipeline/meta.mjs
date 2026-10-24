// Builds snapshots/meta.json: the small index the SPA reads first to learn the
// layout version, the current season and which players/seasons exist.
// See plan/v3-static-season-snapshots.md, "snapshots/ - global now files".

import { GAMEMODE, LAYOUT_VERSION, PLATFORM } from './constants.mjs';
import { nonEmptySeasons } from './store.mjs';
import { compareBy, utcDay } from './util.mjs';

// Object with its keys in plain `<` order, so meta.json diffs stay stable.
const sortedObject = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// min/max `day` across a season's three daily files (falling back to the
// career-latest poll time for a bucket that somehow has no daily rows).
function seasonSpan(bucket) {
  let first = Infinity;
  let last = -Infinity;
  const see = (day) => {
    if (day < first) first = day;
    if (day > last) last = day;
  };
  for (const name of ['rankDaily', 'careerDaily', 'careerHeroDaily']) {
    for (const days of bucket[name].values()) for (const day of days.keys()) see(day);
  }
  if (first === Infinity) for (const row of bucket.careerLatest.values()) see(utcDay(row.time));
  return { firstDay: first, lastDay: last };
}

// `lastPoll` is { at?, source, ok: [playerId], failed: [{ player, error }] }.
// `heartbeatAt` only advances when at least one player was fetched OK.
// Also attaches the result to `store.meta` so saveStore() writes it.
export function buildMeta(store, { now, players, lastPoll, gamemode = GAMEMODE, platform = PLATFORM, previousMeta = store.previousMeta } = {}) {
  if (!Number.isFinite(now)) throw new TypeError('buildMeta: `now` (epoch ms) is required');
  const st = store.state;

  const seasons = nonEmptySeasons(store).map((season) => ({ season, ...seasonSpan(store.seasons.get(season)) }));
  const currentSeason = st.currentSeason ?? null;
  const seasonStart = seasons.find((s) => s.season === currentSeason)?.firstDay ?? null;

  // Compat with the legacy meta: each player's newest rank row decides their
  // reported season (ties go to the alphabetically first role).
  const newest = new Map();
  const rankRows = [...store.rankCurrent.values()].sort(compareBy(['player', 'role']));
  for (const r of rankRows) {
    const prev = newest.get(r.player);
    if (!prev || r.time > prev.time) newest.set(r.player, r);
  }

  const ok = lastPoll?.ok ?? [];
  const meta = {
    layoutVersion: LAYOUT_VERSION,
    generatedAt: now,
    heartbeatAt: ok.length > 0 ? now : previousMeta?.heartbeatAt ?? null,
    gamemode,
    platform,
    players: players ?? previousMeta?.players ?? [],
    currentSeason,
    maxSeason: currentSeason,
    seasonStart,
    seasonByPlayer: sortedObject([...newest].map(([p, r]) => [p, r.season ?? null])),
    playerSeason: sortedObject(Object.entries(st.players).map(([p, s]) => [p, s.season])),
    seasons,
    lastPoll: lastPoll
      ? { at: lastPoll.at ?? now, source: lastPoll.source ?? 'poll', ok, failed: lastPoll.failed ?? [] }
      : previousMeta?.lastPoll ?? null,
  };
  store.meta = meta;
  return meta;
}
