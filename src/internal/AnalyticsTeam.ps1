function Get-HeroRecommendationsFromSnapshots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Snapshots,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    if ($Snapshots.Count -eq 0) {
        return [ordered]@{
            comfort = @()
            growth = @()
            avoid = @()
        }
    }

    $latestSnapshot = @($Snapshots | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' })[-1]
    $preferredRole = $latestSnapshot.normalized.preferred_role
    $heroKeys = @($latestSnapshot.heroes | Sort-Object time_played_seconds -Descending | ForEach-Object { $_.hero_key })
    $comfort = @()
    $growth = @()
    $avoid = @()

    foreach ($heroKey in $heroKeys) {
        $latestMatches = @($latestSnapshot.heroes | Where-Object { $_.hero_key -eq $heroKey })
        $latestHero = $(if ($latestMatches.Count -gt 0) { $latestMatches[0] } else { $null })
        if ($null -eq $latestHero) {
            continue
        }

        $latestHeroName = Get-OwReportObjectValue -Object $latestHero -Path @('hero_name') -Default (ConvertTo-OwReportPrettyHeroName -HeroKey $heroKey)
        $latestHeroRole = Get-OwReportObjectValue -Object $latestHero -Path @('hero_role') -Default 'flex'
        $latestHeroGames = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $latestHero -Path @('games_played'))
        $latestHeroTime = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $latestHero -Path @('time_played_seconds'))
        $latestHeroWinrate = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $latestHero -Path @('winrate'))
        $latestHeroKda = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $latestHero -Path @('kda'))
        $latestHeroElims = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $latestHero -Path @('average', 'eliminations'))
        $latestHeroDeaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $latestHero -Path @('average', 'deaths'))

        $kdaSeriesResult = @(Get-OwReportHeroSeries -Snapshots $Snapshots -HeroKeys @($heroKey) -MetricPath @('kda'))
        $kdaSeries = $(if ($kdaSeriesResult.Count -gt 0) { $kdaSeriesResult[0].series } else { @() })
        $winSeriesResult = @(Get-OwReportHeroSeries -Snapshots $Snapshots -HeroKeys @($heroKey) -MetricPath @('winrate'))
        $winSeries = $(if ($winSeriesResult.Count -gt 0) { $winSeriesResult[0].series } else { @() })
        $kdaTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $kdaSeries -WindowDays 30 -MinimumPoints 2 -FallbackLastPoints 4) -FlatSlopeThreshold 0.01
        $winTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $winSeries -WindowDays 30 -MinimumPoints 2 -FallbackLastPoints 4) -FlatSlopeThreshold 0.12

        $gamesPlayed = [double]$latestHeroGames
        $timePlayed = [double]$latestHeroTime
        $kdaNorm = [Math]::Max(0, [Math]::Min(1, (($latestHeroKda - 1.0) / 2.6)))
        $winNorm = [Math]::Max(0, [Math]::Min(1, (($latestHeroWinrate - 45.0) / 25.0)))
        $elimNorm = [Math]::Max(0, [Math]::Min(1, ($latestHeroElims / 20.0)))
        $survivability = [Math]::Max(0, [Math]::Min(1, ((12.0 - $latestHeroDeaths) / 6.0)))
        $sampleNorm = [Math]::Max(0, [Math]::Min(1, [Math]::Max(($gamesPlayed / 20.0), ($timePlayed / 7200.0))))
        $consistency = 0.55
        $kdaValues = @($kdaSeries | Where-Object { $null -ne $_.value } | ForEach-Object { $_.value })
        if ($kdaValues.Count -ge 3) {
            $kdaStd = Get-OwReportStandardDeviation -Values $kdaValues
            $consistency = [Math]::Max(0, [Math]::Min(1, (1.0 - ($kdaStd / [Math]::Max($latestHeroKda, 1.0)))))
        }

        $trendNorm = [Math]::Max(0, [Math]::Min(1, (0.5 + (($kdaTrend.slope_per_day / 0.03) * 0.3) + (($winTrend.slope_per_day / 0.3) * 0.2))))
        $roleBonus = $(if ($latestHeroRole -eq $preferredRole) { 0.04 } else { 0.0 })
        $score = (
            ($kdaNorm * 0.25) +
            ($winNorm * 0.28) +
            ($elimNorm * 0.08) +
            ($survivability * 0.12) +
            ($sampleNorm * 0.12) +
            ($consistency * 0.07) +
            ($trendNorm * 0.08) +
            $roleBonus
        )

        $entry = [ordered]@{
            hero_key = $heroKey
            hero_name = $latestHeroName
            hero_role = $latestHeroRole
            score = [Math]::Round($score, 3)
            games_played = $latestHeroGames
            time_played_seconds = $latestHeroTime
            winrate = $latestHeroWinrate
            kda = $latestHeroKda
            reason = ''
        }

        if (($gamesPlayed -ge 8 -or $timePlayed -ge 2400) -and $score -ge 0.62) {
            $entry.reason = 'Strong sample, reliable KDA, and stable results.'
            $comfort += $entry
            continue
        }

        if (($gamesPlayed -ge 5 -or $timePlayed -ge 1800) -and ($score -lt 0.42 -or ($latestHeroWinrate -lt 45 -and $latestHeroKda -lt 1.25 -and $kdaTrend.direction -eq 'down'))) {
            $entry.reason = 'Low return from repeated usage compared with other options.'
            $avoid += $entry
            continue
        }

        if (($gamesPlayed -ge 3 -or $timePlayed -ge 900) -and ($kdaTrend.direction -eq 'up' -or $winTrend.direction -eq 'up' -or $score -ge 0.48)) {
            $entry.reason = 'Promising trend with enough recent reps to keep exploring.'
            $growth += $entry
        }
    }

    return [ordered]@{
        comfort = @($comfort | Sort-Object score -Descending | Select-Object -First 3)
        growth = @($growth | Sort-Object score -Descending | Select-Object -First 3)
        avoid = @($avoid | Sort-Object score, games_played -Descending | Select-Object -First 3)
    }
}

