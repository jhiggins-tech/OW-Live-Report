function Get-OwReportExceptionDetail {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $ErrorRecord
    )

    $statusCode = $null
    $body = $null
    $response = $ErrorRecord.Exception.Response

    if ($null -ne $response) {
        try {
            $statusCode = [int]$response.StatusCode
        }
        catch {
        }

        try {
            $stream = $response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                try {
                    $body = $reader.ReadToEnd()
                }
                finally {
                    $reader.Dispose()
                }
            }
        }
        catch {
        }
    }

    if ([string]::IsNullOrWhiteSpace($body)) {
        try {
            $body = $ErrorRecord.ErrorDetails.Message
        }
        catch {
        }
    }

    $parsedBody = $null
    if (-not [string]::IsNullOrWhiteSpace($body)) {
        try {
            $parsedBody = $body | ConvertFrom-Json
        }
        catch {
        }
    }

    return [ordered]@{
        status_code = $statusCode
        body = $body
        message = $ErrorRecord.Exception.Message
        parsed_body = $parsedBody
    }
}

function Format-OwReportProviderErrorMessage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $ErrorDetail
    )

    $parsedBody = Get-OwReportObjectValue -Object $ErrorDetail -Path @('parsed_body')
    $errorNode = Get-OwReportObjectValue -Object $parsedBody -Path @('error')
    $apiErrorText = $null
    $retryAfter = $null
    $nextCheckEpoch = $null

    if ($errorNode -is [string]) {
        $apiErrorText = $errorNode
        $retryAfter = Get-OwReportObjectValue -Object $parsedBody -Path @('retry_after')
        $nextCheckEpoch = Get-OwReportObjectValue -Object $parsedBody -Path @('next_check_at')
    }
    elseif ($null -ne $errorNode) {
        $apiErrorText = Get-OwReportObjectValue -Object $errorNode -Path @('error')
        $retryAfter = Get-OwReportObjectValue -Object $errorNode -Path @('retry_after')
        $nextCheckEpoch = Get-OwReportObjectValue -Object $errorNode -Path @('next_check_at')
    }

    if ($ErrorDetail.status_code -eq 404 -and $apiErrorText -eq 'Player not found') {
        $retryAfter = ConvertTo-OwReportInteger -Value $retryAfter -Default 0
        $nextCheckText = $null
        if ($null -ne $nextCheckEpoch -and $nextCheckEpoch -ne '') {
            try {
                $nextCheckText = [DateTimeOffset]::FromUnixTimeSeconds([Int64]$nextCheckEpoch).ToLocalTime().ToString('yyyy-MM-dd h:mm tt')
            }
            catch {
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($nextCheckText) -and $retryAfter -gt 0) {
            return "OverFast has not indexed this player yet. Try again in about $retryAfter seconds (after $nextCheckText)."
        }

        if (-not [string]::IsNullOrWhiteSpace($nextCheckText)) {
            return "OverFast has not indexed this player yet. Try again after $nextCheckText."
        }

        if ($retryAfter -gt 0) {
            return "OverFast has not indexed this player yet. Try again in about $retryAfter seconds."
        }

        return 'OverFast has not indexed this player yet. Try running the report again in a few minutes.'
    }

    if (-not [string]::IsNullOrWhiteSpace($apiErrorText)) {
        return $apiErrorText
    }

    return $ErrorDetail.message
}

function New-OwReportProviderClient {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    return [ordered]@{
        name = $Config.provider.name
        base_url = $Config.provider.base_url.TrimEnd('/')
        cache_root = Ensure-OwReportDirectory -Path (Join-Path $Config.cache_dir 'http')
        cache_ttl_minutes = $Config.provider.cache_ttl_minutes
        request_delay_ms = $Config.provider.request_delay_ms
        summary_gamemode = $Config.provider.summary_gamemode
        career_gamemode = $Config.provider.career_gamemode
        include_hero_meta_context = $Config.provider.include_hero_meta_context
        fallback_to_stale_cache = $Config.provider.fallback_to_stale_cache
        last_request_at = $null
    }
}

function Invoke-OwReportRequestDelay {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client
    )

    if ($null -eq $Client.last_request_at) {
        return
    }

    $elapsed = ([DateTimeOffset]::Now - [DateTimeOffset]$Client.last_request_at).TotalMilliseconds
    $remaining = $Client.request_delay_ms - $elapsed
    if ($remaining -gt 0) {
        Start-Sleep -Milliseconds ([int][Math]::Ceiling($remaining))
    }
}

