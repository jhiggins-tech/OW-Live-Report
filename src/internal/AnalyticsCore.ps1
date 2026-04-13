function Resolve-OwReportRankParts {
    [CmdletBinding()]
    param(
        $Rank
    )

    if ($null -eq $Rank) {
        return [ordered]@{
            tier_name = $null
            division_number = $null
        }
    }

    $tierName = $null
    $divisionNumber = $null

    if ($Rank -is [string]) {
        if ($Rank -match '(?i)(bronze|silver|gold|platinum|diamond|master|grandmaster|champion)\s*([1-5])?') {
            $tierName = $Matches[1].ToLowerInvariant()
            if ($Matches[2]) {
                $divisionNumber = [int]$Matches[2]
            }
        }
    }
    else {
        $tierRaw = Get-OwReportObjectValue -Object $Rank -Path @('tier')
        $divisionRaw = Get-OwReportObjectValue -Object $Rank -Path @('division')
        $rankRaw = Get-OwReportObjectValue -Object $Rank -Path @('rank')

        if ($tierRaw -is [string] -and -not [string]::IsNullOrWhiteSpace($tierRaw)) {
            $tierName = $tierRaw.ToLowerInvariant()
        }
        elseif ($divisionRaw -is [string] -and -not [string]::IsNullOrWhiteSpace($divisionRaw)) {
            $tierName = $divisionRaw.ToLowerInvariant()
        }
        elseif ($rankRaw -is [string] -and -not [string]::IsNullOrWhiteSpace($rankRaw)) {
            if ($rankRaw -match '(?i)(bronze|silver|gold|platinum|diamond|master|grandmaster|champion)') {
                $tierName = $Matches[1].ToLowerInvariant()
            }
        }

        if ($tierRaw -is [int] -or $tierRaw -is [long] -or $tierRaw -is [double]) {
            $divisionNumber = [int]$tierRaw
        }
        elseif ($divisionRaw -is [int] -or $divisionRaw -is [long] -or $divisionRaw -is [double]) {
            $divisionNumber = [int]$divisionRaw
        }
        else {
            $subdivision = Get-OwReportObjectValue -Object $Rank -Path @('subdivision')
            if ($subdivision -is [int] -or $subdivision -is [long] -or $subdivision -is [double]) {
                $divisionNumber = [int]$subdivision
            }
        }
    }

    return [ordered]@{
        tier_name = $tierName
        division_number = $divisionNumber
    }
}

function ConvertTo-RankOrdinal {
    [CmdletBinding()]
    param(
        $Rank
    )

    $parts = Resolve-OwReportRankParts -Rank $Rank
    $tier = $parts.tier_name
    $division = $parts.division_number

    if ([string]::IsNullOrWhiteSpace($tier)) {
        return $null
    }

    $tierIndexMap = @{
        bronze = 1
        silver = 2
        gold = 3
        platinum = 4
        diamond = 5
        master = 6
        grandmaster = 7
        champion = 8
    }

    $normalizedTier = $tier.ToString().ToLowerInvariant()
    if (-not $tierIndexMap.ContainsKey($normalizedTier)) {
        return $null
    }

    if ($null -eq $division -or $division -eq '') {
        $division = 3
    }

    $divisionNumber = ConvertTo-OwReportInteger -Value $division -Default 3
    if ($divisionNumber -lt 1) { $divisionNumber = 1 }
    if ($divisionNumber -gt 5) { $divisionNumber = 5 }

    return ((($tierIndexMap[$normalizedTier] - 1) * 5) + (6 - $divisionNumber))
}

function ConvertFrom-RankOrdinal {
    [CmdletBinding()]
    param(
        [Nullable[double]]$Ordinal
    )

    if ($null -eq $Ordinal -or $Ordinal -lt 1) {
        return 'Unranked'
    }

    $rounded = [int][Math]::Round([double]$Ordinal, 0)
    $tiers = @('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion')
    $tierIndex = [Math]::Floor(($rounded - 1) / 5)
    if ($tierIndex -ge $tiers.Count) {
        $tierIndex = $tiers.Count - 1
    }

    $division = 6 - ((($rounded - 1) % 5) + 1)
    return ('{0} {1}' -f $tiers[$tierIndex], $division)
}

