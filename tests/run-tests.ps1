$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\OwReport.psm1'
Import-Module $modulePath -Force
$owReportModule = Get-Module OwReport

$failures = 0

function Assert-Equal {
    param(
        $Actual,
        $Expected,
        [string]$Message
    )

    if ($Actual -ne $Expected) {
        $script:failures += 1
        Write-Host ("FAIL: {0}. Expected '{1}' but got '{2}'." -f $Message, $Expected, $Actual) -ForegroundColor Red
    }
    else {
        Write-Host ("PASS: {0}" -f $Message) -ForegroundColor Green
    }
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        $script:failures += 1
        Write-Host ("FAIL: {0}" -f $Message) -ForegroundColor Red
    }
    else {
        Write-Host ("PASS: {0}" -f $Message) -ForegroundColor Green
    }
}

function New-TestSnapshot {
    param(
        [string]$DisplayName = 'Tester',
        [string]$PlayerSlug = 'tester',
        [string]$PlayerId = 'Tester-1234',
        [string]$CapturedAt,
        [double]$Kda,
        [double]$Winrate,
        [double]$RankOrdinal,
        [object[]]$Heroes,
        [object[]]$RoleRecords = @(),
        [object[]]$RankRoles = @(),
        [string]$PreferredRole = 'support'
    )

    $normalizedHeroes = @(
        $Heroes | ForEach-Object {
            [pscustomobject]@{
                hero_key = $_.hero_key
                hero_name = $_.hero_name
                hero_role = $_.hero_role
                games_played = $_.games_played
                time_played_seconds = $_.time_played_seconds
                winrate = $_.winrate
                kda = $_.kda
                average = [pscustomobject]@{
                    eliminations = $_.average.eliminations
                    deaths = $_.average.deaths
                }
            }
        }
    )

    return [pscustomobject]@{
        captured_at = $CapturedAt
        run_id = ([DateTimeOffset]::Parse($CapturedAt)).ToString('yyyyMMdd-HHmmss')
        display_name = $DisplayName
        player_slug = $PlayerSlug
        player_id = $PlayerId
        wide_match_context = 'mixed'
        fetch_status = 'success'
        warnings = @()
        profile = [pscustomobject]@{
            avatar = $null
            title = 'Probe'
        }
        metrics = [pscustomobject]@{
            kda = $Kda
            winrate = $Winrate
            games_played = 20
            games_won = 11
            games_lost = 9
            time_played_seconds = 7200
        }
        ranks = [pscustomobject]@{
            best_label = ConvertFrom-RankOrdinal -Ordinal $RankOrdinal
            average_ordinal = $RankOrdinal
            roles = $(if ($RankRoles.Count -gt 0) {
                $RankRoles
            }
            else {
                @(
                    [pscustomobject]@{
                        role = $PreferredRole
                        label = ConvertFrom-RankOrdinal -Ordinal $RankOrdinal
                        ordinal = $RankOrdinal
                    }
                )
            })
        }
        roles = $(if ($RoleRecords.Count -gt 0) {
            $RoleRecords
        }
        else {
            @(
                [pscustomobject]@{
                    role = $PreferredRole
                    kda = $Kda
                    winrate = $Winrate
                    games_played = 20
                    time_played_seconds = 7200
                }
            )
        })
        heroes = $normalizedHeroes
        normalized = [pscustomobject]@{
            preferred_role = $PreferredRole
            top_heroes = @($normalizedHeroes | ForEach-Object { $_.hero_name })
        }
    }
}

$heroCatalog = @{
    ana = @{ name = 'Ana'; role = 'support' }
    mercy = @{ name = 'Mercy'; role = 'support' }
    moira = @{ name = 'Moira'; role = 'support' }
}

Assert-Equal -Actual (ConvertTo-NormalizedBattleTag 'Player#1234') -Expected 'Player-1234' -Message 'BattleTag normalization replaces # with -'
Assert-Equal -Actual (ConvertTo-RankOrdinal ([ordered]@{ tier = 'gold'; division = 2 })) -Expected 14 -Message 'Rank ordinal conversion handles tier/division objects'
Assert-Equal -Actual (ConvertTo-RankOrdinal ([ordered]@{ division = 'silver'; tier = 4 })) -Expected 7 -Message 'Rank ordinal conversion handles OverFast division-name plus numeric-tier shape'

