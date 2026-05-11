function New-OwReportInfluxClient {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    $queryUrl = Get-OwReportObjectValue -Object $Config -Path @('provider', 'query_url') -Default ''
    if ([string]::IsNullOrWhiteSpace($queryUrl)) {
        $queryUrl = 'https://owstats.jhiggins.tech/query'
    }

    return [ordered]@{
        name = 'influxdb'
        query_url = $queryUrl.TrimEnd('/')
        database = Get-OwReportObjectValue -Object $Config -Path @('provider', 'database') -Default 'ow_stats_telegraf'
        request_delay_ms = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $Config -Path @('provider', 'request_delay_ms') -Default 125) -Default 125
        last_request_at = $null
    }
}

function ConvertFrom-OwReportInfluxResponse {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Payload
    )

    $rows = @()
    foreach ($result in @(Get-OwReportObjectValue -Object $Payload -Path @('results') -Default @())) {
        foreach ($series in @(Get-OwReportObjectValue -Object $result -Path @('series') -Default @())) {
            $columns = @($series.columns)
            $tagObject = Get-OwReportObjectValue -Object $series -Path @('tags') -Default ([ordered]@{})
            foreach ($valueRow in @($series.values)) {
                $record = [ordered]@{
                    measurement = Get-OwReportObjectValue -Object $series -Path @('name')
                }
                for ($index = 0; $index -lt $columns.Count; $index += 1) {
                    $record[$columns[$index]] = $valueRow[$index]
                }

                foreach ($tagName in Get-OwReportObjectPropertyNames -Object $tagObject) {
                    if (-not $record.Contains($tagName)) {
                        $record[$tagName] = Get-OwReportObjectValue -Object $tagObject -Path @($tagName)
                    }
                }

                $rows += [pscustomobject]$record
            }
        }
    }

    return $rows
}

function Get-OwReportInfluxPlayerRegexPattern {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Players
    )

    $playerParts = @(
        foreach ($player in @($Players)) {
            $playerId = Get-OwReportObjectValue -Object $player -Path @('player_id')
            if (-not [string]::IsNullOrWhiteSpace($playerId)) {
                [regex]::Escape($playerId)
            }
        }
    )

    if ($playerParts.Count -eq 0) {
        return $null
    }

    return '^({0})$' -f ($playerParts -join '|')
}

function Get-OwReportInfluxLastFieldSelectClause {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Fields
    )

    return (($Fields | ForEach-Object { 'last("{0}") AS "{0}"' -f $_ }) -join ', ')
}

function Invoke-OwReportInfluxQuery {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [string]$Query
    )

    Invoke-OwReportRequestDelay -Client $Client

    $uri = '{0}?db={1}&q={2}' -f $Client.query_url, ([System.Uri]::EscapeDataString($Client.database)), ([System.Uri]::EscapeDataString($Query))

    try {
        $payload = Invoke-RestMethod -Method Get -Uri $uri
        $Client.last_request_at = [DateTimeOffset]::Now

        return [ordered]@{
            ok = $true
            payload = $payload
            rows = @(ConvertFrom-OwReportInfluxResponse -Payload $payload)
            error = $null
        }
    }
    catch {
        $Client.last_request_at = [DateTimeOffset]::Now
        return [ordered]@{
            ok = $false
            payload = $null
            rows = @()
            error = (Get-OwReportExceptionDetail -ErrorRecord $_)
        }
    }
}

function ConvertTo-OwReportInfluxRunId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Timestamp
    )

    return ([DateTimeOffset]::Parse($Timestamp).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
}

function ConvertTo-OwReportInfluxCategoryObject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Row
    )

    $excluded = @('measurement', 'time', 'player', 'platform', 'gamemode', 'hero', 'host')
    $record = [ordered]@{}
    foreach ($propertyName in Get-OwReportObjectPropertyNames -Object $Row) {
        if ($excluded -contains $propertyName) {
            continue
        }

        $value = Get-OwReportObjectValue -Object $Row -Path @($propertyName)
        if ($null -eq $value -or $value -eq '') {
            continue
        }

        $record[$propertyName] = $value
    }

    return $record
}

function Get-OwReportInfluxFieldValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $value = Get-OwReportObjectValue -Object $Record -Path @($name)
        if ($null -ne $value -and $value -ne '') {
            return $value
        }
    }

    return $null
}

function Get-OwReportInfluxHeroMetricRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$HeroKey,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCategoryMap,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    $game = Get-OwReportObjectValue -Object $HeroCategoryMap -Path @('game') -Default ([ordered]@{})
    $combat = Get-OwReportObjectValue -Object $HeroCategoryMap -Path @('combat') -Default ([ordered]@{})
    $assists = Get-OwReportObjectValue -Object $HeroCategoryMap -Path @('assists') -Default ([ordered]@{})
    $average = Get-OwReportObjectValue -Object $HeroCategoryMap -Path @('average') -Default ([ordered]@{})
    $best = Get-OwReportObjectValue -Object $HeroCategoryMap -Path @('best') -Default ([ordered]@{})
    $matchAwards = Get-OwReportObjectValue -Object $HeroCategoryMap -Path @('match_awards') -Default ([ordered]@{})

    $gamesPlayed = ConvertTo-OwReportInteger -Value (Get-OwReportInfluxFieldValue -Record $game -Names @('games_played'))
    $gamesWon = ConvertTo-OwReportInteger -Value (Get-OwReportInfluxFieldValue -Record $game -Names @('games_won', 'hero_wins'))
    $gamesLost = ConvertTo-OwReportInteger -Value (Get-OwReportInfluxFieldValue -Record $game -Names @('games_lost'))
    $timePlayed = ConvertTo-OwReportInteger -Value (Get-OwReportInfluxFieldValue -Record $game -Names @('time_played'))
    $totalEliminations = ConvertTo-OwReportNumber -Value (Get-OwReportInfluxFieldValue -Record $combat -Names @('eliminations'))
    $totalAssists = ConvertTo-OwReportNumber -Value (Get-OwReportInfluxFieldValue -Record $assists -Names @('assists'))
    $totalDeaths = ConvertTo-OwReportNumber -Value (Get-OwReportInfluxFieldValue -Record $combat -Names @('deaths'))
    $totalDamage = ConvertTo-OwReportNumber -Value (Get-OwReportInfluxFieldValue -Record $combat -Names @('all_damage_done', 'damage_done'))
    $totalHealing = ConvertTo-OwReportNumber -Value (Get-OwReportInfluxFieldValue -Record $assists -Names @('healing_done'))
    $heroName = Get-OwReportHeroName -HeroKey $HeroKey -HeroCatalog $HeroCatalog
    $heroRole = Get-OwReportHeroRole -HeroKey $HeroKey -HeroCatalog $HeroCatalog

    $winrate = $null
    $winPercentage = Get-OwReportInfluxFieldValue -Record $game -Names @('win_percentage')
    if ($null -ne $winPercentage -and $winPercentage -ne '') {
        $winrate = [Math]::Round((ConvertTo-OwReportNumber -Value $winPercentage), 2)
    }
    elseif ($gamesPlayed -gt 0) {
        $winrate = [Math]::Round((($gamesWon / $gamesPlayed) * 100.0), 2)
    }

    $kda = $null
    if ($totalDeaths -gt 0) {
        $kda = [Math]::Round((($totalEliminations + $totalAssists) / $totalDeaths), 2)
    }
    elseif (($totalEliminations + $totalAssists) -gt 0) {
        $kda = [Math]::Round(($totalEliminations + $totalAssists), 2)
    }

    if ($gamesPlayed -le 0 -and $timePlayed -le 0 -and $null -eq $kda -and $null -eq $winrate) {
        return $null
    }

    return [ordered]@{
        hero_key = $HeroKey
        hero_name = $heroName
        hero_role = $heroRole
        games_played = $gamesPlayed
        games_won = $gamesWon
        games_lost = $gamesLost
        time_played_seconds = $timePlayed
        season_games_played = $gamesPlayed
        season_games_won = $gamesWon
        season_games_lost = $gamesLost
        season_time_played_seconds = $timePlayed
        winrate = $winrate
        kda = $kda
        total = [ordered]@{
            eliminations = $totalEliminations
            assists = $totalAssists
            deaths = $totalDeaths
            damage = $totalDamage
            healing = $totalHealing
        }
        average = [ordered]@{
            eliminations = Get-OwReportInfluxFieldValue -Record $average -Names @('eliminations_avg_per_10_min')
            assists = Get-OwReportInfluxFieldValue -Record $average -Names @('assists_avg_per_10_min')
            deaths = Get-OwReportInfluxFieldValue -Record $average -Names @('deaths_avg_per_10_min')
            damage = Get-OwReportInfluxFieldValue -Record $average -Names @('all_damage_done_avg_per_10_min', 'damage_done_avg_per_10_min')
            healing = Get-OwReportInfluxFieldValue -Record $average -Names @('healing_done_avg_per_10_min')
        }
        career = [ordered]@{
            assists = $assists
            average = $average
            best = $best
            combat = $combat
            game = $game
            match_awards = $matchAwards
            hero_specific = [ordered]@{}
        }
    }
}

function New-OwReportInfluxPlaceholderProfile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$DisplayName,
        [Parameter(Mandatory = $true)]
        $RankSummary,
        [Parameter(Mandatory = $true)]
        [string]$Timestamp,
        $SummaryRow = $null
    )

    $bestLabel = Get-OwReportObjectValue -Object $RankSummary -Path @('best_label') -Default 'Unranked'
    $bestRole = Get-OwReportObjectValue -Object $RankSummary -Path @('best_role') -Default ''
    $roleLabel = switch ($bestRole) {
        'damage' { 'DPS' }
        'tank' { 'Tank' }
        'support' { 'Support' }
        default { '' }
    }

    $fallbackTitle = $(if (-not [string]::IsNullOrWhiteSpace($roleLabel) -and $bestLabel -ne 'Unranked') { '{0} {1}' -f $bestLabel, $roleLabel } else { $bestLabel })
    $summaryTimestamp = Get-OwReportObjectValue -Object $SummaryRow -Path @('time')
    $lastUpdatedAt = $(if (-not [string]::IsNullOrWhiteSpace($summaryTimestamp)) { [int64][DateTimeOffset]::Parse($summaryTimestamp).ToUnixTimeSeconds() } else { [int64][DateTimeOffset]::Parse($Timestamp).ToUnixTimeSeconds() })

    return [ordered]@{
        username = Get-OwReportObjectValue -Object $SummaryRow -Path @('username') -Default $DisplayName
        avatar = Get-OwReportObjectValue -Object $SummaryRow -Path @('avatar')
        namecard = Get-OwReportObjectValue -Object $SummaryRow -Path @('namecard')
        title = Get-OwReportObjectValue -Object $SummaryRow -Path @('title') -Default $fallbackTitle
        endorsement_level = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $SummaryRow -Path @('endorsement_level') -Default 0) -Default 0
        endorsement_frame = Get-OwReportObjectValue -Object $SummaryRow -Path @('endorsement_frame')
        last_updated_at = $lastUpdatedAt
    }
}

function Get-OwReportInfluxLatestPlayerSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [string]$PlayerId
    )

    $query = 'SELECT * FROM "player_summary" WHERE "player"=''{0}'' ORDER BY time DESC LIMIT 1' -f $PlayerId.Replace("'", "''")
    $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
    if (-not $result.ok) {
        return [ordered]@{
            ok = $false
            row = $null
            error = $result.error
        }
    }

    $row = @($result.rows | Select-Object -First 1)
    return [ordered]@{
        ok = $true
        row = $(if ($row.Count -gt 0) { $row[0] } else { $null })
        error = $null
    }
}

function Get-OwReportDynamicWideMatchContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Snapshots
    )

    $assignments = @(
        foreach ($snapshot in @($Snapshots)) {
            $bestRole = Get-OwReportObjectValue -Object $snapshot -Path @('ranks', 'best_role')
            $roleMatch = @((Get-OwReportObjectValue -Object $snapshot -Path @('ranks', 'roles') -Default @()) | Where-Object { $_.role -eq $bestRole })
            $bestRank = $(if ($roleMatch.Count -gt 0) { $roleMatch[0] } else { $null })
            if ($null -ne $bestRank -and $null -ne $bestRank.ordinal) {
                [ordered]@{
                    rank_ordinal = $bestRank.ordinal
                }
            }
        }
    )

    if ($assignments.Count -lt 2) {
        return 'mixed'
    }

    $assessment = Get-OwReportWideGroupAssessment -Assignments $assignments
    switch ($assessment.label) {
        'wide' { return 'mostly_wide' }
        'narrow' { return 'mostly_narrow' }
        default { return 'mixed' }
    }
}

