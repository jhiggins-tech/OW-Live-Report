function Invoke-OwReportRun {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigPath,
        [string]$ProjectRoot = (Get-Location).Path,
        [string]$Notes = '',
        [ValidateSet('mostly_narrow', 'mixed', 'mostly_wide')]
        [string]$WideMatchContext = 'mixed'
    )

    $config = Get-OwReportConfig -ConfigPath $ConfigPath -ProjectRoot $ProjectRoot
    Ensure-OwReportDirectory -Path $config.output_dir | Out-Null
    Ensure-OwReportDirectory -Path $config.logs_dir | Out-Null
    Ensure-OwReportDirectory -Path $config.cache_dir | Out-Null
    $runContext = New-OwReportRunContext -Config $config -Notes $Notes -WideMatchContext $WideMatchContext
    Write-OwReportLog -RunContext $runContext -Message ("Starting run {0} for team {1}" -f $runContext.run_id, $config.team_name)
    $providerName = (Get-OwReportObjectValue -Object $config -Path @('provider', 'name') -Default 'overfast').ToString().Trim().ToLowerInvariant()

    if ($providerName -eq 'influxdb') {
        $publishedState = Read-OwReportInfluxPublishedState
        $dataset = Get-OwReportInfluxDataset -Config $config -RunContext $runContext -PublishedState $publishedState
        $siteModel = Get-OwReportTeamAnalytics `
            -Config $config `
            -RunContext $runContext `
            -HeroCatalog $dataset.hero_catalog `
            -Snapshots $dataset.snapshots `
            -RunRecords $dataset.run_records
        $published = Publish-OwReportSite `
            -Config $config `
            -SiteModel $siteModel `
            -RunContext $runContext `
            -PublishedState ([ordered]@{
                snapshots = @($dataset.snapshots)
                run_records = @($dataset.run_records)
            })
        $reportIndex = Get-OwReportObjectValue -Object $published -Path @('docs_index') -Default $published.latest_index
        Write-OwReportLog -RunContext $runContext -Message ("Finished run {0}. Latest report: {1}" -f $runContext.run_id, $reportIndex)

        $latestDatasetRun = @($dataset.run_records | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '' } | Select-Object -Last 1)
        $latestSuccessfulPlayers = 0
        if ($latestDatasetRun.Count -gt 0) {
            $latestSuccessfulPlayers = ConvertTo-OwReportInteger -Value (Get-OwReportObjectValue -Object $latestDatasetRun[0] -Path @('successful_players') -Default 0)
        }
        elseif ($siteModel.meta.player_count_with_history -gt 0) {
            $latestSuccessfulPlayers = $siteModel.meta.player_count_with_history
        }

        return [ordered]@{
            run_id = $runContext.run_id
            latest_index = $reportIndex
            successful_players = $latestSuccessfulPlayers
            failed_players = @($dataset.failed_players)
        }
    }

    $storage = Initialize-OwReportStorage -Config $config
    $provider = New-OwReportProviderClient -Config $config
    $heroCatalog = Get-OwReportHeroCatalog -Client $provider
    $heroMetaContext = Get-OwReportHeroMetaContext -Client $provider

    $successfulPlayers = 0
    $failedPlayers = @()
    $playerWarnings = @()

    foreach ($player in $config.players) {
        Write-OwReportLog -RunContext $runContext -Message ("Fetching {0} ({1})" -f $player.display_name, $player.player_id)
        $bundle = Get-OwReportPlayerBundle -Client $provider -PlayerConfig $player
        if (-not $bundle.success) {
            $failedPlayers += [ordered]@{
                display_name = $player.display_name
                player_id = $player.player_id
                errors = $bundle.errors
            }
            Write-OwReportLog -RunContext $runContext -Message ("Failed {0}: {1}" -f $player.display_name, ($bundle.errors -join '; ')) -Level 'WARN'
            continue
        }

        $snapshot = ConvertTo-OwReportPlayerSnapshot -PlayerConfig $player -RunContext $runContext -Bundle $bundle -HeroCatalog $heroCatalog
        Save-OwReportPlayerRecord -Storage $storage -Snapshot $snapshot
        Save-OwReportPlayerSnapshot -Storage $storage -Snapshot $snapshot
        Save-OwReportPlayerHeroSnapshots -Storage $storage -Snapshot $snapshot

        $successfulPlayers += 1
        if ($snapshot.warnings.Count -gt 0) {
            $playerWarnings += @($snapshot.warnings | ForEach-Object {
                [ordered]@{
                    player = $player.display_name
                    message = $_
                }
            })
        }
    }

    $runRecord = [ordered]@{
        run_id = $runContext.run_id
        timestamp = $runContext.timestamp
        started_at = $runContext.started_at
        completed_at = Get-OwReportIsoNow
        notes = $runContext.notes
        wide_match_context = $runContext.wide_match_context
        team_name = $config.team_name
        provider = $config.provider.name
        successful_players = $successfulPlayers
        failed_players = $failedPlayers
        warnings = $playerWarnings
        hero_meta_context = $heroMetaContext
    }
    Save-OwReportRunRecord -Storage $storage -RunRecord $runRecord

    $siteModel = Get-OwReportTeamAnalytics -Config $config -Storage $storage -RunContext $runContext -HeroCatalog $heroCatalog
    $published = Publish-OwReportSite -Config $config -SiteModel $siteModel -RunContext $runContext
    $reportIndex = Get-OwReportObjectValue -Object $published -Path @('docs_index') -Default $published.latest_index

    $runRecord.output = [ordered]@{
        run_output_dir = $published.run_output_dir
        latest_output_dir = $published.latest_output_dir
        latest_index = $reportIndex
        docs_output_dir = Get-OwReportObjectValue -Object $published -Path @('docs_output_dir')
        docs_index = Get-OwReportObjectValue -Object $published -Path @('docs_index')
    }
    Save-OwReportRunRecord -Storage $storage -RunRecord $runRecord
    Write-OwReportLog -RunContext $runContext -Message ("Finished run {0}. Latest report: {1}" -f $runContext.run_id, $reportIndex)

    return [ordered]@{
        run_id = $runContext.run_id
        latest_index = $reportIndex
        successful_players = $successfulPlayers
        failed_players = $failedPlayers
    }
}