$trendSeries = @(
    [ordered]@{ timestamp = '2026-03-01T12:00:00+10:00'; value = 1.5 },
    [ordered]@{ timestamp = '2026-03-05T12:00:00+10:00'; value = 1.8 },
    [ordered]@{ timestamp = '2026-03-18T12:00:00+10:00'; value = 2.1 }
)
$trend = Get-TimeSeriesTrend -Series $trendSeries -FlatSlopeThreshold 0.01
Assert-Equal -Actual $trend.direction -Expected 'up' -Message 'Time series trend respects irregular timestamps and detects upward slope'

$snapshots = @(
    (New-TestSnapshot -CapturedAt '2026-02-20T09:00:00+10:00' -Kda 1.6 -Winrate 48 -RankOrdinal 13 -Heroes @(
        [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 10; time_played_seconds = 3600; winrate = 50; kda = 1.7; average = [ordered]@{ eliminations = 8; deaths = 8 } },
        [ordered]@{ hero_key = 'mercy'; hero_name = 'Mercy'; hero_role = 'support'; games_played = 9; time_played_seconds = 3300; winrate = 42; kda = 1.1; average = [ordered]@{ eliminations = 3; deaths = 10 } }
    )),
    (New-TestSnapshot -CapturedAt '2026-03-02T09:00:00+10:00' -Kda 1.9 -Winrate 52 -RankOrdinal 14 -Heroes @(
        [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 14; time_played_seconds = 4800; winrate = 57; kda = 2.0; average = [ordered]@{ eliminations = 10; deaths = 7 } },
        [ordered]@{ hero_key = 'mercy'; hero_name = 'Mercy'; hero_role = 'support'; games_played = 10; time_played_seconds = 3600; winrate = 41; kda = 1.0; average = [ordered]@{ eliminations = 3; deaths = 10 } },
        [ordered]@{ hero_key = 'moira'; hero_name = 'Moira'; hero_role = 'support'; games_played = 4; time_played_seconds = 1200; winrate = 54; kda = 1.6; average = [ordered]@{ eliminations = 9; deaths = 8 } }
    )),
    (New-TestSnapshot -CapturedAt '2026-03-19T09:00:00+10:00' -Kda 2.2 -Winrate 56 -RankOrdinal 15 -Heroes @(
        [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 18; time_played_seconds = 6000; winrate = 61; kda = 2.3; average = [ordered]@{ eliminations = 11; deaths = 7 } },
        [ordered]@{ hero_key = 'mercy'; hero_name = 'Mercy'; hero_role = 'support'; games_played = 12; time_played_seconds = 4200; winrate = 40; kda = 0.95; average = [ordered]@{ eliminations = 3; deaths = 11 } },
        [ordered]@{ hero_key = 'moira'; hero_name = 'Moira'; hero_role = 'support'; games_played = 7; time_played_seconds = 2100; winrate = 58; kda = 1.95; average = [ordered]@{ eliminations = 10; deaths = 8 } }
    ))
)

$analysis = Get-PlayerAnalyticsFromSnapshots -Snapshots $snapshots -HeroCatalog $heroCatalog
Assert-Equal -Actual $analysis.trend.label -Expected 'up' -Message 'Composite player analytics detect upward direction'
Assert-True -Condition ($analysis.trend.forecast -in @('likely climbing', 'likely stable')) -Message 'Forecast remains conservative'

$rankBugSnapshot = New-TestSnapshot -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.0 -Winrate 50 -RankOrdinal 9 -Heroes @(
    [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 8; time_played_seconds = 2400; winrate = 50; kda = 2.0; average = [ordered]@{ eliminations = 9; deaths = 7 } }
)
$rankBugSnapshot.ranks = [pscustomobject]@{
    best_role = 'support'
    best_label = 'Silver 2'
    average_ordinal = 9.67
    roles = @(
        [pscustomobject]@{ role = 'support'; label = 'Silver 2'; ordinal = 9 },
        [pscustomobject]@{ role = 'damage'; label = 'Gold 3'; ordinal = 13 },
        [pscustomobject]@{ role = 'tank'; label = 'Silver 4'; ordinal = 7 }
    )
}
$rankBugAnalysis = Get-PlayerAnalyticsFromSnapshots -Snapshots @($rankBugSnapshot) -HeroCatalog $heroCatalog
Assert-Equal -Actual $rankBugAnalysis.latest.ranks.best_role -Expected 'damage' -Message 'Analytics normalize stored rank summaries to the highest role'
Assert-Equal -Actual $rankBugAnalysis.latest.ranks.best_label -Expected 'Gold 3' -Message 'Analytics keep the top rank label aligned after normalization'

