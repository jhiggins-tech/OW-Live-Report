param(
    [string]$ConfigPath = '.\config\team.sample.json',
    [string]$Notes = '',
    [ValidateSet('mostly_narrow', 'mixed', 'mostly_wide')]
    [string]$WideMatchContext = 'mixed'
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSCommandPath
$runReportPath = Join-Path $scriptRoot 'run-report.ps1'

if (-not (Test-Path -LiteralPath $runReportPath)) {
    throw "run-report.ps1 was not found at $runReportPath"
}

$invokeParams = @{
    ConfigPath = $ConfigPath
    WideMatchContext = $WideMatchContext
}

if (-not [string]::IsNullOrWhiteSpace($Notes)) {
    $invokeParams['Notes'] = $Notes
}

Write-Host 'Refreshing published snapshot data...'
& $runReportPath @invokeParams