function Invoke-OwReportProviderRequest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $url = '{0}{1}' -f $Client.base_url, $RelativePath
    $cacheFile = Join-Path $Client.cache_root ('{0}.json' -f (Get-OwReportSha256 -Text $url))

    if (Test-Path -LiteralPath $cacheFile) {
        $cached = Read-OwReportJsonFile -Path $cacheFile
        if ($null -ne $cached) {
            $cachedAt = [DateTimeOffset]::Parse($cached.requested_at)
            $ageMinutes = ([DateTimeOffset]::Now - $cachedAt).TotalMinutes
            if ($ageMinutes -le $Client.cache_ttl_minutes) {
                return [ordered]@{
                    ok = $true
                    payload = $cached.payload
                    source = 'cache'
                    requested_at = $cached.requested_at
                    warnings = @()
                    error = $null
                }
            }
        }
    }

    Invoke-OwReportRequestDelay -Client $Client

    try {
        $payload = Invoke-RestMethod -Method Get -Uri $url
        $Client.last_request_at = [DateTimeOffset]::Now
        Write-OwReportJsonFile -Path $cacheFile -Value ([ordered]@{
            url = $url
            requested_at = Get-OwReportIsoNow
            payload = $payload
        })

        return [ordered]@{
            ok = $true
            payload = $payload
            source = 'live'
            requested_at = Get-OwReportIsoNow
            warnings = @()
            error = $null
        }
    }
    catch {
        $Client.last_request_at = [DateTimeOffset]::Now
        $detail = Get-OwReportExceptionDetail -ErrorRecord $_

        if ($Client.fallback_to_stale_cache -and (Test-Path -LiteralPath $cacheFile)) {
            $cached = Read-OwReportJsonFile -Path $cacheFile
            if ($null -ne $cached) {
                return [ordered]@{
                    ok = $true
                    payload = $cached.payload
                    source = 'stale-cache'
                    requested_at = $cached.requested_at
                    warnings = @("Using stale cache for $RelativePath because the live request failed.")
                    error = $detail
                }
            }
        }

        return [ordered]@{
            ok = $false
            payload = $null
            source = 'error'
            requested_at = Get-OwReportIsoNow
            warnings = @()
            error = $detail
        }
    }
}

function Get-OwReportFallbackHeroCatalog {
    [CmdletBinding()]
    param()

    return @{
        'ana' = @{ name = 'Ana'; role = 'support' }
        'ashe' = @{ name = 'Ashe'; role = 'damage' }
        'baptiste' = @{ name = 'Baptiste'; role = 'support' }
        'bastion' = @{ name = 'Bastion'; role = 'damage' }
        'brigitte' = @{ name = 'Brigitte'; role = 'support' }
        'cassidy' = @{ name = 'Cassidy'; role = 'damage' }
        'doomfist' = @{ name = 'Doomfist'; role = 'tank' }
        'dva' = @{ name = 'D.Va'; role = 'tank' }
        'echo' = @{ name = 'Echo'; role = 'damage' }
        'freja' = @{ name = 'Freja'; role = 'damage' }
        'genji' = @{ name = 'Genji'; role = 'damage' }
        'hanzo' = @{ name = 'Hanzo'; role = 'damage' }
        'hazard' = @{ name = 'Hazard'; role = 'tank' }
        'illari' = @{ name = 'Illari'; role = 'support' }
        'junker-queen' = @{ name = 'Junker Queen'; role = 'tank' }
        'junkrat' = @{ name = 'Junkrat'; role = 'damage' }
        'juno' = @{ name = 'Juno'; role = 'support' }
        'jetpack-cat' = @{ name = 'Jetpack Cat'; role = 'support' }
        'kiriko' = @{ name = 'Kiriko'; role = 'support' }
        'lifeweaver' = @{ name = 'Lifeweaver'; role = 'support' }
        'lucio' = @{ name = 'Lucio'; role = 'support' }
        'mauga' = @{ name = 'Mauga'; role = 'tank' }
        'mei' = @{ name = 'Mei'; role = 'damage' }
        'mercy' = @{ name = 'Mercy'; role = 'support' }
        'mizuki' = @{ name = 'Mizuki'; role = 'support' }
        'moira' = @{ name = 'Moira'; role = 'support' }
        'orisa' = @{ name = 'Orisa'; role = 'tank' }
        'pharah' = @{ name = 'Pharah'; role = 'damage' }
        'ramattra' = @{ name = 'Ramattra'; role = 'tank' }
        'reaper' = @{ name = 'Reaper'; role = 'damage' }
        'reinhardt' = @{ name = 'Reinhardt'; role = 'tank' }
        'roadhog' = @{ name = 'Roadhog'; role = 'tank' }
        'sigma' = @{ name = 'Sigma'; role = 'tank' }
        'sojourn' = @{ name = 'Sojourn'; role = 'damage' }
        'soldier-76' = @{ name = 'Soldier: 76'; role = 'damage' }
        'sombra' = @{ name = 'Sombra'; role = 'damage' }
        'symmetra' = @{ name = 'Symmetra'; role = 'damage' }
        'torbjorn' = @{ name = 'Torbjorn'; role = 'damage' }
        'tracer' = @{ name = 'Tracer'; role = 'damage' }
        'venture' = @{ name = 'Venture'; role = 'damage' }
        'widowmaker' = @{ name = 'Widowmaker'; role = 'damage' }
        'winston' = @{ name = 'Winston'; role = 'tank' }
        'wrecking-ball' = @{ name = 'Wrecking Ball'; role = 'tank' }
        'zarya' = @{ name = 'Zarya'; role = 'tank' }
        'zenyatta' = @{ name = 'Zenyatta'; role = 'support' }
    }
}