$recommendations = Get-HeroRecommendationsFromSnapshots -Snapshots $snapshots -HeroCatalog $heroCatalog
Assert-Equal -Actual $recommendations.comfort[0].hero_key -Expected 'ana' -Message 'Comfort recommendations prioritize strong repeated heroes'
Assert-Equal -Actual $recommendations.avoid[0].hero_key -Expected 'mercy' -Message 'Avoid recommendations surface weak repeated heroes'

$filterSnapshot = [pscustomobject]@{
    captured_at = '2026-03-20T10:00:00+10:00'
    run_id = '20260320-100000'
    display_name = 'FilterTester'
    player_slug = 'filter-tester'
    player_id = 'Filter-1000'
    wide_match_context = 'mixed'
    fetch_status = 'success'
    warnings = @()
    profile = [pscustomobject]@{
        avatar = $null
        title = 'Filter'
    }
    metrics = [pscustomobject]@{
        kda = 2.4
        winrate = 73.3
        games_played = 15
        games_won = 11
        games_lost = 4
        time_played_seconds = 4500
    }
    ranks = [pscustomobject]@{
        best_label = 'Gold 4'
        average_ordinal = 12
        roles = @(
            [pscustomobject]@{ role = 'support'; label = 'Gold 4'; ordinal = 12 },
            [pscustomobject]@{ role = 'damage'; label = 'Silver 1'; ordinal = 10 }
        )
    }
    roles = @(
        [pscustomobject]@{ role = 'support'; kda = 2.2; winrate = 60; games_played = 10; games_won = 6; games_lost = 4; time_played_seconds = 3000 },
        [pscustomobject]@{ role = 'damage'; kda = 3.0; winrate = 100; games_played = 5; games_won = 5; games_lost = 0; time_played_seconds = 1500 }
    )
    heroes = @(
        [pscustomobject]@{
            hero_key = 'ana'
            hero_name = 'Ana'
            hero_role = 'support'
            games_played = 10
            games_won = 6
            games_lost = 4
            time_played_seconds = 3000
            winrate = 60
            kda = 2.2
            total = [pscustomobject]@{ eliminations = 90; assists = 30; deaths = 55; damage = 20000; healing = 60000 }
            average = [pscustomobject]@{ eliminations = 18; deaths = 11 }
        }
        [pscustomobject]@{
            hero_key = 'widowmaker'
            hero_name = 'Widowmaker'
            hero_role = 'damage'
            games_played = 5
            games_won = 5
            games_lost = 0
            time_played_seconds = 1500
            winrate = 100
            kda = 3.0
            total = [pscustomobject]@{ eliminations = 80; assists = 5; deaths = 28; damage = 45000; healing = 0 }
            average = [pscustomobject]@{ eliminations = 32; deaths = 11.2 }
        }
    )
    normalized = [pscustomobject]@{
        preferred_role = 'damage'
        data_quality = 'success'
        top_heroes = @('Widowmaker', 'Ana')
    }
}

$filteredSnapshot = Apply-OwReportPlayerFiltersToSnapshot -Snapshot $filterSnapshot -PlayerConfig @{
    hidden_heroes = @('Widowmaker')
    locked_role = 'support'
}
Assert-Equal -Actual $filteredSnapshot.heroes.Count -Expected 1 -Message 'Hidden hero filtering removes excluded heroes from the visible snapshot'
Assert-Equal -Actual $filteredSnapshot.metrics.games_played -Expected 10 -Message 'Hidden hero filtering recomputes games played from the remaining heroes'
Assert-Equal -Actual $filteredSnapshot.normalized.preferred_role -Expected 'support' -Message 'Hidden hero filtering recalculates the preferred role'
Assert-True -Condition (($filteredSnapshot.warnings -join ' ') -like '*Custom hero filter active*') -Message 'Hidden hero filtering leaves a visible warning trail'

