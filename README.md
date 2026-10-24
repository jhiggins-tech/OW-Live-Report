# OW Live Report

Static React + TypeScript site that renders live competitive Overwatch
analytics for a tracked roster. A GitHub Action polls the OverFast API
twice a day and compacts each sample into one row per series per UTC day,
split by competitive season, under `docs/data/`; the browser fetches those
static JSON files at view time. There is no database or server: the repo
is the datastore.

Hosted via GitHub Pages from `main /docs`.

## Data

```text
docs/data/
  snapshots/        global "now" files, rewritten on every poll
    meta.json         layoutVersion, currentSeason, season index, last poll
    rank-current.json latest rank per player and role, carried across seasons
    profiles.json     latest profile per player
  seasons/<N>/      per-season daily roll-ups (frozen once the season ends)
    rank-daily.json  career-daily.json  career-hero-daily.json  career-latest.json
  pipeline/state.json   the poller's memory (not read by the site)
```

The site reads `meta.json` first. With `layoutVersion: 2` every chart, stat
card, hero pool and leaderboard reads only the current season's files, so
stats reset when a new season starts and past seasons stay behind as static
files. The one exception is the team optimizer: a player with no data in the
current season is rated from a snapshot of their last season, labelled with
that season on their card. Without `layoutVersion: 2` the site reads the
older flat `snapshots/*.json` files instead. See
[`plan/v3-static-season-snapshots.md`](./plan/v3-static-season-snapshots.md)
for the full data contract.

## Stack

- React 18 + TypeScript + Vite 5
- React Router v6 (HashRouter)
- TanStack Query with sessionStorage persister
- Recharts
- Source in `web-v2/`; build output in `docs/`

## Roster

Tracked players live in `config/tracked-battletags.txt`. One player per
line. Accepted formats:

```text
BattleTag
Display Name | BattleTag
Display Name | BattleTag | Optional notes
```

`scripts/build-roster.mjs` parses this file at build time into
`public/data/roster.json`, which the app fetches on boot.

## Runtime config

Non-secret operational values flow in via env vars at build time; see
[`web-v2/.env.example`](./web-v2/.env.example) for the full contract.
In CI, override via repo Settings → Variables → Actions. Defaults live
in `web-v2/src/lib/runtimeConfig.ts`.

Keys:

- `TEAM_NAME`, `TEAM_SUBTITLE`
- `TOP_HERO_COUNT`

Polling is a CI concern, not part of the runtime config the SPA fetches:
it only runs where the repository variable `OW_POLL_ENABLED` is `true`.

## Local dev

```bash
cd web-v2
pnpm install
pnpm dev               # http://localhost:5173/OW-Live-Report/
```

No database or API access is needed: the dev server serves the committed
`docs/data/{snapshots,seasons}/` files directly, so you see the same data
as the live site. Pull `main` to refresh it.

Production preview:

```bash
pnpm build
pnpm preview
```

Type check:

```bash
pnpm typecheck
```

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`:

1. Build the roster manifest from `config/tracked-battletags.txt`.
2. Build the SPA into `docs/` (the build leaves `docs/data/snapshots`,
   `docs/data/seasons` and `docs/data/pipeline` alone).
3. Commit-back `docs/` to `main` with `[skip ci]`.

`.github/workflows/poll-stats.yml` updates the data twice a day (09:37
and 21:37 UTC): it polls the OverFast API for every rostered player,
compacts the results into the current season's daily roll-ups, validates
the tree, and commits `docs/data` with `[skip ci]` — no site rebuild
needed, the SPA fetches the JSON at view time. Scheduled runs only
execute where the `OW_POLL_ENABLED` repository variable is `true`, so
forks never write data; use "Run workflow" to dry-run or poll on demand.
It replaces the old hourly `refresh-data.yml` and the TimescaleDB backend.

GitHub Pages serves the resulting `docs/` tree. No manual steps.

## Plans

Forward-looking design docs live in [`plan/`](./plan/). Each file is a
PRD with status / scope / open questions. See
[`plan/README.md`](./plan/README.md) for the convention.

## Project history

V1 was a PowerShell-rendered static site (`docs/` baked from snapshots)
that was retired in favor of this live-data architecture. The final V1
commit is tagged [`v1-final`](../../tree/v1-final) for archival.
