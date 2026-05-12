# V1 → V2 Cutover (scorched earth)

**Status:** Proposed.

## Context

V2 is feature-complete at `/v2/` (overview, per-player, optimizer, settings,
trajectory, optimizer-card enrichment, hero portraits, etc. — see V2.1
checklist in `plan/v2.md`). The original master plan deliberately deferred
the cutover ("A future cutover from V1 → V2 is out of scope" — v2.md L11).

We now have the go-ahead to retire V1 entirely:

- No data migration. The V1 snapshot JSON in `docs/data/` (~120 MB across
  `overview.json`, `published-state.json`, `site-model.json`, `settings.json`,
  `players/*.json`) is superseded by V2's live InfluxDB reads. Drop it.
- No URL preservation guarantees. V1's `/`, `/settings.html`, and
  `/players/<slug>.html` go away. V2 already covers all three at
  `/#/`, `/#/settings`, `/#/players/<slug>`.

## Goals

1. V2 becomes the root site at `/OW-Live-Report/` (currently at
   `/OW-Live-Report/v2/`).
2. All V1 source, build tooling, snapshots, and CI are deleted from `main`.
3. One CI workflow (`deploy.yml`) builds and publishes V2 to `docs/`.
4. The Pages source mode stays on `main /docs` — no settings change required.
5. Bookmarked `/v2/` URLs continue to land somewhere sensible for one
   release cycle via a redirect stub.

## Non-goals

- Migrating V1 snapshot data into Influx. (V2 doesn't use snapshots; live
  reads only.)
- Hash → clean URLs. That's [`v2.2-hash-url-migration.md`](./v2.2-hash-url-migration.md)
  and stays a separate PR. After cutover, paths are `/#/players/<slug>` at
  the site root, which is the same scheme V2 already ships.
- Changing the InfluxDB endpoint, schema, or CORS posture.
- Changing the Pages source (`main /docs`) or the `tracked-battletags.txt`
  contract.

## Proposed approach

Single PR off this branch. CI will commit the rebuilt `docs/` back on merge,
same pattern as today.

### 1. Safety net before deletion

- Tag the last V1-bearing commit on `main` as `v1-final` and push the tag.
  This is the only retrieval path if we ever need to inspect V1 code or
  the baked snapshot JSON later.
- Do this on `main` after the cutover PR merges — the tag points at the
  parent of the cutover merge.

### 2. Delete V1

Files/dirs to remove:

- `web/` — V1 browser source (`app.js`, `styles.css`).
- `src/` and all of `src/internal/*.ps1` — V1 PowerShell pipeline
  (~5,300 LOC: AnalyticsCore, AnalyticsTeam, Influx, Provider, Renderer,
  Common, Storage, Workflow, OwReport.psm1).
- `tests/run-tests.ps1` — PowerShell test harness.
- Root scripts: `run-report.ps1`, `refresh-site-data.ps1`,
  `publish-github-pages.ps1`, `remove-snapshot.ps1`, `test-player.ps1`.