$stalePreferredRoleSnapshot = [pscustomobject]@{
    captured_at = '2026-03-20T11:00:00+10:00'
    run_id = '20260320-110000'
    display_name = 'RoleFixer'
    player_slug = 'role-fixer'
    player_id = 'Role-1000'
    wide_match_context = 'mixed'
    fetch_status = 'success'
    warnings = @()
    profile = [pscustomobject]@{
        avatar = $null
        title = 'Role Fixer'
    }
    metrics = [pscustomobject]@{
        kda = 2.0
        winrate = 55
        games_played = 16
        games_won = 9
        games_lost = 7
        time_played_seconds = 4200
    }
    ranks = [pscustomobject]@{
        best_label = 'Gold 3'
        average_ordinal = 12
        best_role = 'damage'
        roles = @(
            [pscustomobject]@{ role = 'damage'; label = 'Gold 3'; ordinal = 13 },
            [pscustomobject]@{ role = 'support'; label = 'Silver 1'; ordinal = 10 }
        )
    }
    roles = @(
        [pscustomobject]@{ role = 'support'; kda = 1.7; winrate = 50; games_played = 10; games_won = 5; games_lost = 5; time_played_seconds = 3200 },
        [pscustomobject]@{ role = 'damage'; kda = 2.4; winrate = 63; games_played = 6; games_won = 4; games_lost = 2; time_played_seconds = 5000 }
    )
    heroes = @(
        [pscustomobject]@{
            hero_key = 'ana'
            hero_name = 'Ana'
            hero_role = 'support'
            games_played = 10
            games_won = 5
            games_lost = 5
            time_played_seconds = 3200
            season_games_played = 10
            season_time_played_seconds = 3200
            winrate = 50
            kda = 1.7
            total = [pscustomobject]@{ eliminations = 80; assists = 25; deaths = 62; damage = 18000; healing = 59000 }
            average = [pscustomobject]@{ eliminations = 15; deaths = 11 }
        }
        [pscustomobject]@{
            hero_key = 'soldier-76'
            hero_name = 'Soldier: 76'
            hero_role = 'damage'
            games_played = 6
            games_won = 4
            games_lost = 2
            time_played_seconds = 5000
            season_games_played = 6
            season_time_played_seconds = 5000
            winrate = 63
            kda = 2.4
            total = [pscustomobject]@{ eliminations = 110; assists = 8; deaths = 49; damage = 61000; healing = 0 }
            average = [pscustomobject]@{ eliminations = 18; deaths = 8 }
        }
    )
    normalized = [pscustomobject]@{
        preferred_role = 'tank'
        data_quality = 'success'
        top_heroes = @('Ana', 'Soldier: 76')
    }
}
$normalizedPreferredRoleSnapshot = Apply-OwReportPlayerFiltersToSnapshot -Snapshot $stalePreferredRoleSnapshot -PlayerConfig @{
    hidden_heroes = @()
    locked_role = ''
}
Assert-Equal -Actual $normalizedPreferredRoleSnapshot.normalized.preferred_role -Expected 'damage' -Message 'Snapshot normalization fixes stale preferred-role values even without hidden heroes'

$wideAssessment = Get-OwReportWideGroupAssessment -Assignments @(
    [pscustomobject]@{ rank_ordinal = 18 },
    [pscustomobject]@{ rank_ordinal = 12 },
    [pscustomobject]@{ rank_ordinal = 11 },
    [pscustomobject]@{ rank_ordinal = 10 },
    [pscustomobject]@{ rank_ordinal = 10 }
)
Assert-Equal -Actual $wideAssessment.label -Expected 'wide' -Message 'Wide group assessment flags Masters-inclusive spreads above three divisions'

