Set-StrictMode -Version 3.0

$script:OwReportTextInfo = (Get-Culture).TextInfo
$script:OwReportProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function ConvertTo-NormalizedBattleTag {
    [CmdletBinding()]
    param(
        [string]$BattleTag
    )

    if ([string]::IsNullOrWhiteSpace($BattleTag)) {
        return $null
    }

    return ($BattleTag.Trim() -replace '#', '-')
}

function ConvertTo-Slug {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $slug = $Text.Trim().ToLowerInvariant()
    $slug = $slug -replace '#', '-'
    $slug = $slug -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')

    if ([string]::IsNullOrWhiteSpace($slug)) {
        return 'player'
    }

    return $slug
}

function ConvertTo-OwReportRoleKey {
    [CmdletBinding()]
    param(
        [string]$Role
    )

    if ([string]::IsNullOrWhiteSpace($Role)) {
        return $null
    }

    switch ($Role.Trim().ToLowerInvariant()) {
        'dps' { return 'damage' }
        'damage' { return 'damage' }
        'support' { return 'support' }
        'tank' { return 'tank' }
        default { return $null }
    }
}

function ConvertTo-OwReportHeroKey {
    [CmdletBinding()]
    param(
        [string]$Hero
    )

    if ([string]::IsNullOrWhiteSpace($Hero)) {
        return $null
    }

    $normalized = $Hero.Trim().ToLowerInvariant()
    switch ($normalized) {
        'd.va' { return 'dva' }
        'd va' { return 'dva' }
        'soldier 76' { return 'soldier-76' }
        'soldier: 76' { return 'soldier-76' }
        'junker queen' { return 'junker-queen' }
        'wrecking ball' { return 'wrecking-ball' }
        default {
            $key = $normalized -replace '[^a-z0-9]+', '-'
            $key = $key.Trim('-')
            if ([string]::IsNullOrWhiteSpace($key)) {
                return $null
            }

            return $key
        }
    }
}

function Normalize-OwReportHeroKeyList {
    [CmdletBinding()]
    param(
        [object[]]$Heroes
    )

    $keys = @()
    foreach ($hero in @($Heroes)) {
        if ($null -eq $hero) {
            continue
        }

        $candidate = $hero
        if (-not ($hero -is [string])) {
            $candidate = Get-OwReportObjectValue -Object $hero -Path @('hero')
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                $candidate = Get-OwReportObjectValue -Object $hero -Path @('hero_key')
            }
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                $candidate = Get-OwReportObjectValue -Object $hero -Path @('name')
            }
        }

        $key = ConvertTo-OwReportHeroKey -Hero $candidate
        if (-not [string]::IsNullOrWhiteSpace($key)) {
            $keys += $key
        }
    }

    return @($keys | Select-Object -Unique)
}

function Get-OwReportPlayerIdentifierKeys {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Player
    )

    $identifiers = @()
    foreach ($candidate in @(
        (Get-OwReportObjectValue -Object $Player -Path @('battle_tag')),
        (Get-OwReportObjectValue -Object $Player -Path @('player_id')),
        (Get-OwReportObjectValue -Object $Player -Path @('display_name')),
        (Get-OwReportObjectValue -Object $Player -Path @('slug'))
    )) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $identifiers += $candidate.Trim().ToLowerInvariant()
        if ($candidate.Contains('#')) {
            $normalizedBattleTag = ConvertTo-NormalizedBattleTag -BattleTag $candidate
            if (-not [string]::IsNullOrWhiteSpace($normalizedBattleTag)) {
                $identifiers += $normalizedBattleTag.ToLowerInvariant()
            }
        }
    }

    return @($identifiers | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Merge-OwReportPlayerOverride {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerEntry,
        [Parameter(Mandatory = $true)]
        $Override
    )

    $existingHiddenHeroes = @((Get-OwReportObjectValue -Object $PlayerEntry -Path @('hidden_heroes') -Default @()))
    $overrideHiddenHeroes = @((Get-OwReportObjectValue -Object $Override -Path @('hidden_heroes') -Default @()))
    $PlayerEntry.hidden_heroes = Normalize-OwReportHeroKeyList -Heroes ($existingHiddenHeroes + $overrideHiddenHeroes)

    $lockedRole = Get-OwReportObjectValue -Object $Override -Path @('locked_role')
    if ([string]::IsNullOrWhiteSpace($lockedRole)) {
        $lockedRole = Get-OwReportObjectValue -Object $Override -Path @('role_lock')
    }
    if (-not [string]::IsNullOrWhiteSpace($lockedRole)) {
        $PlayerEntry.locked_role = ConvertTo-OwReportRoleKey -Role $lockedRole
    }

    return $PlayerEntry
}

