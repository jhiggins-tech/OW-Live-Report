// Season-assignment predicates (the pure half of ingestPoll in rollup.mjs).
//
// Competitive career counters are season-to-date and reset when a season
// starts, but a profile keeps showing last season's numbers until the player
// queues again, and summary.competitive.pc.season lags the reset by days or
// weeks. So the pipeline watches the counters themselves. See
// plan/v3-static-season-snapshots.md, "Season assignment".

// Both arguments are all-heroes career objects (a Sample's `career['all-heroes']`
// or a career-latest row). True when the counters went backwards the way a
// season reset does. Two independent counters must fall, so one glitched
// field can't fake a rollover.
export function isCounterReset(prev, cur) {
  if (!prev || !cur) return false;
  const dropped = (k) => prev[k] != null && cur[k] != null && cur[k] < prev[k];
  return dropped('gamesPlayed') && (dropped('timePlayed') || dropped('eliminations'));
}

// True when any headline counter differs from the previous sample (or there is
// no previous sample). Used to spot a carry-over player who has resumed play.
export function countersChanged(prev, cur) {
  if (!cur) return false;
  if (!prev) return true;
  return ['gamesPlayed', 'timePlayed', 'eliminations', 'deaths', 'assists']
    .some((k) => (cur[k] ?? null) !== (prev[k] ?? null));
}

// The player's last stored all-heroes row, from the season bucket the state
// file says they currently belong to. Read this before writing the player's
// new sample.
export function prevAllHeroes(store, player) {
  const ps = store.state.players[player];
  if (!ps) return null;
  return store.seasons.get(ps.season)?.careerLatest.get(`${player}|all-heroes`) ?? null;
}