function Get-OwReportInfluxPublishedStatePath {
    [CmdletBinding()]
    param()

    return (Join-Path $script:OwReportProjectRoot 'docs\data\published-state.json')
}

function Read-OwReportInfluxPublishedState {
    [CmdletBinding()]
    param()

    $state = Read-OwReportJsonFile -Path (Get-OwReportInfluxPublishedStatePath)
    if ($null -eq $state) {
        return [ordered]@{
            snapshots = @()
            run_records = @()
        }
    }

    return [ordered]@{
        snapshots = @((Get-OwReportObjectValue -Object $state -Path @('snapshots') -Default @()))
        run_records = @((Get-OwReportObjectValue -Object $state -Path @('run_records') -Default @()))
    }
}

function Merge-OwReportInfluxSnapshots {
    [CmdletBinding()]
    param(
        [object[]]$ExistingSnapshots = @(),
        [object[]]$NewSnapshots = @()
    )

    $snapshotLookup = @{}
    foreach ($snapshot in @($ExistingSnapshots) + @($NewSnapshots)) {
        if ($null -eq $snapshot) {
            continue
        }

        $snapshotId = Get-OwReportObjectValue -Object $snapshot -Path @('snapshot_id')
        if ([string]::IsNullOrWhiteSpace($snapshotId)) {
            $snapshotId = '{0}|{1}' -f (
                Get-OwReportObjectValue -Object $snapshot -Path @('run_id') -Default ''
            ), (
                Get-OwReportObjectValue -Object $snapshot -Path @('player_slug') -Default ''
            )
        }

        if ([string]::IsNullOrWhiteSpace($snapshotId)) {
            continue
        }

        $snapshotLookup[$snapshotId] = $snapshot
    }

    return @(
        $snapshotLookup.Values |
            Sort-Object -Property @(
                @{ Expression = { [string](Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '') } },
                @{ Expression = { [string](Get-OwReportObjectValue -Object $_ -Path @('player_slug') -Default '') } }
            )
    )
}

function Merge-OwReportInfluxRunRecords {
    [CmdletBinding()]
    param(
        [object[]]$ExistingRunRecords = @(),
        [object[]]$NewRunRecords = @()
    )

    $runLookup = @{}
    foreach ($runRecord in @($ExistingRunRecords) + @($NewRunRecords)) {
        if ($null -eq $runRecord) {
            continue
        }

        $runId = Get-OwReportObjectValue -Object $runRecord -Path @('run_id')
        if ([string]::IsNullOrWhiteSpace($runId)) {
            continue
        }

        $runLookup[$runId] = $runRecord
    }

    return @(
        $runLookup.Values |
            Sort-Object { [string](Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '') }
    )
}

function Get-OwReportInfluxLatestSnapshotsByPlayer {
    [CmdletBinding()]
    param(
        [object[]]$Snapshots = @()
    )

    $latestByPlayer = @{}
    foreach ($snapshot in @($Snapshots | Sort-Object { [string](Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '') })) {
        $playerId = Get-OwReportObjectValue -Object $snapshot -Path @('player_id')
        if ([string]::IsNullOrWhiteSpace($playerId)) {
            continue
        }

        $latestByPlayer[$playerId] = $snapshot
    }

    return $latestByPlayer
}

function Get-OwReportInfluxIncrementalPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Players,
        [object[]]$ExistingSnapshots,
        [Parameter(Mandatory = $true)]
        [hashtable]$LatestSeasonByPlayer
    )

    $latestExistingSnapshotByPlayer = Get-OwReportInfluxLatestSnapshotsByPlayer -Snapshots $ExistingSnapshots
    $rankQueryStartMsByPlayer = @{}

    foreach ($player in @($Players)) {
        $playerId = Get-OwReportObjectValue -Object $player -Path @('player_id')
        if ([string]::IsNullOrWhiteSpace($playerId) -or -not $LatestSeasonByPlayer.ContainsKey($playerId)) {
            continue
        }

        $existingSnapshot = Get-OwReportObjectValue -Object $latestExistingSnapshotByPlayer -Path @($playerId)
        if ($null -eq $existingSnapshot) {
            continue
        }

        $existingSeason = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $existingSnapshot -Path @('ranks', 'season') -Default 0) -Default 0
        $latestSeason = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $LatestSeasonByPlayer -Path @($playerId) -Default 0) -Default 0
        $capturedAt = Get-OwReportObjectValue -Object $existingSnapshot -Path @('captured_at')
        if ($existingSeason -ne $latestSeason -or [string]::IsNullOrWhiteSpace($capturedAt)) {
            continue
        }

        $rankQueryStartMsByPlayer[$playerId] = [DateTimeOffset]::Parse($capturedAt).ToUnixTimeMilliseconds()
    }

    return [ordered]@{
        latest_snapshot_by_player = $latestExistingSnapshotByPlayer
        rank_query_start_ms_by_player = $rankQueryStartMsByPlayer
    }
}

function Get-OwReportInfluxPlayerMeasurementRows {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [string]$Measurement,
        [Parameter(Mandatory = $true)]
        [string]$PlayerId,
        [string]$Gamemode = 'competitive'
    )

    $query = if ($Measurement -eq 'competitive_rank') {
        'SELECT "tier","division","season" FROM "{0}" WHERE "player"=''{1}'' GROUP BY "role" ORDER BY time ASC' -f $Measurement, $PlayerId.Replace("'", "''")
    }
    else {
        'SELECT * FROM "{0}" WHERE "player"=''{1}'' AND "gamemode"=''{2}'' ORDER BY time ASC' -f $Measurement, $PlayerId.Replace("'", "''"), $Gamemode.Replace("'", "''")
    }

    $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
    if (-not $result.ok) {
        return [ordered]@{
            ok = $false
            rows = @()
            error = $result.error
            measurement = $Measurement
        }
    }

    return [ordered]@{
        ok = $true
        rows = @($result.rows)
        error = $null
        measurement = $Measurement
    }
}

