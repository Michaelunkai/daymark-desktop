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

function Require-EnvironmentValue {
    param([string]$Name)
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Missing $Name."
    }
    return $value
}

function Get-KeytoolPath {
    $candidates = @(
        (if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\keytool.exe' }),
        'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    if (-not $candidates) {
        throw 'keytool.exe was not found.'
    }
    return $candidates[0]
}

$store = Require-EnvironmentValue 'DAYMARK_SIGNING_STORE'
$alias = Require-EnvironmentValue 'DAYMARK_SIGNING_KEY_ALIAS'
Require-EnvironmentValue 'DAYMARK_SIGNING_STORE_PASSWORD' | Out-Null
Require-EnvironmentValue 'DAYMARK_SIGNING_KEY_PASSWORD' | Out-Null
$keytool = Get-KeytoolPath

if (-not (Test-Path -LiteralPath $store)) {
    throw "DAYMARK_SIGNING_STORE does not exist: $store"
}

$sourceHash = (Get-FileHash -LiteralPath $store -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceCertificate = & $keytool -list -v -keystore $store -storepass:env DAYMARK_SIGNING_STORE_PASSWORD -alias $alias 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'The configured Daymark signing key could not be opened.'
}
$sourceCertificateText = $sourceCertificate -join "`n"
$sourceSignerMatch = [regex]::Match($sourceCertificateText, 'SHA256:\s*([0-9A-F:]+)', 'IgnoreCase')
if (
    $sourceCertificateText -notmatch 'Entry type:\s*PrivateKeyEntry' -or
    -not $sourceSignerMatch.Success -or
    $sourceSignerMatch.Groups[1].Value.Replace(':', '').ToLowerInvariant() -ne $expectedSigner
) {
    throw 'The configured Daymark signing key does not match the installed application signer.'
}

$seenDriveRoots = @()
foreach ($root in $backupRoots) {
    $manifestPath = Join-Path $root 'daymark-signing-manifest.json'
    $keyPath = Join-Path $root 'daymark-original-signing.keystore'
    if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $keyPath)) {
        throw "Missing protected Daymark signing backup at $root."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $keyHash = (Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $resolvedKeyPath = (Resolve-Path -LiteralPath $keyPath).Path
    $driveRoot = [System.IO.Path]::GetPathRoot($resolvedKeyPath).ToUpperInvariant()
    if (
        $manifest.schemaVersion -ne 2 -or
        $manifest.certificateSha256 -ne $expectedSigner -or
        $manifest.keystoreSha256 -ne $keyHash -or
        $manifest.keystoreSha256 -ne $sourceHash -or
        $manifest.alias -ne $alias -or
        $manifest.backupFile -ne $resolvedKeyPath -or
        $manifest.driveRoot -ne $driveRoot
    ) {
        throw "Daymark signing backup integrity failed at $root."
    }

    $backupCertificate = & $keytool -list -v -keystore $keyPath -storepass:env DAYMARK_SIGNING_STORE_PASSWORD -alias $alias 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Daymark signing backup could not be opened at $root."
    }
    $backupCertificateText = $backupCertificate -join "`n"
    $backupSignerMatch = [regex]::Match($backupCertificateText, 'SHA256:\s*([0-9A-F:]+)', 'IgnoreCase')
    if (
        $backupCertificateText -notmatch 'Entry type:\s*PrivateKeyEntry' -or
        -not $backupSignerMatch.Success -or
        $backupSignerMatch.Groups[1].Value.Replace(':', '').ToLowerInvariant() -ne $expectedSigner
    ) {
        throw "Daymark signing backup certificate verification failed at $root."
    }
    $seenDriveRoots += $driveRoot
}

if (($seenDriveRoots | Select-Object -Unique).Count -ne $backupRoots.Count) {
    throw 'Daymark signing backups are not stored on separate drive roots.'
}

$head = (& 'C:\Program Files\Git\cmd\git.exe' -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) {
    throw "Repository HEAD $head does not match expected release commit $ExpectedCommit."
}

$trackedChanges = & 'C:\Program Files\Git\cmd\git.exe' -C $repositoryRoot status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $trackedChanges) {
    throw 'Repository has tracked changes. Release artifacts require a clean exact commit.'
}

& (Join-Path $PSScriptRoot 'Verify-DaymarkRelease.ps1') -ApkPath $ApkPath -ExpectedCommit $ExpectedCommit
if ($LASTEXITCODE -ne 0) {
    throw 'APK signer verification did not pass.'
}

Write-Host "Daymark release readiness verified for commit $ExpectedCommit."
