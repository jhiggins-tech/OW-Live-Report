# Overwatch Weasel Report

This tool is meant to be run over and over again.

Each time you run it, it:

1. reads your player list
2. queries the hosted stats database
3. rebuilds the report using the full database-backed history
4. writes a fresh local HTML output

That means `output/latest/index.html` is always your newest report, while the historical stat source lives in the hosted database instead of your local `data` folder.

All report stats are now intended to be **competitive-only**.

## The Easiest Way To Use It

You only really need to edit **one simple text file** for your roster:

[tracked-battletags.txt](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\config\tracked-battletags.txt)

Open it and put one player per line.

Accepted formats:

- `BattleTag`
- `Display Name | BattleTag`
- `Display Name | BattleTag | Optional notes`

Example:

```text
Tank Main | ExampleTank#1234
Damage Flex | ExampleDps#5678
Support | ExampleSupport#9999 | Usually queues with the main stack
```

## First-Time Setup

Open PowerShell in this project folder, then run these commands one by one.

### 1. Open the roster file

```powershell
notepad .\config\tracked-battletags.txt
```

Replace the sample line with your real team.

### 2. Optional: change the team name shown on the site

```powershell
notepad .\config\team.sample.json
```

Inside that file, change:

```json
"team_name": "Example Overwatch Squad"
```

You normally do **not** need to edit the rest of that JSON file unless the database URL changes.

### 2b. Optional: hide heroes for one player

In `team.sample.json`, there is now a `player_overrides` section.

Example:

```json
"player_overrides": [
  {
    "player": "ExampleDamage#1234",
    "hidden_heroes": ["Widowmaker"],
    "locked_role": "damage"
  }
]
```

What this does:

- `player`: who the override applies to
- `hidden_heroes`: heroes to completely remove from that player's visible stats and charts
- `locked_role`: optional default role lock for the team optimizer

You can identify the player by BattleTag, normalized player id, display name, or slug.

### 3. Run the report

```powershell
powershell -ExecutionPolicy Bypass -File .\run-report.ps1 -ConfigPath .\config\team.sample.json -WideMatchContext mixed
```

### 4. Open the generated report

```powershell
start .\output\latest\index.html
```

## The Main Command

This is the normal command you can keep reusing:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-report.ps1 -ConfigPath .\config\team.sample.json -WideMatchContext mixed
```

## If You Want To Add Notes For A Regeneration

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-report.ps1 -ConfigPath .\config\team.sample.json -WideMatchContext mostly_wide -Notes "Ranked session after scrims"
```

With the database-backed provider, `WideMatchContext` is no longer the main source of truth for team-wide interpretation. The report now derives wide-vs-narrow context on the fly from the available rank data in each snapshot.

## What `WideMatchContext` Means

Use one of these:

- `mostly_narrow`
- `mixed`
- `mostly_wide`

If you are not sure, use:

```powershell
-WideMatchContext mixed
```

If you mostly played in wide queue, use:

```powershell
-WideMatchContext mostly_wide
```

That still works as a manual run note when needed, but the main report logic now prefers the inferred wide/narrow context derived from the captured ranks.

## Team Optimizer

At the bottom of the main page there is now a `Best Team Combination` section.

It:

- uses the latest competitive-only role data
- builds the best 1 tank / 2 DPS / 2 support lineup
- flags whether the assigned role-rank spread looks `Wide`

You can also use the role-lock dropdowns on that page to force someone onto `Tank`, `DPS`, or `Support`.

Important:

- those dropdown locks are browser-side controls
- they rerun the lineup instantly on the page
- they do **not** change your saved snapshots
- they stay remembered in that browser until you hit `Reset Locks`

If you want a lock to be the default every time the report opens, put it in `player_overrides` inside `team.sample.json`.

## How Long-Term Tracking Works

Yes, this tool is designed to update the same report over time with additional data.

Plain-English version:

- The hosted database keeps collecting timestamped snapshots.
- Your local command reads the available history from that database.
- The site is rebuilt using the full database history each time.
- `output/latest/` becomes your newest report.
- `output/runs/<run-id>/` keeps older generated versions.
- The database is the real long-term tracking history.

So the normal pattern is:

1. edit your roster if needed
2. run the same command again later
3. open `output/latest/index.html`
4. see more points on the charts as history grows

## Important Folders

- [config/tracked-battletags.txt](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\config\tracked-battletags.txt): the simple roster file you edit
- [config/team.sample.json](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\config\team.sample.json): basic app settings
- [run-report.ps1](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\run-report.ps1): the script you run
- [publish-github-pages.ps1](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\publish-github-pages.ps1): copies the latest generated site into `docs/` for GitHub Pages
- [output/latest/index.html](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\output\latest\index.html): the newest report
- [docs/index.html](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\docs\index.html): the GitHub Pages publish folder
- [data](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\data): legacy local storage from the older OverFast mode
- [logs](C:\Users\mattj\OneDrive\Documents\Codex\OVERWATCH_WEASEL_REPORT\logs): run logs

## If You Want To Reset History

In the current database-backed mode, deleting local folders does **not** erase the historical stat source. Use the report `Settings` page to hide snapshots from your browser view, or ask the database owner to remove bad source data if a database snapshot truly needs to disappear.

## Testing

If you ever want to check the analytics logic:

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

## Provider Notes

The sample config now points at the hosted InfluxDB-compatible query endpoint your friend provided. The report no longer depends on OverFast for its main data flow unless you explicitly switch the provider back in `team.sample.json`.

## GitHub Pages

This project is now set up so you can publish the static site from the repo `docs/` folder on GitHub Pages.

### Prepare the site files

After you generate or refresh the local report, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\publish-github-pages.ps1
```

That copies the current site from `output/latest/` into `docs/` and writes a `.nojekyll` file so GitHub Pages serves it cleanly.

### Push to GitHub

1. Create a new GitHub repo.
2. Push this whole project to that repo.
3. In GitHub, open `Settings -> Pages`.
4. Under `Build and deployment`, choose:
   `Deploy from a branch`
5. Select:
   Branch: `main`
   Folder: `/docs`
6. Save and wait for GitHub Pages to publish.

### When you want to refresh the published site

1. Rebuild the report locally if needed.
2. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\publish-github-pages.ps1
```

3. Commit the updated `docs/` folder.
4. Push to GitHub.

### Important limitation right now

GitHub Pages only hosts the static front end. Until your friend's database endpoint is stable and browser-safe, publishing to GitHub Pages does **not** make the site magically live-refresh on its own. The static site is ready for hosting, but true live browser updates will still depend on the backend being reachable and suitable for browser requests.
