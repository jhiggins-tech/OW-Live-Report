# Overwatch Weasel Report

This project builds a polished static Overwatch team report from competitive snapshot data.

Right now the workflow is:

1. query the hosted stats database
2. build a static site snapshot locally
3. write the publishable site into `docs/`
4. push the updated `docs/` folder to GitHub

The important change is this:

- GitHub Pages is now meant to serve a static snapshot
- the page does **not** rely on live browser access to the database
- the published site reads from a fixed snapshot file at `docs/data/site-model.json`

That means you can refresh the published site by uploading a new snapshot file set, without changing the website code.

## Canonical Preview

Use this as the main local preview:

- `docs/index.html`

That is the version we treat as the publishable copy.

`output/latest/` still exists as a generated build artifact, but `docs/` is the place to open, inspect, and publish.

## What The Site Uses

The report currently uses:

- competitive-only rank history
- competitive-only hero usage and performance
- profile metadata from `player_summary`
- a static snapshot file for GitHub Pages publishing

The site currently shows a source badge so you can tell whether you are looking at:

- `Published Snapshot`
- `Fallback Snapshot`
- `Live Server`

For GitHub Pages, the normal expected state is `Published Snapshot`.

## Simple Roster File

You can still manage the roster in:

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
- database connection settings if the host changes
- player overrides such as default locked roles

## Quick Start

### 1. Edit the roster

```powershell
notepad .\config\tracked-battletags.txt
```

### 2. Optional: edit the team name

```powershell
notepad .\config\team.sample.json
```

### 3. Rebuild the snapshot site

```powershell
powershell -ExecutionPolicy Bypass -File .\run-report.ps1 -ConfigPath .\config\team.sample.json -WideMatchContext mixed
```

### 4. Open the publishable preview

```powershell
start .\docs\index.html
```

## What `run-report.ps1` Does Now

When you run:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-report.ps1 -ConfigPath .\config\team.sample.json -WideMatchContext mixed
```

it now:

1. reads your roster/config
2. queries the hosted database
3. builds the report site
4. writes:
   - `output/runs/<run-id>/`
   - `output/latest/`
   - `docs/`
5. writes the publishable snapshot file:
   - `docs/data/site-model.json`

So after a successful run, `docs/` is already ready to commit and publish.

## GitHub Pages Snapshot Flow

This is the recommended publishing workflow.

### Normal refresh

1. Run the report locally.
2. Check `docs/index.html`.
3. Commit the updated `docs/` folder.
4. Push to GitHub.

That updates the published site.

### Important snapshot file

The key data file is:

- `docs/data/site-model.json`

When the site is served over HTTP(S), the page loads this file and rebuilds the dashboard from it.

That means:

- the published page can accept refreshed data without changing the front-end code
- the page shell can stay the same while the snapshot data changes

### If only data changed

If the site structure is unchanged and you are only refreshing stats, the most important file is:

- `docs/data/site-model.json`

In practice, it is usually easiest to commit the whole refreshed `docs/` folder anyway.

### If roster or page structure changed

If you added players, changed slugs, or changed the UI, upload the full refreshed `docs/` folder, not just the JSON snapshot file.

## Important Browser Note

There are two different behaviors depending on where the site is opened.

### Local file preview

If you open `docs/index.html` directly from disk with `file:///...`, browsers often block JSON fetches from sibling files.

So in local file preview:

- the page can fall back to the embedded snapshot baked into the HTML

### GitHub Pages / served site

If the site is served over HTTP(S), it can load:

- `docs/data/site-model.json`

That is the main publish path.

## Why We Are Not Using Live Browser Refresh Right Now

The hosted database is currently only available over `http`, not `https`.

GitHub Pages is served over `https`, so direct browser calls to the database would be blocked as mixed content.

Because of that, the current stable approach is:

- database query at build time
- static snapshot at publish time
- published site reads same-origin snapshot JSON

This is the cleanest safe path until HTTPS is available on the database host.

## Long-Term Tracking

Long-term history currently lives in the hosted database.

Your local run does not need to maintain the full stat history itself. Instead it:

- reads the current historical data from the database
- builds a new snapshot site from that history
- publishes the latest static view into `docs/`

So the published report is a snapshot of the database history at the time you ran the command.

## Settings Page

The settings page is here:

- `docs/settings.html`

It lets you:

- hide snapshots from the browser view
- restore hidden snapshots

In database-backed mode, this is currently hide-only in the UI. It does not delete rows from the hosted database.

## Hero Filters And Roster Filters

The report currently supports:

- player visibility filters on the overview
- per-player hero filters on player pages
- role quick-filter buttons in hero filters
- browser-saved optimizer role locks

These are view-layer controls. They change what the report shows, but they do not edit the hosted source database.

## Team Optimizer

The `Best Team Combination` section:

- uses competitive-only role data
- builds a `1 tank / 2 DPS / 2 support` lineup
- prefers `Narrow` lineups when possible
- supports browser-side manual role locks
- supports `Not Playing`

## Testing

Run the test suite with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

## Helpful Files

- `config/tracked-battletags.txt`: simple roster list
- `config/team.sample.json`: project config
- `run-report.ps1`: main rebuild command
- `publish-github-pages.ps1`: optional manual sync from `output/latest` to `docs`
- `docs/index.html`: canonical preview and publish entrypoint
- `docs/data/site-model.json`: published snapshot data file
- `docs/settings.html`: snapshot visibility settings page
- `output/runs/`: archived generated builds
- `output/latest/`: latest generated build copy
- `logs/`: run logs

## Recommended Everyday Workflow

Use this pattern:

1. edit roster if needed
2. run the report
3. open `docs/index.html`
4. sanity-check the site
5. commit the updated `docs/` folder
6. push to GitHub

That keeps the published page updated with the newest snapshot without needing any live browser database connection.
