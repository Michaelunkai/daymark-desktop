[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ApkPath,
    [Parameter(Mandatory)]
    [string]$ExpectedCommit
)

$ErrorActionPreference = 'Stop'
$expectedPackage = 'com.michaelunkai.daymark'
$expectedModel = 'SM-S938B'
$expectedHardwareSerial = 'R5CY610XJGV'
$expectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'
$adb = 'F:\study\Software_Engineering\Mobile\Android\02_SDKs_and_Toolchains\Dev_Toolchain-Android\platform-tools\adb.exe'

if ($ExpectedCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'ExpectedCommit must be the exact lowercase 40-character Git commit.'
}
if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
    throw "APK does not exist: $ApkPath"
}
if (-not (Test-Path -LiteralPath $adb)) {
    throw 'The pinned Daymark ADB executable was not found.'
}

$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    throw 'ANDROID_HOME or ANDROID_SDK_ROOT is required to install the release.'
}
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
$apksigner = if ($buildTools) { Join-Path $buildTools.FullName 'apksigner.bat' }
if (-not $apksigner -or -not (Test-Path -LiteralPath $apksigner)) {
    throw 'Android build-tools apksigner.bat was not found.'
}

$devices = @(& $adb devices | Select-String '\sdevice$' | ForEach-Object {
    ($_.Line -split '\s+')[0]
})
if ($devices.Count -ne 1) {
    throw "Expected exactly one connected Android transport, found $($devices.Count)."
}
$transport = $devices[0]
$model = (& $adb -s $transport shell getprop ro.product.model).Trim()
$hardwareSerial = (& $adb -s $transport shell getprop ro.serialno).Trim()
if ($model -ne $expectedModel -or $hardwareSerial -ne $expectedHardwareSerial) {
    throw "Connected device is $model / $hardwareSerial, not the pinned Daymark phone."
}

function Get-DaymarkInstalledApkPath {
    param([Parameter(Mandatory)][string]$Transport)

    $paths = @(
        & $adb -s $Transport shell pm path $expectedPackage |
            ForEach-Object {
                if ($_.ToString() -match '^package:(.+)$') {
                    $Matches[1].Trim()
                }
            }
    )
    if ($paths.Count -ne 1) {
        throw "Expected exactly one installed Daymark APK path, found $($paths.Count)."
    }
    return $paths[0]
}

function Get-DaymarkApkSigner {
    param([Parameter(Mandatory)][string]$Path)

    $output = & $apksigner verify --verbose --print-certs $Path
    if ($LASTEXITCODE -ne 0) {
        throw "Installed APK signature verification failed: $Path"
    }
    $matches = [regex]::Matches(
        ($output -join "`n"),
        '(?m)^\s*Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]{64})\s*$'
    )
    if ($matches.Count -ne 1) {
        throw "Installed APK must contain exactly one leaf signer, but $($matches.Count) were found."
    }
    return $matches[0].Groups[1].Value.ToLowerInvariant()
}

$before = (& $adb -s $transport shell dumpsys package $expectedPackage) -join "`n"
$beforeDataInode = [regex]::Match($before, 'ceDataInode=(\d+)').Groups[1].Value
$beforeFirstInstall = [regex]::Match($before, 'firstInstallTime=([^\r\n]+)').Groups[1].Value.Trim()
if ([string]::IsNullOrWhiteSpace($beforeDataInode) -or [string]::IsNullOrWhiteSpace($beforeFirstInstall)) {
    throw 'Could not establish the existing Daymark application-data identity.'
}

$installedPath = Get-DaymarkInstalledApkPath -Transport $transport
$temporaryInstalledApk = Join-Path $env:TEMP "daymark-installed-before-$PID.apk"
$temporaryUpdatedApk = Join-Path $env:TEMP "daymark-installed-after-$PID.apk"
try {
    & $adb -s $transport pull $installedPath $temporaryInstalledApk | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryInstalledApk)) {
        throw 'Could not pull the existing Daymark APK for provenance verification.'
    }
    $beforeSigner = Get-DaymarkApkSigner -Path $temporaryInstalledApk
    if ($beforeSigner -ne $expectedSigner) {
        throw 'Installed Daymark does not use the pinned original leaf signer.'
    }

    & (Join-Path $PSScriptRoot 'Verify-DaymarkRelease.ps1') `
        -ApkPath $ApkPath `
        -ExpectedCommit $ExpectedCommit

    $installOutput = (& $adb -s $transport install -r $ApkPath 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $installOutput -notmatch 'Success') {
        throw "In-place Daymark installation failed: $installOutput"
    }

    $after = (& $adb -s $transport shell dumpsys package $expectedPackage) -join "`n"
    $afterDataInode = [regex]::Match($after, 'ceDataInode=(\d+)').Groups[1].Value
    $afterFirstInstall = [regex]::Match($after, 'firstInstallTime=([^\r\n]+)').Groups[1].Value.Trim()
    if ($beforeDataInode -ne $afterDataInode -or $beforeFirstInstall -ne $afterFirstInstall) {
        throw 'Daymark application data identity changed during the update.'
    }

    $updatedPath = Get-DaymarkInstalledApkPath -Transport $transport
    & $adb -s $transport pull $updatedPath $temporaryUpdatedApk | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryUpdatedApk)) {
        throw 'Could not pull the updated Daymark APK for provenance verification.'
    }
    & (Join-Path $PSScriptRoot 'Verify-DaymarkRelease.ps1') `
        -ApkPath $temporaryUpdatedApk `
        -ExpectedCommit $ExpectedCommit

    Write-Host "Daymark was updated in place on $expectedModel without clearing application data or changing release provenance."
}
finally {
    Remove-Item -LiteralPath $temporaryInstalledApk -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporaryUpdatedApk -Force -ErrorAction SilentlyContinue
}
