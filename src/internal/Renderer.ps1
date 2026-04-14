function Get-OwReportOverviewHtml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$SiteModel
    )

    $json = ConvertTo-OwReportHtmlSafeJson -Value ([ordered]@{
        page = 'overview'
        payload = $SiteModel
        live = (Get-OwReportObjectValue -Object $SiteModel -Path @('meta', 'live_source'))
    })
    $title = '{0} | Overwatch Team Report' -f $SiteModel.meta.team_name

    return @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>$title</title>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body class="owr-body overview-page">
  <div class="owr-noise"></div>
  <header class="hero-shell">
    <div>
      <p class="eyebrow">OVERWATCH COMPETITIVE TEAM ANALYTICS</p>
      <h1>$($SiteModel.meta.team_name)</h1>
      <p class="lede">$($SiteModel.meta.site_subtitle)</p>
      <div class="hero-actions">
        <a class="nav-link" href="settings.html">Settings</a>
      </div>
    </div>
    <div class="hero-meta" id="hero-meta"></div>
  </header>
  <main class="page-shell">
    <section class="panel section-grid">
      <div class="section-head">
        <h2>Team Pulse</h2>
        <p>Snapshot-aware trends, irregular-run safe.</p>
      </div>
      <div id="overview-summary" class="summary-strip"></div>
      <div class="chart-grid triple">
        <section class="subpanel">
          <div class="subpanel-head">
            <h3>Team Average KDA <span class="info-pill" title="Team-level KDA across manual snapshots.">i</span></h3>
            <p>Actual timestamps across manual runs.</p>
          </div>
          <div id="team-kda-chart" class="chart-shell"></div>
        </section>
        <section class="subpanel">
          <div class="subpanel-head">
            <h3>Team Win Rate <span class="info-pill" title="Team-level win rate across manual snapshots.">i</span></h3>
            <p>Separated for easier reading.</p>
          </div>
          <div id="team-winrate-chart" class="chart-shell"></div>
        </section>
        <section class="subpanel">
          <div class="subpanel-head">
            <h3>Team Rank Progression <span class="info-pill" title="Average visible competitive rank over time using an internal ordinal ladder scale.">i</span></h3>
            <p>Wide-queue runs lower interpretation confidence.</p>
          </div>
          <div id="team-rank-chart" class="chart-shell"></div>
        </section>
      </div>
    </section>

    <section class="panel chart-grid dual">
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Player Comparison <span class="info-pill" title="Each dot is one player from the latest snapshot. Hover a dot or use the legend below the chart to identify players.">i</span></h3>
          <p>Current KDA vs win rate snapshot.</p>
        </div>
        <div id="comparison-chart" class="chart-shell"></div>
      </section>
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Hero Pool Summary <span class="info-pill" title="Current-season team hero usage footprint, ranked by tracked competitive time played.">i</span></h3>
          <p>Current-season team usage footprint.</p>
        </div>
        <div id="hero-pool-chart" class="chart-shell"></div>
      </section>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Roster View</h2>
        <p>Filter by trend, role, warnings, and queue interpretation.</p>
      </div>
      <div id="overview-filters" class="filter-row"></div>
      <div id="player-visibility-controls" class="player-visibility-controls"></div>
      <div id="player-grid" class="player-grid"></div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Best Team Combination <span class="info-pill" title="Builds a 1 tank, 2 DPS, 2 support lineup from the latest competitive-only role data. You can lock roles in the browser to rerun the suggestion.">i</span></h2>
        <p>Pick the strongest 1 / 2 / 2 lineup and flag whether the role-rank spread looks Wide.</p>
      </div>
      <div id="team-optimizer" class="optimizer-shell"></div>
    </section>
  </main>
  <script id="report-data" type="application/json">$json</script>
  <script src="assets/app.js"></script>
</body>
</html>
"@
}

function Get-OwReportPlayerHtml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$SiteModel,
        [Parameter(Mandatory = $true)]
        [hashtable]$Player
    )

    $json = ConvertTo-OwReportHtmlSafeJson -Value ([ordered]@{
        page = 'player'
        payload = [ordered]@{
            meta = $SiteModel.meta
            player = $Player
        }
        live = (Get-OwReportObjectValue -Object $SiteModel -Path @('meta', 'live_source'))
        context = [ordered]@{
            player_slug = $Player.slug
        }
    })
    $title = '{0} | {1}' -f $Player.display_name, $SiteModel.meta.team_name

    return @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>$title</title>
  <link rel="stylesheet" href="../assets/styles.css">