function ConvertTo-OwReportRankLabel {
    [CmdletBinding()]
    param(
        $Rank
    )

    if ($null -eq $Rank) {
        return 'Unranked'
    }

    if ($Rank -is [string]) {
        return $script:OwReportTextInfo.ToTitleCase($Rank.ToLowerInvariant())
    }

    $parts = Resolve-OwReportRankParts -Rank $Rank
    $tier = $parts.tier_name
    $division = $parts.division_number
    if ([string]::IsNullOrWhiteSpace($tier)) {
        $label = Get-OwReportObjectValue -Object $Rank -Path @('label')
        if (-not [string]::IsNullOrWhiteSpace($label)) {
            return $label
        }

        $label = Get-OwReportObjectValue -Object $Rank -Path @('rank')
        if (-not [string]::IsNullOrWhiteSpace($label)) {
            return $script:OwReportTextInfo.ToTitleCase($label.ToLowerInvariant())
        }

        return 'Unranked'
    }

    if ($null -eq $division -or $division -eq '') {
        return $script:OwReportTextInfo.ToTitleCase($tier.ToLowerInvariant())
    }

    return ('{0} {1}' -f $script:OwReportTextInfo.ToTitleCase($tier.ToLowerInvariant()), $division)
}

function Get-OwReportRankRecordOrdinal {
    [CmdletBinding()]
    param(
        $RankRecord
    )

    if ($null -eq $RankRecord) {
        return $null
    }

    $ordinal = Get-OwReportObjectValue -Object $RankRecord -Path @('ordinal')
    if ($null -ne $ordinal -and $ordinal -ne '') {
        return (ConvertTo-OwReportNumber -Value $ordinal)
    }

    $raw = Get-OwReportObjectValue -Object $RankRecord -Path @('raw')
    if ($null -ne $raw) {
        $ordinal = ConvertTo-RankOrdinal -Rank $raw
        if ($null -ne $ordinal) {
            return [double]$ordinal
        }
    }

    $label = Get-OwReportObjectValue -Object $RankRecord -Path @('label')
    if (-not [string]::IsNullOrWhiteSpace($label)) {
        $ordinal = ConvertTo-RankOrdinal -Rank $label
        if ($null -ne $ordinal) {
            return [double]$ordinal
        }
    }

    return $null
}

function Normalize-OwReportRankSummary {
    [CmdletBinding()]
    param(
        $RankSummary
    )

    if ($null -eq $RankSummary) {
        return [ordered]@{
            platform = $null
            season = $null
            roles = @()
            average_ordinal = $null
            best_role = $null
            best_label = 'Unranked'
        }
    }

    $normalizedRoles = @(
        @((Get-OwReportObjectValue -Object $RankSummary -Path @('roles') -Default @())) | ForEach-Object {
            $raw = Get-OwReportObjectValue -Object $_ -Path @('raw')
            [ordered]@{
                role = Get-OwReportObjectValue -Object $_ -Path @('role')
                label = Get-OwReportObjectValue -Object $_ -Path @('label') -Default $(if ($null -ne $raw) { ConvertTo-OwReportRankLabel -Rank $raw } else { 'Unranked' })
                ordinal = Get-OwReportRankRecordOrdinal -RankRecord $_
                raw = $raw
            }
        } | Where-Object { -not [string]::IsNullOrWhiteSpace($_.role) }
    )

    $orderedRoles = @(
        $normalizedRoles | Sort-Object -Property @(
            @{ Expression = {
                    $ordinal = Get-OwReportRankRecordOrdinal -RankRecord $_
                    if ($null -eq $ordinal) { -1 } else { [double]$ordinal }
                }; Descending = $true },
            @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('role') -Default '' } }
        )
    )
    $ordinals = @($orderedRoles | ForEach-Object { Get-OwReportRankRecordOrdinal -RankRecord $_ } | Where-Object { $null -ne $_ })

    return [ordered]@{
        platform = Get-OwReportObjectValue -Object $RankSummary -Path @('platform')
        season = Get-OwReportObjectValue -Object $RankSummary -Path @('season')
        roles = $orderedRoles
        average_ordinal = $(if ($ordinals.Count -gt 0) { [Math]::Round((Get-OwReportAverage -Values $ordinals), 2) } else { $null })
        best_role = $(if ($orderedRoles.Count -gt 0) { $orderedRoles[0].role } else { $null })
        best_label = $(if ($orderedRoles.Count -gt 0) { $orderedRoles[0].label } else { 'Unranked' })
    }
}

