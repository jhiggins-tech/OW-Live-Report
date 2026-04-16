# Overwatch Weasel Report

This project publishes a static analytics site shell that now reads **live Overwatch stats from the hosted HTTPS InfluxDB endpoint in the browser**.

Current model:

1. GitHub Pages serves the site from `docs/`
2. the browser calls the live HTTPS stats endpoint directly
3. the dashboard rebuilds itself from that live data
4. the embedded/published snapshot is now only a fallback if the live server is unavailable

That means once the updated site code is published, normal stat changes should show up automatically without running a local snapshot refresh.

## Canonical Site Copy

Use this as the publishable site copy:

- `docs/index.html`

That is the version GitHub Pages should serve.

## Data Source Status

The site shows a source badge so you can tell what you are looking at:

- `Live Server`
- `Published Snapshot`
- `Fallback Snapshot`
- `Static Snapshot`

Expected normal state after this HTTPS switch:

- `Live Server`

If the hosted DB is down or unreachable, the page can still fall back to the last embedded/published snapshot instead of breaking completely.

## Live Data Architecture

The published site now prefers:

- `https://owstats.jhiggins.tech/query`

with:

- database: `ow_stats_telegraf`

The browser fetch path is enabled only because the endpoint is now HTTPS and returns browser-safe CORS headers.

## Simple Roster File

Tracked players still live in:

- `config/tracked-battletags.txt`

One player per line.

Accepted formats:

```text
BattleTag
Display Name | BattleTag
Display Name | BattleTag | Optional notes
```

Example:

```text
Tank Main | ExampleTank#1234
Damage Flex | ExampleDps#5678
Support | ExampleSupport#9999 | Usually queues with the main stack
```

## Main Config

Main config file:

- `config/team.sample.json`

Things you may want to edit:

- `team_name`
- live database URL if the host changes
- player overrides such as default locked roles

## What Changes Need A Rebuild

### Data-only changes

You do **not** need to rerun the local snapshot tool just to get newer stats on the published site anymore.

If the live DB updates, the published page should pull that data automatically on load.

### Code / layout / roster changes

You **do** still need to rebuild or republish when you change:

- HTML / JS / CSS
- tracked players
- config
- page layout or analytics logic

Because GitHub Pages still needs the updated site files under `docs/`.

## Local Preview

Open:

- `docs/index.html`

Important note:

- if you open the page directly from disk with `file:///...`, some browsers handle cross-origin fetch differently
- the site will still try the live HTTPS source first
- if that fails, it falls back to the embedded snapshot

The most accurate real-world test is the published GitHub Pages site, because that is how the browser will run in production.

## Commands

### Edit roster

```powershell
notepad .\config\tracked-battletags.txt
```

### Edit config

```powershell
notepad .\config\team.sample.json
```

### Rebuild local docs after code/config changes

```powershell
powershell -ExecutionPolicy Bypass -File .\run-report.ps1 -ConfigPath .\config\team.sample.json -WideMatchContext mixed
```

Short helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\refresh-site-data.ps1
```

### Open the local preview

```powershell
start .\docs\index.html
```

## What `run-report.ps1` Still Does

Even though the published site is now live-data-first, the local rebuild still has value.

It:

1. reads config and roster
2. generates the site shell
3. updates `docs/`
4. bakes in a fallback snapshot in case the live DB is unavailable

So the command is still useful for:

- UI changes
- new players
- config changes
- fallback refreshes

It is no longer the normal mechanism for daily stat updates on the published site.

## GitHub Pages Flow

Recommended setup:

1. push the repo
2. GitHub Pages serves from `main` -> `/docs`
3. the published page loads live data from the HTTPS stats endpoint

Normal future workflow:

1. make code/config changes locally
2. rebuild `docs/`
3. inspect `docs/index.html`
4. push repo changes

You do not need to republish just because the underlying stats changed.

## Fallback Snapshot Files

These still exist:

- `docs/data/site-model.json`
- `docs/data/published-state.json`

They are now fallback resilience files, not the primary live data source.

The page should prefer the live server first and only use these if the live fetch fails.

## Long-Term Tracking

Long-term history now lives in the hosted database.

The site reads that history live when it loads, then computes:

- team overview metrics
- player drill-downs
- trend charts
- hero recommendations
- optimizer outputs

So the published site should reflect the current database state automatically.

## Settings Page

Settings page:

- `docs/settings.html`

It still supports browser-local hide/show behavior for runs/snapshots already present in the loaded model.

In live DB mode, those controls are view-only and do not delete anything from the hosted source.

## Team Optimizer

The `Best Team Combination` section still:

- uses competitive-only role data
- builds a `1 tank / 2 DPS / 2 support` lineup
- prefers `Narrow` lineups when possible
- supports browser-side role locks
- supports `Not Playing`

## Testing

Run tests with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

## Helpful Files

- `config/tracked-battletags.txt`: roster list
- `config/team.sample.json`: config
- `web/app.js`: browser live-data logic
- `run-report.ps1`: rebuild the site shell and fallback snapshot
- `refresh-site-data.ps1`: shorthand rebuild helper
- `docs/index.html`: publishable site entrypoint
- `docs/settings.html`: settings page
- `docs/data/site-model.json`: fallback snapshot data
- `docs/data/published-state.json`: fallback incremental state

## Everyday Reality Now

For normal stat updates:

1. the database updates
2. the published page reads that live data
3. the site updates on load

For code/config updates:

1. change code locally
2. rebuild `docs/`
3. inspect locally
4. push to GitHub