function Resolve-OwReportAbsolutePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Ensure-OwReportDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $absolutePath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $absolutePath)) {
        New-Item -ItemType Directory -Path $absolutePath -Force | Out-Null
    }

    return $absolutePath
}

function Get-OwReportIsoNow {
    [CmdletBinding()]
    param()

    return ([DateTimeOffset]::Now.ToString('o'))
}

function ConvertTo-OwReportNumber {
    [CmdletBinding()]
    param(
        $Value,
        [double]$Default = 0
    )

    if ($null -eq $Value -or $Value -eq '') {
        return $Default
    }

    try {
        return [double]$Value
    }
    catch {
        return $Default
    }
}

function ConvertTo-OwReportInteger {
    [CmdletBinding()]
    param(
        $Value,
        [int]$Default = 0
    )

    if ($null -eq $Value -or $Value -eq '') {
        return $Default
    }

    try {
        return [int]$Value
    }
    catch {
        return $Default
    }
}

function Get-OwReportAverage {
    [CmdletBinding()]
    param(
        [object[]]$Values
    )

    if ($null -eq $Values) {
        return $null
    }

    $numbers = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ })
    if ($numbers.Count -eq 0) {
        return $null
    }

    return (($numbers | Measure-Object -Average).Average)
}

function Get-OwReportStandardDeviation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Values
    )

    $numbers = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ })
    if ($numbers.Count -lt 2) {
        return 0
    }

    $mean = Get-OwReportAverage -Values $numbers
    $variance = (($numbers | ForEach-Object { [Math]::Pow($_ - $mean, 2) } | Measure-Object -Average).Average)
    return [Math]::Sqrt($variance)
}

function Get-OwReportObjectValue {
    [CmdletBinding()]
    param(
        $Object,
        [Parameter(Mandatory = $true)]
        [string[]]$Path,
        $Default = $null
    )

    $current = $Object
    foreach ($segment in $Path) {
        if ($null -eq $current) {
            return $Default
        }

        if ($current -is [System.Collections.IDictionary]) {
            if ($current.Contains($segment)) {
                $current = $current[$segment]
                continue
            }

            return $Default
        }

        $property = $current.PSObject.Properties[$segment]
        if ($null -eq $property) {
            return $Default
        }

        $current = $property.Value
    }

    if ($null -eq $current) {
        return $Default
    }

    return $current
}

function Get-OwReportObjectPropertyNames {
    [CmdletBinding()]
    param(
        $Object
    )

    if ($null -eq $Object) {
        return @()
    }

    if ($Object -is [System.Collections.IDictionary]) {
        return @($Object.Keys)
    }

    return @($Object.PSObject.Properties | Select-Object -ExpandProperty Name)
}

function ConvertTo-OwReportPrettyHeroName {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$HeroKey
    )

    switch ($HeroKey) {
        'dva' { return 'D.Va' }
        'soldier-76' { return 'Soldier: 76' }
        'wrecking-ball' { return 'Wrecking Ball' }
        'junker-queen' { return 'Junker Queen' }
        'jetpack-cat' { return 'Jetpack Cat' }
        default { return $script:OwReportTextInfo.ToTitleCase(($HeroKey -replace '-', ' ')) }
    }
}

function Get-OwReportSha256 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Write-OwReportTextFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Content
    )

    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        Ensure-OwReportDirectory -Path $directory | Out-Null
    }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Write-OwReportJsonFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        $Value,
        [int]$Depth = 100,
        [switch]$Compress
    )

    $json = if ($Compress) {
        $Value | ConvertTo-Json -Depth $Depth -Compress
    }
    else {
        $Value | ConvertTo-Json -Depth $Depth
    }
    Write-OwReportTextFile -Path $Path -Content $json
}

function Read-OwReportJsonFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function ConvertTo-OwReportHtmlSafeJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Value
    )

    $json = $Value | ConvertTo-Json -Depth 100 -Compress
    return ($json -replace '</', '<\/')
}

function Write-OwReportLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$RunContext,
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string]$Level = 'INFO'
    )

    $timestamp = [DateTimeOffset]::Now.ToString('u')
    $line = "[{0}][{1}] {2}" -f $timestamp, $Level, $Message
    Add-Content -Path $RunContext.log_path -Value $line -Encoding UTF8
    Write-Host $line
}

