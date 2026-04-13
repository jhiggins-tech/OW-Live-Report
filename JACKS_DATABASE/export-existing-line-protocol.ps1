[CmdletBinding()]
param(
    [string]$DataDir,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$script:InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = Join-Path $PSScriptRoot '..\data'
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'existing-captured-stats.lp'
}

function ConvertTo-OwLineTimestamp {
    param([string]$Timestamp)

    if ([string]::IsNullOrWhiteSpace($Timestamp)) {
        return $null
    }

    $dto = [System.DateTimeOffset]::Parse($Timestamp, $script:InvariantCulture)
    $epoch = [System.DateTimeOffset]::FromUnixTimeSeconds(0)
    return [string](($dto.ToUniversalTime().Ticks - $epoch.Ticks) * 100)
}

function Escape-OwLineName {
    param([string]$Value)

    if ($null -eq $Value) {
        return ''
    }

    return ([string]$Value).Replace('\', '\\').Replace(' ', '\ ').Replace(',', '\,')
}

function Escape-OwLineTag {
    param([string]$Value)

    if ($null -eq $Value) {
        return ''
    }

    return ([string]$Value).Replace('\', '\\').Replace(' ', '\ ').Replace(',', '\,').Replace('=', '\=')
}

function Escape-OwLineFieldKey {
    param([string]$Value)

    if ($null -eq $Value) {
        return ''
    }

    return ([string]$Value).Replace('\', '\\').Replace(' ', '\ ').Replace(',', '\,').Replace('=', '\=')
}

function ConvertTo-OwLineStringField {
    param([string]$Value)

    return '"' + ([string]$Value).Replace('\', '\\').Replace('"', '\"') + '"'
}

function ConvertTo-OwLineFieldValue {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [bool]) {
        return $Value.ToString().ToLowerInvariant()
    }

    if ($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64] -or
        $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
        $number = [double]$Value
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
            return $null
        }
        return $number.ToString('G17', $script:InvariantCulture)
    }

    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return $null
        }
        return ConvertTo-OwLineStringField -Value $Value
    }

    return $null
}

function Add-OwLineField {
    param(
        [hashtable]$Fields,
        [string]$Name,
        $Value
    )

    $fieldValue = ConvertTo-OwLineFieldValue -Value $Value
    if ($null -ne $fieldValue) {
        $Fields[$Name] = $fieldValue
    }
}

function ConvertTo-OwLineFieldSet {
    param([hashtable]$Fields)

    $parts = foreach ($key in ($Fields.Keys | Sort-Object)) {
        '{0}={1}' -f (Escape-OwLineFieldKey -Value $key), $Fields[$key]
    }

    return ($parts -join ',')
}

function New-OwLine {
    param(
        [string]$Measurement,
        [hashtable]$Tags,
        [hashtable]$Fields,
        [string]$Timestamp
    )

    if ([string]::IsNullOrWhiteSpace($Timestamp) -or $Fields.Count -eq 0) {
        return $null
    }

    $measurementName = Escape-OwLineName -Value $Measurement
    $tagSet = foreach ($key in ($Tags.Keys | Sort-Object)) {
        if ($null -ne $Tags[$key] -and -not [string]::IsNullOrWhiteSpace([string]$Tags[$key])) {
            '{0}={1}' -f (Escape-OwLineTag -Value $key), (Escape-OwLineTag -Value ([string]$Tags[$key]))
        }
    }

    $tagSuffix = ''
    if ($tagSet.Count -gt 0) {
        $tagSuffix = ',' + ($tagSet -join ',')
    }

    return '{0}{1} {2} {3}' -f $measurementName, $tagSuffix, (ConvertTo-OwLineFieldSet -Fields $Fields), $Timestamp
}

function Get-OwRankDivision {
    param($Rank)

    if ($Rank.raw -and $Rank.raw.division) {
        return ([string]$Rank.raw.division).ToLowerInvariant()
    }

    if ($Rank.label -match '^(\S+)') {
        return $Matches[1].ToLowerInvariant()
    }

    return $null
}

function Get-OwRankTier {
    param($Rank)

    if ($Rank.raw -and $null -ne $Rank.raw.tier) {
        return $Rank.raw.tier
    }

    if ($Rank.label -match '(\d+)') {
        return [int]$Matches[1]
    }

    return $null
}

function Add-OwObjectFields {
    param(
        [hashtable]$Fields,
        $Source
    )

    if ($null -eq $Source) {
        return
    }

    foreach ($property in $Source.PSObject.Properties) {
        Add-OwLineField -Fields $Fields -Name $property.Name -Value $property.Value
    }
}

function Get-OwHeroSpecificMeasurement {
    param([string]$HeroKey)

    $safeHero = ([string]$HeroKey).ToLowerInvariant() -replace '[^a-z0-9_]+', '_'
    return "career_stats_hero_specific_$safeHero"
}

if (-not (Test-Path -LiteralPath $DataDir)) {
    throw "Data directory not found: $DataDir"
}

$lines = [System.Collections.Generic.List[string]]::new()