function Get-OwReportRankSummary {
    [CmdletBinding()]
    param(
        $Summary
    )

    $competitive = Get-OwReportObjectValue -Object $Summary -Path @('competitive')
    if ($null -eq $competitive) {
        return [ordered]@{
            platform = $null
            season = $null
            roles = @()
            average_ordinal = $null
            best_role = $null
            best_label = 'Unranked'
        }
    }

    $platform = $null
    $platformData = $null
    foreach ($candidate in @('pc', 'console')) {
        $value = Get-OwReportObjectValue -Object $competitive -Path @($candidate)
        if ($null -ne $value) {
            $platform = $candidate
            $platformData = $value
            break
        }
    }

    if ($null -eq $platformData) {
        return [ordered]@{
            platform = $null
            season = $null
            roles = @()
            average_ordinal = $null
            best_role = $null
            best_label = 'Unranked'
        }
    }

    $roles = @()
    foreach ($roleName in @('tank', 'damage', 'support', 'open')) {
        $roleRank = Get-OwReportObjectValue -Object $platformData -Path @($roleName)
        if ($null -eq $roleRank) {
            continue
        }

        $ordinal = ConvertTo-RankOrdinal -Rank $roleRank
        $roles += [ordered]@{
            role = $roleName
            label = ConvertTo-OwReportRankLabel -Rank $roleRank
            ordinal = $ordinal
            raw = $roleRank
        }
    }

    return (Normalize-OwReportRankSummary -RankSummary ([ordered]@{
        platform = $platform
        season = Get-OwReportObjectValue -Object $platformData -Path @('season')
        roles = $roles
    }))
}

function Get-OwReportPreferredRole {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Roles,
        $RankSummary = $null
    )

    $sortedRoles = @(
        $Roles | Sort-Object -Property @(
            @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds'))) } },
            @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('games_played'))) } },
            @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('role') -Default '' } }
        )
    )
    if ($sortedRoles.Count -gt 0 -and $sortedRoles[0].time_played_seconds -gt 0) {
        return $sortedRoles[0].role
    }

    if ($null -ne $RankSummary -and -not [string]::IsNullOrWhiteSpace($RankSummary.best_role)) {
        return $RankSummary.best_role
    }

    return 'flex'
}

function Get-OwReportRoleMetrics {
    [CmdletBinding()]
    param(
        $StatsSummary
    )

    $roleRoot = Get-OwReportObjectValue -Object $StatsSummary -Path @('roles')
    $roles = @()
    foreach ($roleKey in Get-OwReportObjectPropertyNames -Object $roleRoot) {
        $roleValue = Get-OwReportObjectValue -Object $roleRoot -Path @($roleKey)
        if ($null -eq $roleValue) {
            continue
        }

        $roles += [ordered]@{
            role = $roleKey
            games_played = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $roleValue -Path @('games_played'))
            games_won = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $roleValue -Path @('games_won'))
            games_lost = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $roleValue -Path @('games_lost'))
            time_played_seconds = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $roleValue -Path @('time_played'))
            winrate = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('winrate'))
            kda = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('kda'))
            total = [ordered]@{
                eliminations = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('total', 'eliminations'))
                assists = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('total', 'assists'))
                deaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('total', 'deaths'))
                damage = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('total', 'damage'))
                healing = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('total', 'healing'))
            }
            average = [ordered]@{
                eliminations = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('average', 'eliminations'))
                assists = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('average', 'assists'))
                deaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('average', 'deaths'))
                damage = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('average', 'damage'))
                healing = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $roleValue -Path @('average', 'healing'))
            }
        }
    }

    return @(
        $roles | Sort-Object -Property @(
            @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds'))) } },
            @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('games_played'))) } },
            @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('role') -Default '' } }
        )
    )
}

