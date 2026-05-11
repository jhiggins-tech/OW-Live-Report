    # Copilot Note (2026-05-11):
    # User reported CI failure on Sort-Object due to property type/missing values.
    # Add debug output to help diagnose problematic entries and filter them before sorting.
    foreach ($item in $snapshotLookup.Values) {
        $cap = Get-OwReportObjectValue -Object $item -Path @('captured_at') -Default $null
        $slug = Get-OwReportObjectValue -Object $item -Path @('player_slug') -Default $null
        if ($null -eq $cap -or $null -eq $slug) {
            Write-Host "::warning file=src/internal/Influx.ps1::Snapshot missing key: captured_at='$cap', player_slug='$slug', value: $($item | Out-String)"
        }
    }
    $safeSnapshots = $snapshotLookup.Values | Where-Object {
        ($null -ne (Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default $null)) -and
        ($null -ne (Get-OwReportObjectValue -Object $_ -Path @('player_slug') -Default $null))
    }
    $safeSnapshots | Sort-Object -Property @(
        @{ Expression = { [string](Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '') } },
        @{ Expression = { [string](Get-OwReportObjectValue -Object $_ -Path @('player_slug') -Default '') } }
    )