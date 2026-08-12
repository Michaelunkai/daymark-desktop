[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ApkPath
)

$ErrorActionPreference = 'Stop'
$expectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'
$required = @(
    'DAYMARK_SIGNING_STORE',
    'DAYMARK_SIGNING_STORE_PASSWORD',
    'DAYMARK_SIGNING_KEY_ALIAS',
    'DAYMARK_SIGNING_KEY_PASSWORD'
)

foreach ($name in $required) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "Missing $name. A release must use the original Daymark signing key."
    }
}

if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    throw 'JAVA_HOME is required to verify the release signer.'
}

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$sdkRoot = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    throw 'ANDROID_HOME is required to verify the release signer.'
}

$apksigner = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object Name -Descending |
    ForEach-Object {
        $candidate = Join-Path $_.FullName 'apksigner.bat'
        if (Test-Path -LiteralPath $candidate) { $candidate }
    } |
    Select-Object -First 1
if (-not $apksigner) {
    throw 'Android build-tools apksigner.bat was not found.'
}

$certificateOutput = & $apksigner verify --print-certs $resolvedApk
if ($LASTEXITCODE -ne 0) {
    throw 'APK signature verification failed.'
}

$match = [regex]::Match(
    ($certificateOutput -join "`n"),
    'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)'
)
if (-not $match.Success) {
    throw 'APK signer digest could not be read.'
}

$actualSigner = $match.Groups[1].Value.ToLowerInvariant()
if ($actualSigner -ne $expectedSigner) {
    throw "APK signer $actualSigner does not match the installed Daymark signer $expectedSigner."
}

Write-Host "Daymark release signer verified: $actualSigner"