function Get-OwReportHeroRecords {
    [CmdletBinding()]
    param(
        $StatsSummary,
        $Career,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    $heroKeys = @()
    foreach ($heroKey in Get-OwReportObjectPropertyNames -Object (Get-OwReportObjectValue -Object $StatsSummary -Path @('heroes'))) {
        if (-not [string]::IsNullOrWhiteSpace($heroKey)) {
            $heroKeys += $heroKey
        }
    }

    foreach ($heroKey in Get-OwReportObjectPropertyNames -Object $Career) {
        if (-not [string]::IsNullOrWhiteSpace($heroKey) -and $heroKey -ne 'all-heroes') {
            $heroKeys += $heroKey
        }
    }

    $records = @()
    foreach ($heroKey in @($heroKeys | Sort-Object -Unique)) {
        $summaryHero = Get-OwReportObjectValue -Object $StatsSummary -Path @('heroes', $heroKey)
        $careerHero = Get-OwReportObjectValue -Object $Career -Path @($heroKey)
        $careerGame = Get-OwReportObjectValue -Object $careerHero -Path @('game')

        $records += [ordered]@{
            hero_key = $heroKey
            hero_name = Get-OwReportHeroName -HeroKey $heroKey -HeroCatalog $HeroCatalog
            hero_role = Get-OwReportHeroRole -HeroKey $heroKey -HeroCatalog $HeroCatalog
            games_played = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('games_played'))
            games_won = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('games_won'))
            games_lost = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('games_lost'))
            time_played_seconds = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('time_played'))
            season_games_played = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $careerGame -Path @('games_played') -Default (Get-OwReportObjectValue -Object $summaryHero -Path @('games_played')))
            season_games_won = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $careerGame -Path @('games_won') -Default (Get-OwReportObjectValue -Object $summaryHero -Path @('games_won')))
            season_games_lost = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $careerGame -Path @('games_lost') -Default (Get-OwReportObjectValue -Object $summaryHero -Path @('games_lost')))
            season_time_played_seconds = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $careerGame -Path @('time_played') -Default (Get-OwReportObjectValue -Object $summaryHero -Path @('time_played')))
            winrate = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('winrate'))
            kda = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('kda'))
            total = [ordered]@{
                eliminations = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('total', 'eliminations'))
                assists = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('total', 'assists'))
                deaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('total', 'deaths'))
                damage = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('total', 'damage'))
                healing = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('total', 'healing'))
            }
            average = [ordered]@{
                eliminations = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('average', 'eliminations'))
                assists = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('average', 'assists'))
                deaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('average', 'deaths'))
                damage = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('average', 'damage'))
                healing = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $summaryHero -Path @('average', 'healing'))
            }
            career = [ordered]@{
                assists = Get-OwReportObjectValue -Object $careerHero -Path @('assists')
                average = Get-OwReportObjectValue -Object $careerHero -Path @('average')
                best = Get-OwReportObjectValue -Object $careerHero -Path @('best')
                combat = Get-OwReportObjectValue -Object $careerHero -Path @('combat')
                game = Get-OwReportObjectValue -Object $careerHero -Path @('game')
                hero_specific = Get-OwReportObjectValue -Object $careerHero -Path @('hero_specific')
            }
        }
    }

    return @(
        $records | Sort-Object -Property @(
            @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_time_played_seconds') -Default (Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds')))) } },
            @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_games_played') -Default (Get-OwReportObjectValue -Object $_ -Path @('games_played')))) } },
            @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('hero_name') -Default '' } }
        )
    )
}

function Get-OwReportComputedKda {
    [CmdletBinding()]
    param(
        [double]$Eliminations,
        [double]$Assists,
        [double]$Deaths
    )

    $numerator = [double]$Eliminations + [double]$Assists
    if ($numerator -le 0) {
        return 0
    }

    if ($Deaths -le 0) {
        return [Math]::Round($numerator, 2)
    }

    return [Math]::Round(($numerator / [double]$Deaths), 2)
}

function Get-OwReportPerTenAverage {
    [CmdletBinding()]
    param(
        [double]$Total,
        [double]$TimePlayedSeconds
    )

    if ($TimePlayedSeconds -le 0) {
        return 0
    }

    return [Math]::Round(($Total / ($TimePlayedSeconds / 600.0)), 2)
}

