[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,
    [string]$ConfigPath = '.\config\team.sample.json'
)

$projectRoot = Split-Path -Parent $PSCommandPath
$modulePath = Join-Path $projectRoot 'src\OwReport.psm1'
Import-Module $modulePath -Force
$owReportModule = Get-Module OwReport

if (-not $PSCmdlet.ShouldProcess($RunId, 'Remove snapshot data and rebuild the latest report')) {
    return
}

$result = & $owReportModule {
    param($InnerRunId, $InnerConfigPath, $InnerProjectRoot)

    $config = Get-OwReportConfig -ConfigPath $InnerConfigPath -ProjectRoot $InnerProjectRoot
    $storage = Initialize-OwReportStorage -Config $config

    $deletedRunRecord = $false
    $deletedSnapshotFiles = 0
    $deletedHeroSnapshotFiles = 0
    $deletedOutputRun = $false

    $runRecordFile = Join-Path $storage.report_runs_dir ('{0}.json' -f $InnerRunId)
    if (Test-Path -LiteralPath $runRecordFile) {
        Remove-Item -LiteralPath $runRecordFile -Force
        $deletedRunRecord = $true
    }

    foreach ($file in @(Get-ChildItem -LiteralPath $storage.player_snapshots_dir -Recurse -Filter ('{0}.json' -f $InnerRunId) -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $file.FullName -Force
        $deletedSnapshotFiles += 1
    }

    foreach ($file in @(Get-ChildItem -LiteralPath $storage.player_hero_snapshots_dir -Recurse -Filter ('{0}-*.json' -f $InnerRunId) -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $file.FullName -Force
        $deletedHeroSnapshotFiles += 1
    }

    $runOutputDir = Join-Path $config.output_dir ('runs\{0}' -f $InnerRunId)
    if (Test-Path -LiteralPath $runOutputDir) {
        Remove-Item -LiteralPath $runOutputDir -Recurse -Force
        $deletedOutputRun = $true
    }

    $remainingRuns = @((Get-OwReportRunRecordsFromStorage -Storage $storage) | Sort-Object timestamp)
    $latestOutputDir = Join-Path $config.output_dir 'latest'
    $rebuiltLatestIndex = $null

    if ($remainingRuns.Count -gt 0) {
        $latestRun = $remainingRuns[-1]
        $runContext = [ordered]@{
            run_id = $latestRun.run_id
            timestamp = $latestRun.timestamp
            notes = (Get-OwReportObjectValue -Object $latestRun -Path @('notes') -Default '')
            wide_match_context = (Get-OwReportObjectValue -Object $latestRun -Path @('wide_match_context') -Default 'mixed')
        }

        $siteModel = Get-OwReportTeamAnalytics -Config $config -Storage $storage -RunContext $runContext -HeroCatalog @{}
        $published = Publish-OwReportSite -Config $config -SiteModel $siteModel -RunContext $runContext
        $rebuiltLatestIndex = $published.latest_index
    }
    elseif (Test-Path -LiteralPath $latestOutputDir) {
        Remove-Item -LiteralPath $latestOutputDir -Recurse -Force
    }

    return [ordered]@{
        run_id = $InnerRunId
        deleted_run_record = $deletedRunRecord
        deleted_snapshot_files = $deletedSnapshotFiles
        deleted_hero_snapshot_files = $deletedHeroSnapshotFiles
        deleted_output_run = $deletedOutputRun
        remaining_runs = $remainingRuns.Count
        latest_index = $rebuiltLatestIndex
    }
} $RunId $ConfigPath $projectRoot

Write-Host ("Removed snapshot {0}" -f $result.run_id)
Write-Host ("Run record deleted: {0}" -f $result.deleted_run_record)
Write-Host ("Player snapshot files deleted: {0}" -f $result.deleted_snapshot_files)
Write-Host ("Hero snapshot files deleted: {0}" -f $result.deleted_hero_snapshot_files)
Write-Host ("Remaining runs: {0}" -f $result.remaining_runs)
if ($result.latest_index) {
    Write-Host ("Latest report rebuilt: {0}" -f $result.latest_index)
}
else {
    Write-Host 'No runs remain. The latest report output was removed.'
}
