function Save-OwReportPlayerRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Storage,
        [Parameter(Mandatory = $true)]
        [hashtable]$Snapshot
    )

    $playerFile = Join-Path $Storage.players_dir ('{0}.json' -f $Snapshot.player_slug)
    $existing = Read-OwReportJsonFile -Path $playerFile
    $firstSeen = $(if ($existing) { $existing.first_seen_at } else { $Snapshot.captured_at })
    Write-OwReportJsonFile -Path $playerFile -Value ([ordered]@{
        player_id = $Snapshot.player_id
        player_slug = $Snapshot.player_slug
        display_name = $Snapshot.display_name
        battle_tag = $Snapshot.battle_tag
        provider = $Snapshot.provider
        first_seen_at = $firstSeen
        last_seen_at = $Snapshot.captured_at
        current_profile = $Snapshot.profile
        current_preferred_role = $Snapshot.normalized.preferred_role
    })
}

function Save-OwReportPlayerSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Storage,
        [Parameter(Mandatory = $true)]
        [hashtable]$Snapshot
    )

    $playerDir = Ensure-OwReportDirectory -Path (Join-Path $Storage.player_snapshots_dir $Snapshot.player_slug)
    $snapshotFile = Join-Path $playerDir ('{0}.json' -f $Snapshot.run_id)
    Write-OwReportJsonFile -Path $snapshotFile -Value $Snapshot
}

function Save-OwReportPlayerHeroSnapshots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Storage,
        [Parameter(Mandatory = $true)]
        [hashtable]$Snapshot
    )

    $playerDir = Ensure-OwReportDirectory -Path (Join-Path $Storage.player_hero_snapshots_dir $Snapshot.player_slug)
    foreach ($hero in @($Snapshot.heroes)) {
        $heroFile = Join-Path $playerDir ('{0}-{1}.json' -f $Snapshot.run_id, $hero.hero_key)
        Write-OwReportJsonFile -Path $heroFile -Value ([ordered]@{
            hero_snapshot_id = '{0}-{1}-{2}' -f $Snapshot.run_id, $Snapshot.player_slug, $hero.hero_key
            run_id = $Snapshot.run_id
            captured_at = $Snapshot.captured_at
            player_id = $Snapshot.player_id
            player_slug = $Snapshot.player_slug
            display_name = $Snapshot.display_name
            hero = $hero
            wide_match_context = $Snapshot.wide_match_context
        })
    }
}

function Save-OwReportRunRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Storage,
        [Parameter(Mandatory = $true)]
        [hashtable]$RunRecord
    )

    $runFile = Join-Path $Storage.report_runs_dir ('{0}.json' -f $RunRecord.run_id)
    Write-OwReportJsonFile -Path $runFile -Value $RunRecord
}

function Get-OwReportSnapshotsFromStorage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Storage
    )

    $snapshots = @()
    if (-not (Test-Path -LiteralPath $Storage.player_snapshots_dir)) {
        return @()
    }

    foreach ($file in Get-ChildItem -LiteralPath $Storage.player_snapshots_dir -Recurse -Filter '*.json' | Sort-Object FullName) {
        $snapshots += Read-OwReportJsonFile -Path $file.FullName
    }

    return $snapshots
}

function Get-OwReportRunRecordsFromStorage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Storage
    )

    $runRecords = @()
    if (-not (Test-Path -LiteralPath $Storage.report_runs_dir)) {
        return @()
    }

    foreach ($file in Get-ChildItem -LiteralPath $Storage.report_runs_dir -Filter '*.json' | Sort-Object FullName) {
        $runRecords += Read-OwReportJsonFile -Path $file.FullName
    }

    return @($runRecords | Sort-Object { Get-OwReportObjectValue -Object $_ -Path @('timestamp') -Default '' })
}