function Get-OwReportTrajectoryText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$DisplayName,
        [Parameter(Mandatory = $true)]
        [string]$TrendLabel,
        [Parameter(Mandatory = $true)]
        $LatestSnapshot
    )

    $currentKda = [Math]::Round([double]$LatestSnapshot.metrics.kda, 2)
    $currentWinrate = [Math]::Round([double]$LatestSnapshot.metrics.winrate, 1)
    $rankLabel = $LatestSnapshot.ranks.best_label

    switch ($TrendLabel) {
        'up' {
            return "{0} is trending upward with a current KDA of {1} and win rate at {2}%. Rank reads as {3}, and the recent direction is strong enough to project cautious improvement." -f $DisplayName, $currentKda, $currentWinrate, $rankLabel
        }
        'down' {
            return "{0} is sliding right now. KDA sits at {1}, win rate is {2}%, and rank context is {3}. The next sessions should focus on stabilizing execution before expecting visible ladder gains." -f $DisplayName, $currentKda, $currentWinrate, $rankLabel
        }
        default {
            return "{0} looks mostly stable. KDA is {1}, win rate is {2}%, and current rank context is {3}. Progress is present but not accelerating enough yet to read as a decisive climb." -f $DisplayName, $currentKda, $currentWinrate, $rankLabel
        }
    }
}

function Get-OwReportHeroHighlights {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Heroes
    )

    if ($Heroes.Count -eq 0) {
        return [ordered]@{
            best_kda_hero = $null
            best_winrate_hero = $null
        }
    }

    $nonOutlierHeroes = @($Heroes | Where-Object {
        (ConvertTo-OwReportNumber -Value $_.games_played) -gt 0 -and
        (ConvertTo-OwReportNumber -Value $_.winrate) -lt 100
    })

    if ($nonOutlierHeroes.Count -eq 0) {
        return [ordered]@{
            best_kda_hero = $null
            best_winrate_hero = $null
        }
    }

    $qualifiedHeroes = @($nonOutlierHeroes | Where-Object {
        (($_.games_played -ge 3) -or ($_.time_played_seconds -ge 900)) -and $_.games_played -gt 0
    })
    if ($qualifiedHeroes.Count -eq 0) {
        $qualifiedHeroes = @($nonOutlierHeroes | Where-Object { $_.games_played -gt 0 })
    }

    if ($qualifiedHeroes.Count -eq 0) {
        return [ordered]@{
            best_kda_hero = $null
            best_winrate_hero = $null
        }
    }

    $bestKdaHero = @(
        $qualifiedHeroes | Sort-Object -Property @(
            @{ Expression = 'kda'; Descending = $true },
            @{ Expression = 'games_played'; Descending = $true },
            @{ Expression = 'time_played_seconds'; Descending = $true }
        )
    )[0]

    $bestWinrateHero = @(
        $qualifiedHeroes | Sort-Object -Property @(
            @{ Expression = 'winrate'; Descending = $true },
            @{ Expression = 'games_played'; Descending = $true },
            @{ Expression = 'kda'; Descending = $true }
        )
    )[0]

    return [ordered]@{
        best_kda_hero = $bestKdaHero
        best_winrate_hero = $bestWinrateHero
    }
}

