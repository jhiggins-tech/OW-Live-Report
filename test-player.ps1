param(
    [Parameter(Mandatory = $true)]
    [string]$BattleTag
)

$playerId = $BattleTag.Trim() -replace '#', '-'
$userName = if ($BattleTag.Contains('#')) { $BattleTag.Split('#')[0] } else { $BattleTag }
$summaryUrl = "https://overfast-api.tekrop.fr/players/$playerId/summary"
$searchUrl = "https://overfast-api.tekrop.fr/players?name=$([System.Uri]::EscapeDataString($userName))"

function Get-ErrorBody {
    param($ErrorRecord)

    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
        return $ErrorRecord.ErrorDetails.Message
    }

    try {
        $response = $ErrorRecord.Exception.Response
        if ($response) {
            $stream = $response.GetResponseStream()
            if ($stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                try {
                    return $reader.ReadToEnd()
                }
                finally {
                    $reader.Dispose()
                }
            }
        }
    }
    catch {
    }

    return $ErrorRecord.Exception.Message
}

Write-Host ''
Write-Host "BattleTag: $BattleTag"
Write-Host "Normalized: $playerId"
Write-Host "Summary URL: $summaryUrl"
Write-Host "Search URL: $searchUrl"
Write-Host ''

try {
    $summary = Invoke-RestMethod -Uri $summaryUrl
    Write-Host 'Summary request: SUCCESS' -ForegroundColor Green
    Write-Host ($summary | ConvertTo-Json -Depth 10)
}
catch {
    Write-Host 'Summary request: FAILED' -ForegroundColor Yellow
    Write-Host (Get-ErrorBody -ErrorRecord $_)
}

Write-Host ''

try {
    $search = Invoke-RestMethod -Uri $searchUrl
    Write-Host 'Search request: SUCCESS' -ForegroundColor Green
    Write-Host ($search | ConvertTo-Json -Depth 10)
}
catch {
    Write-Host 'Search request: FAILED' -ForegroundColor Yellow
    Write-Host (Get-ErrorBody -ErrorRecord $_)
}