function Get-OwReportInfluxLatestSeason {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [string]$PlayerId
    )

    $query = 'SELECT "season" FROM "competitive_rank" WHERE "player"=''{0}'' ORDER BY time DESC LIMIT 1' -f $PlayerId.Replace("'", "''")
    $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
    if (-not $result.ok) {
        return [ordered]@{
            ok = $false
            season = $null
            error = $result.error
        }
    }

    $seasonRow = @($result.rows | Select-Object -First 1)
    $season = $null
    if ($seasonRow.Count -gt 0) {
        $seasonValue = Get-OwReportObjectValue -Object $seasonRow[0] -Path @('season')
        if ($null -ne $seasonValue -and $seasonValue -ne '') {
            $season = [int]$seasonValue
        }
    }

    return [ordered]@{
        ok = $true
        season = $season
        error = $null
    }
}

function ConvertTo-OwReportInfluxPlayerSnapshotSet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerConfig,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog,
        $PlayerSummaryRow = $null,
        [object[]]$RankRows = @(),
        [hashtable]$RowsByMeasurement = @{},
        [object[]]$Warnings = @(),
        [object[]]$FailedMeasurements = @()
    )

    $careerMeasurements = @('career_stats_assists', 'career_stats_average', 'career_stats_combat', 'career_stats_game')
    $rowsLookup = @{}
    foreach ($measurement in $careerMeasurements) {
        $rowsLookup[$measurement] = @((Get-OwReportObjectValue -Object $RowsByMeasurement -Path @($measurement) -Default @()))
    }

    $snapshotLookup = @{}
    $ensureSnapshotState = {
        param([string]$Timestamp)

        if (-not $snapshotLookup.ContainsKey($Timestamp)) {
            $snapshotLookup[$Timestamp] = [ordered]@{
                captured_at = $Timestamp
                run_id = ConvertTo-OwReportInfluxRunId -Timestamp $Timestamp
                rank_roles = @{}
                hero_categories = @{}
                rank_season = $null
            }
        }

        return $snapshotLookup[$Timestamp]
    }

    foreach ($rankRow in @($RankRows)) {
        $timestamp = Get-OwReportObjectValue -Object $rankRow -Path @('time')
        if ([string]::IsNullOrWhiteSpace($timestamp)) {
            continue
        }

        $state = & $ensureSnapshotState $timestamp
        $role = ConvertTo-OwReportRoleKey -Role (Get-OwReportObjectValue -Object $rankRow -Path @('role'))
        if ([string]::IsNullOrWhiteSpace($role)) {
            continue
        }

        $state.rank_roles[$role] = [ordered]@{
            role = $role
            raw = [ordered]@{
                division = Get-OwReportObjectValue -Object $rankRow -Path @('division')
                tier = Get-OwReportObjectValue -Object $rankRow -Path @('tier')
            }
            label = $null
            ordinal = ConvertTo-RankOrdinal -Rank ([ordered]@{
                division = Get-OwReportObjectValue -Object $rankRow -Path @('division')
                tier = Get-OwReportObjectValue -Object $rankRow -Path @('tier')
            })
        }
        $state.rank_season = Get-OwReportObjectValue -Object $rankRow -Path @('season')
    }

    foreach ($measurement in $careerMeasurements) {
        $categoryKey = $measurement -replace '^career_stats_', ''
        foreach ($row in @($rowsLookup[$measurement])) {
            $timestamp = Get-OwReportObjectValue -Object $row -Path @('time')
            if ([string]::IsNullOrWhiteSpace($timestamp)) {
                continue
            }

            $heroKey = ConvertTo-OwReportHeroKey -Hero (Get-OwReportObjectValue -Object $row -Path @('hero') -Default '')
            if ([string]::IsNullOrWhiteSpace($heroKey)) {
                continue
            }

            $state = & $ensureSnapshotState $timestamp
            if (-not $state.hero_categories.ContainsKey($heroKey)) {
                $state.hero_categories[$heroKey] = @{}
            }

            $state.hero_categories[$heroKey][$categoryKey] = ConvertTo-OwReportInfluxCategoryObject -Row $row
        }
    }

    $snapshots = @()
    foreach ($timestamp in @($snapshotLookup.Keys | Sort-Object)) {
        $state = $snapshotLookup[$timestamp]
        $rankSummary = Normalize-OwReportRankSummary -RankSummary ([ordered]@{
            platform = 'pc'
            season = $state.rank_season
            roles = @($state.rank_roles.Values | Sort-Object role)
        })

        $heroes = @()
        foreach ($heroKey in @($state.hero_categories.Keys | Sort-Object)) {
            if ($heroKey -eq 'all-heroes') {
                continue
            }

            $heroRecord = Get-OwReportInfluxHeroMetricRecord -HeroKey $heroKey -HeroCategoryMap $state.hero_categories[$heroKey] -HeroCatalog $HeroCatalog
            if ($null -ne $heroRecord) {
                $heroes += $heroRecord
            }
        }

        $heroes = @(
            $heroes | Sort-Object -Property @(
                @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_time_played_seconds') -Default $_.time_played_seconds)) } },
                @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_games_played') -Default $_.games_played)) } },
                @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('hero_name') -Default '' } }
            )
        )

        $allHeroRecord = $null
        if ($state.hero_categories.ContainsKey('all-heroes')) {
            $allHeroRecord = Get-OwReportInfluxHeroMetricRecord -HeroKey 'all-heroes' -HeroCategoryMap $state.hero_categories['all-heroes'] -HeroCatalog $HeroCatalog
        }

        $metrics = if ($null -ne $allHeroRecord) {
            [ordered]@{
                kda = $allHeroRecord.kda
                winrate = $allHeroRecord.winrate
                games_played = $allHeroRecord.games_played
                games_won = $allHeroRecord.games_won
                games_lost = $allHeroRecord.games_lost
                time_played_seconds = $allHeroRecord.time_played_seconds
                total = $allHeroRecord.total
                average = $allHeroRecord.average
            }
        }
        else {
            Get-OwReportAggregateMetricsFromHeroes -HeroRecords $heroes
        }

        $roles = Get-OwReportAggregateRoleMetricsFromHeroes -HeroRecords $heroes
        $preferredRole = Get-OwReportPreferredRole -Roles $roles -RankSummary $rankSummary
        $profile = New-OwReportInfluxPlaceholderProfile -DisplayName $PlayerConfig.display_name -RankSummary $rankSummary -Timestamp $timestamp -SummaryRow $PlayerSummaryRow
        $snapshotWarnings = @($Warnings)
        $fetchStatus = $(if (@($FailedMeasurements).Count -gt 0) { 'partial' } else { 'success' })
        $title = Get-OwReportObjectValue -Object $profile -Path @('title') -Default 'Unranked'

        $snapshots += [ordered]@{
            snapshot_id = '{0}-{1}' -f $state.run_id, $PlayerConfig.slug
            run_id = $state.run_id
            captured_at = ([DateTimeOffset]::Parse($timestamp).ToString('o'))
            player_id = $PlayerConfig.player_id
            player_slug = $PlayerConfig.slug
            display_name = $PlayerConfig.display_name
            battle_tag = $PlayerConfig.battle_tag
            notes = $PlayerConfig.notes
            provider = 'influxdb'
            fetch_status = $fetchStatus
            wide_match_context = 'mixed'
            warnings = @($snapshotWarnings | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
            profile = $profile
            metrics = $metrics
            roles = $roles
            ranks = $rankSummary
            normalized = [ordered]@{
                preferred_role = $preferredRole
                data_quality = $fetchStatus
                top_heroes = @($heroes | Select-Object -First 3 | ForEach-Object { $_.hero_name })
            }
            heroes = $heroes
            raw_payloads = $null
            title = $title
        }
    }

    return [ordered]@{
        success = ($snapshots.Count -gt 0)
        player = $PlayerConfig
        snapshots = $snapshots
        warnings = @($Warnings | Select-Object -Unique)
        errors = $(if ($snapshots.Count -gt 0) { @() } else { @("No database-backed competitive snapshots were found for $($PlayerConfig.display_name).") })
        failed_measurements = @($FailedMeasurements | Select-Object -Unique)
    }
}

