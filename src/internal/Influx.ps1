            # Copilot Note (2026-05-11):
            # A user is experiencing a crash here:
            # "Unable to sort because the IComparer.Compare() method returns inconsistent results. Either a value does not compare equal to itself, or one value repeatedly compared to another value yields different results. IComparer: 'Microsoft.PowerShell.Commands.OrderByPropertyComparer'."
            # This usually happens if sorting properties are missing, null, or inconsistent types. Please review that the properties in the Sort-Object below are always present and type-consistent for all items, or filter/cast as appropriate before sorting.
            Sort-Object -Property @(
                @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('captured_at') -Default '' } },
                @{ Expression = { Get-OwReportObjectValue -Object $_ -Path @('player_slug') -Default '' } }
            )