</head>
<body class="owr-body player-page">
  <div class="owr-noise"></div>
  <header class="hero-shell compact">
    <div>
      <div class="hero-actions">
        <a class="back-link" href="../index.html">Back to team overview</a>
        <a class="nav-link" href="../settings.html">Settings</a>
      </div>
      <p class="eyebrow">PLAYER DRILL-DOWN</p>
      <h1>$($Player.display_name)</h1>
      <p class="lede" id="player-lede">Current KDA $([Math]::Round([double]$Player.current.kda, 2)) | Forecast: $($Player.trend.forecast)</p>
    </div>
    <div class="hero-meta" id="player-meta"></div>
  </header>
  <main class="page-shell">
    <section class="panel">
      <div id="player-summary" class="player-summary"></div>
    </section>

    <section class="panel chart-grid dual">
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Rank Trend <span class="info-pill" title="Tracks current-season competitive ranks over time with one line per role. Higher on the chart means a higher rank.">i</span></h3>
          <p>Current-season rank history with one line each for tank, DPS, and support.</p>
        </div>
        <div id="player-rank-chart" class="chart-shell"></div>
      </section>
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>KDA Trend <span class="info-pill" title="KDA means kills plus assists divided by deaths.">i</span></h3>
          <p>Direction uses elapsed time between runs.</p>
        </div>
        <div id="player-kda-chart" class="chart-shell"></div>
      </section>
    </section>

    <section class="panel chart-grid dual">
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Win Rate Trend <span class="info-pill" title="Win rate is the percentage of tracked games won in a snapshot.">i</span></h3>
          <p>Conservative directional interpretation.</p>
        </div>
        <div id="player-winrate-chart" class="chart-shell"></div>
      </section>
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Role Breakdown <span class="info-pill" title="Latest role-level footprint for tank, DPS, and support.">i</span></h3>
          <p>Latest role-level KDA footprint.</p>
        </div>
        <div id="player-role-chart" class="chart-shell"></div>
      </section>
    </section>

    <section class="panel chart-grid dual">
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Hero Usage Over Time <span class="info-pill" title="Shows how much time was spent on each tracked hero across snapshots.">i</span></h3>
          <p>Top heroes by current time played.</p>
        </div>
        <div id="player-hero-usage-chart" class="chart-shell"></div>
      </section>
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Hero Performance Over Time <span class="info-pill" title="Compares hero-specific KDA trends across repeated snapshots.">i</span></h3>
          <p>KDA trend on the same hero set.</p>
        </div>
        <div id="player-hero-performance-chart" class="chart-shell"></div>
      </section>
    </section>

    <section class="panel chart-grid dual">
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Recommendations <span class="info-pill" title="Player-history weighted hero suggestions, not meta-only picks.">i</span></h3>
          <p>Player-history weighted, not meta-first.</p>
        </div>
        <div id="player-recommendations" class="recommendation-grid"></div>
      </section>
      <section class="subpanel">
        <div class="subpanel-head">
          <h3>Trajectory <span class="info-pill" title="Short written interpretation of the player trend, forecast, and flags.">i</span></h3>
          <p>Short interpretation and flags.</p>
        </div>
        <div id="player-trajectory" class="trajectory-panel"></div>
      </section>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Hero Leaderboards <span class="info-pill" title="Latest snapshot hero rankings, excluding 100 percent win-rate outliers from the leaderboard lists.">i</span></h2>
        <p>Latest snapshot hero rankings with obvious one-game outliers removed.</p>
      </div>
      <div id="player-hero-leaderboards" class="chart-grid dual"></div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Hero Filters <span class="info-pill" title="Hide heroes from this player page by ticking the box. The setting is saved in your browser and recalculates this player breakdown locally.">i</span></h2>
        <p>Browser-saved filters for this player page only.</p>
      </div>
      <div id="player-hero-controls" class="hero-filter-shell"></div>
    </section>
  </main>
  <script id="report-data" type="application/json">$json</script>
  <script src="../assets/app.js"></script>
</body>
</html>
"@
}

