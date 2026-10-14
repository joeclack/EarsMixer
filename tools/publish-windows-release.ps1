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

# A version identifies its source commit. Rebuilds can resume a release, but new
# source commits must bump AppVersion rather than publish beneath a stale tag.
$tagCommit = & git rev-parse --verify "refs/tags/$tag^{commit}" 2>$null
if ($LASTEXITCODE -eq 0 -and $tagCommit -ne $Commit) {
    throw "Tag $tag already points to another commit. Bump AppVersion for the new release."
}

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

if (-not @($release.assets | Where-Object { $_.name -eq $installer.Name }).Count) {
    Invoke-Gh @('release', 'upload', $tag, $installer.FullName, '--repo', $Repository)
}

if ($release.isDraft) {
    Invoke-Gh @('release', 'edit', $tag, '--repo', $Repository, '--draft=false', '--latest')
}
else {
    Invoke-Gh @('release', 'edit', $tag, '--repo', $Repository, '--latest')
}
Write-Host "Published installer for ${tag}: https://github.com/$Repository/releases/latest"
