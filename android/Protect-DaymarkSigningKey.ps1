[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$expectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'

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
        throw 'keytool.exe was not found. Set JAVA_HOME before protecting the signing key.'
    }
    return $candidates[0]
}

$store = Require-EnvironmentValue 'DAYMARK_SIGNING_STORE'
$storePassword = Require-EnvironmentValue 'DAYMARK_SIGNING_STORE_PASSWORD'
$alias = Require-EnvironmentValue 'DAYMARK_SIGNING_KEY_ALIAS'

if (-not (Test-Path -LiteralPath $store)) {
    throw "DAYMARK_SIGNING_STORE does not exist: $store"
}

$keytool = Get-KeytoolPath
$certificate = & $keytool -list -v -keystore $store -storepass:env DAYMARK_SIGNING_STORE_PASSWORD -alias $alias 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'The configured Daymark signing key could not be opened.'
}

$certificateText = $certificate -join "`n"
if ($certificateText -notmatch 'Entry type:\s*PrivateKeyEntry') {
    throw 'The configured Daymark signing alias is not a private signing key.'
}

$match = [regex]::Match($certificateText, 'SHA256:\s*([0-9A-F:]+)', 'IgnoreCase')
if (-not $match.Success) {
    throw 'The signing-key certificate SHA-256 digest could not be read.'
}

$signer = $match.Groups[1].Value.Replace(':', '').ToLowerInvariant()
if ($signer -ne $expectedSigner) {
    throw "Configured signer $signer does not match the installed Daymark signer $expectedSigner."
}

$sourceHash = (Get-FileHash -LiteralPath $store -Algorithm SHA256).Hash.ToLowerInvariant()
$roots = @(
    'F:\backup\windowsapps\Daymark\signing',
    'C:\ProgramData\Codex\DaymarkSigning'
)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$backupDriveRoots = $roots | ForEach-Object { [System.IO.Path]::GetPathRoot($_).ToUpperInvariant() }
if (($backupDriveRoots | Select-Object -Unique).Count -ne $roots.Count) {
    throw 'Daymark signing backups must be stored on separate drive roots.'
}

foreach ($root in $roots) {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    & icacls $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not protect the signing backup directory: $root"
    }

    $target = Join-Path $root 'daymark-original-signing.keystore'
    if (Test-Path -LiteralPath $target) {
        $existingHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($existingHash -ne $sourceHash) {
            throw "Backup conflict at $target. Refusing to overwrite a different signing key."
        }
    }
    else {
        Copy-Item -LiteralPath $store -Destination $target -ErrorAction Stop
    }

    $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($targetHash -ne $sourceHash) {
        throw "Signing backup hash verification failed at $target."
    }

    $backupCertificate = & $keytool -list -v -keystore $target -storepass:env DAYMARK_SIGNING_STORE_PASSWORD -alias $alias 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Signing backup could not be reopened at $target."
    }
    $backupCertificateText = $backupCertificate -join "`n"
    $backupSignerMatch = [regex]::Match($backupCertificateText, 'SHA256:\s*([0-9A-F:]+)', 'IgnoreCase')
    if (
        $backupCertificateText -notmatch 'Entry type:\s*PrivateKeyEntry' -or
        -not $backupSignerMatch.Success -or
        $backupSignerMatch.Groups[1].Value.Replace(':', '').ToLowerInvariant() -ne $expectedSigner
    ) {
        throw "Signing backup certificate verification failed at $target."
    }

    $manifest = [ordered]@{
        schemaVersion = 2
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        certificateSha256 = $signer
        keystoreSha256 = $sourceHash
        alias = $alias
        backupFile = (Resolve-Path -LiteralPath $target).Path
        driveRoot = [System.IO.Path]::GetPathRoot($target).ToUpperInvariant()
    } | ConvertTo-Json
    Set-Content -LiteralPath (Join-Path $root 'daymark-signing-manifest.json') -Value $manifest -Encoding ASCII
}

Write-Host "Daymark signing key escrow verified for signer $signer."
