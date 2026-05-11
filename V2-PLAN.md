# OW-Live-Report V2 — Greenfield Build at `/v2/`

## Context

V1 is a static site rendered by ~5,300 lines of PowerShell modules: at build time, `run-report.ps1` pulls from InfluxDB + OverFast, transforms snapshots, and bakes ~20MB of JSON into `docs/`. This pipeline has been brittle (Windows CI, race between build & Pages serving, stale `docs/`-on-`main` deploys — the Melrose-missing incident). It also means data is only as fresh as the last CI run.

V2 is a greenfield rebuild that:
- Hosts at `/v2/` (built into `docs/v2/`) alongside V1 — V1 site is **not** touched.
- Drops PowerShell entirely; uses Linux CI (Ubuntu + Node).
- Drops the prebuild data pipeline; the browser queries InfluxDB directly at view time, with sessionStorage caching.
- Ships an MVP first, with a tracked checklist of V1 features deferred to V2.1. A future cutover from V1 → V2 is out of scope.

## Out of scope

- Any edits to `docs/` files outside `docs/v2/`.
- Any edits to `.github/workflows/deploy-windows.yml`, `*.ps1`, or `src/internal/*.ps1`.
- Switching the GitHub Pages source mode (stays on `main /docs`).
- New backend infra, secrets, or proxies.
- V1 → V2 redirect / cutover.

## Tech decisions

- **Stack:** React 18 + TypeScript + Vite 5. `vite.config.ts` with `base: './'`, `build.outDir: '../docs/v2'`, `emptyOutDir: true`.
- **Routing:** `createHashRouter` (React Router v6). Avoids the SPA-fallback problem on static GitHub Pages and the need to pre-render per-player HTML stubs. Tradeoff: hash URLs; revisit in V2.1.
- **Charts:** Recharts. Declarative React components compose naturally with state-driven filters; bundle ~80–100 KB gz for the chart set we need.
- **Data layer:** TanStack Query with sessionStorage persister, 5-min `staleTime`, `refetchOnWindowFocus: false`. Custom `influxClient.ts` with 4-wide concurrency. No artificial spacing — the slow path is now per-chart latency, not server politeness.
- **Query strategy:** **one query per chart**, server-side aggregated via InfluxQL `GROUP BY time(<bucket>)`. We do NOT port V1's "fetch all raw rows then transform in code" approach. Each chart specifies its own time window + bucket size + grouping, so payloads are O(buckets × dimensions) — tens of points, not thousands of raw events. Charts that need a derived metric across two measurements (e.g., KDA = (E+A)/D from `career_stats_combat` + `career_stats_assists`) fire those two queries in parallel and combine in JS. See "Query strategy" section below.
- **Roster source:** `config/tracked-battletags.txt` parsed by `scripts/build-roster.mjs` at build time into `public/data/roster.json` (shipped as a static asset, fetched by the app).

## Directory layout

```
web-v2/                           # new — V2 source tree
  package.json, tsconfig.json, vite.config.ts
  scripts/
    build-roster.mjs              # txt → public/data/roster.json (prebuild)
  public/
    data/roster.json              # generated; do not hand-edit
    favicon.svg
  src/
    main.tsx, App.tsx             # HashRouter, QueryClient + sessionStorage persister
    theme/{tokens.css, global.css}  # port palette/noise from docs/assets/styles.css
    lib/
      influxClient.ts             # GET .../query, parse series, throttle, sessionStorage cache
      queries/
        _shared.ts                # playerRegex builder, time-window helpers, current-season lookup
        latestPlayerProfile.ts    # SELECT last(avatar, namecard, ...) FROM player_summary (per-player header)
        currentSeasonByPlayer.ts  # SELECT last(season) FROM competitive_rank GROUP BY player
        charts/
          team/
            statCards.ts          # last() across team for KDA/WR/freshness, single window
            kdaOverTime.ts        # combat + assists, GROUP BY time(1d), team-wide
            winRateOverTime.ts    # game, GROUP BY time(1d), team-wide
            rankOverTime.ts       # competitive_rank, GROUP BY time(1d), player, role
            playerScatter.ts      # combat + assists + game, last() per player, latest window
            heroPool.ts           # game, GROUP BY hero, sum time_played over season
          player/
            rankTrend.ts          # competitive_rank, 1h bucket, group by role
            kdaTrend.ts           # combat + assists, 1d bucket
            winRateTrend.ts       # game, 1d bucket
            roleBreakdown.ts      # combat + assists + game, last() per role
            heroUsage.ts          # game, 1w bucket, group by hero (stacked)
            heroPerf.ts           # combat + assists, 1w bucket, group by hero
            heroLeaderboard.ts    # game + combat + assists, last() per hero
      normalize/
        heroKey.ts                # ports Common.ps1:57 (D.Va→dva, etc.)
        rankOrdinal.ts            # ports ConvertTo-RankOrdinal (tier+division → 1..40)
        kda.ts                    # combine combat+assists row arrays → KDA series
    hooks/
      useRoster.ts, useTeamAnalytics.ts, usePlayerSnapshot.ts
    pages/{OverviewPage,PlayerPage,NotFoundPage}.tsx
    components/
      SiteHeader.tsx, StatCards.tsx
      RosterGrid.tsx, RosterCard.tsx
      charts/Team{Kda,WinRate,Rank}Chart.tsx
      charts/PlayerScatter.tsx, HeroPoolBar.tsx
      charts/Player{Rank,Kda,WinRate}Trend.tsx, RoleBreakdown.tsx
      charts/HeroUsageStacked.tsx, HeroPerfLines.tsx
      HeroLeaderboard.tsx
      filters/{TrendFilter,RoleFilter,HeroToggle}.tsx
    types/{influx.ts, models.ts}

docs/v2/                          # Vite build output (CI-committed; no manual edits)

.github/workflows/deploy-v2-linux.yml   # new — see "CI" below
```