function New-OwReportPlayerEntry {
    [CmdletBinding()]
    param(
        [string]$DisplayName,
        [string]$BattleTag,
        [string]$Notes = '',
        [string]$SearchTerm = '',
        [bool]$DiscoverWithSearch = $false,
        [object[]]$HiddenHeroes = @(),
        [string]$LockedRole = ''
    )

    $playerId = ConvertTo-NormalizedBattleTag -BattleTag $BattleTag
    $resolvedDisplayName = $DisplayName
    if ([string]::IsNullOrWhiteSpace($resolvedDisplayName)) {
        if (-not [string]::IsNullOrWhiteSpace($BattleTag) -and $BattleTag.Contains('#')) {
            $resolvedDisplayName = $BattleTag.Split('#')[0]
        }
        else {
            $resolvedDisplayName = $playerId
        }
    }

    return [ordered]@{
        display_name = $resolvedDisplayName
        battle_tag = $BattleTag
        player_id = $playerId
        slug = ConvertTo-Slug -Text $resolvedDisplayName
        notes = $Notes
        search_term = $SearchTerm
        discover_with_search = $DiscoverWithSearch
        hidden_heroes = Normalize-OwReportHeroKeyList -Heroes $HiddenHeroes
        locked_role = ConvertTo-OwReportRoleKey -Role $LockedRole
    }
}

function Get-OwReportPlayersFromRosterFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$RosterFilePath
    )

    if (-not (Test-Path -LiteralPath $RosterFilePath)) {
        throw "Roster file not found: $RosterFilePath"
    }

    $players = @()
    $lineNumber = 0
    foreach ($rawLine in Get-Content -LiteralPath $RosterFilePath) {
        $lineNumber += 1
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or $line.StartsWith(';')) {
            continue
        }

        $parts = @($line.Split('|') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
        if ($parts.Count -eq 0) {
            continue
        }

        if ($parts.Count -eq 1) {
            $players += New-OwReportPlayerEntry -BattleTag $parts[0]
            continue
        }

        if ($parts.Count -eq 2) {
            $players += New-OwReportPlayerEntry -DisplayName $parts[0] -BattleTag $parts[1]
            continue
        }

        $players += New-OwReportPlayerEntry -DisplayName $parts[0] -BattleTag $parts[1] -Notes $parts[2]
    }

    return $players
}