function Get-OwReportAggregateMetricsFromHeroes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$HeroRecords
    )

    $gamesPlayed = 0
    $gamesWon = 0
    $gamesLost = 0
    $timePlayedSeconds = 0
    $totalEliminations = 0.0
    $totalAssists = 0.0
    $totalDeaths = 0.0
    $totalDamage = 0.0
    $totalHealing = 0.0

    foreach ($hero in @($HeroRecords)) {
        $gamesPlayed += ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $hero -Path @('games_played'))
        $gamesWon += ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $hero -Path @('games_won'))
        $gamesLost += ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $hero -Path @('games_lost'))
        $timePlayedSeconds += ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $hero -Path @('time_played_seconds'))
        $totalEliminations += ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $hero -Path @('total', 'eliminations'))
        $totalAssists += ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $hero -Path @('total', 'assists'))
        $totalDeaths += ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $hero -Path @('total', 'deaths'))
        $totalDamage += ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $hero -Path @('total', 'damage'))
        $totalHealing += ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $hero -Path @('total', 'healing'))
    }

    $effectiveGamesPlayed = $(if ($gamesPlayed -gt 0) { $gamesPlayed } else { ($gamesWon + $gamesLost) })
    $winrate = $(if ($effectiveGamesPlayed -gt 0) { [Math]::Round((($gamesWon / [double]$effectiveGamesPlayed) * 100.0), 2) } else { 0 })

    return [ordered]@{
        kda = Get-OwReportComputedKda -Eliminations $totalEliminations -Assists $totalAssists -Deaths $totalDeaths
        winrate = $winrate
        games_played = $effectiveGamesPlayed
        games_won = $gamesWon
        games_lost = $gamesLost
        time_played_seconds = $timePlayedSeconds
        total = [ordered]@{
            eliminations = [Math]::Round($totalEliminations, 2)
            assists = [Math]::Round($totalAssists, 2)
            deaths = [Math]::Round($totalDeaths, 2)
            damage = [Math]::Round($totalDamage, 2)
            healing = [Math]::Round($totalHealing, 2)
        }
        average = [ordered]@{
            eliminations = Get-OwReportPerTenAverage -Total $totalEliminations -TimePlayedSeconds $timePlayedSeconds
            assists = Get-OwReportPerTenAverage -Total $totalAssists -TimePlayedSeconds $timePlayedSeconds
            deaths = Get-OwReportPerTenAverage -Total $totalDeaths -TimePlayedSeconds $timePlayedSeconds
            damage = Get-OwReportPerTenAverage -Total $totalDamage -TimePlayedSeconds $timePlayedSeconds
            healing = Get-OwReportPerTenAverage -Total $totalHealing -TimePlayedSeconds $timePlayedSeconds
        }
    }
}

function Get-OwReportAggregateRoleMetricsFromHeroes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$HeroRecords
    )

    $roles = @()
    foreach ($role in @('tank', 'damage', 'support', 'flex')) {
        $roleHeroes = @($HeroRecords | Where-Object { $_.hero_role -eq $role })
        if ($roleHeroes.Count -eq 0) {
            continue
        }

        $aggregate = Get-OwReportAggregateMetricsFromHeroes -HeroRecords $roleHeroes
        if ($aggregate.games_played -le 0 -and $aggregate.time_played_seconds -le 0) {
            continue
        }

        $roles += [ordered]@{
            role = $role
            games_played = $aggregate.games_played
            games_won = $aggregate.games_won
            games_lost = $aggregate.games_lost
            time_played_seconds = $aggregate.time_played_seconds
            winrate = $aggregate.winrate
            kda = $aggregate.kda
            total = $aggregate.total
            average = $aggregate.average
        }
    }

    return @(
        $roles | Sort-Object -Property @(
            @{ Expression = 'time_played_seconds'; Descending = $true },
            @{ Expression = 'games_played'; Descending = $true }
        )
    )
}

function Apply-OwReportPlayerFiltersToSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Snapshot,
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerConfig
    )

    $filteredSnapshot = [ordered]@{}
    foreach ($propertyName in Get-OwReportObjectPropertyNames -Object $Snapshot) {
        $filteredSnapshot[$propertyName] = Get-OwReportObjectValue -Object $Snapshot -Path @($propertyName)
    }

    $hiddenHeroKeys = @((Get-OwReportObjectValue -Object $PlayerConfig -Path @('hidden_heroes') -Default @()) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $lockedRole = Get-OwReportObjectValue -Object $PlayerConfig -Path @('locked_role')
    $heroList = @((Get-OwReportObjectValue -Object $Snapshot -Path @('heroes') -Default @()))
    $hiddenHeroLookup = @{}
    foreach ($heroKey in $hiddenHeroKeys) {
        $hiddenHeroLookup[$heroKey] = $true
    }

    $visibleHeroes = @($heroList | Where-Object { -not $hiddenHeroLookup.ContainsKey($_.hero_key) })
    $hiddenHeroRecords = @($heroList | Where-Object { $hiddenHeroLookup.ContainsKey($_.hero_key) })
    $hiddenHeroNames = @($hiddenHeroRecords | ForEach-Object { $_.hero_name } | Select-Object -Unique)

    if ($hiddenHeroKeys.Count -gt 0) {
        $filteredSnapshot.heroes = $visibleHeroes
        $filteredSnapshot.metrics = Get-OwReportAggregateMetricsFromHeroes -HeroRecords $visibleHeroes
        $filteredSnapshot.roles = Get-OwReportAggregateRoleMetricsFromHeroes -HeroRecords $visibleHeroes
    }

    $normalizedHeroes = @($filteredSnapshot.heroes | Sort-Object -Property @(
        @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_time_played_seconds') -Default (Get-OwReportObjectValue -Object $_ -Path @('time_played_seconds')))) } },
        @{ Expression = { -1 * (ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $_ -Path @('season_games_played') -Default (Get-OwReportObjectValue -Object $_ -Path @('games_played')))) } },
        @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('hero_name') -Default '' } }
    ))
    $normalized = Get-OwReportObjectValue -Object $Snapshot -Path @('normalized') -Default ([ordered]@{})
    $filteredSnapshot.normalized = [ordered]@{
        preferred_role = Get-OwReportPreferredRole -Roles @($filteredSnapshot.roles) -RankSummary $filteredSnapshot.ranks
        data_quality = Get-OwReportObjectValue -Object $normalized -Path @('data_quality') -Default (Get-OwReportObjectValue -Object $Snapshot -Path @('fetch_status') -Default 'success')
        top_heroes = @($normalizedHeroes | Select-Object -First 3 | ForEach-Object { $_.hero_name })
    }

    $warnings = @((Get-OwReportObjectValue -Object $Snapshot -Path @('warnings') -Default @()))
    if ($hiddenHeroNames.Count -gt 0) {
        $warnings += ('Custom hero filter active: {0}' -f ($hiddenHeroNames -join ', '))
    }
    $filteredSnapshot.warnings = @($warnings | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    $filteredSnapshot.customizations = [ordered]@{
        hidden_hero_keys = $hiddenHeroKeys
        hidden_hero_names = $hiddenHeroNames
        locked_role = $lockedRole
    }

    return $filteredSnapshot
}