## Query strategy: one query per chart, server-aggregated

Each chart owns its query. InfluxDB `GROUP BY time(<bucket>)` does the aggregation server-side; the browser receives chart-shaped data (tens of points), not raw events. TanStack Query dedupes if two charts request the same underlying query (e.g., overview + scatter both want latest team stats).

| Chart | Measurement(s) | Window | Bucket | Group by | Aggregation |
|---|---|---|---|---|---|
| Stat cards | combat + assists + game | last 14d | last() | player | last per player, then JS team-roll-up |
| Team KDA over time | combat + assists | current season | 1d | time, player | mean per player per day, JS team-mean |
| Team win rate over time | game | current season | 1d | time, player | mean(win_percentage) per player per day, JS team-mean |
| Team rank over time | competitive_rank | current season | 1d | time, player, role | last(tier+division) per bucket |
| Player scatter | combat + assists + game | last 7d | last() | player | last per player |
| Hero pool bar | game | current season | full | hero | sum(time_played) per hero |
| Player rank trend | competitive_rank | current season | 1h | time, role | last(tier+division) |
| Player KDA trend | combat + assists | current season | 1d | time | mean per day |
| Player WR trend | game | current season | 1d | time | mean(win_percentage) per day |
| Player role breakdown | combat + assists + game | latest | last() | role | last per role |
| Player hero usage | game | current season | 1w | time, hero | sum(time_played) per week per hero |
| Player hero perf | combat + assists | current season | 1w | time, hero | mean per week per hero |
| Player hero leaderboard | game + combat + assists | latest | last() | hero | last per hero |

InfluxQL shape (illustrative — `kdaOverTime.ts`):
```sql
SELECT mean("eliminations") AS e, mean("deaths") AS d
FROM "career_stats_combat"
WHERE "player" =~ /<regex>/ AND "gamemode"='competitive' AND time > now() - 90d
GROUP BY time(1d), "player" fill(none)
```
Pair with a sibling query on `career_stats_assists` for `a`, then JS computes `(e+a)/max(d,1)` per bucket per player, averages across players.

Caching: each chart query keyed `[chartId, timeWindow, playerSetHash]` in TanStack Query + sessionStorage. `_shared.ts` exports the player regex builder so 13 chart queries don't each re-derive it.

Constants we own (not in V1): bucket sizes per chart, time windows per chart. Codify in `lib/queries/charts/_constants.ts` so we can tune without hunting through files.

## CI: `.github/workflows/deploy-v2-linux.yml`

- **Triggers:** `push` on `main` filtered by paths `web-v2/**`, `config/tracked-battletags.txt`, and the workflow file itself. Plus `workflow_dispatch`.
- **Permissions:** `contents: write`. Concurrency group `deploy-v2-linux`, `cancel-in-progress: false`.
- **Runner:** `ubuntu-latest`. No PowerShell.
- **Steps:**
  1. `actions/checkout@v4` (full history so we can rebase on push).
  2. `actions/setup-node@v4` (Node 20, `cache: pnpm`).
  3. `pnpm install --frozen-lockfile` in `web-v2/`.
  4. `pnpm run build:roster` (Node script, reads `../config/tracked-battletags.txt`).
  5. `pnpm run build` (Vite emits to `../docs/v2/`).
  6. Commit-back, mirroring V1: configure `github-actions[bot]`, `git add docs/v2`, exit 0 if nothing staged, else `git commit -m 'ci(v2): refresh docs/v2 [skip ci]' && git push origin HEAD:main`. Wrap push in a rebase-and-retry to handle a race with the V1 workflow's commit-back (both can write under `docs/` on the same push, though to disjoint paths).