function Get-OwReportConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigPath,
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    $absoluteConfigPath = Resolve-OwReportAbsolutePath -BasePath $ProjectRoot -Path $ConfigPath
    if (-not (Test-Path -LiteralPath $absoluteConfigPath)) {
        throw "Config file not found: $absoluteConfigPath"
    }

    $rawConfig = Get-Content -LiteralPath $absoluteConfigPath -Raw | ConvertFrom-Json
    $players = @()
    $rosterFileRelativePath = Get-OwReportObjectValue -Object $rawConfig -Path @('roster_file') -Default ''
    $rosterFilePath = $null
    if (-not [string]::IsNullOrWhiteSpace($rosterFileRelativePath)) {
        $rosterFilePath = Resolve-OwReportAbsolutePath -BasePath $ProjectRoot -Path $rosterFileRelativePath
        $players += @(Get-OwReportPlayersFromRosterFile -RosterFilePath $rosterFilePath)
    }

    foreach ($player in @($rawConfig.players)) {
        $players += New-OwReportPlayerEntry `
            -DisplayName (Get-OwReportObjectValue -Object $player -Path @('display_name')) `
            -BattleTag (Get-OwReportObjectValue -Object $player -Path @('battle_tag')) `
            -Notes (Get-OwReportObjectValue -Object $player -Path @('notes') -Default '') `
            -SearchTerm (Get-OwReportObjectValue -Object $player -Path @('search_term') -Default '') `
            -DiscoverWithSearch ([bool](Get-OwReportObjectValue -Object $player -Path @('discover_with_search') -Default $false)) `
            -HiddenHeroes @((Get-OwReportObjectValue -Object $player -Path @('hidden_heroes') -Default @())) `
            -LockedRole (Get-OwReportObjectValue -Object $player -Path @('locked_role') -Default '')
    }

    if ($players.Count -gt 0) {
        $playerLookup = @{}
        for ($index = 0; $index -lt $players.Count; $index += 1) {
            foreach ($key in Get-OwReportPlayerIdentifierKeys -Player $players[$index]) {
                if (-not $playerLookup.ContainsKey($key)) {
                    $playerLookup[$key] = $index
                }
            }
        }

        foreach ($override in @($rawConfig.player_overrides)) {
            $overrideCandidates = @(
                (Get-OwReportObjectValue -Object $override -Path @('player')),
                (Get-OwReportObjectValue -Object $override -Path @('battle_tag')),
                (Get-OwReportObjectValue -Object $override -Path @('player_id')),
                (Get-OwReportObjectValue -Object $override -Path @('display_name')),
                (Get-OwReportObjectValue -Object $override -Path @('slug'))
            )

            $matchedIndex = $null
            foreach ($candidate in $overrideCandidates) {
                if ([string]::IsNullOrWhiteSpace($candidate)) {
                    continue
                }

                $lookupKeys = @($candidate.Trim().ToLowerInvariant())
                if ($candidate.Contains('#')) {
                    $normalizedCandidate = ConvertTo-NormalizedBattleTag -BattleTag $candidate
                    if (-not [string]::IsNullOrWhiteSpace($normalizedCandidate)) {
                        $lookupKeys += $normalizedCandidate.ToLowerInvariant()
                    }
                }

                foreach ($lookupKey in @($lookupKeys | Select-Object -Unique)) {
                    if ($playerLookup.ContainsKey($lookupKey)) {
                        $matchedIndex = $playerLookup[$lookupKey]
                        break
                    }
                }

                if ($null -ne $matchedIndex) {
                    break
                }
            }

            if ($null -eq $matchedIndex) {
                continue
            }

            $players[$matchedIndex] = Merge-OwReportPlayerOverride -PlayerEntry $players[$matchedIndex] -Override $override
        }
    }

    return [ordered]@{
        team_name = Get-OwReportObjectValue -Object $rawConfig -Path @('team_name') -Default 'Overwatch Team Report'
        site_subtitle = Get-OwReportObjectValue -Object $rawConfig -Path @('site_subtitle') -Default 'Competitive snapshot analytics with team and player drill-downs.'
        config_path = $absoluteConfigPath
        roster_file = $rosterFilePath
        project_root = $ProjectRoot
        storage_dir = Resolve-OwReportAbsolutePath -BasePath $ProjectRoot -Path (Get-OwReportObjectValue -Object $rawConfig -Path @('storage_dir') -Default 'data')
        output_dir = Resolve-OwReportAbsolutePath -BasePath $ProjectRoot -Path (Get-OwReportObjectValue -Object $rawConfig -Path @('output_dir') -Default 'output')
        logs_dir = Resolve-OwReportAbsolutePath -BasePath $ProjectRoot -Path (Get-OwReportObjectValue -Object $rawConfig -Path @('logs_dir') -Default 'logs')
        cache_dir = Resolve-OwReportAbsolutePath -BasePath $ProjectRoot -Path (Get-OwReportObjectValue -Object $rawConfig -Path @('cache_dir') -Default 'cache')
        provider = [ordered]@{
            name = Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'name') -Default 'overfast'
            base_url = Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'base_url') -Default 'https://overfast-api.tekrop.fr'
            query_url = Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'query_url') -Default 'http://134.199.184.203:8183/query'
            database = Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'database') -Default 'ow_stats_telegraf'
            cache_ttl_minutes = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'cache_ttl_minutes') -Default 30) -Default 30
            request_delay_ms = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'request_delay_ms') -Default 450) -Default 450
            summary_gamemode = Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'summary_gamemode') -Default 'competitive'
            career_gamemode = Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'career_gamemode') -Default 'competitive'
            include_hero_meta_context = [bool](Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'include_hero_meta_context') -Default $false)
            fallback_to_stale_cache = [bool](Get-OwReportObjectValue -Object $rawConfig -Path @('provider', 'fallback_to_stale_cache') -Default $true)
        }
        ui = [ordered]@{
            top_hero_count = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $rawConfig -Path @('ui', 'top_hero_count') -Default 6) -Default 6
        }
        players = $players
    }
}

function New-OwReportRunContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config,
        [string]$Notes = '',
        [ValidateSet('mostly_narrow', 'mixed', 'mostly_wide')]
        [string]$WideMatchContext = 'mixed'
    )

    $timestamp = [DateTimeOffset]::Now
    $runId = $timestamp.ToString('yyyyMMdd-HHmmss')
    $logPath = Join-Path $Config.logs_dir ("run-{0}.log" -f $runId)
    Write-OwReportTextFile -Path $logPath -Content ''

    return [ordered]@{
        run_id = $runId
        timestamp = $timestamp.ToString('o')
        notes = $Notes
        wide_match_context = $WideMatchContext
        log_path = $logPath
        started_at = $timestamp.ToString('o')
    }
}

function Initialize-OwReportStorage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    $storageRoot = Ensure-OwReportDirectory -Path $Config.storage_dir
    return [ordered]@{
        root = $storageRoot
        report_runs_dir = Ensure-OwReportDirectory -Path (Join-Path $storageRoot 'report-runs')
        players_dir = Ensure-OwReportDirectory -Path (Join-Path $storageRoot 'players')
        player_snapshots_dir = Ensure-OwReportDirectory -Path (Join-Path $storageRoot 'player-snapshots')
        player_hero_snapshots_dir = Ensure-OwReportDirectory -Path (Join-Path $storageRoot 'player-hero-snapshots')
    }
}