function Get-OwReportHeroCatalog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client
    )

    $fallback = Get-OwReportFallbackHeroCatalog
    $result = Invoke-OwReportProviderRequest -Client $Client -RelativePath '/heroes'
    if (-not $result.ok) {
        return $fallback
    }

    $entries = $result.payload
    $entryResults = Get-OwReportObjectValue -Object $entries -Path @('results')
    if ($null -ne $entryResults) {
        $entries = $entryResults
    }

    $catalog = @{}
    foreach ($entry in @($entries)) {
        $key = $null
        foreach ($candidateProperty in @('key', 'slug', 'id', 'name')) {
            $value = Get-OwReportObjectValue -Object $entry -Path @($candidateProperty)
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $key = $value.ToString().ToLowerInvariant()
                break
            }
        }

        if ([string]::IsNullOrWhiteSpace($key)) {
            continue
        }

        $fallbackEntry = $fallback[$key]
        $catalog[$key] = [ordered]@{
            key = $key
            name = Get-OwReportObjectValue -Object $entry -Path @('name') -Default ($(if ($fallbackEntry) { $fallbackEntry.name } else { ConvertTo-OwReportPrettyHeroName -HeroKey $key }))
            role = Get-OwReportObjectValue -Object $entry -Path @('role') -Default ($(if ($fallbackEntry) { $fallbackEntry.role } else { 'flex' }))
        }
    }

    foreach ($fallbackKey in $fallback.Keys) {
        if (-not $catalog.ContainsKey($fallbackKey)) {
            $catalog[$fallbackKey] = [ordered]@{
                key = $fallbackKey
                name = $fallback[$fallbackKey].name
                role = $fallback[$fallbackKey].role
            }
        }
    }

    return $catalog
}

function Get-OwReportHeroMetaContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client
    )

    if (-not $Client.include_hero_meta_context) {
        return $null
    }

    $result = Invoke-OwReportProviderRequest -Client $Client -RelativePath '/heroes/stats'
    if ($result.ok) {
        return $result.payload
    }

    return $null
}

function Get-OwReportHeroName {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$HeroKey,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    if ($HeroCatalog.ContainsKey($HeroKey)) {
        return $HeroCatalog[$HeroKey].name
    }

    return (ConvertTo-OwReportPrettyHeroName -HeroKey $HeroKey)
}

function Get-OwReportHeroRole {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$HeroKey,
        [Parameter(Mandatory = $true)]
        [hashtable]$HeroCatalog
    )

    if ($HeroCatalog.ContainsKey($HeroKey)) {
        return $HeroCatalog[$HeroKey].role
    }

    return 'flex'
}

function Search-OwReportOverFastPlayers {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [string]$Query
    )

    $encoded = [System.Uri]::EscapeDataString($Query)
    $result = Invoke-OwReportProviderRequest -Client $Client -RelativePath ('/players?name={0}' -f $encoded)
    if (-not $result.ok) {
        return @()
    }

    return @($result.payload.results)
}

function Resolve-OwReportSearchCandidateId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Candidate
    )

    if ($Candidate -is [string]) {
        return $Candidate
    }

    foreach ($propertyName in @('player_id', 'battle_tag', 'battletag', 'id', 'name')) {
        $value = Get-OwReportObjectValue -Object $Candidate -Path @($propertyName)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }

    return $null
}

