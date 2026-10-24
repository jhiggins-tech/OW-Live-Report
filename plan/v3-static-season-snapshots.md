# PRD — V3: retire the stats database; poll OverFast into static season snapshots

**Status:** Approved 2026-10-24 — in progress on the `jhiggins-tech` fork first
**Owner:** unassigned (split across agents; see [Work packages](#work-packages))
**Related:** [v2.3 InfluxQL → SQL migration](./v2.3-influxql-to-sql-migration.md)
(superseded when this ships) · backend repo `jhiggins-tech/ow-stats-influxdb`
(retired by WP6)

## TL;DR

Today the data path is:

```
OverFast ─(hourly scraper, droplet)─▶ TimescaleDB ─(hourly Action, SQL)─▶ docs/data/snapshots/*.json ─▶ SPA
```

The upstream profile data only changes about once a day per player, so the
always-on droplet and database are paying for freshness nobody gets.

V3 removes the server side:

```
OverFast ─(GitHub Action, twice daily)─▶ docs/data/seasons/<N>/*.json  (one row per series per UTC day)
                                       └▶ docs/data/snapshots/{meta,rank-current,profiles}.json ─▶ SPA
```

Each poll **compacts** its sample straight into a daily roll-up, so the repo
never holds more than one row per series per day. Counters take the day's
MAX; rank and rate fields take the day's last value. History is split by
**season**: the site shows the current season, resets when a new season
starts, and keeps past seasons as frozen static files. Raw API responses are
never committed (they're kept for 14 days as workflow artifacts for debugging).

Every work package can be merged to `main` on its own without changing what
users see. The site only switches over when the WP5 cutover switches are
flipped, and the old pipeline stays available for rollback until WP6.

---

## Context

### What exists today

| Piece | Where | Role |
|---|---|---|
| Scraper | `ow-stats-influxdb/docker/scripts/scrape.py` | Hourly `GET https://overfast-api.tekrop.fr/players/{id}` for each player; emits line protocol |
| DB | TimescaleDB on a droplet (`owstats.jhiggins.tech:5432`) | `ow_stats` (raw, 14 days) + `ow_stats_daily` (last sample per series per UTC day, 600 days) |
| Snapshot baker | `web-v2/scripts/fetch-snapshots.mjs` | SQL → 7 JSON datasets in `docs/data/snapshots/` |
| Refresh job | `.github/workflows/refresh-data.yml` | Hourly cron; runs the baker and commits `[skip ci]` |
| Deploy job | `.github/workflows/deploy.yml` | On push to `main`: roster → (re)bake snapshots → `vite build` into `docs/` → commit |
| SPA data layer | `web-v2/src/lib/snapshotClient.ts`, `web-v2/src/types/snapshots.ts`, `web-v2/src/lib/queries/**` | Fetches the static JSON and aggregates client-side |

The SPA is already a static site that reads static JSON. Only the
**producer** of that JSON needs to change.

### Evidence behind the design

**1. The data really does change about once a day.** I analysed the 761
snapshot-refresh commits on `mattjsawyer/ow-live-report` since 2026-07-29.
The "hourly" cron actually fires about 5×/day because GitHub throttles
schedules. A player-day here means a day on which a player's all-heroes
counters changed. There were 68 such player-days: **58 changed exactly once
that day**, and 70 of the 81 change events landed **between 11:00 and 19:59
UTC**. Polling twice a day loses almost nothing.

**2. How season rollovers look in the data.** Taken from upstream
`career-daily.json` / `rank-daily.json`; `gp` = all-heroes competitive games played:

| Player | Last-season counters | Counter reset first seen | Rank `season` field flips | Notes |
|---|---|---|---|---|
| DarthKcaj-1443 | gp 467 (S23) | 2026-08-12 (gp 8) | S24 on 08-13 | first in roster → S24 starts 08-12 |
| Kieness-6123 | gp 191 (S23) | 2026-08-17 (gp 8) | S24 on 08-21 | rank lags the reset by 4 days, briefly null |
| Tones-11680 | gp 34 (S23) | 2026-08-21 (gp 4) | S24 on 09-05 | rank lags by 15 days |
| KiwiCore-1324 | gp 28 (S23) | 2026-08-28 (gp 7) | never (null from 08-22) | kept showing S23 counters two weeks into S24 |
| DarthKcaj-1443 | gp 307 (S24) | 2026-10-08 (gp 4) | S25 on 10-08 | S25 starts 10-08 |
| Kiddo-11482 | gp 31 (S22) | — | stays S22 | inactive; still serves S22 stats in S25 |
| Shotdownboyz-1119 | gp 36 (S23) | — | stays S23 | inactive since July |

What the design takes from this:

- Competitive career counters are **season-to-date** and reset when a season
  starts. A player's profile, however, **keeps showing last season's numbers
  until they play** in the new season.
- `summary.competitive.pc.season` is **per player**. It lags the counter
  reset by days or weeks, and it can be null. It cannot decide on its own
  which season a sample belongs to.
- So the pipeline tracks **a season per player**. A player moves into a new
  season when their rank season increases or their counters reset (see
  [Season assignment](#3-season-assignment-wp1-seasonmjs--rollupmjs)).
- A naive daily `MAX()` across a reset would keep the old season's high
  numbers. MAX is only safe *within* one season's bucket, which is one more
  reason to partition by season.

**3. Repos.** `mattjsawyer/ow-live-report` is the live site (GitHub Pages
serves `main:/docs`, and its refresh job is still running).
`jhiggins-tech/OW-Live-Report` is the development fork. Its scheduled refresh
stopped on 2026-08-08, and its `main` is missing upstream commit `7d941b4`
("feat: add player role rank cards", which adds
`web-v2/src/lib/queries/currentPlayerRanks.ts` and
`web-v2/src/components/PlayerCurrentRank.tsx`). WP0 brings the fork level
with upstream.

## Goals

1. **No always-on infrastructure.** No droplet, database, TLS/certbot or
   self-hosted runner. Hosting cost is $0 (GitHub Pages + Actions on a public
   repo).
2. **Twice-daily polling** from GitHub Actions straight against OverFast.
3. **Minimal stored data.** One row per series per UTC day per season. Raw
   responses are never committed.
4. **Season by season.** The site shows the current season and resets at
   rollover. Past seasons stay as static archives in `docs/data/seasons/<N>/`.
5. **Stable SPA contract.** The row shapes in `web-v2/src/types/snapshots.ts`
   don't change, so the ~20 query modules under `web-v2/src/lib/queries/` need
   no edits (apart from `seasonWindow.ts`).
6. **Keep history.** Backfill everything the DB holds (about S21–S25) into
   season archives before it is shut down.

## Non-goals

- No UI redesign or new charts. A season picker is optional follow-up WP7a.
- The browser's direct OverFast calls (`lib/queries/heroMeta.ts`,
  `lib/queries/overfastPlayerSummary.ts`) stay as they are (optional WP7c).
- No quickplay and no console data: competitive on PC only, same as today.
- No history finer than a day. The rank trend has been day-resolution since v2.3.

## Decisions (defaults — confirm at sign-off)

| # | Decision | Default |
|---|---|---|
| D1 | Poll schedule | `37 9,21 * * *` UTC (≈ 20:37 and 08:37 Sydney during AEDT). 21:37 UTC catches the 11–20 UTC change window; 09:37 catches stragglers. The off-the-hour minute avoids GitHub's top-of-hour queueing. |
| D2 | Roll-up rule | Counters (`eliminations, deaths, assists, healingDone, gamesWon, gamesPlayed, timePlayed`) take **MAX** within the day. Rank fields (`tier, division, season`), rates (`healingPer10Min, winPercentage`) and profile text take the **last value of the day**. MAX is wrong for rank: `tier` is an inverted division number (1 is the best) and `division` is text. |
| D3 | Day boundary | UTC midnight, same as today's data. AU evening sessions (09–14 UTC) fall inside one UTC day. |
| D4 | Canonical repo | **Phase 1 (approved): the `jhiggins-tech/OW-Live-Report` fork.** Get it working there end to end first; `mattjsawyer/ow-live-report` follows later. Polling runs only where the repository variable `OW_POLL_ENABLED=true` is set, so whichever repo doesn't set it never writes data. |
| D5 | What resets each season | **Stats reset**: every chart, stat card, hero pool and leaderboard reads only the current season's files. **Optimizer exception (approved):** a player with no current-season data falls back to one snapshot of their last season, i.e. that season's `career-latest.json` rows, labelled with the season (WP7b, now in scope as part of WP4). **Rank is carried over**: `rank-current.json` keeps each player's last known rank tagged with its season (today's behaviour, and the rank cards already show the season label). |
| D6 | History | Backfill the DB's full daily history into `seasons/<N>/` (WP3) before the DB is retired. |

---

## Target architecture

```
GitHub Actions: poll-stats.yml (09:37 + 21:37 UTC)
 └─ node web-v2/scripts/pipeline/poll.mjs
     1. POLL     GET /players/{id} × roster  ──▶ raw JSON (artifact only, 14 days)
     2. EXTRACT  raw → Sample (ranks, profile, per-hero career counters)
     3. ASSIGN   per-player season (rank-season / counter-reset / grace rules)
     4. COMPACT  upsert today's row per series into seasons/<N>/  (MAX / last-wins)
     5. BAKE     snapshots/meta.json, rank-current.json, profiles.json, pipeline/state.json
 └─ node web-v2/scripts/pipeline/validate.mjs  (fails the job before any commit)
 └─ git commit docs/data  "data: poll <UTC> [skip ci]"  → push main

GitHub Pages (main:/docs) ──▶ SPA reads snapshots/meta.json → seasons/<currentSeason>/*.json
```

### Repository layout after V3

```
config/tracked-battletags.txt                 (unchanged — the roster)
docs/data/
  roster.json, runtime-config.json            (unchanged — written by the build)
  snapshots/                                  global "now" files, rewritten each poll
    meta.json                                 CHANGED: layoutVersion 2 + season index
    rank-current.json                         unchanged shape
    profiles.json                             unchanged shape (+ optional lastUpdatedAt)
    rank-daily.json, career-*.json            DELETED at cutover (moved into seasons/)
  seasons/                                    NEW
    <N>/rank-daily.json
    <N>/career-daily.json
    <N>/career-hero-daily.json
    <N>/career-latest.json
  pipeline/state.json                         NEW: the poller's memory (not read by the SPA)
web-v2/scripts/pipeline/                      NEW: Node 20 ESM, no dependencies
  constants.mjs  util.mjs  roster.mjs  extract.mjs  season.mjs
  rollup.mjs  store.mjs  meta.mjs  validate.mjs                    (WP1)
  overfast.mjs  poll.mjs                                           (WP2)
  backfill-from-db.mjs                                             (WP3, deleted in WP6)
  *.test.mjs, __fixtures__/
web-v2/scripts/fetch-snapshots.mjs            DELETED at cutover
.github/workflows/poll-stats.yml              NEW
.github/workflows/backfill-history.yml        NEW, temporary (deleted in WP6)
.github/workflows/refresh-data.yml            DELETED at cutover
.github/workflows/deploy.yml                  CHANGED: no DB step, no snapshot seeding
```

---

## Data contract (authoritative — every WP codes against this)

### Conventions

- **Player id**: the BattleTag with `#` replaced by `-` (`DarthKcaj-1443`),
  same as today. Parsed from `config/tracked-battletags.txt` by the same rules
  as `build-roster.mjs` and `fetch-snapshots.mjs` (`Display | BattleTag | Notes`,
  `#` comments, a lone BattleTag is allowed).
- **Times** are epoch milliseconds. **`day`** is the epoch ms of UTC midnight
  (`ms - (ms % 86_400_000)`).
- **Seasons** are integers and directory names are the bare number (`seasons/25/`).
- **Roles**: `tank | damage | support | open`. Keep `open` for parity; the SPA ignores it.
- **Field naming quirk kept on purpose**: in rank rows `tier` is the division
  **number** (1–5) and `division` is the tier **name** (`gold`). See
  `web-v2/src/lib/normalize/rankOrdinal.ts`.
- **Hero keys** are OverFast's (`all-heroes`, `ana`, `soldier-76`, …), not normalised.
- **Null means absent.** Blizzard omits zero-valued stats, so a missing stat is
  stored as `null`. Never coerce it to 0 in the pipeline; the SPA already
  handles it.

### File format (the deterministic writer in `store.mjs`)

Every dataset file is valid JSON written as a header line, **one row per
line**, and a closing line, so git diffs show only the rows that changed:

```
{"season":25,"generatedAt":1792803080655,"rows":[
{"player":"DarthKcaj-1443","role":"damage","day":1791417600000,"tier":5,"division":"silver","season":25},
{"player":"DarthKcaj-1443","role":"support","day":1791417600000,"tier":3,"division":"gold","season":25}
]}
```

- Write each row with `JSON.stringify` in the **key order given below**.
  Use `"rows":[]}` for an empty dataset. End the file with `\n`.
- Sort with plain `<` comparisons (no `localeCompare`) using the sort keys listed per dataset.
- Global files (`rank-current`, `profiles`) have no `"season"` key:
  `{"generatedAt":…,"rows":[…]}`, the same as today's `SnapshotFile`.
- **Only rewrite a file when its rows changed.** `generatedAt` is the time of
  the last row change, so a frozen season's files never churn.
  `meta.json` and `pipeline/state.json` are pretty-printed (2-space indent)
  and `meta.json` is written on every poll.

### `docs/data/seasons/<N>/` — per-season roll-ups

Row types are exactly today's interfaces in `web-v2/src/types/snapshots.ts`.

| File | Row type | Unique key | Sort | Contents |
|---|---|---|---|---|
| `rank-daily.json` | `RankDailyRow` `{player, role, day, tier, division, season}` | player, role, day | day, player, role | `season` always equals `N` |
| `career-daily.json` | `CareerDailyRow` `{player, day, eliminations, deaths, assists, gamesWon, gamesPlayed}` | player, day | day, player | hero `all-heroes` only |
| `career-hero-daily.json` | `CareerHeroDailyRow` `{player, hero, day, eliminations, deaths, assists, gamesPlayed, timePlayed}` | player, hero, day | day, player, hero | real heroes only (no `all-heroes`) |
| `career-latest.json` | `CareerLatestRow` `{player, hero, time, eliminations, deaths, assists, healingDone, healingPer10Min, gamesWon, gamesPlayed, winPercentage, timePlayed}` | player, hero | player, hero | includes `all-heroes`; `time` = last poll that saw the row |

Header: `{"season":N,"generatedAt":ms,"rows":[…]}`.

### `docs/data/snapshots/` — global "now" files

- `rank-current.json`: `RankRow` `{player, role, time, tier, division, season}`,
  latest per (player, role) from **any** season. `season` is the raw reported
  value (may be null). Sort: player, role.
- `profiles.json`: `ProfileRow` `{player, time, username, avatar, namecard,
  title, endorsementLevel, endorsementFrame, lastUpdatedAt}`. `lastUpdatedAt`
  is new and optional (OverFast `summary.last_updated_at × 1000`, or null).
  Sort: player.
- `rank-icons.json` (optional, pretty-printed; written once a poll has seen a
  rank insignia URL): the official insignia for the player page's rank cards.
  The URLs carry content hashes and older profiles use an older format, so
  they are captured from OverFast's `rank_icon` / `tier_icon`, never derived:

  ```json
  { "generatedAt": 1792803080655,
    "divisions": { "gold": { "url": "https://static.playoverwatch.com/…/Rank_GoldTier.8d40….png", "season": 25 } },
    "tiers":     { "3":    { "url": "https://static.playoverwatch.com/…/TierDivision_3.e9d8….png", "season": 25 } } }
  ```

  `divisions` is keyed by the lower-case tier **name** and `tiers` by the
  division **number** `"1"`–`"5"` (the naming quirk again). Every ingested rank
  updates the map; on a conflict the URL seen with the highest rank `season`
  wins (a rank with a null season counts as its player's season), and on a tie
  the newer poll. Rows keep their contracts: no icon fields are added to them.
  Like the datasets, the file is only rewritten when its content changes.
- `meta.json` (pretty-printed). Fields already in today's `SnapshotMeta` keep their meaning:

```json
{
  "layoutVersion": 2,
  "generatedAt": 1792803080655,
  "heartbeatAt": 1792803080655,
  "gamemode": "competitive",
  "platform": "pc",
  "players": ["Kieness-6123", "DarthKcaj-1443"],
  "currentSeason": 25,
  "maxSeason": 25,
  "seasonStart": 1791417600000,
  "seasonByPlayer": { "DarthKcaj-1443": 25, "Kieness-6123": 24 },
  "playerSeason": { "DarthKcaj-1443": 25, "Kieness-6123": 24 },
  "seasons": [
    { "season": 24, "firstDay": 1786492800000, "lastDay": 1791417600000 },
    { "season": 25, "firstDay": 1791417600000, "lastDay": 1792800000000 }
  ],
  "lastPoll": { "at": 1792803080655, "source": "poll", "ok": ["DarthKcaj-1443"], "failed": [{ "player": "Kieness-6123", "error": "HTTP 503" }] }
}
```

| Field | Meaning |
|---|---|
| `layoutVersion` | `2`. The SPA uses this to choose season paths over the legacy flat layout. |
| `generatedAt` | When this poll finished. Written every poll; drives the stale banner. |
| `heartbeatAt` | The last poll where ≥1 player was fetched OK (kept for compatibility). |
| `players` | Roster ids from `config/tracked-battletags.txt`. |
| `currentSeason` / `maxSeason` | The global season (`maxSeason` is a compat alias). `null` only on an empty store. |
| `seasonStart` | `firstDay` of `currentSeason`, or `null`. |
| `seasonByPlayer` | Compat: the latest **reported** rank season per player (from `rank-current`, newest row by `time`), same as today. |
| `playerSeason` | The season each player's **counters** belong to (from `state.json`). |
| `seasons` | Every non-empty season directory with the min/max `day` across its three daily files, ascending. |
| `lastPoll` | `source` is `poll` or `backfill`. `failed` lists players that errored this run. |

### `docs/data/pipeline/state.json` — the poller's memory

```json
{
  "version": 1,
  "currentSeason": 25,
  "currentSeasonDetectedAt": 1791460800000,
  "players": {
    "DarthKcaj-1443": { "season": 25, "lastFetchedAt": 1792803080655, "lastReason": "unchanged" }
  }
}
```

The previous counters for a player are **not** duplicated here. They are read
from `seasons/<players[p].season>/career-latest.json` (the `all-heroes` row).

---

## Pipeline behaviour

### 1. Poll (WP2, `overfast.mjs` + `poll.mjs`)

- `GET ${OVERFAST_BASE_URL:-https://overfast-api.tekrop.fr}/players/${encodeURIComponent(playerId)}`
  with headers `Accept: application/json` and
  `User-Agent: OW-Live-Report-poller/1.0 (+https://github.com/mattjsawyer/ow-live-report)`.
  Use `AbortSignal.timeout(30_000)`.
- Fetch players **one at a time** with a 1 s pause between them (OverFast is a
  free community API; 7 players × 2/day is trivial load).
- On 429, 5xx or a network error, retry up to 3 times with 2 s / 4 s / 8 s
  backoff, honouring `Retry-After` (seconds, capped at 60). A 404 is not
  retried; record it as `player not found (OverFast may not have indexed them yet)`.
  Any other 4xx fails that player with no retry.
- With `--raw-dir <dir>`, save each body as `<dir>/<playerId>.json` (uploaded
  as an artifact, never committed).
- With `--fixtures <dir>`, read `<dir>/<playerId>.json` instead of the network
  (offline mode for tests and local runs). A missing fixture counts as a fetch failure.

### 2. Extract (WP1, `extract.mjs`)

`extractSample(playerId, body, fetchedAt, { platform = 'pc', gamemode = 'competitive' })` returns:

```js
{
  player: 'DarthKcaj-1443',
  fetchedAt: 1792803080655,
  day: 1792800000000,
  rankSeason: 25,                       // summary.competitive.pc.season ?? null
  ranks: [{ role: 'support', tier: 3, division: 'gold', season: 25,
            rankIcon: 'https://…/Rank_GoldTier.….png', tierIcon: 'https://…/TierDivision_3.….png' }],
  profile: { username, avatar, namecard, title, endorsementLevel, endorsementFrame, lastUpdatedAt } | null,
  career: { 'all-heroes': { eliminations, deaths, assists, healingDone, healingPer10Min,
                            gamesWon, gamesPlayed, winPercentage, timePlayed }, ana: { … } } | null,
}
```

| Sample field | OverFast path | Rule |
|---|---|---|
| `rankSeason` | `summary.competitive[platform].season` | null if missing |
| `ranks[]` | `summary.competitive[platform][role]` for each role | skip a role if it's null or lacks `division`/`tier`; `season` = `rankSeason`; `rankIcon` / `tierIcon` = `rank_icon` / `tier_icon` (string, else null) |
| `profile.username` / `avatar` / `namecard` / `title` | `summary.<same>` | string or null |
| `profile.endorsementLevel` / `endorsementFrame` | `summary.endorsement.level` / `.frame` | |
| `profile.lastUpdatedAt` | `summary.last_updated_at` | seconds → ms, null if missing |
| `career[hero]` | `stats[platform][gamemode].career_stats[hero]` | a list of `{category, stats: [{key, value}]}` |

Career field mapping, the same metrics `fetch-snapshots.mjs` reads today:

| category | key | field |
|---|---|---|
| combat | `eliminations` | `eliminations` |
| combat | `deaths` | `deaths` |
| assists | `assists` | `assists` |
| assists | `healing_done` | `healingDone` |
| average | `healing_done_avg_per_10_min` | `healingPer10Min` |
| game | `games_won` | `gamesWon` |
| game | `games_played` | `gamesPlayed` |
| game | `win_percentage` | `winPercentage` |
| game | `time_played` | `timePlayed` (seconds) |

Look up each key in its own category first, then in any of the four
categories. Coerce values with `Number()`, and use `null` for anything absent
or non-finite. `career` is `null` when `stats`, the platform, the gamemode or
`career_stats` is missing (a private profile or no competitive play). A
`null` `summary` gives `profile: null, ranks: [], rankSeason: null`.

Shape reference for building fixtures. The values are real (DarthKcaj's S24
career-latest row); the structure matches `scrape.py`'s walker. **Check it
against a real response** from the WP5 dry-run artifact:

```json
{
  "summary": {
    "username": "DarthKcaj",
    "avatar": "https://d15f34w2p8l1cc.cloudfront.net/overwatch/f6cc….png",
    "namecard": "https://d15f34w2p8l1cc.cloudfront.net/overwatch/9a9d….png",
    "title": "Platinum Support",
    "endorsement": { "level": 5, "frame": "https://static.playoverwatch.com/…/5.47a7….svg#icon" },
    "competitive": {
      "pc": {
        "season": 25,
        "tank": null,
        "damage":  { "division": "silver", "tier": 5, "role_icon": "…", "rank_icon": "…", "tier_icon": "…" },
        "support": { "division": "gold",   "tier": 3, "role_icon": "…", "rank_icon": "…", "tier_icon": "…" },
        "open": null
      },
      "console": null
    },
    "last_updated_at": 1792800000
  },
  "stats": {
    "pc": {
      "competitive": {
        "heroes_comparisons": { "time_played": { "label": "Time Played", "values": [{ "hero": "ana", "value": 4000 }] } },
        "career_stats": {
          "all-heroes": [
            { "category": "assists", "label": "Assists", "stats": [
              { "key": "assists", "label": "Assists", "value": 6658 },
              { "key": "healing_done", "label": "Healing Done", "value": 4028795 } ] },
            { "category": "average", "label": "Average", "stats": [
              { "key": "healing_done_avg_per_10_min", "label": "Healing Done - Avg per 10 Min", "value": 8433 } ] },
            { "category": "combat", "label": "Combat", "stats": [
              { "key": "eliminations", "label": "Eliminations", "value": 4419 },
              { "key": "deaths", "label": "Deaths", "value": 3203 } ] },
            { "category": "game", "label": "Game", "stats": [
              { "key": "time_played", "label": "Time Played", "value": 286661 },
              { "key": "games_played", "label": "Games Played", "value": 430 },
              { "key": "games_won", "label": "Games Won", "value": 213 } ] }
          ],
          "ana": [ "…same structure; may also carry best / hero_specific / match_awards categories (ignored)…" ]
        }
      },
      "quickplay": { "…": "ignored" }
    },
    "console": null
  }
}
```

### 3. Season assignment (WP1, `season.mjs` + `rollup.mjs`)

Constants live in `constants.mjs`: `GRACE_MS = 36h`, `MIN_SEASON_MS = 21 days`.

```js
// prevAll(p) = all-heroes row of seasons/<state.players[p].season>/career-latest.json, or null.

function isCounterReset(prev, cur) {        // both are all-heroes career objects
  if (!prev || !cur) return false;
  const dropped = (k) => prev[k] != null && cur[k] != null && cur[k] < prev[k];
  // Two independent counters must fall, so one glitched field can't fake a rollover.
  return dropped('gamesPlayed') && (dropped('timePlayed') || dropped('eliminations'));
}

function countersChanged(prev, cur) {      // "has played since": games played only.
  if (!cur) return false;                   // Time played jitters by a second or two between
  if (!prev) return true;                   // sources and must not move an idle player (found
  const b = cur.gamesPlayed ?? null;        // in the end-to-end check after WP3).
  return b !== null && b !== (prev.gamesPlayed ?? null);
}

export function ingestPoll(store, samples, { now, graceMs = GRACE_MS, minSeasonMs = MIN_SEASON_MS, forceSeason = null }) {
  const st = store.state;
  if (forceSeason != null && forceSeason > (st.currentSeason ?? -Infinity)) {
    st.currentSeason = forceSeason;
    st.currentSeasonDetectedAt = now;
  }
  const g0 = st.currentSeason;                          // global season before this poll (may be null)
  const seasonOldEnough = st.currentSeasonDetectedAt == null
    || now - st.currentSeasonDetectedAt >= minSeasonMs;

  // Pass 1: strong signals. These may raise the global season.
  const strong = new Map();
  for (const s of samples) {
    const ps = st.players[s.player];
    if (!ps) {
      strong.set(s.player, { season: s.rankSeason ?? g0, reason: 'new-player' });   // season may be null → resolved in pass 2
    } else if (s.rankSeason != null && s.rankSeason > ps.season) {
      strong.set(s.player, { season: s.rankSeason, reason: 'rank-season' });
    } else if (isCounterReset(prevAll(s.player), s.career?.['all-heroes'])) {
      const season = Math.max(g0 ?? 0, ps.season + 1);
      if (season > (g0 ?? 0) && !seasonOldEnough) {
        // A reset that would start a new global season < 21 days after the last one is
        // treated as a data glitch: skip this player's career rows this poll, warn.
        strong.set(s.player, { blocked: true, reason: 'reset-too-soon' });
      } else {
        strong.set(s.player, { season, reason: 'counter-reset' });
      }
    }
  }
  const candidates = [g0, ...samples.map((s) => s.rankSeason), ...[...strong.values()].map((v) => v.season)]
    .filter(Number.isInteger);
  if (!candidates.length) throw new Error('Cannot determine the current season; rerun with --force-season N');
  const g1 = Math.max(...candidates);
  if (g1 !== g0) { st.currentSeason = g1; st.currentSeasonDetectedAt = now; }

  // Pass 2: final per-player season, then write.
  const assignments = [];
  for (const s of samples) {
    const ps = st.players[s.player];
    const sig = strong.get(s.player);
    let season; let reason; let writeCareer = true;
    if (sig?.blocked) { season = ps.season; reason = sig.reason; writeCareer = false; }
    else if (sig) { season = sig.season ?? g1; reason = sig.reason; }
    else if (g1 > ps.season
      && now - st.currentSeasonDetectedAt >= graceMs
      && countersChanged(prevAll(s.player), s.career?.['all-heroes'])) {
      // The global season rolled over more than 36h ago and this carry-over player's
      // numbers moved: that can only be new-season play (catches light players whose
      // new totals already exceed last season's, so isCounterReset never fires).
      season = g1; reason = 'post-grace-change';
    } else { season = ps.season; reason = 'unchanged'; }
    st.players[s.player] = { season, lastFetchedAt: s.fetchedAt, lastReason: reason };
    writeSample(store, s, { season, current: g1, writeCareer });
    assignments.push({ player: s.player, season, reason });
  }
  return { assignments, currentSeason: g1 };
}
```

Notes:

- Read `prevAll` for a player **before** that player's write. The two passes
  make the result independent of roster order.
- Inside the grace window, a carry-over player whose counters go **up** is
  treated as having played the last day(s) of the old season. Those values go
  into the old season's bucket, change-only (see below).
- **Known limitation:** a light player whose new-season totals pass last
  season's before the first poll, and who then never plays again, stays filed
  under the old season. It's rare, fixable with `force_season`, and every
  write is in git so it can be reverted.

### 4. Compact (WP1, `rollup.mjs`)

```js
function writeSample(store, s, { season, current, writeCareer }) {
  const changeOnly = (target) => target !== current;     // only the current season is forward-filled
  if (s.profile) store.profiles.set(s.player, { player: s.player, time: s.fetchedAt, ...s.profile });
  for (const r of s.ranks) {
    const rowSeason = r.season ?? season;
    store.rankCurrent.set(`${s.player}|${r.role}`,
      { player: s.player, role: r.role, time: s.fetchedAt, tier: r.tier, division: r.division, season: r.season });
    upsertDaily(store.bucket(rowSeason).rankDaily, `${s.player}|${r.role}`,
      { player: s.player, role: r.role, day: s.day, tier: r.tier, division: r.division, season: rowSeason },
      { changeOnly: changeOnly(rowSeason) });
  }
  if (!writeCareer || !s.career) return;
  const b = store.bucket(season);
  for (const [hero, c] of Object.entries(s.career)) {
    if (hero === 'all-heroes') {
      upsertDaily(b.careerDaily, s.player, { player: s.player, day: s.day, eliminations: c.eliminations,
        deaths: c.deaths, assists: c.assists, gamesWon: c.gamesWon, gamesPlayed: c.gamesPlayed },
        { changeOnly: changeOnly(season) });
    } else {
      upsertDaily(b.careerHeroDaily, `${s.player}|${hero}`, { player: s.player, hero, day: s.day,
        eliminations: c.eliminations, deaths: c.deaths, assists: c.assists,
        gamesPlayed: c.gamesPlayed, timePlayed: c.timePlayed }, { changeOnly: changeOnly(season) });
    }
    upsertLatest(b.careerLatest, `${s.player}|${hero}`, { player: s.player, hero, time: s.fetchedAt, ...c },
      { changeOnly: changeOnly(season) });
  }
}
```

**Merge rule (D2).** When a row already exists for the key (a second poll the same day):

| Field class | Fields | Rule |
|---|---|---|
| Counters | `eliminations, deaths, assists, healingDone, gamesWon, gamesPlayed, timePlayed` | `max(existing, incoming)`; `null` loses to any number. If incoming is lower and the season didn't change, log a `non-monotonic` warning. |
| Last-wins | `tier, division, season, healingPer10Min, winPercentage`, all profile fields | the incoming value, including `null` |
| `time` (latest/current rows) | | `max(existing.time, incoming.time)` |

`career-latest.json` rows are only max-merged with a row from the **same UTC
day**. A row from an earlier day is replaced (last-wins, `time` still max), so
one transient high reading can't stick for the rest of the season. In
replays, per-hero rows that lag a reset would otherwise pin an inflated
total and trigger false `post-grace-change` moves. (Found during WP1.)

**Write rule.**

- **Current season**: always upsert today's row. Players who belong to the
  current season therefore get one row per day while polls run. That is the
  same density the DB's daily table had, which the charts expect.
- **Any other season** (a carry-over player, a stale rank season): **change-only**.
  `upsertDaily` compares the incoming row with the **latest existing row for
  the same series** (any day). If every value field is equal it does nothing;
  otherwise it upserts today's row. `upsertLatest` compares all fields except
  `time`. This stops inactive players (Kiddo, Shotdownboyz) from flat-lining
  across old seasons while still catching late old-season updates.
- No buckets are ever frozen or moved. "Archived" just means "not current", so
  only change-only writes reach it.

### 5. Bake (WP1, `meta.mjs` + `store.mjs`)

`buildMeta(store, { now, players, lastPoll, gamemode, platform, previousMeta })`
produces `meta.json` as specified above. `heartbeatAt` is `now` when
`lastPoll.ok.length > 0`, otherwise `previousMeta.heartbeatAt`.
`saveStore(store, dataDir)` writes only changed files and returns
`{ written: [...], unchanged: [...] }`.

`loadStore(dataDir)` must cope with an empty or missing tree (empty maps and
`state = { version: 1, currentSeason: null, currentSeasonDetectedAt: null, players: {} }`).
It ignores the legacy flat files in `snapshots/` (`rank-daily.json`,
`career-*.json`). All season directories get loaded; they're small.

### Failure handling (WP2 `poll.mjs`)

| Situation | Behaviour |
|---|---|
| Some players fail to fetch | Ingest the others and list the failures in `meta.lastPoll.failed`; print `::warning::` per player. Exit 0. |
| **Every** player fails | Write nothing; `::error::`; exit 1 (the workflow fails, GitHub emails, data stays intact). |
| Every successful sample has `career === null` **and** `ranks.length === 0` | Probably an OverFast schema change: write nothing, `::error::`, exit 1. |
| `reset-too-soon` | Warning only; that player's rank/profile still update. |
| `validate.mjs` fails | Job fails before the commit step, so nothing reaches `main`. |
| A bad poll got committed anyway | `git revert` the `data: poll …` commit(s). Everything is plain files in git. |

`validate.mjs --data-dir <dir>`. **Errors** (exit 1):

- `meta.layoutVersion !== 2`; `currentSeason` is neither an integer nor null;
  `seasons[]` doesn't match the season directories.
- A file doesn't parse, or a header's `season` doesn't match its directory.
- A row is missing a key or has the wrong type; duplicate unique keys; rows not sorted.
- A `day` that isn't UTC midnight, or that is later than tomorrow.
- A `rank-daily` row whose `season` ≠ its directory.
- `lastPoll.ok` is empty.

**Warnings** (`::warning::`): a counter falling day over day inside one season
series; any file over 5 MB; a roster player missing from `profiles.json`.
`poll.mjs` prints a per-player table (`player | status | season | reason`)
and appends it to `$GITHUB_STEP_SUMMARY` when that is set.

---

## Workflows

### `.github/workflows/poll-stats.yml` (new — WP2)

```yaml
name: Poll OverFast stats

# Twice daily: fetch every rostered player from the OverFast API, compact the
# results into the current season's daily roll-ups under docs/data/, and
# commit. Replaces the TimescaleDB backend and refresh-data.yml. See
# plan/v3-static-season-snapshots.md.
#
# Scheduled runs only execute where the OW_POLL_ENABLED repository variable
# is 'true' (the repo GitHub Pages serves), so forks never write data.

on:
  schedule:
    # 09:37 + 21:37 UTC. Upstream changes land 11:00-20:00 UTC (see PRD);
    # the off-the-hour minute dodges GitHub's top-of-hour queueing.
    - cron: '37 9,21 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Poll and compact, upload the result as an artifact, but do not commit'
        type: boolean
        default: false
      force_season:
        description: 'Force the current season to this number (blank = auto-detect)'
        type: string
        default: ''

permissions:
  contents: write

jobs:
  poll:
    if: github.event_name == 'workflow_dispatch' || vars.OW_POLL_ENABLED == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # Shared with deploy.yml: both push to main. Job-level so a scheduled run
    # skipped by the `if` above never claims the group (and so can't displace
    # a deploy waiting in it).
    concurrency:
      group: deploy
      cancel-in-progress: false

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: main

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      # The pipeline uses only Node built-ins (global fetch, node:fs), so
      # there is no pnpm install here.
      - name: Poll OverFast and compact into daily roll-ups
        working-directory: web-v2
        env:
          FORCE_SEASON: ${{ inputs.force_season }}
        run: node scripts/pipeline/poll.mjs --data-dir ../docs/data --raw-dir ../poll-raw

      - name: Validate data tree
        working-directory: web-v2
        run: node scripts/pipeline/validate.mjs --data-dir ../docs/data

      - name: Upload raw responses and resulting data
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: poll-${{ github.run_id }}
          path: |
            poll-raw/
            docs/data/
          retention-days: 14
          if-no-files-found: ignore

      - name: Commit data back to main
        if: ${{ !inputs.dry_run }}
        run: |
          set -euo pipefail
          git config user.name  'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add docs/data
          if git diff --cached --quiet; then
            echo 'No data changes to commit.'
            exit 0
          fi
          git commit -m "data: poll $(date -u +%Y-%m-%dT%H:%MZ) [skip ci]"

          # Retry push to ride out any concurrent push to main.
          for attempt in 1 2 3 4 5; do
            if git push origin HEAD:main; then
              echo "Pushed on attempt $attempt"
              exit 0
            fi
            echo "Push failed (attempt $attempt). Fetching + rebasing."
            git fetch origin main
            git rebase origin/main
          done
          echo 'Push failed after 5 attempts.'
          exit 1
```

`poll.mjs` reads `FORCE_SEASON` from the environment (blank means unset) as
well as `--force-season N`. Add `poll-raw/` to the root `.gitignore`.

Because `meta.json` changes on every poll, there is always one commit per
poll, which also keeps the repo "active" for GitHub's 60-day
scheduled-workflow auto-disable rule.

### `.github/workflows/backfill-history.yml` (new, temporary — WP3)

A one-shot migration, deleted in WP6.

```yaml
name: Backfill season history (one-shot)

on:
  workflow_dispatch:
    inputs:
      source:
        description: 'db = TimescaleDB daily table (full history); snapshots = legacy docs/data/snapshots files (~120 days)'
        type: choice
        options: [db, snapshots]
        default: db
      dry_run:
        description: 'Upload the result as an artifact, but do not commit'
        type: boolean
        default: true

permissions:
  contents: write

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  backfill:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with: { ref: main }
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm, cache-dependency-path: web-v2/pnpm-lock.yaml }
      - name: Install dependencies (pg)
        working-directory: web-v2
        run: pnpm install --frozen-lockfile
      - name: Replay history into seasons/
        working-directory: web-v2
        env:
          STATS_DB_URL: ${{ vars.STATS_DB_URL || 'postgresql://readonly:owstats-readonly@owstats.jhiggins.tech:5432/ow_stats?sslmode=require' }}
        run: >
          node scripts/pipeline/backfill-from-db.mjs --data-dir ../docs/data --force
          ${{ inputs.source == 'snapshots' && '--from-snapshots ../docs/data/snapshots' || '' }}
      - name: Validate data tree
        working-directory: web-v2
        run: node scripts/pipeline/validate.mjs --data-dir ../docs/data
      - uses: actions/upload-artifact@v4
        with:
          name: backfill-${{ github.run_id }}
          path: docs/data/
          retention-days: 30
      - name: Commit
        if: ${{ !inputs.dry_run }}
        run: |
          # same commit/push loop as poll-stats.yml, message:
          # "data: backfill season history from ${{ inputs.source }} [skip ci]"
```

### `.github/workflows/deploy.yml` (modified — WP4)

Delete two steps: **"Seed data snapshots from previous deploy"** and **"Refresh
data snapshots"**. Nothing else changes. Vite's `emptyOutDir: false` already
leaves `docs/data/{snapshots,seasons,pipeline}` alone, and `public/` now only
supplies `roster.json` and `runtime-config.json`.

### `.github/workflows/refresh-data.yml` — disabled at cutover (WP5), deleted in WP5's cleanup PR.

---

## Frontend changes (WP4)

All changes are small and **backwards-compatible**: if `meta.layoutVersion !== 2`,
the SPA reads the legacy flat files exactly as it does today. WP4 can therefore
merge before the data migration.

1. **`web-v2/src/types/snapshots.ts`**
   - `SnapshotMeta`: add optional `layoutVersion?: number`, `currentSeason?: number | null`,
     `platform?: string`, `playerSeason?: Record<string, number>`,
     `seasons?: Array<{ season: number; firstDay: number; lastDay: number }>`,
     `lastPoll?: { at: number; source: string; ok: string[]; failed: Array<{ player: string; error: string }> }`.
   - `SnapshotFile<T>`: add optional `season?: number`.
   - `ProfileRow`: add optional `lastUpdatedAt?: number | null`.
   - Update the header comment: "baked by scripts/pipeline/poll.mjs from the OverFast API".
2. **`web-v2/src/lib/snapshotClient.ts`**
   - Split URL building out of `fetchSnapshot(name)` so it takes a cache key
     and a path relative to `data/`:
     ``fetchSnapshot<T>(cacheKey: string, rel = `snapshots/${cacheKey}.json`)``.
   - Add:
     ```ts
     type SeasonDataset = 'rank-daily' | 'career-latest' | 'career-daily' | 'career-hero-daily';
     async function fetchSeasonDataset<T>(name: SeasonDataset, season?: number): Promise<SnapshotFile<T>> {
       const meta = await loadMeta();
       if (meta.layoutVersion !== 2) return fetchSnapshot(name);          // legacy flat layout
       const s = season ?? meta.currentSeason ?? null;
       if (s === null) return { generatedAt: meta.generatedAt, rows: [] };
       return fetchSnapshot(`s${s}:${name}`, `seasons/${s}/${name}.json`);
     }
     ```
   - `loadRankDaily`, `loadCareerLatest`, `loadCareerDaily` and
     `loadCareerHeroDaily` delegate to `fetchSeasonDataset` and take an optional
     `season?: number` (for WP7a). `loadRankCurrent` and `loadProfiles` stay global.
   - `SNAPSHOT_STALE_MS` → `30 * 60 * 60 * 1000`: two polls a day, plus cron
     delay, plus one missed run. Update the "refreshed hourly" comments.
3. **`web-v2/src/lib/queries/seasonWindow.ts`**: at the top of
   `fetchCurrentCompetitiveSeasonStart`, load meta and
   `if (meta.layoutVersion === 2) return meta.seasonStart ?? null;`. Season
   files are already season-scoped, and the old rank-derived start would cut
   off the days between a counter reset and the first new-season rank. Keep
   the legacy code path below it.
4. **`web-v2/src/main.tsx`**: bump the persister key `owr-v2:react-query:v3` → `v4`.
5. **Copy**: in `SettingsPage.tsx`, "hourly-refreshed data snapshots" →
   "data snapshots refreshed twice a day"; fix the `rankTrend.ts` comment
   that mentions 14-day raw retention.
6. **`web-v2/vite.config.ts`**: add a dev-only middleware that serves the
   committed data tree, so `pnpm dev` shows real data without copying it into
   `public/` (a copy there would be published back over `docs/` by the next
   build):
   ```ts
   import { createReadStream, existsSync, statSync } from 'node:fs';
   import { resolve } from 'node:path';
   import { fileURLToPath } from 'node:url';
   import { defineConfig, type Plugin } from 'vite';
   import react from '@vitejs/plugin-react';

   const DOCS_DATA = fileURLToPath(new URL('../docs/data/', import.meta.url));

   // Dev only: serve docs/data/{snapshots,seasons}/ straight from the
   // committed tree instead of copying it into public/.
   function serveCommittedData(): Plugin {
     return {
       name: 'owr-serve-committed-data',
       apply: 'serve',
       configureServer(server) {
         server.middlewares.use((req, res, next) => {
           const path = (req.url ?? '').split('?')[0] ?? '';
           const m = path.match(/^\/OW-Live-Report\/data\/((?:snapshots|seasons)\/.+\.json)$/);
           if (!m) return next();
           const file = resolve(DOCS_DATA, m[1]!);
           if (!file.startsWith(DOCS_DATA) || !existsSync(file) || !statSync(file).isFile()) return next();
           res.setHeader('Content-Type', 'application/json');
           createReadStream(file).pipe(res);
         });
       },
     };
   }
   ```
   Then `plugins: [react(), serveCommittedData()]`. (`tsconfig.json` only
   includes `src/`, so the Node imports don't need `@types/node`.)
7. **`web-v2/package.json`**: remove the `fetch:snapshots` script in WP5's
   cleanup PR, not here.
8. **`README.md`**: rewrite the data-flow paragraphs, "Local dev" (no DB
   needed anymore; `pnpm dev` reads `docs/data`) and "Deploy" (poll-stats.yml
   twice daily replaces refresh-data.yml).

No other query module changes. Season scoping comes from the files themselves,
and the 90-day `TIME_WINDOWS` are longer than a season (~8 weeks).

---

## Work packages

### Rules for every agent

- **Read this PRD first.** The [Data contract](#data-contract-authoritative--every-wp-codes-against-this)
  and [Pipeline behaviour](#pipeline-behaviour) sections are the spec. If you
  find a real contradiction, fix it in this PRD in the same PR and say so in
  the PR description.
- **Runtime:** CI runs Node 20. Use only Node built-ins: global `fetch`,
  `node:fs`, `node:path`, `node:test`, `node:assert/strict`. **No new
  dependencies.** `pg` is already a devDependency and only WP3 uses it. Don't
  use Node ≥ 21-only APIs such as `fs.globSync` or `--test` glob arguments.
- **Style:** match `web-v2/scripts/fetch-snapshots.mjs`. ESM `.mjs`, 2-space
  indent, single quotes, semicolons, a header comment explaining the file's
  purpose and where it runs, and short "why" comments at a similar density.
  Pure functions go in the library modules; I/O goes in `store.mjs` and the CLIs.
- **Sandbox network:** agent sandboxes may block `overfast-api.tekrop.fr` and
  `owstats.jhiggins.tech:5432`. Never depend on them in tests. Use
  `__fixtures__/` and the `--from-snapshots` replay over the committed
  `docs/data/snapshots/` files. Real-network verification happens through the
  `workflow_dispatch` dry runs in WP5.
- **Don't commit generated output.** `pnpm build` writes into `docs/`. Before
  committing, run `git checkout -- docs && git clean -fdq docs` unless your WP
  says otherwise. Only workflows commit data.
- **Pre-push checks** (from `web-v2/`): `pnpm install --frozen-lockfile &&
  pnpm test:pipeline && pnpm typecheck && pnpm build`.
- **Everything ships inert.** No WP before WP5 may enable polling, delete the
  legacy snapshot files, or remove `refresh-data.yml`.
- One PR per WP, with a conventional-commit title (`feat(pipeline): …`, `ci: …`, `docs: …`).

### WP0 — Sync the fork with upstream *(small; do first)*

- In `jhiggins-tech/OW-Live-Report`, merge `mattjsawyer/ow-live-report` `main`
  into the working branch (`git remote add upstream
  https://github.com/mattjsawyer/ow-live-report && git fetch upstream main &&
  git merge upstream/main`). For conflicts under `docs/`, take upstream's side
  (`git checkout --theirs docs/`); it's generated output and data.
- Check that `web-v2/src/lib/queries/currentPlayerRanks.ts` and
  `docs/data/snapshots/*.json` (meta should show `maxSeason: 25`) are present.
- Acceptance: `pnpm typecheck && pnpm build` pass; PR merged so every later WP
  branches from a base that has the role-rank cards and current data.

### WP1 — Pipeline core library + validator + tests *(large; on the critical path)*

**Owns:** `web-v2/scripts/pipeline/{constants,util,roster,extract,season,rollup,store,meta,validate}.mjs`,
their `*.test.mjs`, `web-v2/scripts/pipeline/__fixtures__/`, the
`web-v2/package.json` scripts, and the root `.gitignore` (`poll-raw/`).

Exports, which WP2 and WP3 code against:

```js
// constants.mjs
export const LAYOUT_VERSION = 2;
export const GAMEMODE = 'competitive';
export const PLATFORM = 'pc';
export const ROLES = ['tank', 'damage', 'support', 'open'];
export const GRACE_MS = 36 * 60 * 60 * 1000;
export const MIN_SEASON_MS = 21 * 24 * 60 * 60 * 1000;
export const COUNTER_FIELDS = ['eliminations', 'deaths', 'assists', 'healingDone', 'gamesWon', 'gamesPlayed', 'timePlayed'];
export const CAREER_FIELDS = [...COUNTER_FIELDS, 'healingPer10Min', 'winPercentage'];
// util.mjs
export function utcDay(ms) {}                       // → epoch ms of UTC midnight
// roster.mjs
export function loadRoster(rosterPath) {}           // → [{ battleTag, playerId, display }]
// extract.mjs
export function extractSample(playerId, body, fetchedAt, opts = {}) {}
// rollup.mjs (uses season.mjs helpers isCounterReset / countersChanged)
export function ingestPoll(store, samples, { now, graceMs, minSeasonMs, forceSeason }) {}  // → { assignments, currentSeason }
// store.mjs
export function emptyStore() {}
export function loadStore(dataDir) {}
export function saveStore(store, dataDir) {}         // → { written, unchanged }
// meta.mjs
export function buildMeta(store, { now, players, lastPoll, gamemode, platform, previousMeta }) {}
// validate.mjs: CLI (`--data-dir`) + export
export function validateDataDir(dataDir) {}          // → { errors: string[], warnings: string[] }
```

In-memory store shape (internal to WP1; WP2/3 use it only through the functions above):

```js
{
  state,                                    // pipeline/state.json contents
  previousMeta,                             // the meta.json that was loaded (or null)
  rankCurrent: Map<`${player}|${role}`, RankRow>,
  profiles: Map<player, ProfileRow>,
  seasons: Map<number, { rankDaily: Map, careerDaily: Map, careerHeroDaily: Map, careerLatest: Map }>,
  bucket(n),                                // get-or-create a season bucket
}
```

`package.json` scripts to add (pointing at files WP2 creates is fine):
`"test:pipeline": "node --test scripts/pipeline/*.test.mjs"`,
`"poll": "node scripts/pipeline/poll.mjs"`,
`"validate:data": "node scripts/pipeline/validate.mjs --data-dir ../docs/data"`.

**Tests (all required):**

| id | test |
|---|---|
| E1 | Full public profile fixture → ranks per present role, `rankSeason`, all-heroes and per-hero career with every mapped field; absent stats are `null`. |
| E2 | `stats: null` (private) → `career: null`, profile still filled. |
| E3 | `summary.competitive: null` → `ranks: []`, `rankSeason: null`. |
| E4 | A role with `tier` or `division` missing is skipped. |
| E5 | A key found only in a non-canonical category is still mapped (fallback lookup). |
| S1 | DarthKcaj S24→S25: prev gp 307 (S24); sample gp 4, `rankSeason` 25 → season 25, reason `rank-season`; global 24→25; `currentSeasonDetectedAt = now`. |
| S2 | Kieness S23→S24: prev gp 191 / higher time (S23); sample gp 8, `rankSeason` 23 → season 24 `counter-reset`; the stale S23 rank row is not added to S23 (change-only, identical to the last S23 row). |
| S3 | Tones inside the grace window: global just rolled to 24, Tones still S23 with unchanged counters → stays 23 `unchanged`, no career rows written anywhere. |
| S4 | Late old-season update inside grace: carry-over player's gp rises 34→36 within 36h of the rollover → row written to the S23 bucket (change-only), player stays 23. |
| S5 | Post-grace light player: prev gp 3 (S23), global 24 detected 3 days ago, sample gp 5 → season 24 `post-grace-change`. |
| S6 | Inactive player (Kiddo, S22, unchanged) while global is 25 → no season-file writes; `rank-current` and `profiles` still update. |
| S7 | New player, `rankSeason` null, global 25 → season 25 `new-player`. |
| S8 | Glitch guard: only `gamesPlayed` drops (time and elims rise) → no reset. |
| S9 | `reset-too-soon`: a reset 5 days after `currentSeasonDetectedAt` that would raise the global → `blocked`, no career writes, warning. |
| S10 | `forceSeason: 26` → global 26, detectedAt `now`. |
| S11 | Empty store, no rank seasons in any sample → throws "rerun with --force-season". |
| R1 | Two polls on the same UTC day → one row per key; counters MAX, rank/rates last-wins, latest `time` = later poll. |
| R2 | Second poll lower on one counter, same season → MAX keeps the higher value and a `non-monotonic` warning is emitted. |
| R3 | Current-season player with unchanged values on two consecutive days → two daily rows (forward-fill). |
| R4 | Non-current season with an unchanged sample → zero rows written. |
| W1 | `saveStore` is deterministic: two saves of the same store are byte-identical; rows one per line, sorted, key order as specified; unchanged files aren't rewritten and keep their `generatedAt`. |
| W2 | `loadStore` → `saveStore` round trip on a populated temp dir is a no-op (`written` is just `meta.json`). |
| M1 | `buildMeta`: `seasons[]` min/max days, `seasonStart`, `playerSeason`, `seasonByPlayer`, `heartbeatAt` carry-over when `ok` is empty. |
| V1 | `validateDataDir` passes on a store written by `saveStore`; fails on a duplicated key, an unsorted file, a non-midnight `day`, and a header season mismatch. |
| RP | **Replay on real data.** A helper (which WP3 can reuse) turns the committed legacy `docs/data/snapshots/{rank-daily,career-daily,career-hero-daily}.json` into one sample per (player, day). all-heroes `timePlayed` = the sum of that day's per-hero `timePlayed`. Run `ingestPoll` day by day with `now = day + 12h`. Assert the season timeline in the table below. |

Expected replay timeline (upstream data window 2026-06-27 → 2026-10-24). This
was checked when the PRD was written by running a reference implementation
of the [Season assignment](#3-season-assignment-wp1-seasonmjs--rollupmjs) pseudo-code over upstream's
`docs/data/snapshots/` at 2026-10-24. If your test disagrees, suspect the code
before the table. In S1/S2/S4/S5 set `currentSeasonDetectedAt` ≥ 21 days
before `now` unless the test is about that guard.

| Player | Expected season timeline |
|---|---|
| global | 23 → **24 on 2026-08-12** → **25 on 2026-10-08** |
| DarthKcaj-1443 | 23 → 24 on 2026-08-12 (`counter-reset`) → 25 on 2026-10-08 |
| Kieness-6123 | 23 → 24 on 2026-08-17 (`counter-reset`) |
| Tones-11680 | 23 → 24 on 2026-08-21 (`counter-reset`) |
| KiwiCore-1324 | 23 → 24 on 2026-08-28 (`counter-reset`) |
| Shotdownboyz-1119 | 23 throughout |
| Kiddo-11482 | 22 throughout |
| Lank-21912 | 23 throughout (new player, no rank → global) |

Keep the replay fixture small: copy only the rows needed into
`__fixtures__/replay/`, or read the committed files directly if they are
present and skip with a message if not.

Acceptance: `pnpm test:pipeline` green on Node 20 and 22; no dependency changes;
`validate.mjs` usable as a CLI.

### WP2 — OverFast client, poll CLI, workflow *(medium; after WP1)*

**Owns:** `web-v2/scripts/pipeline/{overfast,poll}.mjs`, `overfast.test.mjs`,
`poll.test.mjs`, `.github/workflows/poll-stats.yml`.

- `overfast.mjs`:
  `export async function fetchPlayer(playerId, { baseUrl, timeoutMs = 30_000, retries = 3, fetchImpl = fetch, sleep } = {})`
  → `{ ok: true, status, body } | { ok: false, status, error }`, implementing
  the [Poll](#1-poll-wp2-overfastmjs--pollmjs) rules. `fetchImpl` and `sleep`
  are injectable so tests run instantly.
- `poll.mjs` CLI: `--data-dir` (default `../../../docs/data` resolved from the
  script's location), `--roster` (default `config/tracked-battletags.txt` at
  the repo root), `--raw-dir`, `--fixtures`, `--now <ISO>` (tests only),
  `--force-season N` / `FORCE_SEASON`.
  Flow: roster → sequential fetch → `extractSample` → failure checks →
  `loadStore` → `ingestPoll` → `buildMeta` → `saveStore` → summary table / `$GITHUB_STEP_SUMMARY`.
- Tests: retry/backoff/404/429 handling with a fake `fetchImpl`; an end-to-end
  `poll.mjs` run with `--fixtures` against an `fs.mkdtempSync` data dir that
  polls day 1 twice and day 2 once, then asserts file contents and that
  `validateDataDir` passes; "all players failed" → exit 1 and nothing written.
- Workflow: copy the YAML in [Workflows](#githubworkflowspoll-statsyml-new--wp2) verbatim, adjusting only if a check proves it wrong.
- Acceptance: tests green; `node scripts/pipeline/poll.mjs --fixtures
  scripts/pipeline/__fixtures__/players --data-dir /tmp/x --now 2026-10-24T21:37:00Z`
  prints a sensible table; the workflow lints (`actionlint` if available) and
  stays inert without `OW_POLL_ENABLED`.

### WP3 — Backfill from TimescaleDB *(medium; after WP1, parallel with WP2)*

**Owns:** `web-v2/scripts/pipeline/backfill-from-db.mjs`, `backfill.test.mjs`,
`.github/workflows/backfill-history.yml`.

- CLI: `--data-dir`, `--force` (required when `seasons/` or `pipeline/state.json`
  already exists; deletes them first), `--from-snapshots <dir>` (offline
  source), `--initial-season N` (only if no rank season exists on day 1).
- **DB source.** Copy the connection setup from `fetch-snapshots.mjs`
  (`STATS_DB_URL`, `connectionTimeoutMillis: 20_000`, `query_timeout: 30_000`)
  rather than importing it, because that file is deleted at cutover. The
  server enforces a **15 s statement timeout**, so query `ow_stats_daily` in
  **14-day windows** from the earliest `day` (`SELECT min(day) FROM
  ow_stats_daily`) up to today:
  - rank: `measurement = 'competitive_rank' AND metric IN ('tier','division','season')`
  - career: `measurement IN ('career_stats_combat','career_stats_assists','career_stats_average','career_stats_game') AND gamemode = 'competitive' AND platform = 'pc' AND metric = ANY(<the 9 metrics>)`
  - profiles: reuse `fetchProfiles`' raw-then-daily "latest" logic once at the end.
- **Snapshots source** (`--from-snapshots`): use WP1's replay helper on the
  legacy files. Per-hero healing and win fields aren't in
  `career-hero-daily.json`, so take them from `career-latest.json` for the
  final day only; `profiles.json` and `rank-current.json` come as they are.
- Group rows by (day, player) into samples (`fetchedAt = day + 12h`,
  `profile: null`). Replay them in ascending day order with
  `ingestPoll(store, samplesOfDay, { now: day + 12h })`. Then set `profiles`
  from the latest-profile query, run
  `buildMeta(… lastPoll: { source: 'backfill', ok: players, failed: [] })`
  and `saveStore`.
- **Drop lagging per-hero rows on reset days** (found during WP3). The DB's
  daily table keeps each hero series' last sample of the day. On the day a
  player's counters reset, heroes they haven't played since the reset still
  carry last season's totals. On a reset day (`isCounterReset` against the
  previous day), keep a hero only if it's new or its `gamesPlayed`/`timePlayed`
  fell. Otherwise those rows leak into the new season's `career-latest.json`
  for good. Live polling isn't affected: one API response is self-consistent.
- **Read every input before writing anything.** `--from-snapshots` reads the
  same directory it writes `meta/rank-current/profiles` into. Leave the
  legacy flat files untouched.
- Print a season summary (season, firstDay, lastDay, players, rows per file)
  and cross-check: for every player whose final season is the current one,
  compare the replayed all-heroes `gamesPlayed` against the DB's latest value
  and warn on mismatches.
- Tests: a fake `pg` client (an object with `query()` returning canned rows)
  drives the DB path; the `--from-snapshots` path over the committed legacy
  files reproduces the WP1 RP timeline.
- Acceptance: run locally with `--from-snapshots ../docs/data/snapshots
  --data-dir /tmp/v2` (it must not touch the real `docs/data`); `validate.mjs`
  passes on `/tmp/v2`; the PR description includes the season summary.

### WP4 — Frontend reads season files *(medium; parallel with WP1)*

**Owns:** `web-v2/src/**`, `web-v2/vite.config.ts`, `.github/workflows/deploy.yml`, `README.md`.

Implement [Frontend changes](#frontend-changes-wp4) items 1–6 and 8, **plus
the optimizer fallback (WP7b, approved).** In `lib/queries/optimizerData.ts`,
when `meta.layoutVersion === 2`, a roster player with no rows in the current
season's `career-latest.json` uses their rows from
`seasons/<meta.playerSeason[player]>/career-latest.json` instead (load it with
`loadCareerLatest(season)`; skip it when `playerSeason` is missing or equals
the current season). Fallback rows skip the season `cutoff` filter. Expose
the season the data came from on the per-player optimizer result (for
example `dataSeason: number | null`, null meaning the current season), and
show a small label such as "S24 data" on that player's optimizer card. Only
the optimizer falls back; nothing else does.

To test without WP3, build a throwaway v2 tree in a temp copy of `docs/`:
copy `docs/data/snapshots/{rank-daily,career-latest,career-daily,career-hero-daily}.json`
into `seasons/25/`, then set `layoutVersion: 2`, `currentSeason: 25` and
`seasonStart` (the first `day` in `seasons/25/career-daily.json`) in its
`meta.json`. Never commit this tree.

Acceptance:
- `pnpm typecheck && pnpm build` pass.
- **Legacy check:** `pnpm preview` against the untouched `docs/` renders as before.
- **V2 check:** with the throwaway tree, `/`, `/players/darth-kcaj/` and
  `/optimizer/` render with data. Network requests go to `data/seasons/25/*.json`
  and none 404. Take Playwright screenshots (Chromium is preinstalled; `require('playwright')`)
  and attach them to the PR.
- `pnpm dev` serves `/OW-Live-Report/data/snapshots/meta.json` from `docs/data`.
- No changes under `web-v2/src/lib/queries/` other than `seasonWindow.ts`.

### WP5 — Cutover runbook *(👤 = a person with repo admin on `mattjsawyer/ow-live-report`; 🤖 = an agent)*

Run this on the fork (`jhiggins-tech/OW-Live-Report`) first, per D4.
Preconditions: WP1–WP4 merged into the canonical repo's `main`; the deploy is
green; the site looks unchanged (legacy layout).

1. 👤 Actions → **Refresh data snapshots** → *Disable workflow*. The DB keeps
   running for rollback.
2. 👤 Actions → **Backfill season history** → `source: db`, `dry_run: true`.
   🤖 Download the artifact; check the season summary (S24 ≈ 2026-08-12,
   S25 ≈ 2026-10-08 — the expected timeline holds back to whatever earlier
   seasons the DB has); spot-check current-season totals against the live
   site; run `validate.mjs` on it.
3. 👤 Re-run with `dry_run: false`. The site now reads `seasons/<current>/`;
   check that `/`, a player page and `/optimizer/` render.
4. 👤 Actions → **Poll OverFast stats** → `dry_run: true`. 🤖 Inspect
   `poll-raw/*.json` and **confirm the real response shape matches the
   [extraction reference](#2-extract-wp1-extractmjs)**; if it doesn't, fix
   `extract.mjs` and its fixtures first. Then 👤 run with `dry_run: false`.
5. 👤 Settings → Secrets and variables → Actions → Variables → add
   `OW_POLL_ENABLED = true`.
6. 🤖 Cleanup PR: delete `.github/workflows/refresh-data.yml`,
   `web-v2/scripts/fetch-snapshots.mjs`, the `fetch:snapshots` script and the
   legacy `docs/data/snapshots/{rank-daily,career-latest,career-daily,career-hero-daily}.json`;
   mark this PRD *Shipped* and v2.3 *Superseded* in `plan/README.md`.
7. **Soak for 7 days (~14 polls).** Every run is green, `meta.lastPoll.ok` has
   the whole roster, and charts move after play sessions.

**Rollback** (any time before WP6): revert the backfill and poll commits plus
the cleanup PR, delete `OW_POLL_ENABLED`, and re-enable **Refresh data
snapshots**. The SPA falls back to the legacy layout by itself.

### WP6 — Retire the backend *(after a clean soak)*

- 👤 In `ow-stats-influxdb`: run **Backup database** manually, download the
  `.dump`, and attach it to a GitHub Release (`final-backup-YYYY-MM-DD`;
  release assets don't expire like the 90-day artifacts do).
- 👤 On the droplet: `docker compose down`. Remove the self-hosted runner
  (repo Settings → Actions → Runners). Destroy the droplet, including any
  volumes, snapshots and backups that bill. Delete the `owstats.jhiggins.tech`
  DNS record.
- 🤖 PR in `ow-stats-influxdb`: a "Retired YYYY-MM-DD — collection moved to
  OW-Live-Report's poll-stats workflow" banner at the top of the README;
  delete `deploy.yml`, `backup.yml` and `migrate-to-timescale.yml`. Then 👤
  archive the repo.
- 🤖 PR in OW-Live-Report: delete `backfill-from-db.mjs`, `backfill.test.mjs`
  and `backfill-history.yml`; remove the `pg` devDependency (`pnpm remove pg`
  to update the lockfile); remove the legacy-layout fallback in
  `snapshotClient.ts` and `seasonWindow.ts`; drop TimescaleDB/`owstats`
  references from the README; 👤 delete the `STATS_DB_URL` repo variable if set.

### WP7 — Optional follow-ups (not needed for sign-off)

- **a. Season picker.** A header dropdown backed by `meta.seasons` plus a
  `?season=N` query param; the loaders already take `season`. For archived
  seasons, the `Date.now()`-relative cutoffs in `TIME_WINDOWS` users must
  become relative to that season's `lastDay`.
- **b. Optimizer previous-season fallback.** *Approved and moved into WP4.*
- **c. Bake OverFast hero meta** (`/heroes`, `/heroes/stats`) and per-player
  summaries into the poll, so the browser makes no third-party calls.
- **d. Use `profiles.lastUpdatedAt`** for the "fresh players" stat card
  instead of the poll time.

### Dependency graph

```
WP0 ──┬─▶ WP1 ──┬─▶ WP2 ──┐
      │         └─▶ WP3 ──┼─▶ WP5 ──▶ (soak) ──▶ WP6
      └─▶ WP4 ────────────┘
```

Two agents can start right after WP0 (WP1 and WP4), and two more after WP1 (WP2 and WP3).

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OverFast outage, slowness or a block on Actions IPs | Medium (it's community-run; `/heroes/stats` has returned 500s before) | A gap in daily rows | Retries; partial ingest; all-fail writes nothing; stale banner after 30h; the 14-day raw artifacts help diagnose |
| OverFast schema change | Low–medium | Bad rows | The extraction "all null" guard plus `validate.mjs` stop the commit; fixtures pin the expected shape |
| Season mis-assignment in an edge case | Low | Some rows filed in the wrong season | Two-signal reset, 21-day guard, grace window, `force_season`, everything revertable in git |
| GitHub cron delays or skipped runs | High (normal) | A late poll | Twice daily with MAX/last-wins merges is order-safe; the 30h stale threshold allows one missed run |
| Scheduled workflow auto-disabled after 60 days without activity | Low | Polling stops | Each poll commits `meta.json`; the stale banner surfaces it; re-enable in the Actions tab |
| Repo growth | Low | — | Roughly 0.7 MB per season of row files; one-row-per-line diffs come to a few KB per poll |
| Fork/upstream data divergence | Medium | Merge conflicts under `docs/data` | Polling is gated to one repo (D4); when syncing, take upstream's `docs/` |
| Losing history when the DB goes away | — | — | WP3 backfill plus the WP6 release-asset dump, done before the droplet is destroyed |

## Acceptance criteria (overall)

- No droplet, DB or self-hosted runner. The site is served by GitHub Pages only.
- `poll-stats.yml` runs twice daily in the canonical repo and nowhere else;
  each run is about a minute and makes one `data: poll … [skip ci]` commit.
- `docs/data/seasons/<N>/` holds at most one row per series per UTC day;
  `validate.mjs` passes on `main`.
- The site shows the current season, resets at rollover (stats only; rank
  shows last-known with a season label), and past seasons stay on disk as
  static JSON.
- History from the DB (≈S21–S25) is preserved in `seasons/`.
- The stale banner appears if no poll has succeeded for 30h.

## Open questions

Resolved 2026-10-24: D4 → fork first (`jhiggins-tech/OW-Live-Report`),
upstream later; D5 → stats reset, optimizer falls back to one snapshot of last
season (WP7b in scope); D1 → poll times approved.

Still open: moving to `mattjsawyer/ow-live-report` after the fork has soaked
(Matt sets `OW_POLL_ENABLED` there and runs WP5 on upstream).

## Estimated effort

| WP | Size | Notes |
|---|---|---|
| WP0 | XS | merge + build |
| WP1 | L | ~600–800 LOC including tests; the critical path |
| WP2 | M | ~250 LOC + workflow |
| WP3 | M | ~250 LOC + workflow |
| WP4 | S–M | ~120 LOC + README |
| WP5 | S | about an hour of clicking, then a 7-day soak |
| WP6 | S | mostly deletions plus droplet/DNS teardown |
