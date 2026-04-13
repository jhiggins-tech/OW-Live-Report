param(
    [string]$ConfigPath = '.\config\team.sample.json',
    [string]$Notes = '',
    [ValidateSet('mostly_narrow', 'mixed', 'mostly_wide')]
    [string]$WideMatchContext = 'mixed'
)

$modulePath = Join-Path $PSScriptRoot 'src\OwReport.psm1'
Import-Module $modulePath -Force

$result = Invoke-OwReportRun -ConfigPath $ConfigPath -ProjectRoot $PSScriptRoot -Notes $Notes -WideMatchContext $WideMatchContext
Write-Host ''
Write-Host ('Run complete: {0}' -f $result.run_id)
Write-Host ('Fresh snapshots: {0}' -f $result.successful_players)
Write-Host ('Latest report: {0}' -f $result.latest_index)
if (@($result.failed_players).Count -gt 0) {
    Write-Host ('Failed players: {0}' -f ((@($result.failed_players) | ForEach-Object { $_.display_name }) -join ', '))
}