function Get-PlayerAnalyticsFromSnapshots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Snapshots,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    $orderedSnapshots = @(
        $Snapshots | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' } | ForEach-Object {
            $snapshot = $_
            $rankSummary = Get-OwReportObjectValue -Object $snapshot -Path @('ranks')
            if ($null -ne $rankSummary) {
                $normalizedRanks = Normalize-OwReportRankSummary -RankSummary $rankSummary
                if ($snapshot -is [System.Collections.IDictionary]) {
                    $snapshot['ranks'] = $normalizedRanks
                }
                else {
                    $snapshot.ranks = $normalizedRanks
                }
            }

            $snapshot
        }
    )
    if ($orderedSnapshots.Count -eq 0) {
        return $null
    }

    $latestSnapshot = $orderedSnapshots[-1]
    $previousSnapshot = $(if ($orderedSnapshots.Count -gt 1) { $orderedSnapshots[-2] } else { $null })
    $wideConfidenceMultiplier = $(if ($latestSnapshot.wide_match_context -eq 'mostly_wide') { 0.65 } else { 1.0 })

    $rankSeries = Get-OwReportMetricSeries -Snapshots $orderedSnapshots -Path @('ranks', 'average_ordinal')
    $rankRoleSeries = @()
    foreach ($role in @('tank', 'damage', 'support', 'open')) {
        $series = @()
        foreach ($snapshot in $orderedSnapshots) {
            $rankMatches = @($snapshot.ranks.roles | Where-Object { $_.role -eq $role })
            $rankRecord = $(if ($rankMatches.Count -gt 0) { $rankMatches[0] } else { $null })
            $series += (New-OwReportSeriesPoint -Timestamp $snapshot.captured_at -Value $(if ($rankRecord) { $rankRecord.ordinal } else { $null }))
        }

        $rankRoleSeries += [ordered]@{
            role = $role
            series = $series
        }
    }
    $kdaSeries = Get-OwReportMetricSeries -Snapshots $orderedSnapshots -Path @('metrics', 'kda')
    $winSeries = Get-OwReportMetricSeries -Snapshots $orderedSnapshots -Path @('metrics', 'winrate')
    $gamesSeries = Get-OwReportMetricSeries -Snapshots $orderedSnapshots -Path @('metrics', 'games_played')

    $shortRankTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $rankSeries -WindowDays 21 -MinimumPoints 2 -FallbackLastPoints 4) -FlatSlopeThreshold 0.04 -ConfidenceMultiplier $wideConfidenceMultiplier
    $mediumRankTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $rankSeries -WindowDays 60 -MinimumPoints 2 -FallbackLastPoints 6) -FlatSlopeThreshold 0.03 -ConfidenceMultiplier $wideConfidenceMultiplier
    $shortKdaTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $kdaSeries -WindowDays 21 -MinimumPoints 2 -FallbackLastPoints 4) -FlatSlopeThreshold 0.01
    $mediumKdaTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $kdaSeries -WindowDays 60 -MinimumPoints 2 -FallbackLastPoints 6) -FlatSlopeThreshold 0.008
    $shortWinTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $winSeries -WindowDays 21 -MinimumPoints 2 -FallbackLastPoints 4) -FlatSlopeThreshold 0.12
    $mediumWinTrend = Get-TimeSeriesTrend -Series (Get-OwReportWindowedSeries -Series $winSeries -WindowDays 60 -MinimumPoints 2 -FallbackLastPoints 6) -FlatSlopeThreshold 0.08

    $signals = @()
    if ($shortRankTrend.sample_count -ge 2) {
        $signals += [ordered]@{
            weight = 0.4
            score = [Math]::Max(-1, [Math]::Min(1, ($shortRankTrend.slope_per_day / 0.08)))
            confidence = $shortRankTrend.confidence
        }
    }

    if ($shortKdaTrend.sample_count -ge 2) {
        $signals += [ordered]@{
            weight = 0.35
            score = [Math]::Max(-1, [Math]::Min(1, ($shortKdaTrend.slope_per_day / 0.02)))
            confidence = $shortKdaTrend.confidence
        }
    }

    if ($shortWinTrend.sample_count -ge 2) {
        $signals += [ordered]@{
            weight = 0.25
            score = [Math]::Max(-1, [Math]::Min(1, ($shortWinTrend.slope_per_day / 0.2)))
            confidence = $shortWinTrend.confidence
        }
    }

    $weightedScore = 0
    $weightSum = 0
    foreach ($signal in $signals) {
        $effectiveWeight = $signal.weight * $signal.confidence
        $weightedScore += ($signal.score * $effectiveWeight)
        $weightSum += $effectiveWeight
    }

    $compositeScore = $(if ($weightSum -gt 0) { $weightedScore / $weightSum } else { 0 })
    $confidence = $(if ($signals.Count -gt 0) { [Math]::Round((Get-OwReportAverage -Values ($signals | ForEach-Object { $_.confidence })), 3) } else { 0 })
    $label = 'flat'
    if ($compositeScore -ge 0.2) {
        $label = 'up'
    }
    elseif ($compositeScore -le -0.2) {
        $label = 'down'
    }

    $forecast = 'likely stable'
    if ($label -eq 'up' -and $confidence -ge 0.35) {
        $forecast = 'likely climbing'
    }
    elseif ($label -eq 'down' -and $confidence -ge 0.35) {
        $forecast = 'likely declining'
    }

    $delta = [ordered]@{
        kda = $(if ($previousSnapshot) { [Math]::Round(([double]$latestSnapshot.metrics.kda - [double]$previousSnapshot.metrics.kda), 2) } else { 0 })
        winrate = $(if ($previousSnapshot) { [Math]::Round(([double]$latestSnapshot.metrics.winrate - [double]$previousSnapshot.metrics.winrate), 2) } else { 0 })
        rank_ordinal = $(if ($previousSnapshot -and $null -ne $latestSnapshot.ranks.average_ordinal -and $null -ne $previousSnapshot.ranks.average_ordinal) { [Math]::Round(([double]$latestSnapshot.ranks.average_ordinal - [double]$previousSnapshot.ranks.average_ordinal), 2) } else { 0 })
    }

    $roleSeries = @()
    foreach ($role in @('tank', 'damage', 'support')) {
        $series = @()
        foreach ($snapshot in $orderedSnapshots) {
            $roleMatches = @($snapshot.roles | Where-Object { $_.role -eq $role })
            $roleRecord = $(if ($roleMatches.Count -gt 0) { $roleMatches[0] } else { $null })
            $series += (New-OwReportSeriesPoint -Timestamp $snapshot.captured_at -Value $(if ($roleRecord) { $roleRecord.kda } else { $null }))
        }

        $roleSeries += [ordered]@{
            role = $role
            series = $series
        }
    }

    $topHeroKeys = @($latestSnapshot.heroes | Sort-Object time_played_seconds -Descending | Select-Object -First 4 | ForEach-Object { $_.hero_key })
    $heroUsageSeries = @()
    $heroPerformanceSeries = @()
    if ($topHeroKeys.Count -gt 0) {
        $heroUsageSeries = Get-OwReportHeroSeries -Snapshots $orderedSnapshots -HeroKeys $topHeroKeys -MetricPath @('time_played_seconds') -MissingAsZero
        $heroPerformanceSeries = Get-OwReportHeroSeries -Snapshots $orderedSnapshots -HeroKeys $topHeroKeys -MetricPath @('kda')
    }
    $recommendations = Get-HeroRecommendationsFromSnapshots -Snapshots $orderedSnapshots -HeroCatalog $HeroCatalog
    $heroHighlights = Get-OwReportHeroHighlights -Heroes @($latestSnapshot.heroes)

    $flags = @()
    if ($latestSnapshot.wide_match_context -eq 'mostly_wide') {
        $flags += 'Mostly wide queue: visible rank changes may be muted.'
    }
    if ($label -eq 'down' -and $delta.kda -lt 0) {
        $flags += 'Recent KDA dip needs review.'
    }
    if ($latestSnapshot.fetch_status -ne 'success') {
        $flags += 'Latest snapshot is partial.'
    }
    $flags += @($latestSnapshot.warnings)

    return [ordered]@{
        latest = $latestSnapshot
        previous = $previousSnapshot
        history_snapshots = @(
            $orderedSnapshots | ForEach-Object {
                [ordered]@{
                    run_id = $_.run_id
                    captured_at = $_.captured_at
                    wide_match_context = $_.wide_match_context
                    fetch_status = $_.fetch_status
                    warnings = $_.warnings
                    ranks = $_.ranks
                    heroes = @(
                        @($_.heroes) | ForEach-Object {
                            [ordered]@{
                                hero_key = Get-OwReportObjectValue -Object $_ -Path @('hero_key')
                                hero_name = Get-OwReportObjectValue -Object $_ -Path @('hero_name')
                                hero_role = Get-OwReportObjectValue -Object $_ -Path @('hero_role')
                                games_played = Get-OwReportObjectValue -Object $_ -Path @('games_played')
                                games_won = Get-OwReportObjectValue -Object $_ -Path @('games_won')
                                games_lost = Get-OwReportObjectValue -Object $_ -Path @('games_lost')
                                season_games_played = Get-OwReportObjectValue -Object $_ -Path @('season_games_played')
                                season_games_won = Get-OwReportObjectValue -Object $_ -Path @('season_games_won')
                                season_games_lost = Get-OwReportObjectValue -Object $_ -Path @('season_games_lost')
                                time_played_seconds = Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds')
                                season_time_played_seconds = Get-OwReportObjectValue -Object $_ -Path @('season_time_played_seconds')
                                winrate = Get-OwReportObjectValue -Object $_ -Path @('winrate')
                                kda = Get-OwReportObjectValue -Object $_ -Path @('kda')
                                total = [ordered]@{
                                    eliminations = Get-OwReportObjectValue -Object $_ -Path @('total', 'eliminations')
                                    assists = Get-OwReportObjectValue -Object $_ -Path @('total', 'assists')
                                    deaths = Get-OwReportObjectValue -Object $_ -Path @('total', 'deaths')
                                    damage = Get-OwReportObjectValue -Object $_ -Path @('total', 'damage')
                                    healing = Get-OwReportObjectValue -Object $_ -Path @('total', 'healing')
                                }
                            }
                        }
                    )
                }
            }
        )
        series = [ordered]@{
            rank = $rankSeries
            rank_roles = $rankRoleSeries
            kda = $kdaSeries
            winrate = $winSeries
            games_played = $gamesSeries
            hero_usage = $heroUsageSeries
            hero_performance = $heroPerformanceSeries
            role_kda = $roleSeries
        }
        trend = [ordered]@{
            label = $label
            short = [ordered]@{
                rank = $shortRankTrend
                kda = $shortKdaTrend
                winrate = $shortWinTrend
            }
            medium = [ordered]@{
                rank = $mediumRankTrend
                kda = $mediumKdaTrend
                winrate = $mediumWinTrend
            }
            confidence = $confidence
            forecast = $forecast
            momentum = [Math]::Round(($compositeScore * $confidence), 3)
        }
        delta = $delta
        recommendations = $recommendations
        highlights = $heroHighlights
        narrative = Get-OwReportTrajectoryText -DisplayName $latestSnapshot.display_name -TrendLabel $label -LatestSnapshot $latestSnapshot
        flags = @($flags | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    }
}