function ConvertTo-OwReportPlayerSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerConfig,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [Parameter(Mandatory = $true)]
        [hashtable]$Bundle,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    $rankSummary = Get-OwReportRankSummary -Summary $Bundle.summary
    $roleMetrics = Get-OwReportRoleMetrics -StatsSummary $Bundle.stats_summary
    $heroRecords = Get-OwReportHeroRecords -StatsSummary $Bundle.stats_summary -Career $Bundle.stats_career -HeroCatalog $HeroCatalog
    $general = Get-OwReportObjectValue -Object $Bundle.stats_summary -Path @('general')
    $preferredRole = Get-OwReportPreferredRole -Roles $roleMetrics -RankSummary $rankSummary
    $fetchStatus = if ($Bundle.stats_summary -and $Bundle.stats_career) { 'success' } elseif ($Bundle.summary -or $Bundle.stats_summary) { 'partial' } else { 'failed' }
    $topHeroes = @($heroRecords | Select-Object -First 3 | ForEach-Object { $_.hero_name })

    return [ordered]@{
        snapshot_id = '{0}-{1}' -f $RunContext.run_id, $PlayerConfig.slug
        run_id = $RunContext.run_id
        captured_at = $RunContext.timestamp
        player_id = $Bundle.player_id
        player_slug = $PlayerConfig.slug
        display_name = $PlayerConfig.display_name
        battle_tag = $PlayerConfig.battle_tag
        provider = 'overfast'
        fetch_status = $fetchStatus
        wide_match_context = $RunContext.wide_match_context
        notes = $PlayerConfig.notes
        warnings = @($Bundle.warnings)
        profile = [ordered]@{
            username = Get-OwReportObjectValue -Object $Bundle.summary -Path @('username') -Default $PlayerConfig.display_name
            avatar = Get-OwReportObjectValue -Object $Bundle.summary -Path @('avatar')
            namecard = Get-OwReportObjectValue -Object $Bundle.summary -Path @('namecard')
            title = Get-OwReportObjectValue -Object $Bundle.summary -Path @('title')
            endorsement_level = Get-OwReportObjectValue -Object $Bundle.summary -Path @('endorsement', 'level')
            last_updated_at = Get-OwReportObjectValue -Object $Bundle.summary -Path @('last_updated_at')
        }
        ranks = $rankSummary
        metrics = [ordered]@{
            kda = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('kda'))
            winrate = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('winrate'))
            games_played = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $general -Path @('games_played'))
            games_won = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $general -Path @('games_won'))
            games_lost = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $general -Path @('games_lost'))
            time_played_seconds = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $general -Path @('time_played'))
            total = [ordered]@{
                eliminations = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('total', 'eliminations'))
                assists = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('total', 'assists'))
                deaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('total', 'deaths'))
                damage = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('total', 'damage'))
                healing = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('total', 'healing'))
            }
            average = [ordered]@{
                eliminations = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('average', 'eliminations'))
                assists = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('average', 'assists'))
                deaths = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('average', 'deaths'))
                damage = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('average', 'damage'))
                healing = ConvertTo-OwReportNumber -Value (Get-OwReportObjectValue -Object $general -Path @('average', 'healing'))
            }
        }
        roles = $roleMetrics
        heroes = $heroRecords
        normalized = [ordered]@{
            preferred_role = $preferredRole
            data_quality = $fetchStatus
            top_heroes = $topHeroes
        }
        raw_payloads = $Bundle.raw_payloads
    }
}

function New-OwReportSeriesPoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Timestamp,
        $Value,
        [string]$HeroKey = '',
        [string]$HeroName = ''
    )

    return [ordered]@{
        timestamp = $Timestamp
        value = $Value
        hero_key = $HeroKey
        hero_name = $HeroName
    }
}

function Get-OwReportWindowedSeries {
    [CmdletBinding()]
    param(
        [object[]]$Series,
        [int]$WindowDays = 14,
        [int]$MinimumPoints = 3,
        [int]$FallbackLastPoints = 4
    )

    if ($null -eq $Series) {
        return @()
    }

    $ordered = @($Series | Where-Object { $null -ne $_.value } | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '' })
    if ($ordered.Count -eq 0) {
        return @()
    }
    if ($ordered.Count -le 1) {
        return $ordered
    }

    $latestTimestamp = [DateTimeOffset]::Parse($ordered[-1].timestamp)
    $threshold = $latestTimestamp.AddDays(-$WindowDays)
    $windowed = @($ordered | Where-Object { [DateTimeOffset]::Parse($_.timestamp) -ge $threshold })
    if ($windowed.Count -lt $MinimumPoints) {
        return @($ordered | Select-Object -Last ([Math]::Min($FallbackLastPoints, $ordered.Count)))
    }

    return $windowed
}

