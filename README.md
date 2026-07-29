# OW Live Report

Static React + TypeScript site that renders live competitive Overwatch
analytics for a tracked roster. An hourly CI pipeline queries the
TimescaleDB stats backend over SQL and bakes JSON snapshot datasets into
`docs/data/snapshots/`; the browser fetches those static files at view
time. (The backend's old InfluxQL HTTP endpoint is gone, and browsers
can't speak the Postgres wire protocol, so there is no browser-direct
database access anymore.)

Hosted via GitHub Pages from `main /docs`.

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

The stats-backend connection (`STATS_DB_URL`, `STATS_GAMEMODE`) is a
CI/build-time concern of `scripts/fetch-snapshots.mjs`, not part of the
runtime config the SPA fetches.

## Local dev

```bash
cd web-v2
pnpm install
pnpm fetch:snapshots   # bake data snapshots from the stats backend
pnpm dev               # http://localhost:5173/
```

`fetch:snapshots` needs outbound access to
`owstats.jhiggins.tech:5432`; without it the site renders empty with a
stale-data banner.

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
2. Refresh the data snapshots (seeded from the previous deploy if the
   stats backend is unreachable).
3. Build the SPA into `docs/`.
4. Commit-back `docs/` to `main` with `[skip ci]`.

`.github/workflows/refresh-data.yml` additionally re-bakes
`docs/data/snapshots/` hourly (matching the scraper's cadence) and
commits with `[skip ci]` — no site rebuild needed, the SPA fetches the
JSON at view time.

GitHub Pages serves the resulting `docs/` tree. No manual steps.

## Plans

Forward-looking design docs live in [`plan/`](./plan/). Each file is a
PRD with status / scope / open questions. See
[`plan/README.md`](./plan/README.md) for the convention.

## Project history

V1 was a PowerShell-rendered static site (`docs/` baked from snapshots)
that was retired in favor of this live-data architecture. The final V1
commit is tagged [`v1-final`](../../tree/v1-final) for archival.
