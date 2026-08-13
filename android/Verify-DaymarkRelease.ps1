[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ApkPath,
    [Parameter(Mandatory)]
    [string]$ExpectedCommit
)

$ErrorActionPreference = 'Stop'
$expectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'
$expectedPackage = 'com.michaelunkai.daymark'
$expectedVersionCode = '27'
$expectedVersionName = '1.4.34'
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
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    throw 'ANDROID_HOME or ANDROID_SDK_ROOT is required to verify the release.'
}

$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
$apksigner = if ($buildTools) { Join-Path $buildTools.FullName 'apksigner.bat' }
$aapt = if ($buildTools) { Join-Path $buildTools.FullName 'aapt.exe' }
if (-not $apksigner) {
    throw 'Android build-tools apksigner.bat was not found.'
}
if (-not (Test-Path -LiteralPath $aapt)) {
    throw 'Android build-tools aapt.exe was not found.'
}

$certificateOutput = & $apksigner verify --verbose --print-certs $resolvedApk
if ($LASTEXITCODE -ne 0) {
    throw 'APK signature verification failed.'
}

$signerMatches = [regex]::Matches(
    ($certificateOutput -join "`n"),
    'Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]+)'
)
if ($signerMatches.Count -ne 1) {
    throw "APK must contain exactly one signer, but $($signerMatches.Count) were found."
}
if (-not $signerMatches[0].Success) {
    throw 'APK signer digest could not be read.'
}

$actualSigner = $signerMatches[0].Groups[1].Value.ToLowerInvariant()
if ($actualSigner -ne $expectedSigner) {
    throw "APK signer $actualSigner does not match the installed Daymark signer $expectedSigner."
}

$badging = & $aapt dump badging $resolvedApk 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'APK package metadata could not be read.'
}
$badgingText = $badging -join "`n"
$packageMatch = [regex]::Match($badgingText, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
if (
    -not $packageMatch.Success -or
    $packageMatch.Groups[1].Value -ne $expectedPackage -or
    $packageMatch.Groups[2].Value -ne $expectedVersionCode -or
    $packageMatch.Groups[3].Value -ne $expectedVersionName
) {
    throw 'APK package name or version does not match the Daymark release contract.'
}

$manifest = & $aapt dump xmltree $resolvedApk AndroidManifest.xml 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'APK manifest could not be read.'
}
$manifestText = $manifest -join "`n"
if (
    $manifestText -notmatch 'com\.michaelunkai\.daymark\.GIT_COMMIT' -or
    $manifestText -notmatch [regex]::Escape($ExpectedCommit)
) {
    throw "APK is not bound to expected Git commit $ExpectedCommit."
}

Write-Host "Daymark release verified for signer $actualSigner and commit $ExpectedCommit."