function Get-OwReportSettingsHtml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$SiteModel
    )

    $json = ConvertTo-OwReportHtmlSafeJson -Value ([ordered]@{
        page = 'settings'
        payload = $SiteModel
        live = (Get-OwReportObjectValue -Object $SiteModel -Path @('meta', 'live_source'))
    })
    $title = '{0} | Settings' -f $SiteModel.meta.team_name
    $isHideOnly = (Get-OwReportObjectValue -Object $SiteModel -Path @('settings', 'removal_mode') -Default 'browser-local') -eq 'hide-only'
    $settingsLede = $(if ($isHideOnly) { 'Hide snapshots in this browser view without changing the hosted source data.' } else { 'Hide snapshots in the report, or copy a safe delete command for permanent removal.' })
    $settingsSubtext = $(if ($isHideOnly) { 'Hide a snapshot from this report view instantly. You can restore it any time, and the hosted database stays untouched.' } else { 'Hide a snapshot from the report instantly, or copy the delete command if you want to remove it from disk.' })
    $settingsCardText = $(if ($isHideOnly) { 'Each card shows one database-backed team snapshot, its inferred queue context, and which players were captured.' } else { 'Each card shows one manual team snapshot, its queue context, and which players were captured.' })

    return @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>$title</title>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body class="owr-body settings-page">
  <div class="owr-noise"></div>
  <header class="hero-shell compact">
    <div>
      <div class="hero-actions">
        <a class="back-link" href="index.html">Back to team overview</a>
      </div>
      <p class="eyebrow">REPORT SETTINGS</p>
      <h1>Settings</h1>
      <p class="lede">$settingsLede</p>
    </div>
    <div class="hero-meta" id="settings-meta"></div>
  </header>
  <main class="page-shell">
    <section class="panel">
      <div class="section-head">
        <h2>Snapshot Controls</h2>
        <p>$settingsSubtext</p>
      </div>
      <div id="settings-summary" class="summary-strip"></div>
      <div class="hero-actions">
        <button type="button" class="filter-chip" data-reset-removed-runs="true">Restore All Snapshots</button>
        <a class="nav-link" href="index.html">Open Team Overview</a>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Saved Snapshots</h2>
        <p>$settingsCardText</p>
      </div>
      <div id="settings-run-list" class="settings-run-list"></div>
    </section>
  </main>
  <script id="report-data" type="application/json">$json</script>
  <script src="assets/app.js"></script>
</body>
</html>
"@
}