- `.github/workflows/deploy-windows.yml` — V1 CI.
- `config/team.sample.json` — superseded by env-var runtime config
  (PR #15). Roster file `config/tracked-battletags.txt` stays.
- Under `docs/`:
  - `docs/index.html`, `docs/settings.html`
  - `docs/assets/` (V1 `app.js`, `styles.css`)
  - `docs/players/` (per-player HTML stubs)
  - `docs/data/` (V1 snapshots — the 120 MB of JSON)

V2's `docs/v2/` tree gets *moved* by CI to the new `outDir` on the next
build (step 4), not by hand. The PR diff will simply delete the old V1
files under `docs/` and the next CI commit-back will repopulate `docs/`
with V2's bundle.

### 3. Promote V2 to root

Code changes in `web-v2/`:

- `vite.config.ts` — `build.outDir: '../docs'` (was `'../docs/v2'`).
  `base: './'` stays as-is; relative asset paths already work at any
  subdirectory depth on Pages.
- `package.json` — `preview` script becomes `vite preview --base=/`
  (was `--base=/v2/`).
- `src/components/SiteHeader.tsx` — drop the "Back to V1" `<a>` (line 25).
- `src/lib/runtimeConfig.ts` — remove `ui.linkToV1Url` from the
  `RuntimeConfig` interface and `DEFAULT_CONFIG`.
- `scripts/build-runtime-config.mjs` — drop the `LINK_TO_V1_URL`/
  `VITE_LINK_TO_V1_URL` pick.
- `.env.example` — drop the `LINK_TO_V1_URL` line.

### 4. Consolidate CI

Rename `.github/workflows/deploy-v2-linux.yml` → `deploy.yml`. Diff:

- `name:` → `Deploy site`.
- `paths:` filter on push — drop `web-v2/**` narrowness and let any push
  to `main` trigger (it's the only workflow now; the previous filter
  existed to avoid double-firing with `deploy-windows.yml`). Keep
  `workflow_dispatch`.
- `concurrency.group` → `deploy`.
- Env vars block — drop `LINK_TO_V1_URL`.
- Commit-back step — `git add docs` (was `git add docs/v2`); commit
  message `ci: refresh docs/ [skip ci]`.
- Drop the comment about racing `deploy-windows.yml` and shorten the
  push retry loop's purpose comment. Keep the retry itself as generic
  resilience.

### 5. Bookmark redirect (optional, one release cycle)

Ship a minimal `web-v2/public/v2/index.html` that meta-refreshes to `../`.
Vite copies `public/*` to the bundle root, so this lands at
`docs/v2/index.html` post-build. ~5 lines:

```html
<!doctype html>
<meta charset="utf-8">
<title>OW Live Report — moved</title>
<meta http-equiv="refresh" content="0; url=../">
<link rel="canonical" href="../">
<p>This page has moved to <a href="../">../</a>.</p>
```

Remove in a follow-up PR after a few weeks once analytics (or word of
mouth) confirm nobody's hitting `/v2/` anymore.

### 6. Docs

- Rewrite `README.md` from the V1-flavoured copy to a short V2-focused
  intro: stack, roster file, runtime config env vars, local dev
  (`pnpm install && pnpm dev`), deploy contract.
- Update `plan/v2.md`: mark the "V1 not touched" framing as superseded;
  point at this PRD for the cutover record. Keep the V2 architecture
  and V2.1/V2.2 sections intact — they remain accurate.
- Update `plan/v2.2-hash-url-migration.md`: any references to base path
  `/v2/` shift to `/`. (Verify after writing this PRD; that PRD was
  written assuming the V1 coexistence world.)

## Open questions

1. **Tag name**: `v1-final` vs `v1-archive` vs date-stamped? Recommend
   `v1-final` for searchability.
2. **Redirect stub lifetime**: ship it (one-cycle) or skip entirely?
   Recommend ship — five lines, zero ongoing cost, and the V1 site has
   been live long enough that some links almost certainly exist.
3. **Hash URLs as part of cutover, or stay deferred?** Recommend stay
   deferred. The hash-URL PRD is non-trivial (build-time per-route
   stubs, 404 handling) and bundling it raises blast radius. Cutover
   should be small and reversible-via-revert.
4. **Pages build cache**: GitHub Pages caches `index.html` for up to
   ~10 minutes. There will be a brief window post-merge where a hard
   refresh shows the old V1 page from cache. Acceptable; flag in the
   PR description so we're not surprised.

## Risks

- **Single-PR blast radius.** The PR deletes ~120 MB of files plus
  ~5.3k LOC of PowerShell. Mitigation: tag `v1-final` before merge,
  and verify locally (`pnpm build` from `web-v2/` with `outDir`
  pointing at `../docs`) that the produced `docs/` is fully
  self-contained and the site loads end-to-end in `pnpm preview
  --base=/`.
- **CI race with itself.** The `deploy-v2-linux.yml` push-retry loop
  existed to handle racing the V1 workflow. With one workflow left,
  the retry is dead code in practice but keep it as cheap insurance
  against unrelated `main` pushes happening during the build window.
- **`docs/` becomes a huge cleanup commit.** The deletion will show
  up in `git log --stat` forever. Worth it — and the `v1-final` tag
  is the recovery path.
- **Cached browser sessionStorage.** V2 already namespaces its cache
  key (`owr-v2:react-query:v2`) so existing V2 users carry their
  cache across the move. V1 users' localStorage from V1 is
  orphaned, which is the intended behavior.

## Acceptance criteria

- `https://<pages-host>/OW-Live-Report/` serves V2's overview page with
  live data.
- `https://<pages-host>/OW-Live-Report/#/players/<slug>`,
  `/#/settings`, `/#/optimizer` all route correctly.
- `https://<pages-host>/OW-Live-Report/v2/` either 404s or redirects
  to root (depending on whether step 5 ships).
- `git ls-files` shows no PowerShell, no `web/`, no `docs/data/`,
  no `docs/index.html`/`settings.html`/`players/`, no
  `deploy-windows.yml`, no `config/team.sample.json`.
- Only one workflow in `.github/workflows/`.
- `v1-final` tag exists on the remote pointing at the parent of the
  cutover merge.
- `web-v2/` `pnpm typecheck` and `pnpm build` both succeed locally
  with the updated `outDir`.

## Estimated effort

One PR. Touches ~20 files (mostly deletions). Real work is the local
build verification before merge. Roughly half a day of focused time
plus a watch on the first post-merge CI run.

## Sequence summary

1. Branch off `main` (we're on `claude/plan-v1-to-v2-migration-UoPB2`).
2. Apply changes from sections 2–5 above; verify locally.
3. Open PR; note the `v1-final` tag plan in the description.
4. On merge: tag `v1-final` at the merge's first parent and push the
   tag.
5. Watch CI commit-back land; smoke-test the production URLs against
   the acceptance criteria.
6. Schedule a follow-up to drop the `/v2/` redirect stub.
