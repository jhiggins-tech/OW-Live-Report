# OW Live Report

Static React + TypeScript site that renders live competitive Overwatch
analytics for a tracked roster. The browser queries InfluxDB directly at
view time; there is no prebuild data pipeline.

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
- `INFLUX_QUERY_URL`, `INFLUX_DATABASE`, `INFLUX_GAMEMODE`

## Local dev

```bash
cd web-v2
pnpm install
pnpm dev          # http://localhost:5173/
```

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
2. Build the SPA into `docs/`.
3. Commit-back `docs/` to `main` with `[skip ci]`.

GitHub Pages serves the resulting `docs/` tree. No manual steps.

## Plans

Forward-looking design docs live in [`plan/`](./plan/). Each file is a
PRD with status / scope / open questions. See
[`plan/README.md`](./plan/README.md) for the convention.

## Project history

V1 was a PowerShell-rendered static site (`docs/` baked from snapshots)
that was retired in favor of this live-data architecture. The final V1
commit is tagged [`v1-final`](../../tree/v1-final) for archival.