function Publish-OwReportSite {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config,
        [Parameter(Mandatory = $true)]
        [hashtable]$SiteModel,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [hashtable]$PublishedState
    )

    $runOutputDir = Ensure-OwReportDirectory -Path (Join-Path $Config.output_dir ('runs\{0}' -f $RunContext.run_id))
    $latestOutputDir = Join-Path $Config.output_dir 'latest'
    $docsOutputDir = Join-Path $script:OwReportProjectRoot 'docs'
    if (Test-Path -LiteralPath $latestOutputDir) {
        Remove-Item -LiteralPath $latestOutputDir -Recurse -Force
    }
    Ensure-OwReportDirectory -Path $latestOutputDir | Out-Null

    $resolvedProjectRoot = [System.IO.Path]::GetFullPath($script:OwReportProjectRoot).TrimEnd('\')
    $resolvedDocsOutputDir = [System.IO.Path]::GetFullPath($docsOutputDir)
    if (-not $resolvedDocsOutputDir.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to publish docs outside the project root: $resolvedDocsOutputDir"
    }
    if (Test-Path -LiteralPath $docsOutputDir) {
        foreach ($item in @(Get-ChildItem -LiteralPath $docsOutputDir -Force -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $item.FullName -Recurse -Force
        }
    }
    Ensure-OwReportDirectory -Path $docsOutputDir | Out-Null

    $playersDir = Ensure-OwReportDirectory -Path (Join-Path $runOutputDir 'players')
    $latestPlayersDir = Ensure-OwReportDirectory -Path (Join-Path $latestOutputDir 'players')
    $docsPlayersDir = Ensure-OwReportDirectory -Path (Join-Path $docsOutputDir 'players')
    $runAssetsDir = Ensure-OwReportDirectory -Path (Join-Path $runOutputDir 'assets')
    $latestAssetsDir = Ensure-OwReportDirectory -Path (Join-Path $latestOutputDir 'assets')
    $docsAssetsDir = Ensure-OwReportDirectory -Path (Join-Path $docsOutputDir 'assets')
    $runDataDir = Ensure-OwReportDirectory -Path (Join-Path $runOutputDir 'data')
    $latestDataDir = Ensure-OwReportDirectory -Path (Join-Path $latestOutputDir 'data')
    $docsDataDir = Ensure-OwReportDirectory -Path (Join-Path $docsOutputDir 'data')

    Copy-Item -LiteralPath (Join-Path $script:OwReportProjectRoot 'web\styles.css') -Destination (Join-Path $runAssetsDir 'styles.css') -Force
    Copy-Item -LiteralPath (Join-Path $script:OwReportProjectRoot 'web\app.js') -Destination (Join-Path $runAssetsDir 'app.js') -Force
    Copy-Item -LiteralPath (Join-Path $script:OwReportProjectRoot 'web\styles.css') -Destination (Join-Path $latestAssetsDir 'styles.css') -Force
    Copy-Item -LiteralPath (Join-Path $script:OwReportProjectRoot 'web\app.js') -Destination (Join-Path $latestAssetsDir 'app.js') -Force
    Copy-Item -LiteralPath (Join-Path $script:OwReportProjectRoot 'web\styles.css') -Destination (Join-Path $docsAssetsDir 'styles.css') -Force
    Copy-Item -LiteralPath (Join-Path $script:OwReportProjectRoot 'web\app.js') -Destination (Join-Path $docsAssetsDir 'app.js') -Force

    $overviewHtml = Get-OwReportOverviewHtml -SiteModel $SiteModel
    $settingsHtml = Get-OwReportSettingsHtml -SiteModel $SiteModel
    Write-OwReportTextFile -Path (Join-Path $runOutputDir 'index.html') -Content $overviewHtml
    Write-OwReportTextFile -Path (Join-Path $latestOutputDir 'index.html') -Content $overviewHtml
    Write-OwReportTextFile -Path (Join-Path $docsOutputDir 'index.html') -Content $overviewHtml
    Write-OwReportTextFile -Path (Join-Path $runOutputDir 'settings.html') -Content $settingsHtml
    Write-OwReportTextFile -Path (Join-Path $latestOutputDir 'settings.html') -Content $settingsHtml
    Write-OwReportTextFile -Path (Join-Path $docsOutputDir 'settings.html') -Content $settingsHtml
    Write-OwReportTextFile -Path (Join-Path $docsOutputDir '.nojekyll') -Content ''
    Write-OwReportJsonFile -Path (Join-Path $runDataDir 'site-model.json') -Value $SiteModel -Compress
    Write-OwReportJsonFile -Path (Join-Path $latestDataDir 'site-model.json') -Value $SiteModel -Compress
    Write-OwReportJsonFile -Path (Join-Path $docsDataDir 'site-model.json') -Value $SiteModel -Compress
    if ($PSBoundParameters.ContainsKey('PublishedState') -and $null -ne $PublishedState) {
        Write-OwReportJsonFile -Path (Join-Path $runDataDir 'published-state.json') -Value $PublishedState -Compress
        Write-OwReportJsonFile -Path (Join-Path $latestDataDir 'published-state.json') -Value $PublishedState -Compress
        Write-OwReportJsonFile -Path (Join-Path $docsDataDir 'published-state.json') -Value $PublishedState -Compress
    }

    foreach ($player in $SiteModel.players) {
        $playerHtml = Get-OwReportPlayerHtml -SiteModel $SiteModel -Player $player
        Write-OwReportTextFile -Path (Join-Path $playersDir ('{0}.html' -f $player.slug)) -Content $playerHtml
        Write-OwReportTextFile -Path (Join-Path $latestPlayersDir ('{0}.html' -f $player.slug)) -Content $playerHtml
        Write-OwReportTextFile -Path (Join-Path $docsPlayersDir ('{0}.html' -f $player.slug)) -Content $playerHtml
    }

    return [ordered]@{
        run_output_dir = $runOutputDir
        latest_output_dir = $latestOutputDir
        latest_index = (Join-Path $latestOutputDir 'index.html')
        docs_output_dir = $docsOutputDir
        docs_index = (Join-Path $docsOutputDir 'index.html')
    }
}