function Get-OwReportPlayerDetailModel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Analysis
    )

    $latest = $Analysis.latest
    return [ordered]@{
        slug = $latest.player_slug
        href = ('players/{0}.html' -f $latest.player_slug)
        display_name = $latest.display_name
        player_id = $latest.player_id
        profile = $latest.profile
        current = [ordered]@{
            kda = $latest.metrics.kda
            winrate = $latest.metrics.winrate
            games_played = $latest.metrics.games_played
            games_won = $latest.metrics.games_won
            games_lost = $latest.metrics.games_lost
            time_played_seconds = $latest.metrics.time_played_seconds
            rank_label = $latest.ranks.best_label
            rank_roles = $latest.ranks.roles
            preferred_role = $latest.normalized.preferred_role
            best_rank_role = $latest.ranks.best_role
        }
        ranks = $latest.ranks
        roles = $latest.roles
        heroes = $latest.heroes
        trend = $Analysis.trend
        delta = $Analysis.delta
        narrative = $Analysis.narrative
        flags = $Analysis.flags
        warnings = $latest.warnings
        recommendations = $Analysis.recommendations
        highlights = $Analysis.highlights
        series = $Analysis.series
        latest_run = [ordered]@{
            run_id = $latest.run_id
            captured_at = $latest.captured_at
            wide_match_context = $latest.wide_match_context
        }
        has_previous_snapshot = ($null -ne $Analysis.previous)
        customizations = $latest.customizations
        history_snapshots = $Analysis.history_snapshots
        top_heroes = @($latest.heroes | Select-Object -First 6)
    }
}

function Get-OwReportClampedValue {
    [CmdletBinding()]
    param(
        [double]$Value,
        [double]$Minimum = 0,
        [double]$Maximum = 1
    )

    return [Math]::Max($Minimum, [Math]::Min($Maximum, $Value))
}

function Get-OwReportRoleDisplayName {
    [CmdletBinding()]
    param(
        [string]$Role
    )

    switch ($Role) {
        'damage' { return 'DPS' }
        'tank' { return 'Tank' }
        'support' { return 'Support' }
        default { return 'Flex' }
    }
}

function Get-OwReportTeamRoleOption {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Analysis,
        [Parameter(Mandatory = $true)]
        [ValidateSet('tank', 'damage', 'support')]
        [string]$Role
    )

    $latest = $Analysis.latest
    $roleRecord = @($latest.roles | Where-Object { $_.role -eq $Role } | Select-Object -First 1)
    $roleMetric = $(if ($roleRecord.Count -gt 0) { $roleRecord[0] } else { $null })
    $rankRecord = @($latest.ranks.roles | Where-Object { $_.role -eq $Role } | Select-Object -First 1)
    $rankMetric = $(if ($rankRecord.Count -gt 0) { $rankRecord[0] } else { $null })

    $gamesPlayed = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $roleMetric -Path @('games_played'))
    $timePlayedSeconds = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $roleMetric -Path @('time_played_seconds'))
    $kda = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleMetric -Path @('kda'))
    $winrate = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleMetric -Path @('winrate'))

    $rankOrdinal = Get-OwReportObjectValue -Object $rankMetric -Path @('ordinal')
    if ($null -ne $rankOrdinal -and $rankOrdinal -ne '') {
        $rankOrdinal = [double]$rankOrdinal
    }
    else {
        $rankOrdinal = $null
    }

    $rankLabel = Get-OwReportObjectValue -Object $rankMetric -Path @('label') -Default 'Unranked'
    $eligible = ($gamesPlayed -gt 0 -or $timePlayedSeconds -gt 0 -or $null -ne $rankOrdinal)
    if (-not $eligible) {
        return [ordered]@{
            role = $Role
            role_label = Get-OwReportRoleDisplayName -Role $Role
            eligible = $false
            score = 0
            kda = 0
            winrate = 0
            games_played = 0
            time_played_seconds = 0
            rank_label = 'Unranked'
            rank_ordinal = $null
            explanation = 'No visible competitive sample on this role yet.'
        }
    }

    $sampleNorm = Get-OwReportClampedValue -Value ([Math]::Max(($gamesPlayed / 25.0), ($timePlayedSeconds / 7200.0)))
    $kdaNorm = Get-OwReportClampedValue -Value (($kda - 1.0) / 2.5)
    $winNorm = Get-OwReportClampedValue -Value (($winrate - 45.0) / 20.0)
    $rankNorm = $(if ($null -ne $rankOrdinal) { Get-OwReportClampedValue -Value (($rankOrdinal - 1.0) / 39.0) } else { 0.2 })
    $trendNorm = switch ($Analysis.trend.label) {
        'up' { 1.0 }
        'flat' { 0.6 }
        default { 0.35 }
    }

    $roleFitBonus = 0
    if ($latest.ranks.best_role -eq $Role) {
        $roleFitBonus += 0.06
    }
    if ($latest.normalized.preferred_role -eq $Role) {
        $roleFitBonus += 0.08
    }

    $score = (
        ($kdaNorm * 0.34) +
        ($winNorm * 0.24) +
        ($sampleNorm * 0.18) +
        ($rankNorm * 0.18) +
        ($trendNorm * 0.06) +
        $roleFitBonus
    )

    $explanationParts = @()
    if ($gamesPlayed -gt 0) {
        $explanationParts += ('{0} games' -f $gamesPlayed)
    }
    if ($null -ne $rankOrdinal) {
        $explanationParts += ('rank {0}' -f $rankLabel)
    }
    if ($kda -gt 0) {
        $explanationParts += ('{0} KDA' -f ([Math]::Round($kda, 2)))
    }

    return [ordered]@{
        role = $Role
        role_label = Get-OwReportRoleDisplayName -Role $Role
        eligible = $true
        score = [Math]::Round($score, 3)
        kda = $kda
        winrate = $winrate
        games_played = $gamesPlayed
        time_played_seconds = $timePlayedSeconds
        rank_label = $rankLabel
        rank_ordinal = $rankOrdinal
        explanation = ($explanationParts -join ' | ')
    }
}

