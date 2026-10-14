param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$Commit,
    [string]$MetadataPath = (Join-Path $PSScriptRoot '..\installer\version.inc.iss'),
    [string]$ArtifactDirectory = 'dist'
)

$ErrorActionPreference = 'Stop'

function Invoke-Gh([string[]]$Arguments) {
    $result = & gh @Arguments
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI failed: gh $($Arguments -join ' ')" }
    return $result
}

$metadata = Get-Content -LiteralPath $MetadataPath -Raw
$match = [regex]::Match($metadata, '(?m)^#define[ \t]+AppVersion[ \t]+"(\d+\.\d+\.\d+)"[ \t]*\r?$')
if (-not $match.Success) { throw 'AppVersion must be a quoted major.minor.patch version in version.inc.iss.' }
$version = $match.Groups[1].Value
$tag = "v$version"
$installers = @(Get-ChildItem -LiteralPath $ArtifactDirectory -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows installer in the downloaded artifact.' }
$installer = $installers[0]

$existingJson = & gh release view $tag --repo $Repository --json isDraft,assets 2>$null
if ($LASTEXITCODE -eq 0) {
    $release = ($existingJson -join "`n") | ConvertFrom-Json
}
else {
    # Keep a new release as a draft until its installer has uploaded successfully.
    Invoke-Gh @('release', 'create', $tag, '--repo', $Repository, '--target', $Commit,
        '--title', "EarsMixer $version", '--generate-notes', '--draft')
    $release = [pscustomobject]@{ isDraft = $true; assets = @() }
}

# Each successful main build refreshes the installer for the current version.
# Reuse the existing release/tag; --target applies only when creating a new tag.
Invoke-Gh @('release', 'upload', $tag, $installer.FullName, '--repo', $Repository, '--clobber')

if ($release.isDraft) {
    Invoke-Gh @('release', 'edit', $tag, '--repo', $Repository, '--draft=false', '--latest')
}
else {
    Invoke-Gh @('release', 'edit', $tag, '--repo', $Repository, '--latest')
}
Write-Host "Published installer for ${tag}: https://github.com/$Repository/releases/latest"
