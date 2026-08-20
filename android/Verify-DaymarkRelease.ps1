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
$expectedVersionCode = '34'
$expectedVersionName = '1.4.44'

if ($ExpectedCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'ExpectedCommit must be the exact lowercase 40-character Git commit.'
}
if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
    throw "APK does not exist: $ApkPath"
}
$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-DaymarkApkEntryBytes {
    param(
        [Parameter(Mandatory)][string]$ArchivePath,
        [Parameter(Mandatory)][string]$EntryName
    )

    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entry = $archive.GetEntry($EntryName)
        if (-not $entry) {
            throw "APK is missing required entry: $EntryName"
        }
        $input = $entry.Open()
        $memory = New-Object System.IO.MemoryStream
        try {
            $input.CopyTo($memory)
            return ,$memory.ToArray()
        }
        finally {
            $memory.Dispose()
            $input.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Get-DaymarkSha256 {
    param([Parameter(Mandatory)][byte[]]$Bytes)

    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-DaymarkWebProvenance {
    param([Parameter(Mandatory)][string]$ArchivePath)

    $bytes = Get-DaymarkApkEntryBytes `
        -ArchivePath $ArchivePath `
        -EntryName 'assets/daymark/.daymark-web-provenance.json'
    try {
        $metadata = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    }
    catch {
        throw 'The packaged Daymark web provenance metadata is not valid JSON.'
    }

    if (
        $metadata.schemaVersion -ne 1 -or
        $metadata.sourceCommit -notmatch '^[0-9a-f]{40}$' -or
        $metadata.fileCount -lt 1 -or
        $metadata.filesSha256 -notmatch '^[0-9a-f]{64}$' -or
        $metadata.indexSha256 -notmatch '^[0-9a-f]{64}$'
    ) {
        throw 'The packaged Daymark web provenance metadata is incomplete.'
    }

    $records = @($metadata.files)
    if ($records.Count -ne [int]$metadata.fileCount) {
        throw 'The packaged Daymark web provenance file count is inconsistent.'
    }

    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $assetEntries = @(
            $archive.Entries |
                Where-Object {
                    $_.FullName.StartsWith('assets/daymark/') -and
                    $_.FullName -ne 'assets/daymark/.daymark-web-provenance.json' -and
                    -not $_.FullName.EndsWith('/')
                } |
                ForEach-Object { $_.FullName.Substring('assets/daymark/'.Length) }
        )
    }
    finally {
        $archive.Dispose()
    }

    $expectedEntries = @($records | ForEach-Object { [string]$_.path })
    if (($assetEntries | Sort-Object) -join "`n" -ne ($expectedEntries | Sort-Object) -join "`n") {
        throw 'The APK web asset set does not match its provenance metadata.'
    }

    $manifestLines = @()
    foreach ($record in $records) {
        $relativePath = [string]$record.path
        if (
            [string]::IsNullOrWhiteSpace($relativePath) -or
            $relativePath.Contains('\') -or
            $relativePath.Contains('..') -or
            $record.sha256 -notmatch '^[0-9a-f]{64}$'
        ) {
            throw 'The packaged Daymark web provenance contains an unsafe or invalid asset record.'
        }
        $entryBytes = Get-DaymarkApkEntryBytes `
            -ArchivePath $ArchivePath `
            -EntryName ('assets/daymark/' + $relativePath)
        $actualHash = Get-DaymarkSha256 -Bytes $entryBytes
        if ($actualHash -ne ([string]$record.sha256).ToLowerInvariant() -or $entryBytes.Length -ne [int64]$record.bytes) {
            throw "Packaged Daymark web asset integrity failed: $relativePath"
        }
        $manifestLines += "$relativePath|$($record.sha256)|$($record.bytes)"
    }

    $manifestBytes = [Text.Encoding]::UTF8.GetBytes(($manifestLines | Sort-Object) -join "`n")
    if ((Get-DaymarkSha256 -Bytes $manifestBytes) -ne ([string]$metadata.filesSha256).ToLowerInvariant()) {
        throw 'The packaged Daymark web asset manifest hash does not match its metadata.'
    }

    $indexRecord = $records | Where-Object { $_.path -eq 'index.html' }
    if (-not $indexRecord -or $indexRecord.sha256 -ne $metadata.indexSha256) {
        throw 'The packaged Daymark web provenance has no valid index.html record.'
    }
    return $metadata
}

$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    throw 'ANDROID_HOME or ANDROID_SDK_ROOT is required to verify the release.'
}

$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
$apksigner = if ($buildTools) { Join-Path $buildTools.FullName 'apksigner.bat' }
$aapt = if ($buildTools) { Join-Path $buildTools.FullName 'aapt.exe' }
if (-not $apksigner -or -not (Test-Path -LiteralPath $apksigner)) {
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
    '(?m)^\s*Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]{64})\s*$'
)
if ($signerMatches.Count -ne 1) {
    throw "APK must contain exactly one leaf signer, but $($signerMatches.Count) were found."
}
$actualSigner = $signerMatches[0].Groups[1].Value.ToLowerInvariant()
if ($actualSigner -ne $expectedSigner) {
    throw "APK leaf signer $actualSigner does not match the installed Daymark signer $expectedSigner."
}

$badging = & $aapt dump badging $resolvedApk 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'APK package metadata could not be read.'
}
$badgingText = $badging -join "`n"
$packageMatch = [regex]::Match(
    $badgingText,
    "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'"
)
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

$webProvenance = Get-DaymarkWebProvenance -ArchivePath $resolvedApk
if ($webProvenance.sourceCommit -ne $ExpectedCommit) {
    throw "Packaged Daymark web assets are bound to $($webProvenance.sourceCommit), not $ExpectedCommit."
}

Write-Host "Daymark release verified for leaf signer $actualSigner, commit $ExpectedCommit, and packaged web provenance."