function Get-OwReportWideGroupAssessment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Assignments
    )

    if ($Assignments.Count -eq 0) {
        return [ordered]@{
            label = 'unknown'
            is_wide = $null
            spread_divisions = $null
            threshold = $null
            reason = 'No lineup selected yet.'
            source_url = 'https://overwatch.blizzard.com/en-us/news/24061006/'
        }
    }

    $ordinals = @($Assignments | ForEach-Object { $_.rank_ordinal } | Where-Object { $null -ne $_ })
    if ($ordinals.Count -ne $Assignments.Count) {
        return [ordered]@{
            label = 'unknown'
            is_wide = $null
            spread_divisions = $null
            threshold = $null
            reason = 'At least one assigned role is unranked, so the Wide Group check is incomplete.'
            source_url = 'https://overwatch.blizzard.com/en-us/news/24061006/'
        }
    }

    $maxOrdinal = ($ordinals | Measure-Object -Maximum).Maximum
    $minOrdinal = ($ordinals | Measure-Object -Minimum).Minimum
    $spreadDivisions = [Math]::Round(([double]$maxOrdinal - [double]$minOrdinal), 2)
    $highestTierIndex = [int]([Math]::Floor((([double]$maxOrdinal - 1) / 5.0)) + 1)

    if ($highestTierIndex -ge 7) {
        return [ordered]@{
            label = 'wide'
            is_wide = $true
            spread_divisions = $spreadDivisions
            threshold = 0
            reason = 'A Grandmaster or Champion role rank makes the lineup a Wide Group.'
            source_url = 'https://overwatch.blizzard.com/en-us/news/24061006/'
        }
    }

    $threshold = $(if ($highestTierIndex -ge 6) { 3 } else { 5 })
    $isWide = ($spreadDivisions -gt $threshold)
    $reason = if ($highestTierIndex -ge 6) {
        if ($isWide) {
            'A Masters-inclusive lineup spreads more than 3 skill divisions, so it is Wide.'
        }
        else {
            'The Masters-inclusive lineup stays within 3 skill divisions, so it is Narrow.'
        }
    }
    else {
        if ($isWide) {
            'The Diamond-or-lower lineup spreads more than 5 skill divisions, so it is Wide.'
        }
        else {
            'The Diamond-or-lower lineup stays within 5 skill divisions, so it is Narrow.'
        }
    }

    return [ordered]@{
        label = $(if ($isWide) { 'wide' } else { 'narrow' })
        is_wide = $isWide
        spread_divisions = $spreadDivisions
        threshold = $threshold
        reason = $reason
        source_url = 'https://overwatch.blizzard.com/en-us/news/24061006/'
    }
}