function Get-TimeSeriesTrend {
    [CmdletBinding()]
    param(
        [object[]]$Series,
        [double]$FlatSlopeThreshold,
        [double]$ConfidenceMultiplier = 1.0
    )

    if ($null -eq $Series) {
        return [ordered]@{
            direction = 'flat'
            slope_per_day = 0
            delta = 0
            confidence = 0
            span_days = 0
            sample_count = 0
        }
    }

    $ordered = @($Series | Where-Object { $null -ne $_.value } | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '' })
    if ($ordered.Count -lt 2) {
        return [ordered]@{
            direction = 'flat'
            slope_per_day = 0
            delta = 0
            confidence = 0
            span_days = 0
            sample_count = $ordered.Count
        }
    }

    $baseTime = [DateTimeOffset]::Parse($ordered[0].timestamp)
    $pairs = @()
    foreach ($point in $ordered) {
        $timestamp = [DateTimeOffset]::Parse($point.timestamp)
        $pairs += [ordered]@{
            x = ($timestamp - $baseTime).TotalDays
            y = [double]$point.value
        }
    }

    $xMean = Get-OwReportAverage -Values ($pairs | ForEach-Object { $_.x })
    $yMean = Get-OwReportAverage -Values ($pairs | ForEach-Object { $_.y })
    $denominator = (($pairs | ForEach-Object { [Math]::Pow($_.x - $xMean, 2) } | Measure-Object -Sum).Sum)
    $slope = 0
    if ($denominator -ne 0) {
        $numerator = (($pairs | ForEach-Object { ($_.x - $xMean) * ($_.y - $yMean) } | Measure-Object -Sum).Sum)
        $slope = ($numerator / $denominator)
    }

    $delta = ([double]$ordered[-1].value) - ([double]$ordered[0].value)
    $spanDays = ([DateTimeOffset]::Parse($ordered[-1].timestamp) - [DateTimeOffset]::Parse($ordered[0].timestamp)).TotalDays
    $confidence = [Math]::Min(1.0, ($ordered.Count / 5.0)) * [Math]::Min(1.0, ($spanDays / 14.0)) * $ConfidenceMultiplier

    $direction = 'flat'
    if ([Math]::Abs($slope) -gt $FlatSlopeThreshold -and [Math]::Abs($delta) -gt ($FlatSlopeThreshold * [Math]::Max($spanDays, 1))) {
        $direction = $(if ($slope -gt 0) { 'up' } else { 'down' })
    }

    return [ordered]@{
        direction = $direction
        slope_per_day = [Math]::Round($slope, 4)
        delta = [Math]::Round($delta, 3)
        confidence = [Math]::Round($confidence, 3)
        span_days = [Math]::Round($spanDays, 2)
        sample_count = $ordered.Count
    }
}

function Get-OwReportMetricSeries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Snapshots,
        [Parameter(Mandatory = $true)]
        [string[]]$Path
    )

    $series = @()
    foreach ($snapshot in @($Snapshots | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' })) {
        $value = Get-OwReportObjectValue -Object $snapshot -Path $Path
        $series += (New-OwReportSeriesPoint -Timestamp $snapshot.captured_at -Value $value)
    }

    return $series
}

function Get-OwReportHeroSeries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Snapshots,
        [Parameter(Mandatory = $true)]
        [object[]]$HeroKeys,
        [Parameter(Mandatory = $true)]
        [string[]]$MetricPath,
        [switch]$MissingAsZero
    )

    $seriesList = @()
    foreach ($heroKey in $HeroKeys) {
        $heroPoints = @()
        foreach ($snapshot in @($Snapshots | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' })) {
            $matches = @($snapshot.heroes | Where-Object { $_.hero_key -eq $heroKey })
            $hero = $(if ($matches.Count -gt 0) { $matches[0] } else { $null })
            $value = $null
            if ($null -ne $hero) {
                $value = Get-OwReportObjectValue -Object $hero -Path $MetricPath
            }

            if ($MissingAsZero -and $null -eq $value) {
                $value = 0
            }

            $heroPoints += (New-OwReportSeriesPoint -Timestamp $snapshot.captured_at -Value $value -HeroKey $heroKey -HeroName (Get-OwReportObjectValue -Object $hero -Path @('hero_name') -Default ''))
        }

        $latestMatches = @($Snapshots[-1].heroes | Where-Object { $_.hero_key -eq $heroKey })
        $latestHero = $(if ($latestMatches.Count -gt 0) { $latestMatches[0] } else { $null })
        $seriesList += [ordered]@{
            key = $heroKey
            name = $(if ($null -ne $latestHero) { Get-OwReportObjectValue -Object $latestHero -Path @('hero_name') -Default (ConvertTo-OwReportPrettyHeroName -HeroKey $heroKey) } else { ConvertTo-OwReportPrettyHeroName -HeroKey $heroKey })
            series = $heroPoints
        }
    }

    return $seriesList
}