$singleRunRoot = Join-Path $PSScriptRoot 'tmp\single-run-site'
$singleRunSiteModel = & $owReportModule {
    param($TempRoot)

    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    $config = [ordered]@{
        team_name = 'Single Run Team'
        site_subtitle = 'Single run regression'
        storage_dir = (Join-Path $TempRoot 'data')
        output_dir = (Join-Path $TempRoot 'output')
        logs_dir = (Join-Path $TempRoot 'logs')
        cache_dir = (Join-Path $TempRoot 'cache')
        players = @(
            [ordered]@{
                display_name = 'FirstRun'
                battle_tag = 'FirstRun#1000'
                player_id = 'FirstRun-1000'
                slug = 'firstrun'
                hidden_heroes = @()
                locked_role = ''
            }
        )
    }

    $storage = Initialize-OwReportStorage -Config $config
    $snapshot = [ordered]@{
        snapshot_id = '20260322-100000-firstrun'
        run_id = '20260322-100000'
        captured_at = '2026-03-22T10:00:00+10:00'
        player_id = 'FirstRun-1000'
        player_slug = 'firstrun'
        display_name = 'FirstRun'
        battle_tag = 'FirstRun#1000'
        provider = 'overfast'
        fetch_status = 'success'
        wide_match_context = 'mixed'
        notes = ''
        warnings = @()
        profile = [ordered]@{
            username = 'FirstRun'
            avatar = $null
            namecard = $null
            title = $null
            endorsement_level = 3
            last_updated_at = '2026-03-22T09:59:00+10:00'
        }
        ranks = [ordered]@{
            best_label = 'Gold 3'
            best_role = 'damage'
            average_ordinal = 13
            roles = @(
                [ordered]@{ role = 'damage'; label = 'Gold 3'; ordinal = 13 }
                [ordered]@{ role = 'support'; label = 'Silver 2'; ordinal = 9 }
            )
        }
        metrics = [ordered]@{
            kda = 2.35
            winrate = 54.5
            games_played = 20
            games_won = 11
            games_lost = 9
            time_played_seconds = 7200
            total = [ordered]@{ eliminations = 210; assists = 58; deaths = 114; damage = 52000; healing = 6000 }
            average = [ordered]@{ eliminations = 17.5; assists = 4.8; deaths = 9.5; damage = 4333; healing = 500 }
        }
        roles = @(
            [ordered]@{ role = 'damage'; kda = 2.6; winrate = 55; games_played = 14; games_won = 8; games_lost = 6; time_played_seconds = 5000 }
            [ordered]@{ role = 'support'; kda = 1.8; winrate = 53; games_played = 6; games_won = 3; games_lost = 3; time_played_seconds = 2200 }
        )
        heroes = @(
            [ordered]@{
                hero_key = 'soldier-76'
                hero_name = 'Soldier: 76'
                hero_role = 'damage'
                games_played = 14
                games_won = 8
                games_lost = 6
                season_games_played = 14
                season_games_won = 8
                season_games_lost = 6
                time_played_seconds = 5000
                season_time_played_seconds = 5000
                winrate = 55
                kda = 2.6
                total = [ordered]@{ eliminations = 160; assists = 20; deaths = 69; damage = 43000; healing = 0 }
            }
            [ordered]@{
                hero_key = 'ana'
                hero_name = 'Ana'
                hero_role = 'support'
                games_played = 6
                games_won = 3
                games_lost = 3
                season_games_played = 6
                season_games_won = 3
                season_games_lost = 3
                time_played_seconds = 2200
                season_time_played_seconds = 2200
                winrate = 53
                kda = 1.8
                total = [ordered]@{ eliminations = 50; assists = 38; deaths = 45; damage = 9000; healing = 28000 }
            }
        )
        normalized = [ordered]@{
            preferred_role = 'damage'
            data_quality = 'success'
            top_heroes = @('Soldier: 76', 'Ana')
        }
        raw_payloads = [ordered]@{}
    }

    Save-OwReportPlayerSnapshot -Storage $storage -Snapshot $snapshot
    Save-OwReportRunRecord -Storage $storage -RunRecord ([ordered]@{
        run_id = '20260322-100000'
        timestamp = '2026-03-22T10:00:00+10:00'
        started_at = '2026-03-22T10:00:00+10:00'
        completed_at = '2026-03-22T10:01:00+10:00'
        notes = ''
        wide_match_context = 'mixed'
        team_name = 'Single Run Team'
        provider = 'overfast'
        successful_players = 1
        failed_players = @()
        warnings = @()
    })

    return (Get-OwReportTeamAnalytics -Config $config -Storage $storage -RunContext ([ordered]@{
        run_id = '20260322-100000'
        timestamp = '2026-03-22T10:00:00+10:00'
        notes = ''
        wide_match_context = 'mixed'
    }) -HeroCatalog @{})
} $singleRunRoot

Assert-Equal -Actual $singleRunSiteModel.overview.players.Count -Expected 1 -Message 'First run team analytics still produce a roster card'
Assert-Equal -Actual $singleRunSiteModel.players.Count -Expected 1 -Message 'First run team analytics still produce a player detail page'
Assert-Equal -Actual $singleRunSiteModel.overview.players[0].has_previous_snapshot -Expected $false -Message 'First run roster cards mark that there is no previous snapshot yet'
Assert-Equal -Actual $singleRunSiteModel.settings.runs.Count -Expected 1 -Message 'Settings payload includes the first run immediately'