$playerSnapshotRoot = Join-Path $DataDir 'player-snapshots'
if (Test-Path -LiteralPath $playerSnapshotRoot) {
    Get-ChildItem -LiteralPath $playerSnapshotRoot -Recurse -Filter '*.json' | Sort-Object FullName | ForEach-Object {
        $snapshot = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
        $timestamp = ConvertTo-OwLineTimestamp -Timestamp $snapshot.captured_at
        if ([string]::IsNullOrWhiteSpace($timestamp) -or -not $snapshot.ranks -or -not $snapshot.ranks.roles) {
            return
        }

        foreach ($rank in $snapshot.ranks.roles) {
            $fields = @{}
            Add-OwLineField -Fields $fields -Name 'division' -Value (Get-OwRankDivision -Rank $rank)
            Add-OwLineField -Fields $fields -Name 'tier' -Value (Get-OwRankTier -Rank $rank)
            Add-OwLineField -Fields $fields -Name 'season' -Value $snapshot.ranks.season

            $line = New-OwLine `
                -Measurement 'competitive_rank' `
                -Tags @{
                    player = $snapshot.player_id
                    role = $rank.role
                } `
                -Fields $fields `
                -Timestamp $timestamp

            if ($line) {
                $lines.Add($line)
            }
        }
    }
}

$heroSnapshotRoot = Join-Path $DataDir 'player-hero-snapshots'
if (Test-Path -LiteralPath $heroSnapshotRoot) {
    Get-ChildItem -LiteralPath $heroSnapshotRoot -Recurse -Filter '*.json' | Sort-Object FullName | ForEach-Object {
        $snapshot = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
        $timestamp = ConvertTo-OwLineTimestamp -Timestamp $snapshot.captured_at
        $hero = $snapshot.hero
        if ([string]::IsNullOrWhiteSpace($timestamp) -or $null -eq $hero) {
            return
        }

        $platform = 'pc'
        $gamemode = 'competitive'
        $tags = @{
            player = $snapshot.player_id
            platform = $platform
            gamemode = $gamemode
            hero = $hero.hero_key
        }

        $comparisonFields = @{}
        Add-OwLineField -Fields $comparisonFields -Name 'time_played' -Value $hero.career.game.time_played
        Add-OwLineField -Fields $comparisonFields -Name 'games_played' -Value $hero.career.game.games_played
        Add-OwLineField -Fields $comparisonFields -Name 'games_won' -Value $hero.career.game.games_won
        Add-OwLineField -Fields $comparisonFields -Name 'games_lost' -Value $hero.career.game.games_lost
        Add-OwLineField -Fields $comparisonFields -Name 'win_percentage' -Value $hero.career.game.win_percentage
        Add-OwLineField -Fields $comparisonFields -Name 'eliminations_per_life' -Value $hero.career.average.eliminations_per_life
        Add-OwLineField -Fields $comparisonFields -Name 'eliminations_avg_per_10_min' -Value $hero.career.average.eliminations_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'deaths_avg_per_10_min' -Value $hero.career.average.deaths_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'final_blows_avg_per_10_min' -Value $hero.career.average.final_blows_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'solo_kills_avg_per_10_min' -Value $hero.career.average.solo_kills_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'objective_kills_avg_per_10_min' -Value $hero.career.average.objective_kills_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'objective_time_avg_per_10_min' -Value $hero.career.average.objective_time_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'hero_damage_done_avg_per_10_min' -Value $hero.career.average.hero_damage_done_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'healing_done_avg_per_10_min' -Value $hero.career.average.healing_done_avg_per_10_min
        Add-OwLineField -Fields $comparisonFields -Name 'assists_avg_per_10_min' -Value $hero.career.average.assists_avg_per_10_min

        $comparisonLine = New-OwLine -Measurement 'heroes_comparisons' -Tags $tags -Fields $comparisonFields -Timestamp $timestamp
        if ($comparisonLine) {
            $lines.Add($comparisonLine)
        }

        foreach ($category in @('best', 'average', 'combat', 'game', 'assists', 'match_awards')) {
            if (-not $hero.career.$category) {
                continue
            }

            $fields = @{}
            Add-OwObjectFields -Fields $fields -Source $hero.career.$category
            $categoryLine = New-OwLine -Measurement "career_stats_$category" -Tags $tags -Fields $fields -Timestamp $timestamp
            if ($categoryLine) {
                $lines.Add($categoryLine)
            }
        }

        if ($hero.career.hero_specific) {
            $fields = @{}
            Add-OwObjectFields -Fields $fields -Source $hero.career.hero_specific
            $specificLine = New-OwLine -Measurement (Get-OwHeroSpecificMeasurement -HeroKey $hero.hero_key) -Tags $tags -Fields $fields -Timestamp $timestamp
            if ($specificLine) {
                $lines.Add($specificLine)
            }
        }
    }
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$resolvedOutputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($resolvedOutputPath, [string[]]$lines, $utf8NoBom)

[pscustomobject]@{
    output_path = (Resolve-Path -LiteralPath $OutputPath).Path
    line_count = $lines.Count
    player_snapshot_files = if (Test-Path -LiteralPath $playerSnapshotRoot) { (Get-ChildItem -LiteralPath $playerSnapshotRoot -Recurse -Filter '*.json').Count } else { 0 }
    hero_snapshot_files = if (Test-Path -LiteralPath $heroSnapshotRoot) { (Get-ChildItem -LiteralPath $heroSnapshotRoot -Recurse -Filter '*.json').Count } else { 0 }
} | ConvertTo-Json