- **Never touches anything under `docs/` other than `docs/v2/`.** V1's workflow remains the sole writer of the rest of `docs/`.

## MVP feature checklist (V2 launch)

Team overview (`/v2/#/`):
- [ ] Stat cards: tracked player count, fresh-snapshot count, team avg KDA, team win rate
- [ ] Team avg KDA over time (line)
- [ ] Team win rate over time (line)
- [ ] Team rank progression (line, ordinal scale)
- [ ] Player scatter: KDA × win rate, one dot per player
- [ ] Hero pool bar chart: top heroes by team playtime (current season)
- [ ] Roster grid + client-side filters: trend, role, warnings, queue interpretation
- [ ] Header: team name, subtitle, "last refreshed" timestamp, link back to V1

Per-player page (`/v2/#/players/:slug`):
- [ ] Profile header (avatar, namecard, endorsement, current KDA)
- [ ] Rank trend (line per role, current competitive season)
- [ ] KDA trend; win-rate trend
- [ ] Role breakdown bar (latest snapshot)
- [ ] Hero usage over time (stacked)
- [ ] Hero performance over time (lines per hero)
- [ ] Hero leaderboard table (filters 100%-wr one-game outliers)
- [ ] Per-player hide/show hero toggles (localStorage)

Shared:
- [ ] HashRouter + 404 page
- [ ] TanStack Query + sessionStorage persister, 5-min stale, throttled client
- [ ] Theme tokens ported from `docs/assets/styles.css`
- [ ] Skeleton loading states (live first paint will be 3–6s cold)

## V2.1 parity checklist (shipped)

- [x] Settings page (snapshot hide/restore, browser-local persistence) — PR #12
- [x] Team optimizer (1 tank / 2 DPS / 2 support, role-lock UI) — PR #19, ports `Search-OwReportBestTeamComposition` from `src/internal/AnalyticsTeam.ps1`
- [x] Wide-match heuristic — PR #14, ports `Get-OwReportWideGroupAssessment` (`AnalyticsTeam.ps1:605`); banner on Overview + tie-break in the optimizer
- [x] Trajectory narratives + warnings + forecast labels — PRs #18 (per-player TrajectoryPanel) + #21 (team Biggest Movers + roster pills)
- [x] Hero meta context from OverFast API — PR #20 (pickrate/winrate columns + Δ vs meta on the hero leaderboard); CORS verified open on `overfast-api.tekrop.fr`
- [x] Stale-cache fallback when live query fails — PR #16 (24h sessionStorage + StaleBanner on fetch failure)
- [x] Wide-match / standard-queue badges in UI — PR #14
- [x] Per-player notes badges (column 3 of `tracked-battletags.txt`) — PR #12 (pill-styled in `RosterGrid`)
- [x] Per-player snapshot hiding (browser-local override) — PR #12
- [x] Player-override config (hidden_heroes, locked_role) mirroring `team.sample.json` `player_overrides` — PR #17
- [x] Full `team.sample.json` parity: site subtitle, `top_hero_count`, `request_delay_ms` surfaced as runtime config — PR #15
- [x] Move runtime config out of `config/team.sample.json` / inlined constants into **environment variables + CI vars** — PR #15 (`docs/v2/data/runtime-config.json` + `.env.example` contract + `deploy-v2-linux.yml` GitHub Actions vars)
- [x] Restored role-breakdown chart via hero→role derivation — PR #14

## V2.2 deferred