$databaseBackedSiteModel = & $owReportModule {
    $config = [ordered]@{
        team_name = 'Database Team'
        site_subtitle = 'DB-backed regression'
        project_root = 'C:\Temp\OwReport'
        config_path = 'C:\Temp\OwReport\config\team.sample.json'
        provider = [ordered]@{
            name = 'influxdb'
        }
        players = @(
            [ordered]@{
                display_name = 'DbTester'
                battle_tag = 'DbTester#1000'
                player_id = 'DbTester-1000'
                slug = 'dbtester'
                hidden_heroes = @()
                locked_role = ''
            }
        )
    }

    $olderSnapshot = New-TestSnapshot -DisplayName 'DbTester' -PlayerSlug 'dbtester' -PlayerId 'DbTester-1000' -CapturedAt '2026-03-22T10:00:00+10:00' -Kda 2.0 -Winrate 50 -RankOrdinal 12 -PreferredRole 'damage' -RankRoles @(
        [pscustomobject]@{ role = 'damage'; label = 'Gold 4'; ordinal = 12 }
    ) -Heroes @(
        [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 5; time_played_seconds = 1800; winrate = 50; kda = 2.0; average = [ordered]@{ eliminations = 8; deaths = 6 } }
    )
    $olderSnapshot.run_id = '20260322-000000'

    $latestSnapshot = New-TestSnapshot -DisplayName 'DbTester' -PlayerSlug 'dbtester' -PlayerId 'DbTester-1000' -CapturedAt '2026-04-10T10:00:00+10:00' -Kda 2.3 -Winrate 55 -RankOrdinal 13 -PreferredRole 'damage' -RankRoles @(
        [pscustomobject]@{ role = 'damage'; label = 'Gold 3'; ordinal = 13 }
    ) -Heroes @(
        [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 7; time_played_seconds = 2400; winrate = 55; kda = 2.3; average = [ordered]@{ eliminations = 9; deaths = 5 } }
    )
    $latestSnapshot.run_id = '20260410-000000'

    $snapshots = @(
        $olderSnapshot,
        $latestSnapshot
    )

    $runRecords = @(
        [ordered]@{
            run_id = '20260322-000000'
            timestamp = '2026-03-22T00:00:00Z'
            started_at = '2026-03-22T00:00:00Z'
            completed_at = '2026-03-22T00:00:00Z'
            notes = ''
            wide_match_context = 'mostly_narrow'
            successful_players = 1
            failed_players = @()
        },
        [ordered]@{
            run_id = '20260410-000000'
            timestamp = '2026-04-10T00:00:00Z'
            started_at = '2026-04-10T00:00:00Z'
            completed_at = '2026-04-10T00:00:00Z'
            notes = ''
            wide_match_context = 'mostly_wide'
            successful_players = 1
            failed_players = @()
        }
    )

    return (Get-OwReportTeamAnalytics -Config $config -RunContext ([ordered]@{
        run_id = '20260413-200000'
        timestamp = '2026-04-13T10:00:00+10:00'
        notes = 'regenerated'
        wide_match_context = 'mixed'
    }) -HeroCatalog $heroCatalog -Snapshots $snapshots -RunRecords $runRecords)
}

Assert-Equal -Actual $databaseBackedSiteModel.meta.latest_run.run_id -Expected '20260410-000000' -Message 'Database-backed analytics use the latest database run instead of the local regeneration run'
Assert-Equal -Actual $databaseBackedSiteModel.meta.fresh_snapshots -Expected 1 -Message 'Database-backed analytics count fresh snapshots from the latest database run'
Assert-Equal -Actual $databaseBackedSiteModel.overview.players[0].stale -Expected $false -Message 'Database-backed roster cards are not marked stale when they come from the latest database run'
Assert-Equal -Actual $databaseBackedSiteModel.settings.removal_mode -Expected 'hide-only' -Message 'Database-backed settings switch to hide-only mode'

