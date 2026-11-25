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
. (Join-Path $PSScriptRoot 'DaymarkSigningResolver.ps1')

if ($ExpectedCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'ExpectedCommit must be the exact lowercase 40-character Git commit.'
}

try {
    $resolvedSigningEnvironment = Resolve-DaymarkSigningEnvironment
    $store = $resolvedSigningEnvironment.Store
    $alias = $resolvedSigningEnvironment.Alias
    $backupRoots = Get-DaymarkSigningBackupRoots

    Assert-DaymarkSecureFile -Path $store | Out-Null
    $sourceHash = (Get-FileHash -LiteralPath $store -Algorithm SHA256).Hash.ToLowerInvariant()
    $sourceCertificate = Get-DaymarkKeytoolCertificate `
        -StorePath $store `
        -Alias $alias `
        -StorePassword $resolvedSigningEnvironment.StorePassword
    if ($sourceCertificate.LeafSigner -ne $expectedSigner) {
        throw 'The configured Daymark leaf signing certificate is not the pinned original signer.'
    }

    $seenDriveRoots = @()
    foreach ($root in $backupRoots) {
        $manifestPath = Join-Path $root 'daymark-signing-manifest.json'
        $keyPath = Join-Path $root 'daymark-original-signing.keystore'
        if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $keyPath)) {
            throw "Missing protected Daymark signing backup at $root."
        }

        Assert-DaymarkStrictAcl -Path $manifestPath -Kind File | Out-Null
        Assert-DaymarkStrictAcl -Path $keyPath -Kind File | Out-Null
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $keyHash = (Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $resolvedKeyPath = (Resolve-Path -LiteralPath $keyPath).Path
        $driveRoot = [System.IO.Path]::GetPathRoot($resolvedKeyPath).ToUpperInvariant()
        if (
            $manifest.schemaVersion -ne 3 -or
            $manifest.certificateSha256 -ne $expectedSigner -or
            $manifest.keystoreSha256 -ne $keyHash -or
            $manifest.keystoreSha256 -ne $sourceHash -or
            $manifest.alias -ne $alias -or
            $manifest.backupFile -ne $resolvedKeyPath -or
            $manifest.driveRoot -ne $driveRoot
        ) {
            throw "Daymark signing backup integrity failed at $root."
        }

        $backupCertificate = Get-DaymarkKeytoolCertificate `
            -StorePath $keyPath `
            -Alias $alias `
            -StorePassword $resolvedSigningEnvironment.StorePassword
        if ($backupCertificate.LeafSigner -ne $expectedSigner) {
            throw "Daymark signing backup leaf certificate verification failed at $root."
        }
        $seenDriveRoots += $driveRoot
    }

    if (($seenDriveRoots | Select-Object -Unique).Count -ne $backupRoots.Count) {
        throw 'Daymark signing backups are not stored on separate drive roots.'
    }

    $git = 'C:\Program Files\Git\cmd\git.exe'
    $head = (& $git -C $repositoryRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) {
        throw "Repository HEAD $head does not match expected release commit $ExpectedCommit."
    }

    $repositoryChanges = @(& $git -C $repositoryRoot status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $repositoryChanges.Count -gt 0) {
        throw 'Repository has changes. Release artifacts require a clean exact commit.'
    }

    & (Join-Path $PSScriptRoot 'Verify-DaymarkRelease.ps1') `
        -ApkPath $ApkPath `
        -ExpectedCommit $ExpectedCommit
    if ($LASTEXITCODE -ne 0) {
        throw 'APK release provenance verification did not pass.'
    }

    Write-Host "Daymark release readiness verified for commit $ExpectedCommit."
}
finally {
    Clear-DaymarkSigningEnvironment
}
