[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ApkPath,
    [Parameter(Mandatory)]
    [string]$ExpectedCommit
)

$ErrorActionPreference = 'Stop'
$expectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backupRoots = @(
    'F:\backup\windowsapps\Daymark\signing',
    'C:\ProgramData\Codex\DaymarkSigning'
)

foreach ($root in $backupRoots) {
    $manifestPath = Join-Path $root 'daymark-signing-manifest.json'
    $keyPath = Join-Path $root 'daymark-original-signing.keystore'
    if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $keyPath)) {
        throw "Missing protected Daymark signing backup at $root."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $keyHash = (Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifest.certificateSha256 -ne $expectedSigner -or $manifest.keystoreSha256 -ne $keyHash) {
        throw "Daymark signing backup integrity failed at $root."
    }
}

$head = (& 'C:\Program Files\Git\cmd\git.exe' -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) {
    throw "Repository HEAD $head does not match expected release commit $ExpectedCommit."
}

& (Join-Path $PSScriptRoot 'Verify-DaymarkRelease.ps1') -ApkPath $ApkPath
if ($LASTEXITCODE -ne 0) {
    throw 'APK signer verification did not pass.'
}

Write-Host "Daymark release readiness verified for commit $ExpectedCommit."