function Get-OwReportInfluxPlayerSnapshots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerConfig,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    $careerMeasurements = @('career_stats_assists', 'career_stats_average', 'career_stats_combat', 'career_stats_game')
    $measurements = @('competitive_rank') + $careerMeasurements
    $rowsByMeasurement = @{}
    $warnings = @()
    $failedMeasurements = @()
    foreach ($measurement in $measurements) {
        $rowsByMeasurement[$measurement] = @()
    }

    $playerSummaryResult = Get-OwReportInfluxLatestPlayerSummary -Client $Client -PlayerId $PlayerConfig.player_id
    $playerSummaryRow = $null
    if ($playerSummaryResult.ok) {
        $playerSummaryRow = $playerSummaryResult.row
    }
    elseif ($null -ne $playerSummaryResult.error) {
        $warnings += ("player_summary query failed: {0}" -f (Format-OwReportProviderErrorMessage -ErrorDetail $playerSummaryResult.error))
    }

    $latestSeasonResult = Get-OwReportInfluxLatestSeason -Client $Client -PlayerId $PlayerConfig.player_id
    $latestSeason = $null
    if ($latestSeasonResult.ok) {
        $latestSeason = $latestSeasonResult.season
    }
    else {
        $failedMeasurements += 'competitive_rank'
        $warnings += ("competitive_rank latest-season query failed: {0}" -f (Format-OwReportProviderErrorMessage -ErrorDetail $latestSeasonResult.error))
    }

    $seasonStartMs = $null
    if ($null -ne $latestSeason) {
        $rankQuery = 'SELECT "tier","division","season" FROM "competitive_rank" WHERE "player"=''{0}'' AND "season"={1} GROUP BY "role" ORDER BY time ASC' -f $PlayerConfig.player_id.Replace("'", "''"), $latestSeason
        $rankResult = Invoke-OwReportInfluxQuery -Client $Client -Query $rankQuery
        if ($rankResult.ok) {
            $rowsByMeasurement['competitive_rank'] = @($rankResult.rows)
            $rankTimes = @(
                $rankResult.rows |
                    ForEach-Object { Get-OwReportObjectValue -Object $_ -Path @('time') } |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                    ForEach-Object { [DateTimeOffset]::Parse($_) }
            )
            if ($rankTimes.Count -gt 0) {
                $seasonStartMs = (@($rankTimes | Sort-Object)[0]).ToUnixTimeMilliseconds()
            }
        }
        else {
            $failedMeasurements += 'competitive_rank'
            $warnings += ("competitive_rank season query failed: {0}" -f (Format-OwReportProviderErrorMessage -ErrorDetail $rankResult.error))
        }
    }

    if ($null -ne $seasonStartMs) {
        $careerQuery = 'SELECT * FROM /^(career_stats_assists|career_stats_average|career_stats_combat|career_stats_game)$/ WHERE "player"=''{0}'' AND "gamemode"=''competitive'' AND time >= {1}ms ORDER BY time ASC' -f $PlayerConfig.player_id.Replace("'", "''"), $seasonStartMs
        $careerResult = Invoke-OwReportInfluxQuery -Client $Client -Query $careerQuery
        if ($careerResult.ok) {
            foreach ($row in @($careerResult.rows)) {
                $measurement = Get-OwReportObjectValue -Object $row -Path @('measurement')
                if (-not [string]::IsNullOrWhiteSpace($measurement) -and $rowsByMeasurement.ContainsKey($measurement)) {
                    $rowsByMeasurement[$measurement] += $row
                }
            }
        }
        else {
            foreach ($measurement in $careerMeasurements) {
                $fallbackQuery = 'SELECT * FROM "{0}" WHERE "player"=''{1}'' AND "gamemode"=''competitive'' AND time >= {2}ms ORDER BY time ASC' -f $measurement, $PlayerConfig.player_id.Replace("'", "''"), $seasonStartMs
                $fallbackResult = Invoke-OwReportInfluxQuery -Client $Client -Query $fallbackQuery
                if ($fallbackResult.ok) {
                    $rowsByMeasurement[$measurement] = @($fallbackResult.rows)
                }
                else {
                    $failedMeasurements += $measurement
                    $warnings += ("{0} query failed: {1}" -f $measurement, (Format-OwReportProviderErrorMessage -ErrorDetail $fallbackResult.error))
                }
            }
        }
    }

    return (ConvertTo-OwReportInfluxPlayerSnapshotSet `
        -PlayerConfig $PlayerConfig `
        -HeroCatalog $HeroCatalog `
        -PlayerSummaryRow $playerSummaryRow `
        -RankRows @($rowsByMeasurement['competitive_rank']) `
        -RowsByMeasurement $rowsByMeasurement `
        -Warnings @($warnings) `
        -FailedMeasurements @($failedMeasurements))
}

function Get-OwReportInfluxBulkLatestPlayerSummaries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [object[]]$Players
    )

    $playerRegex = Get-OwReportInfluxPlayerRegexPattern -Players $Players
    if ([string]::IsNullOrWhiteSpace($playerRegex)) {
        return [ordered]@{
            ok = $true
            rows_by_player = @{}
            error = $null
        }
    }

    $summaryFields = @('avatar', 'endorsement_frame', 'endorsement_level', 'namecard', 'title', 'username')
    $query = 'SELECT {0} FROM "player_summary" WHERE "player" =~ /{1}/ GROUP BY "player"' -f (Get-OwReportInfluxLastFieldSelectClause -Fields $summaryFields), $playerRegex
    $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
    if (-not $result.ok) {
        return [ordered]@{
            ok = $false
            rows_by_player = @{}
            error = $result.error
        }
    }

    $rowsByPlayer = @{}
    foreach ($row in @($result.rows)) {
        $playerId = Get-OwReportObjectValue -Object $row -Path @('player')
        if (-not [string]::IsNullOrWhiteSpace($playerId)) {
            $rowsByPlayer[$playerId] = $row
        }
    }

    return [ordered]@{
        ok = $true
        rows_by_player = $rowsByPlayer
        error = $null
    }
}

function Get-OwReportInfluxBulkLatestSeasons {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [object[]]$Players
    )

    $playerRegex = Get-OwReportInfluxPlayerRegexPattern -Players $Players
    if ([string]::IsNullOrWhiteSpace($playerRegex)) {
        return [ordered]@{
            ok = $true
            seasons_by_player = @{}
            error = $null
        }
    }

    $query = 'SELECT last("season") AS "season" FROM "competitive_rank" WHERE "player" =~ /{0}/ GROUP BY "player"' -f $playerRegex
    $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
    if (-not $result.ok) {
        return [ordered]@{
            ok = $false
            seasons_by_player = @{}
            error = $result.error
        }
    }

    $seasonsByPlayer = @{}
    foreach ($row in @($result.rows)) {
        $playerId = Get-OwReportObjectValue -Object $row -Path @('player')
        $seasonValue = Get-OwReportObjectValue -Object $row -Path @('season')
        if (-not [string]::IsNullOrWhiteSpace($playerId) -and $null -ne $seasonValue -and $seasonValue -ne '') {
            $seasonsByPlayer[$playerId] = [int]$seasonValue
        }
    }

    return [ordered]@{
        ok = $true
        seasons_by_player = $seasonsByPlayer
        error = $null
    }
}

function Get-OwReportInfluxBulkRankRows {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [object[]]$Players,
        [Parameter(Mandatory = $true)]
        [hashtable]$LatestSeasonByPlayer,
        [hashtable]$QueryStartMsByPlayer = @{}
    )

    $clauses = @(
        foreach ($player in @($Players)) {
            $playerId = Get-OwReportObjectValue -Object $player -Path @('player_id')
            if ([string]::IsNullOrWhiteSpace($playerId) -or -not $LatestSeasonByPlayer.ContainsKey($playerId)) {
                continue
            }

            $timeClause = ''
            if ($QueryStartMsByPlayer.ContainsKey($playerId)) {
                $timeClause = ' AND time > {0}ms' -f $QueryStartMsByPlayer[$playerId]
            }

            '("player"=''{0}'' AND "season"={1}{2})' -f $playerId.Replace("'", "''"), $LatestSeasonByPlayer[$playerId], $timeClause
        }
    )

    if ($clauses.Count -eq 0) {
        return [ordered]@{
            ok = $true
            rows = @()
            error = $null
        }
    }

    $query = 'SELECT {0} FROM "competitive_rank" WHERE {1} GROUP BY time(1h),"player","role" fill(none) ORDER BY time ASC' -f (Get-OwReportInfluxLastFieldSelectClause -Fields @('tier', 'division', 'season')), ($clauses -join ' OR ')
    $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
    if (-not $result.ok) {
        return [ordered]@{
            ok = $false
            rows = @()
            error = $result.error
        }
    }

    return [ordered]@{
        ok = $true
        rows = @($result.rows)
        error = $null
    }
}

function Get-OwReportInfluxCareerMeasurementFieldMap {
    [CmdletBinding()]
    param()

    return [ordered]@{
        career_stats_assists = @('assists', 'healing_done')
        career_stats_average = @('eliminations_avg_per_10_min', 'assists_avg_per_10_min', 'deaths_avg_per_10_min', 'all_damage_done_avg_per_10_min', 'damage_done_avg_per_10_min', 'healing_done_avg_per_10_min')
        career_stats_combat = @('eliminations', 'deaths', 'all_damage_done', 'damage_done')
        career_stats_game = @('games_played', 'games_won', 'hero_wins', 'games_lost', 'time_played', 'win_percentage')
    }
}

function Get-OwReportInfluxBulkCareerRows {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [object[]]$Players,
        [Parameter(Mandatory = $true)]
        [hashtable]$QueryStartMsByPlayer,
        [string]$Gamemode = 'competitive'
    )

    $playerRegex = Get-OwReportInfluxPlayerRegexPattern -Players $Players
    $globalQueryStartMs = $null
    if (@($QueryStartMsByPlayer.Values).Count -gt 0) {
        $globalQueryStartMs = (@($QueryStartMsByPlayer.Values | Sort-Object))[0]
    }

    $fieldMap = Get-OwReportInfluxCareerMeasurementFieldMap
    $rowsByMeasurement = @{}
    foreach ($measurement in $fieldMap.Keys) {
        $rowsByMeasurement[$measurement] = @()
    }

    if ([string]::IsNullOrWhiteSpace($playerRegex) -or $null -eq $globalQueryStartMs) {
        return [ordered]@{
            ok = $true
            rows_by_measurement = $rowsByMeasurement
            warnings = @()
            failed_measurements = @()
        }
    }

    $warnings = @()
    $failedMeasurements = @()
    foreach ($measurement in $fieldMap.Keys) {
        $query = 'SELECT {0} FROM "{1}" WHERE "player" =~ /{2}/ AND "gamemode"=''{3}'' AND time >= {4}ms GROUP BY time(1h),"player","hero" fill(none) ORDER BY time ASC' -f (Get-OwReportInfluxLastFieldSelectClause -Fields $fieldMap[$measurement]), $measurement, $playerRegex, $Gamemode.Replace("'", "''"), $globalQueryStartMs
        $result = Invoke-OwReportInfluxQuery -Client $Client -Query $query
        if ($result.ok) {
            $rowsByMeasurement[$measurement] = @($result.rows)
        }
        else {
            $failedMeasurements += $measurement
            $warnings += ("{0} bulk query failed: {1}" -f $measurement, (Format-OwReportProviderErrorMessage -ErrorDetail $result.error))
        }
    }

    return [ordered]@{
        ok = ($failedMeasurements.Count -lt $fieldMap.Keys.Count)
        rows_by_measurement = $rowsByMeasurement
        warnings = @($warnings | Select-Object -Unique)
        failed_measurements = @($failedMeasurements | Select-Object -Unique)
    }
}

function Get-OwReportInfluxDataset {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [hashtable]$PublishedState = @{ snapshots = @(); run_records = @() }
    )

    $client = New-OwReportInfluxClient -Config $Config
    $heroCatalog = Get-OwReportFallbackHeroCatalog
    $players = @($Config.players)
    $existingSnapshots = @((Get-OwReportObjectValue -Object $PublishedState -Path @('snapshots') -Default @()))
    $existingRunRecords = @((Get-OwReportObjectValue -Object $PublishedState -Path @('run_records') -Default @()))
    $newSnapshots = @()
    $failedPlayers = @()
    $playerWarnings = @()

    if ($players.Count -eq 0) {
        return [ordered]@{
            hero_catalog = $heroCatalog
            snapshots = @()
            run_records = @()
            failed_players = @()
            player_warnings = @()
        }
    }

    Write-OwReportLog -RunContext $RunContext -Message ("Querying database in bulk for {0} tracked players" -f $players.Count)

    $playerSummaryResult = Get-OwReportInfluxBulkLatestPlayerSummaries -Client $client -Players $players
    $playerSummaryByPlayer = Get-OwReportObjectValue -Object $playerSummaryResult -Path @('rows_by_player') -Default @{}

    $latestSeasonResult = Get-OwReportInfluxBulkLatestSeasons -Client $client -Players $players
    $latestSeasonByPlayer = Get-OwReportObjectValue -Object $latestSeasonResult -Path @('seasons_by_player') -Default @{}

    $incrementalPlan = Get-OwReportInfluxIncrementalPlan -Players $players -ExistingSnapshots $existingSnapshots -LatestSeasonByPlayer $latestSeasonByPlayer
    $existingLatestSnapshotByPlayer = Get-OwReportObjectValue -Object $incrementalPlan -Path @('latest_snapshot_by_player') -Default @{}
    $rankQueryStartMsByPlayer = Get-OwReportObjectValue -Object $incrementalPlan -Path @('rank_query_start_ms_by_player') -Default @{}

    $rankRowsResult = Get-OwReportInfluxBulkRankRows -Client $client -Players $players -LatestSeasonByPlayer $latestSeasonByPlayer -QueryStartMsByPlayer $rankQueryStartMsByPlayer
    $rankRows = @($(if ($rankRowsResult.ok) { $rankRowsResult.rows } else { @() }))
    $rankRowsByPlayer = @{}
    $careerQueryStartMsByPlayer = @{}
    foreach ($rankRow in @($rankRows)) {
        $playerId = Get-OwReportObjectValue -Object $rankRow -Path @('player')
        if ([string]::IsNullOrWhiteSpace($playerId)) {
            continue
        }

        if (-not $rankRowsByPlayer.ContainsKey($playerId)) {
            $rankRowsByPlayer[$playerId] = @()
        }

        $rankRowsByPlayer[$playerId] += $rankRow

        $timestampText = Get-OwReportObjectValue -Object $rankRow -Path @('time')
        if (-not [string]::IsNullOrWhiteSpace($timestampText)) {
            $timestampMs = [DateTimeOffset]::Parse($timestampText).ToUnixTimeMilliseconds()
            if (-not $careerQueryStartMsByPlayer.ContainsKey($playerId) -or $timestampMs -lt $careerQueryStartMsByPlayer[$playerId]) {
                $careerQueryStartMsByPlayer[$playerId] = $timestampMs
            }
        }
    }

    foreach ($playerId in @($rankQueryStartMsByPlayer.Keys)) {
        if (-not $careerQueryStartMsByPlayer.ContainsKey($playerId)) {
            $careerQueryStartMsByPlayer[$playerId] = $rankQueryStartMsByPlayer[$playerId]
        }
    }

    $careerRowsResult = Get-OwReportInfluxBulkCareerRows -Client $client -Players $players -QueryStartMsByPlayer $careerQueryStartMsByPlayer -Gamemode (Get-OwReportObjectValue -Object $Config -Path @('provider', 'career_gamemode') -Default 'competitive')
    $careerRowsByMeasurementByPlayer = @{}
    foreach ($measurement in (Get-OwReportInfluxCareerMeasurementFieldMap).Keys) {
        $careerRowsByMeasurementByPlayer[$measurement] = @{}
    }

    foreach ($measurement in $careerRowsByMeasurementByPlayer.Keys) {
        foreach ($row in @(Get-OwReportObjectValue -Object $careerRowsResult -Path @('rows_by_measurement', $measurement) -Default @())) {
            $playerId = Get-OwReportObjectValue -Object $row -Path @('player')
            if ([string]::IsNullOrWhiteSpace($playerId) -or -not $careerQueryStartMsByPlayer.ContainsKey($playerId)) {
                continue
            }

            $timestampText = Get-OwReportObjectValue -Object $row -Path @('time')
            if ([string]::IsNullOrWhiteSpace($timestampText)) {
                continue
            }

            $timestampMs = [DateTimeOffset]::Parse($timestampText).ToUnixTimeMilliseconds()
            if ($timestampMs -lt $careerQueryStartMsByPlayer[$playerId]) {
                continue
            }

            if (-not $careerRowsByMeasurementByPlayer[$measurement].ContainsKey($playerId)) {
                $careerRowsByMeasurementByPlayer[$measurement][$playerId] = @()
            }

            $careerRowsByMeasurementByPlayer[$measurement][$playerId] += $row
        }
    }

    foreach ($player in $players) {
        Write-OwReportLog -RunContext $RunContext -Message ("Shaping database results for {0} ({1})" -f $player.display_name, $player.player_id)

        $warnings = @()
        $failedMeasurements = @()

        if (-not $playerSummaryResult.ok) {
            $warnings += ("player_summary bulk query failed: {0}" -f (Format-OwReportProviderErrorMessage -ErrorDetail $playerSummaryResult.error))
        }

        if (-not $latestSeasonResult.ok) {
            $failedMeasurements += 'competitive_rank'
            $warnings += ("competitive_rank latest-season bulk query failed: {0}" -f (Format-OwReportProviderErrorMessage -ErrorDetail $latestSeasonResult.error))
        }

        if (-not $rankRowsResult.ok) {
            $failedMeasurements += 'competitive_rank'
            $warnings += ("competitive_rank bulk query failed: {0}" -f (Format-OwReportProviderErrorMessage -ErrorDetail $rankRowsResult.error))
        }

        if (@($careerRowsResult.warnings).Count -gt 0) {
            $warnings += @($careerRowsResult.warnings)
        }
        if (@($careerRowsResult.failed_measurements).Count -gt 0) {
            $failedMeasurements += @($careerRowsResult.failed_measurements)
        }

        $playerRowsByMeasurement = @{}
        foreach ($measurement in $careerRowsByMeasurementByPlayer.Keys) {
            $playerRowsByMeasurement[$measurement] = @((Get-OwReportObjectValue -Object $careerRowsByMeasurementByPlayer[$measurement] -Path @($player.player_id) -Default @()))
        }

        $result = ConvertTo-OwReportInfluxPlayerSnapshotSet `
            -PlayerConfig $player `
            -HeroCatalog $heroCatalog `
            -PlayerSummaryRow (Get-OwReportObjectValue -Object $playerSummaryByPlayer -Path @($player.player_id)) `
            -RankRows @((Get-OwReportObjectValue -Object $rankRowsByPlayer -Path @($player.player_id) -Default @())) `
            -RowsByMeasurement $playerRowsByMeasurement `
            -Warnings @($warnings) `
            -FailedMeasurements @($failedMeasurements)

        if (-not $result.success) {
            if ($existingLatestSnapshotByPlayer.ContainsKey($player.player_id)) {
                continue
            }

            $failedPlayers += [ordered]@{
                display_name = $player.display_name
                player_id = $player.player_id
                errors = @($result.errors)
            }
            Write-OwReportLog -RunContext $RunContext -Message ("Failed {0}: {1}" -f $player.display_name, (($result.errors + $result.warnings) -join '; ')) -Level 'WARN'
            continue
        }

        $allSnapshots += @($result.snapshots)
        if (@($result.warnings).Count -gt 0) {
            $playerWarnings += @($result.warnings | ForEach-Object {
                [ordered]@{
                    player = $player.display_name
                    message = $_
                }
            })
        }

        $newSnapshots += @($result.snapshots)
    }

    $allSnapshots = Merge-OwReportInfluxSnapshots -ExistingSnapshots $existingSnapshots -NewSnapshots $newSnapshots
    $runLookup = @{}
    foreach ($existingRun in @($existingRunRecords)) {
        $runId = Get-OwReportObjectValue -Object $existingRun -Path @('run_id')
        if (-not [string]::IsNullOrWhiteSpace($runId)) {
            $runLookup[$runId] = [ordered]@{
                run_id = $runId
                timestamp = Get-OwReportObjectValue -Object $existingRun -Path @('timestamp')
                started_at = Get-OwReportObjectValue -Object $existingRun -Path @('started_at') -Default (Get-OwReportObjectValue -Object $existingRun -Path @('timestamp'))
                completed_at = Get-OwReportObjectValue -Object $existingRun -Path @('completed_at') -Default (Get-OwReportObjectValue -Object $existingRun -Path @('timestamp'))
                notes = Get-OwReportObjectValue -Object $existingRun -Path @('notes') -Default ''
                wide_match_context = Get-OwReportObjectValue -Object $existingRun -Path @('wide_match_context') -Default 'mixed'
                team_name = Get-OwReportObjectValue -Object $existingRun -Path @('team_name') -Default $Config.team_name
                provider = Get-OwReportObjectValue -Object $existingRun -Path @('provider') -Default 'influxdb'
                successful_players = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $existingRun -Path @('successful_players') -Default 0) -Default 0
                failed_players = @((Get-OwReportObjectValue -Object $existingRun -Path @('failed_players') -Default @()))
                warnings = @((Get-OwReportObjectValue -Object $existingRun -Path @('warnings') -Default @()))
            }
        }
    }

    foreach ($snapshot in @($allSnapshots | Sort-Object { [string](Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '') })) {
        if (-not $runLookup.ContainsKey($snapshot.run_id)) {
            $runLookup[$snapshot.run_id] = [ordered]@{
                run_id = $snapshot.run_id
                timestamp = $snapshot.captured_at
                started_at = $snapshot.captured_at
                completed_at = $snapshot.captured_at
                notes = ''
                wide_match_context = 'mixed'
                team_name = $Config.team_name
                provider = 'influxdb'
                successful_players = 0
                failed_players = @()
                warnings = @()
            }
        }
    }

    foreach ($runId in @($runLookup.Keys)) {
        $runSnapshots = @($allSnapshots | Where-Object { $_.run_id -eq $runId })
        $wideContext = Get-OwReportDynamicWideMatchContext -Snapshots $runSnapshots
        foreach ($snapshot in $runSnapshots) {
            if ($snapshot -is [System.Collections.IDictionary]) {
                $snapshot['wide_match_context'] = $wideContext
            }
            else {
                $snapshot.wide_match_context = $wideContext
            }
        }

        $runLookup[$runId].wide_match_context = $wideContext
        $runLookup[$runId].successful_players = $runSnapshots.Count
        $runLookup[$runId].warnings = @($runSnapshots | ForEach-Object { $_.warnings } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    }

    $runRecords = Merge-OwReportInfluxRunRecords -ExistingRunRecords @() -NewRunRecords @($runLookup.Values | Sort-Object { [string](Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '') })

    if ($newSnapshots.Count -eq 0) {
        Write-OwReportLog -RunContext $RunContext -Message 'No newer database snapshots were found. Reusing the published snapshot state.'
    }

    return [ordered]@{
        hero_catalog = $heroCatalog
        snapshots = @($allSnapshots | Sort-Object { [string](Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '') })
        run_records = $runRecords
        failed_players = $failedPlayers
        player_warnings = $playerWarnings
    }
}