$optimizerAnalyses = @(
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'TankAce' -PlayerSlug 'tank-ace' -PlayerId 'Tank-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.1 -Winrate 55 -RankOrdinal 15 -PreferredRole 'tank' -RoleRecords @(
            [pscustomobject]@{ role = 'tank'; kda = 2.8; winrate = 58; games_played = 18; time_played_seconds = 5400 },
            [pscustomobject]@{ role = 'support'; kda = 1.4; winrate = 47; games_played = 4; time_played_seconds = 1200 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'tank'; label = 'Gold 1'; ordinal = 15 },
            [pscustomobject]@{ role = 'support'; label = 'Silver 3'; ordinal = 8 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'reinhardt'; hero_name = 'Reinhardt'; hero_role = 'tank'; games_played = 18; time_played_seconds = 5400; winrate = 58; kda = 2.8; average = [ordered]@{ eliminations = 12; deaths = 6 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'DamageOne' -PlayerSlug 'damage-one' -PlayerId 'Damage-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.3 -Winrate 54 -RankOrdinal 14 -PreferredRole 'damage' -RoleRecords @(
            [pscustomobject]@{ role = 'damage'; kda = 2.6; winrate = 56; games_played = 16; time_played_seconds = 5100 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'damage'; label = 'Gold 2'; ordinal = 14 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'soldier-76'; hero_name = 'Soldier: 76'; hero_role = 'damage'; games_played = 16; time_played_seconds = 5100; winrate = 56; kda = 2.6; average = [ordered]@{ eliminations = 13; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'DamageTwo' -PlayerSlug 'damage-two' -PlayerId 'Damage-2' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.25 -Winrate 53 -RankOrdinal 13 -PreferredRole 'damage' -RoleRecords @(
            [pscustomobject]@{ role = 'damage'; kda = 2.4; winrate = 54; games_played = 15; time_played_seconds = 4800 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'damage'; label = 'Gold 3'; ordinal = 13 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'cassidy'; hero_name = 'Cassidy'; hero_role = 'damage'; games_played = 15; time_played_seconds = 4800; winrate = 54; kda = 2.4; average = [ordered]@{ eliminations = 12; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'SupportOne' -PlayerSlug 'support-one' -PlayerId 'Support-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.0 -Winrate 57 -RankOrdinal 14 -PreferredRole 'support' -RoleRecords @(
            [pscustomobject]@{ role = 'support'; kda = 2.1; winrate = 57; games_played = 17; time_played_seconds = 5000 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'support'; label = 'Gold 2'; ordinal = 14 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 17; time_played_seconds = 5000; winrate = 57; kda = 2.1; average = [ordered]@{ eliminations = 11; deaths = 6 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'FlexLock' -PlayerSlug 'flex-lock' -PlayerId 'Flex-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 1.95 -Winrate 52 -RankOrdinal 12 -PreferredRole 'support' -RoleRecords @(
            [pscustomobject]@{ role = 'support'; kda = 2.0; winrate = 53; games_played = 14; time_played_seconds = 4200 },
            [pscustomobject]@{ role = 'tank'; kda = 2.2; winrate = 50; games_played = 10; time_played_seconds = 3300 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'support'; label = 'Gold 4'; ordinal = 12 },
            [pscustomobject]@{ role = 'tank'; label = 'Silver 1'; ordinal = 10 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'moira'; hero_name = 'Moira'; hero_role = 'support'; games_played = 14; time_played_seconds = 4200; winrate = 53; kda = 2.0; average = [ordered]@{ eliminations = 10; deaths = 6 } }
        ))
    ) -HeroCatalog $heroCatalog)
)

$optimizerAnalyses[4].latest | Add-Member -NotePropertyName customizations -NotePropertyValue ([pscustomobject]@{
    hidden_hero_names = @()
    locked_role = 'support'
}) -Force

$optimizer = Get-OwReportTeamOptimizerModel -PlayerAnalyses $optimizerAnalyses
Assert-Equal -Actual $optimizer.default_result.assignments.Count -Expected 5 -Message 'Team optimizer returns a full five-player lineup'
Assert-Equal -Actual (@($optimizer.default_result.assignments | Where-Object { $_.role -eq 'tank' }).Count) -Expected 1 -Message 'Team optimizer keeps the lineup to one tank'
Assert-Equal -Actual (@($optimizer.default_result.assignments | Where-Object { $_.role -eq 'damage' }).Count) -Expected 2 -Message 'Team optimizer keeps the lineup to two DPS'
Assert-Equal -Actual (@($optimizer.default_result.assignments | Where-Object { $_.role -eq 'support' }).Count) -Expected 2 -Message 'Team optimizer keeps the lineup to two supports'
Assert-True -Condition (@($optimizer.default_result.assignments | Where-Object { $_.slug -eq 'flex-lock' -and $_.role -eq 'support' }).Count -eq 1) -Message 'Team optimizer respects locked role assignments'

$narrowPreferredAnalyses = @(
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'TankWide' -PlayerSlug 'tank-wide' -PlayerId 'TankWide-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 3.2 -Winrate 60 -RankOrdinal 15 -PreferredRole 'tank' -RoleRecords @(
            [pscustomobject]@{ role = 'tank'; kda = 3.2; winrate = 60; games_played = 22; time_played_seconds = 6000 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'tank'; label = 'Gold 1'; ordinal = 15 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'reinhardt'; hero_name = 'Reinhardt'; hero_role = 'tank'; games_played = 22; time_played_seconds = 6000; winrate = 60; kda = 3.2; average = [ordered]@{ eliminations = 13; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'TankNarrow' -PlayerSlug 'tank-narrow' -PlayerId 'TankNarrow-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.25 -Winrate 55 -RankOrdinal 12 -PreferredRole 'tank' -RoleRecords @(
            [pscustomobject]@{ role = 'tank'; kda = 2.25; winrate = 55; games_played = 20; time_played_seconds = 5400 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'tank'; label = 'Gold 4'; ordinal = 12 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'orisa'; hero_name = 'Orisa'; hero_role = 'tank'; games_played = 20; time_played_seconds = 5400; winrate = 55; kda = 2.25; average = [ordered]@{ eliminations = 11; deaths = 6 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'DamageOne' -PlayerSlug 'damage-one-b' -PlayerId 'DamageOne-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.45 -Winrate 54 -RankOrdinal 13 -PreferredRole 'damage' -RoleRecords @(
            [pscustomobject]@{ role = 'damage'; kda = 2.45; winrate = 54; games_played = 21; time_played_seconds = 5600 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'damage'; label = 'Gold 3'; ordinal = 13 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'cassidy'; hero_name = 'Cassidy'; hero_role = 'damage'; games_played = 21; time_played_seconds = 5600; winrate = 54; kda = 2.45; average = [ordered]@{ eliminations = 12; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'DamageTwo' -PlayerSlug 'damage-two-b' -PlayerId 'DamageTwo-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.35 -Winrate 53 -RankOrdinal 14 -PreferredRole 'damage' -RoleRecords @(
            [pscustomobject]@{ role = 'damage'; kda = 2.35; winrate = 53; games_played = 20; time_played_seconds = 5500 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'damage'; label = 'Gold 2'; ordinal = 14 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'soldier-76'; hero_name = 'Soldier: 76'; hero_role = 'damage'; games_played = 20; time_played_seconds = 5500; winrate = 53; kda = 2.35; average = [ordered]@{ eliminations = 12; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'SupportLow' -PlayerSlug 'support-low' -PlayerId 'SupportLow-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.9 -Winrate 58 -RankOrdinal 6 -PreferredRole 'support' -RoleRecords @(
            [pscustomobject]@{ role = 'support'; kda = 2.9; winrate = 58; games_played = 22; time_played_seconds = 6200 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'support'; label = 'Silver 5'; ordinal = 6 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'moira'; hero_name = 'Moira'; hero_role = 'support'; games_played = 22; time_played_seconds = 6200; winrate = 58; kda = 2.9; average = [ordered]@{ eliminations = 13; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'SupportMid' -PlayerSlug 'support-mid' -PlayerId 'SupportMid-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.5 -Winrate 56 -RankOrdinal 9 -PreferredRole 'support' -RoleRecords @(
            [pscustomobject]@{ role = 'support'; kda = 2.5; winrate = 56; games_played = 21; time_played_seconds = 5900 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'support'; label = 'Silver 2'; ordinal = 9 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'ana'; hero_name = 'Ana'; hero_role = 'support'; games_played = 21; time_played_seconds = 5900; winrate = 56; kda = 2.5; average = [ordered]@{ eliminations = 11; deaths = 5 } }
        ))
    ) -HeroCatalog $heroCatalog),
    (Get-PlayerAnalyticsFromSnapshots -Snapshots @(
        (New-TestSnapshot -DisplayName 'SupportHigh' -PlayerSlug 'support-high' -PlayerId 'SupportHigh-1' -CapturedAt '2026-03-20T09:00:00+10:00' -Kda 2.15 -Winrate 52 -RankOrdinal 12 -PreferredRole 'support' -RoleRecords @(
            [pscustomobject]@{ role = 'support'; kda = 2.15; winrate = 52; games_played = 18; time_played_seconds = 5000 }
        ) -RankRoles @(
            [pscustomobject]@{ role = 'support'; label = 'Gold 4'; ordinal = 12 }
        ) -Heroes @(
            [ordered]@{ hero_key = 'kiriko'; hero_name = 'Kiriko'; hero_role = 'support'; games_played = 18; time_played_seconds = 5000; winrate = 52; kda = 2.15; average = [ordered]@{ eliminations = 10; deaths = 6 } }
        ))
    ) -HeroCatalog $heroCatalog)
)

$narrowPreferredOptimizer = Get-OwReportTeamOptimizerModel -PlayerAnalyses $narrowPreferredAnalyses
Assert-Equal -Actual $narrowPreferredOptimizer.default_result.wide_assessment.label -Expected 'narrow' -Message 'Team optimizer prefers a narrow lineup when one is available'
Assert-True -Condition (@($narrowPreferredOptimizer.default_result.assignments | Where-Object { $_.slug -eq 'tank-narrow' -and $_.role -eq 'tank' }).Count -eq 1) -Message 'Narrow-first optimizer selects the best narrow tank option'
Assert-True -Condition (@($narrowPreferredOptimizer.default_result.assignments | Where-Object { $_.slug -eq 'support-low' }).Count -eq 0) -Message 'Narrow-first optimizer can bench a high-score wide-enabling support to stay narrow'

if ($failures -gt 0) {
    Write-Host ''
    Write-Host ("{0} test(s) failed." -f $failures) -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'All tests passed.' -ForegroundColor Green
