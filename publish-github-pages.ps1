param(
    [string]$SourceDir = '.\output\latest',
    [string]$DocsDir = '.\docs'
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Ensure-WorkspacePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,
        [Parameter(Mandatory = $true)]
        [string]$WorkspaceRoot
    )

    $normalizedRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd('\')
    $normalizedCandidate = [System.IO.Path]::GetFullPath($CandidatePath)
    if (-not $normalizedCandidate.StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside the workspace: $normalizedCandidate"
    }
}

$workspaceRoot = (Get-Location).Path
$resolvedSourceDir = Resolve-FullPath -Path $SourceDir
$resolvedDocsDir = Resolve-FullPath -Path $DocsDir

Ensure-WorkspacePath -CandidatePath $resolvedSourceDir -WorkspaceRoot $workspaceRoot
Ensure-WorkspacePath -CandidatePath $resolvedDocsDir -WorkspaceRoot $workspaceRoot

if (-not (Test-Path -LiteralPath $resolvedSourceDir)) {
    throw "Source site folder not found: $resolvedSourceDir"
}

if (-not (Test-Path -LiteralPath $resolvedDocsDir)) {
    New-Item -ItemType Directory -Path $resolvedDocsDir -Force | Out-Null
}

$existingDocsItems = @(Get-ChildItem -LiteralPath $resolvedDocsDir -Force -ErrorAction SilentlyContinue)
foreach ($item in $existingDocsItems) {
    Remove-Item -LiteralPath $item.FullName -Recurse -Force
}

Copy-Item -Path (Join-Path $resolvedSourceDir '*') -Destination $resolvedDocsDir -Recurse -Force

$noJekyllPath = Join-Path $resolvedDocsDir '.nojekyll'
[System.IO.File]::WriteAllText($noJekyllPath, '', (New-Object System.Text.UTF8Encoding($false)))

Write-Host "GitHub Pages site prepared."
Write-Host "Source: $resolvedSourceDir"
Write-Host "Docs:   $resolvedDocsDir"
Write-Host ''
Write-Host 'Next step: push this repo to GitHub and set Pages to deploy from the `docs` folder on your main branch.'