- [ ] Switch HashRouter → BrowserRouter with build-time per-player HTML stubs (drop hash URLs). See the BrowserRouter trade-off notes below.
- [ ] History-weighted hero recommendations — port from `src/internal/AnalyticsCore.ps1`
- [ ] Team Overview hero-pool vs OverFast meta pickrate overlay (follow-up to PR #20)
- [ ] Trend-label feed into the optimizer's role-option scoring (the +trend-norm component; deferred from PR #19 to avoid N×3 query inflation)
- [ ] Any remaining functions in `AnalyticsTeam.ps1` / `AnalyticsCore.ps1` not covered by MVP / V2.1

### BrowserRouter trade-off notes (for V2.2)

- Drops `#` from URLs (`/v2/#/players/melrose` → `/v2/players/melrose/`).
- Build script must emit one `docs/v2/players/<slug>/index.html` per roster entry and a `docs/v2/404.html` for SPA fallback on unknown paths.
- Vite `base` moves from `./` to `/v2/` (drop the portable-relative-paths setup).
- Stale stubs need cleanup on roster removal — build step tracks "what existed last time".
- Existing hash bookmarks need a small boot-time `location.hash` → path migration shim or they land on Overview.
- Unlocks per-player `<title>`/`<meta>` so Slack/Discord link previews are no longer identical for every player.

## Critical files to reference (V1 → V2 port map)

- `src/internal/Influx.ps1:863, 907, 951, 1016` — V1's bulk queries; we don't port them verbatim, but they show the field names, measurement names, and player-regex pattern V2's per-chart queries reuse
- `src/internal/Influx.ps1:1004` — `Get-OwReportInfluxCareerMeasurementFieldMap`: definitive list of fields per measurement (combat: eliminations/deaths/all_damage_done/damage_done; assists: assists/healing_done; game: games_played/games_won/time_played/win_percentage; average: \*\_avg_per_10_min). V2 chart queries pull subsets of these.
- `src/internal/AnalyticsCore.ps1:635` — `ConvertTo-OwReportPlayerSnapshot`: reference for which derived metrics matter (KDA, role inference, current rank). V2 derives these per-chart, not per-snapshot.
- `src/internal/AnalyticsTeam.ps1:930` — team aggregations to understand the team-roll-up semantics (mean-of-means vs sum-of-totals); MVP keeps these simple.
- `src/internal/Common.ps1:57` — hero key normalization
- `docs/assets/styles.css` — palette + noise overlay tokens
- `config/team.sample.json` — runtime config schema (provider URL, request delay, etc.)
- `config/tracked-battletags.txt` — roster source (already verified `Display | BattleTag | Notes` format with `#` comments)
- `.github/workflows/deploy-windows.yml` — V1 commit-back pattern to mirror in `deploy-v2-linux.yml`

## Verification

1. **CORS smoke test (do first, before building UI):** open browser devtools at any HTTPS origin and `fetch('https://owstats.jhiggins.tech/query?db=ow_stats_telegraf&q=SHOW+MEASUREMENTS')`. Confirm 200 + `Access-Control-Allow-Origin` header. If it fails, the no-proxy constraint is invalidated and we revisit before writing code.
2. **Local dev:** `cd web-v2 && pnpm install && pnpm run build:roster && pnpm dev` → `http://localhost:5173/`. Confirm overview renders from live data; devtools shows throttled requests; second navigation is a sessionStorage hit.
3. **Production build preview:** `pnpm build && pnpm preview --base=/v2/`. Confirm assets resolve under `/v2/`, HashRouter routes `/v2/#/players/kieness` correctly.
4. **Pre-merge:** `git status docs/` shows changes only under `docs/v2/`; nothing else under `docs/` modified.
5. **Post-deploy on Pages:** hit `https://<pages-host>/OW-Live-Report/v2/`. Verify (a) overview renders with live data, (b) "last refreshed" reflects newest `player_summary` time, (c) `https://<pages-host>/OW-Live-Report/` (V1) is unchanged, (d) "Back to V1" link in V2 header works.

## Risks / unknowns

- **CORS on `owstats.jhiggins.tech/query`:** the whole V2 architecture depends on this. V1's `browser_refresh_enabled` flag suggests it works, but we should confirm in step 1 of Verification before committing to the no-proxy plan.
- **Cold-paint latency:** with per-chart server-aggregated queries, cold paint is dominated by InfluxDB round-trip latency, not payload size. Overview fires ~6 queries in parallel (stat cards, team KDA pair, team WR, team rank, scatter, hero pool) — expect 0.5–2s for first chart to land, others to follow as they resolve. Per-chart skeletons mean partial rendering, not a single 3–6s blocking wait.
- **Query count vs payload size tradeoff:** we trade more HTTP requests for dramatically smaller payloads. With HTTP/2 multiplexing on `owstats.jhiggins.tech` (verify in CORS smoke test), the request-count cost is negligible. If the host is HTTP/1.1, the 4-wide concurrency cap may serialize some charts; raise it to 6–8 if needed.
- **Bundle size:** React + Router + TanStack Query + Recharts ≈ 180–220 KB gz. Watch for accidental `moment` / `lodash` imports.
- **Commit-back race with V1 workflow:** both workflows commit-and-push to `main` on overlapping triggers. They write to disjoint paths under `docs/`, so a rebase-and-retry loop in V2's push step resolves it. Both already include `[skip ci]` to avoid recursive triggers.
- **Roster drift:** the path filter on `config/tracked-battletags.txt` should trigger a rebuild whenever the roster changes. If V2 ever depends on more config files, add them to the trigger paths.
- **Wide-match awareness deferred:** MVP charts won't flag wide-queue runs. Header subtitle should note "wide-match detection: v2.1".