function Search-OwReportBestTeamComposition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Players,
        [Parameter(Mandatory = $true)]
        [hashtable]$NeededCounts,
        [Parameter(Mandatory = $true)]
        [hashtable]$UsedPlayers,
        [object[]]$CurrentAssignments = @(),
        [Parameter(Mandatory = $true)]
        [ref]$BestResult
    )

    if (($NeededCounts.tank + $NeededCounts.damage + $NeededCounts.support) -le 0) {
        $assignments = @($CurrentAssignments | Sort-Object role, @{ Expression = 'score'; Descending = $true }, display_name)
        $totalScore = [Math]::Round((($assignments | ForEach-Object { $_.score } | Measure-Object -Sum).Sum), 3)
        $teamKda = [Math]::Round((Get-OwReportAverage -Values ($assignments | ForEach-Object { $_.kda })), 2)
        $teamWinrate = [Math]::Round((Get-OwReportAverage -Values ($assignments | ForEach-Object { $_.winrate })), 2)
        $wideAssessment = Get-OwReportWideGroupAssessment -Assignments $assignments
        $widePenalty = switch ($wideAssessment.label) {
            'narrow' { 0 }
            'unknown' { 1 }
            default { 2 }
        }

        $replaceBest = $false
        if ($null -eq $BestResult.Value) {
            $replaceBest = $true
        }
        else {
            $bestPenalty = switch ($BestResult.Value.wide_assessment.label) {
                'narrow' { 0 }
                'unknown' { 1 }
                default { 2 }
            }

            if ($widePenalty -lt $bestPenalty) {
                $replaceBest = $true
            }
            elseif ($widePenalty -eq $bestPenalty -and $totalScore -gt $BestResult.Value.total_score) {
                $replaceBest = $true
            }
            elseif ($widePenalty -eq $bestPenalty -and $totalScore -eq $BestResult.Value.total_score -and $teamWinrate -gt $BestResult.Value.team_winrate) {
                $replaceBest = $true
            }
        }

        if ($replaceBest) {
            $BestResult.Value = [ordered]@{
                assignments = $assignments
                total_score = $totalScore
                team_kda = $teamKda
                team_winrate = $teamWinrate
                wide_assessment = $wideAssessment
            }
        }

        return
    }

    $nextRole = if ($NeededCounts.tank -gt 0) {
        'tank'
    }
    elseif ($NeededCounts.damage -gt 0) {
        'damage'
    }
    else {
        'support'
    }

    foreach ($player in $Players) {
        if ($UsedPlayers.ContainsKey($player.slug)) {
            continue
        }

        $option = Get-OwReportObjectValue -Object $player -Path @('role_options', $nextRole)
        if ($null -eq $option -or -not $option.eligible) {
            continue
        }

        $newNeededCounts = @{
            tank = $NeededCounts.tank
            damage = $NeededCounts.damage
            support = $NeededCounts.support
        }
        $newNeededCounts[$nextRole] -= 1

        $newUsedPlayers = @{}
        foreach ($key in $UsedPlayers.Keys) {
            $newUsedPlayers[$key] = $true
        }
        $newUsedPlayers[$player.slug] = $true

        $assignment = [ordered]@{
            slug = $player.slug
            display_name = $player.display_name
            avatar = $player.avatar
            role = $nextRole
            role_label = Get-OwReportRoleDisplayName -Role $nextRole
            score = $option.score
            kda = $option.kda
            winrate = $option.winrate
            games_played = $option.games_played
            time_played_seconds = $option.time_played_seconds
            rank_label = $option.rank_label
            rank_ordinal = $option.rank_ordinal
            explanation = $option.explanation
            locked = ($player.locked_role -eq $nextRole)
        }

        Search-OwReportBestTeamComposition `
            -Players $Players `
            -NeededCounts $newNeededCounts `
            -UsedPlayers $newUsedPlayers `
            -CurrentAssignments (@($CurrentAssignments) + $assignment) `
            -BestResult $BestResult
    }
}

function Get-OwReportTeamOptimizerModel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$PlayerAnalyses
    )

    $candidatePlayers = @(
        $PlayerAnalyses | ForEach-Object {
            $latest = $_.latest
            [ordered]@{
                slug = $latest.player_slug
                display_name = $latest.display_name
                avatar = $latest.profile.avatar
                locked_role = Get-OwReportObjectValue -Object $latest -Path @('customizations', 'locked_role')
                hidden_hero_names = @((Get-OwReportObjectValue -Object $latest -Path @('customizations', 'hidden_hero_names') -Default @()))
                trend_label = $_.trend.label
                role_options = [ordered]@{
                    tank = Get-OwReportTeamRoleOption -Analysis $_ -Role 'tank'
                    damage = Get-OwReportTeamRoleOption -Analysis $_ -Role 'damage'
                    support = Get-OwReportTeamRoleOption -Analysis $_ -Role 'support'
                }
            }
        }
    )

    $neededCounts = @{
        tank = 1
        damage = 2
        support = 2
    }
    $usedPlayers = @{}
    $lockedAssignments = @()
    $warnings = @()

    foreach ($player in @($candidatePlayers | Where-Object { -not [string]::IsNullOrWhiteSpace($_.locked_role) })) {
        $role = $player.locked_role
        if (-not $neededCounts.ContainsKey($role)) {
            $warnings += ('Ignored invalid role lock for {0}.' -f $player.display_name)
            continue
        }

        if ($neededCounts[$role] -le 0) {
            $warnings += ('Ignored extra {0} lock for {1} because that role is already full.' -f (Get-OwReportRoleDisplayName -Role $role), $player.display_name)
            continue
        }

        $option = Get-OwReportObjectValue -Object $player -Path @('role_options', $role)
        if ($null -eq $option -or -not $option.eligible) {
            $warnings += ('Ignored lock for {0} because there is no visible competitive data for that role yet.' -f $player.display_name)
            continue
        }

        $usedPlayers[$player.slug] = $true
        $neededCounts[$role] -= 1
        $lockedAssignments += [ordered]@{
            slug = $player.slug
            display_name = $player.display_name
            avatar = $player.avatar
            role = $role
            role_label = Get-OwReportRoleDisplayName -Role $role
            score = $option.score
            kda = $option.kda
            winrate = $option.winrate
            games_played = $option.games_played
            time_played_seconds = $option.time_played_seconds
            rank_label = $option.rank_label
            rank_ordinal = $option.rank_ordinal
            explanation = $option.explanation
            locked = $true
        }
    }

    $bestResult = $null
    Search-OwReportBestTeamComposition `
        -Players $candidatePlayers `
        -NeededCounts $neededCounts `
        -UsedPlayers $usedPlayers `
        -CurrentAssignments $lockedAssignments `
        -BestResult ([ref]$bestResult)

    if ($null -eq $bestResult) {
        $warnings += 'No valid 1 tank / 2 DPS / 2 support lineup could be built from the current competitive samples.'
    }

    return [ordered]@{
        composition_rules = [ordered]@{
            tank = 1
            damage = 2
            support = 2
        }
        candidate_players = $candidatePlayers
        default_locks = @($candidatePlayers | Where-Object { -not [string]::IsNullOrWhiteSpace($_.locked_role) } | ForEach-Object {
            [ordered]@{
                slug = $_.slug
                display_name = $_.display_name
                role = $_.locked_role
                role_label = Get-OwReportRoleDisplayName -Role $_.locked_role
            }
        })
        default_result = $bestResult
        warnings = @($warnings | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
        wide_rule_summary = 'Blizzard marks groups as Wide when Diamond-or-lower spreads exceed 5 divisions, Masters spreads exceed 3, or any Grandmaster or Champion role rank is present.'
        wide_rule_source_url = 'https://overwatch.blizzard.com/en-us/news/24061006/'
    }
}

function Get-OwReportTeamAnalytics {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog,
        [hashtable]$Storage,
        [object[]]$Snapshots,
        [object[]]$RunRecords
    )

    $allSnapshots = @()
    if ($PSBoundParameters.ContainsKey('Snapshots')) {
        $allSnapshots = @($Snapshots | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' })
    }
    elseif ($null -ne $Storage) {
        $allSnapshots = @((Get-OwReportSnapshotsFromStorage -Storage $Storage) | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' })
    }

    $allRuns = @()
    if ($PSBoundParameters.ContainsKey('RunRecords')) {
        $allRuns = @($RunRecords | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '' })
    }
    elseif ($null -ne $Storage) {
        $allRuns = @((Get-OwReportRunRecordsFromStorage -Storage $Storage) | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '' })
    }

    $latestAvailableRun = $(if ($allRuns.Count -gt 0) { $allRuns[-1] } else { $null })
    $effectiveLatestRunId = Get-OwReportObjectValue -Object $latestAvailableRun -Path @('run_id') -Default $RunContext.run_id
    $effectiveLatestRunTimestamp = Get-OwReportObjectValue -Object $latestAvailableRun -Path @('timestamp') -Default $RunContext.timestamp
    $effectiveLatestRunNotes = Get-OwReportObjectValue -Object $latestAvailableRun -Path @('notes') -Default $RunContext.notes
    $effectiveLatestRunWideContext = Get-OwReportObjectValue -Object $latestAvailableRun -Path @('wide_match_context') -Default $RunContext.wide_match_context

    $playerAnalyses = @()
    $filteredSnapshots = @()

    foreach ($player in $Config.players) {
        $playerSnapshots = @(
            $allSnapshots |
                Where-Object { $_.player_slug -eq $player.slug } |
                Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' } |
                ForEach-Object { Apply-OwReportPlayerFiltersToSnapshot -Snapshot $_ -PlayerConfig $player }
        )
        if ($playerSnapshots.Count -eq 0) {
            continue
        }

        $filteredSnapshots += $playerSnapshots
        $analysis = Get-PlayerAnalyticsFromSnapshots -Snapshots $playerSnapshots -HeroCatalog $HeroCatalog
        if ($null -ne $analysis) {
            $playerAnalyses += $analysis
        }
    }

    $playerDetails = @($playerAnalyses | ForEach-Object { Get-OwReportPlayerDetailModel -Analysis $_ })
    $playerCards = @()
    foreach ($analysis in $playerAnalyses) {
        $latest = $analysis.latest
        $stale = $latest.run_id -ne $effectiveLatestRunId
        $displayRole = $(if (-not [string]::IsNullOrWhiteSpace($latest.ranks.best_role)) { $latest.ranks.best_role } else { $latest.normalized.preferred_role })
        $filterTags = @(
            $analysis.trend.label,
            $displayRole,
            $latest.normalized.preferred_role,
            $(if ($analysis.delta.kda -lt 0) { 'falling-kda' } else { 'steady-kda' }),
            $(if ($analysis.trend.momentum -gt 0.18) { 'best-momentum' } else { 'normal-momentum' }),
            $(if ($analysis.flags.Count -gt 0) { 'needs-review' } else { 'clean' }),
            $(if ($latest.wide_match_context -eq 'mostly_wide') { 'wide-warning' } else { 'standard-queue' })
        )

        $playerCards += [ordered]@{
            slug = $latest.player_slug
            href = ('players/{0}.html' -f $latest.player_slug)
            display_name = $latest.display_name
            player_id = $latest.player_id
            avatar = $latest.profile.avatar
            title = $latest.profile.title
            preferred_role = $displayRole
            best_rank_role = $latest.ranks.best_role
            top_heroes = $latest.normalized.top_heroes
            customizations = $latest.customizations
            current = [ordered]@{
                kda = $latest.metrics.kda
                winrate = $latest.metrics.winrate
                games_played = $latest.metrics.games_played
                rank_label = $latest.ranks.best_label
                rank_ordinal = $latest.ranks.average_ordinal
                rank_roles = $latest.ranks.roles
            }
            highlights = $analysis.highlights
            delta = $analysis.delta
            trend = [ordered]@{
                label = $analysis.trend.label
                confidence = $analysis.trend.confidence
                forecast = $analysis.trend.forecast
                momentum = $analysis.trend.momentum
            }
            narrative = $analysis.narrative
            flags = $analysis.flags
            stale = $stale
            warnings = $latest.warnings
            has_previous_snapshot = ($null -ne $analysis.previous)
            filter_tags = $filterTags
            mini_series = [ordered]@{
                kda = $analysis.series.kda
                rank = $analysis.series.rank
            }
        }
    }

    $latestSnapshots = @($playerAnalyses | ForEach-Object { $_.latest })
    $freshCount = @($latestSnapshots | Where-Object { $_.run_id -eq $effectiveLatestRunId }).Count
    $teamAverageKda = Get-OwReportAverage -Values ($latestSnapshots | ForEach-Object { $_.metrics.kda })
    $teamAverageRankOrdinal = Get-OwReportAverage -Values ($latestSnapshots | ForEach-Object { $_.ranks.average_ordinal } | Where-Object { $null -ne $_ })
    $teamAverageRankLabel = ConvertFrom-RankOrdinal -Ordinal $teamAverageRankOrdinal

    $teamSeries = @()
    foreach ($run in $allRuns) {
        $runSnapshots = @($filteredSnapshots | Where-Object { $_.run_id -eq $run.run_id })
        if ($runSnapshots.Count -eq 0) {
            continue
        }

        $teamSeries += [ordered]@{
            timestamp = $run.timestamp
            run_id = $run.run_id
            avg_kda = [Math]::Round((Get-OwReportAverage -Values ($runSnapshots | ForEach-Object { $_.metrics.kda })), 3)
            avg_winrate = [Math]::Round((Get-OwReportAverage -Values ($runSnapshots | ForEach-Object { $_.metrics.winrate })), 3)
            avg_rank = [Math]::Round((Get-OwReportAverage -Values ($runSnapshots | ForEach-Object { $_.ranks.average_ordinal } | Where-Object { $null -ne $_ })), 3)
            player_count = $runSnapshots.Count
        }
    }

    $roleDistribution = @(
        foreach ($role in @('tank', 'damage', 'support', 'flex')) {
            [ordered]@{
                role = $role
                count = @($latestSnapshots | Where-Object {
                    $roleSource = if (-not [string]::IsNullOrWhiteSpace($_.ranks.best_role)) { $_.ranks.best_role } else { $_.normalized.preferred_role }
                    $roleSource -eq $role
                }).Count
            }
        }
    )

    $heroPoolLookup = @{}
    foreach ($snapshot in $latestSnapshots) {
        $seasonHeroes = @(
            $snapshot.heroes |
                Where-Object {
                    (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_games_played') -Default (Get-OwReportObjectValue -Object $_ -Path @('games_played')))) -gt 0 -or
                    (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_time_played_seconds') -Default (Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds')))) -gt 0
                } |
                Sort-Object -Property @(
                    @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_time_played_seconds') -Default (Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds')))) } },
                    @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_games_played') -Default (Get-OwReportObjectValue -Object $_ -Path @('games_played')))) } },
                    @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('hero_name') -Default '' } }
                ) |
                Select-Object -First 5
        )

        foreach ($hero in @($seasonHeroes)) {
            if (-not $heroPoolLookup.ContainsKey($hero.hero_key)) {
                $heroPoolLookup[$hero.hero_key] = [ordered]@{
                    hero_key = $hero.hero_key
                    hero_name = $hero.hero_name
                    total_time_played_seconds = 0
                    player_count = 0
                }
            }

            $heroPoolLookup[$hero.hero_key].total_time_played_seconds += (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $hero -Path @('season_time_played_seconds') -Default $hero.time_played_seconds))
            $heroPoolLookup[$hero.hero_key].player_count += 1
        }
    }

    $teamOptimizer = Get-OwReportTeamOptimizerModel -PlayerAnalyses $playerAnalyses
    $runSummaries = @(
        foreach ($run in $allRuns) {
            $runSnapshots = @($filteredSnapshots | Where-Object { $_.run_id -eq $run.run_id })
            $failedPlayers = @((Get-OwReportObjectValue -Object $run -Path @('failed_players') -Default @()))
            [ordered]@{
                run_id = $run.run_id
                timestamp = $run.timestamp
                started_at = $run.started_at
                completed_at = $run.completed_at
                notes = $run.notes
                wide_match_context = $run.wide_match_context
                snapshot_count = $runSnapshots.Count
                successful_players = Get-OwReportObjectValue -Object $run -Path @('successful_players') -Default $runSnapshots.Count
                failed_player_count = $failedPlayers.Count
                failed_player_names = @($failedPlayers | ForEach-Object { Get-OwReportObjectValue -Object $_ -Path @('display_name') } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                player_display_names = @($runSnapshots | ForEach-Object { $_.display_name } | Select-Object -Unique)
                player_slugs = @($runSnapshots | ForEach-Object { $_.player_slug } | Select-Object -Unique)
            }
        }
    )

    return [ordered]@{
        meta = [ordered]@{
            team_name = $Config.team_name
            site_subtitle = $Config.site_subtitle
            generated_at = Get-OwReportIsoNow
            config_path = Get-OwReportObjectValue -Object $Config -Path @('config_path')
            project_root = Get-OwReportObjectValue -Object $Config -Path @('project_root')
            latest_run = [ordered]@{
                run_id = $effectiveLatestRunId
                timestamp = $effectiveLatestRunTimestamp
                notes = $effectiveLatestRunNotes
                wide_match_context = $effectiveLatestRunWideContext
            }
            total_tracked_players = $Config.players.Count
            fresh_snapshots = $freshCount
            player_count_with_history = $playerCards.Count
            stat_scope = 'competitive-only'
        }
        overview = [ordered]@{
            stat_cards = @(
                [ordered]@{ label = 'Tracked players'; value = $Config.players.Count; accent = 'sky' }
                [ordered]@{ label = 'Fresh snapshots'; value = $freshCount; accent = 'mint' }
                [ordered]@{ label = 'Team avg KDA'; value = $(if ($null -ne $teamAverageKda) { [Math]::Round($teamAverageKda, 2) } else { 'n/a' }); accent = 'amber' }
                [ordered]@{ label = 'Team avg rank'; value = $teamAverageRankLabel; accent = 'rose' }
            )
            trend_counts = [ordered]@{
                up = @($playerCards | Where-Object { $_.trend.label -eq 'up' }).Count
                flat = @($playerCards | Where-Object { $_.trend.label -eq 'flat' }).Count
                down = @($playerCards | Where-Object { $_.trend.label -eq 'down' }).Count
            }
            current_rank_summary = [ordered]@{
                average_label = $teamAverageRankLabel
                average_ordinal = $teamAverageRankOrdinal
                role_distribution = $roleDistribution
            }
            team_series = [ordered]@{
                kda = @($teamSeries | ForEach-Object { [ordered]@{ timestamp = $_.timestamp; value = $_.avg_kda } })
                rank = @($teamSeries | ForEach-Object { [ordered]@{ timestamp = $_.timestamp; value = $_.avg_rank } })
                winrate = @($teamSeries | ForEach-Object { [ordered]@{ timestamp = $_.timestamp; value = $_.avg_winrate } })
            }
            comparison = @($playerCards | ForEach-Object {
                [ordered]@{
                    slug = $_.slug
                    display_name = $_.display_name
                    kda = $_.current.kda
                    winrate = $_.current.winrate
                    rank_ordinal = $_.current.rank_ordinal
                    preferred_role = $_.preferred_role
                    trend_label = $_.trend.label
                }
            })
            biggest_movers = @($playerCards | Sort-Object { [Math]::Abs($_.delta.kda) + ([Math]::Abs($_.delta.rank_ordinal) * 0.35) + ([Math]::Abs($_.delta.winrate) * 0.04) } -Descending | Select-Object -First 5)
            strongest_momentum = @($playerCards | Sort-Object { $_.trend.momentum } -Descending | Select-Object -First 5)
            watchlist = @($playerCards | Where-Object { $_.trend.label -eq 'down' -or $_.flags.Count -gt 0 } | Select-Object -First 6)
            role_distribution = $roleDistribution
            hero_pool_summary = @(
                $heroPoolLookup.Values |
                    Sort-Object -Property @(
                        @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('total_time_played_seconds'))) } },
                        @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('player_count'))) } },
                        @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('hero_name') -Default '' } }
                    ) |
                    Select-Object -First 10
            )
            players = $playerCards
            team_optimizer = $teamOptimizer
        }
        settings = [ordered]@{
            runs = $runSummaries
            removal_mode = $(if (((Get-OwReportObjectValue -Object $Config -Path @('provider', 'name') -Default 'overfast').ToString().Trim().ToLowerInvariant()) -eq 'influxdb') { 'hide-only' } else { 'browser-local' })
        }
        players = @($playerDetails)
    }
}