function Resolve-OwReportPlayerId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerConfig
    )

    if (-not [string]::IsNullOrWhiteSpace($PlayerConfig.player_id)) {
        return $PlayerConfig.player_id
    }

    if (-not [string]::IsNullOrWhiteSpace($PlayerConfig.search_term)) {
        $results = Search-OwReportOverFastPlayers -Client $Client -Query $PlayerConfig.search_term
        foreach ($candidate in $results) {
            $playerId = Resolve-OwReportSearchCandidateId -Candidate $candidate
            if (-not [string]::IsNullOrWhiteSpace($playerId)) {
                return (ConvertTo-NormalizedBattleTag -BattleTag $playerId)
            }
        }
    }

    return $null
}

function Get-OwReportPlayerBundle {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Client,
        [Parameter(Mandatory = $true)]
        [hashtable]$PlayerConfig
    )

    $warnings = @()
    $resolvedPlayerId = Resolve-OwReportPlayerId -Client $Client -PlayerConfig $PlayerConfig
    if ([string]::IsNullOrWhiteSpace($resolvedPlayerId)) {
        return [ordered]@{
            success = $false
            player_id = $null
            summary = $null
            stats_summary = $null
            stats_career = $null
            raw_payloads = $null
            warnings = @('Unable to resolve player ID.')
            errors = @('Unable to resolve player ID.')
        }
    }

    $summaryResult = Invoke-OwReportProviderRequest -Client $Client -RelativePath ('/players/{0}/summary' -f $resolvedPlayerId)
    if (-not $summaryResult.ok -and $PlayerConfig.discover_with_search -and -not [string]::IsNullOrWhiteSpace($PlayerConfig.battle_tag)) {
        $username = $PlayerConfig.battle_tag.Split('#')[0]
        if (-not [string]::IsNullOrWhiteSpace($username)) {
            $searchResults = Search-OwReportOverFastPlayers -Client $Client -Query $username
            foreach ($candidate in $searchResults) {
                $candidateId = Resolve-OwReportSearchCandidateId -Candidate $candidate
                if (-not [string]::IsNullOrWhiteSpace($candidateId)) {
                    $resolvedPlayerId = ConvertTo-NormalizedBattleTag -BattleTag $candidateId
                    $summaryResult = Invoke-OwReportProviderRequest -Client $Client -RelativePath ('/players/{0}/summary' -f $resolvedPlayerId)
                    if ($summaryResult.ok) {
                        $warnings += 'Player ID resolved via search fallback.'
                        break
                    }
                }
            }
        }
    }

    if (-not $summaryResult.ok) {
        return [ordered]@{
            success = $false
            player_id = $resolvedPlayerId
            summary = $null
            stats_summary = $null
            stats_career = $null
            raw_payloads = [ordered]@{
                summary = $summaryResult
            }
            warnings = $warnings
            errors = @("Summary request failed: $(Format-OwReportProviderErrorMessage -ErrorDetail $summaryResult.error)")
        }
    }

    $warnings += @($summaryResult.warnings)
    $summaryRelativePath = '/players/{0}/stats/summary?gamemode={1}' -f $resolvedPlayerId, ([System.Uri]::EscapeDataString($Client.summary_gamemode))
    $statsSummaryResult = Invoke-OwReportProviderRequest -Client $Client -RelativePath $summaryRelativePath
    if ($statsSummaryResult.ok) {
        $warnings += @($statsSummaryResult.warnings)
    }
    else {
        $warnings += "Stats summary unavailable: $(Format-OwReportProviderErrorMessage -ErrorDetail $statsSummaryResult.error)"
    }

    $careerRelativePath = '/players/{0}/stats/career?gamemode={1}' -f $resolvedPlayerId, ([System.Uri]::EscapeDataString($Client.career_gamemode))
    $careerResult = Invoke-OwReportProviderRequest -Client $Client -RelativePath $careerRelativePath
    if ($careerResult.ok) {
        $warnings += @($careerResult.warnings)
    }
    else {
        $warnings += "Career stats unavailable: $(Format-OwReportProviderErrorMessage -ErrorDetail $careerResult.error)"
    }

    return [ordered]@{
        success = $true
        player_id = $resolvedPlayerId
        summary = $summaryResult.payload
        stats_summary = $(if ($statsSummaryResult.ok) { $statsSummaryResult.payload } else { $null })
        stats_career = $(if ($careerResult.ok) { $careerResult.payload } else { $null })
        raw_payloads = [ordered]@{
            summary = $summaryResult.payload
            stats_summary = $statsSummaryResult.payload
            stats_career = $careerResult.payload
        }
        warnings = @($warnings | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
        errors = @()
    }
}
