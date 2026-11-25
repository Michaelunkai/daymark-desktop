[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ExpectedCommit
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$gradle = Join-Path $env:DAYMARK_GRADLE_HOME "bin\gradle.bat"
$git = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path -LiteralPath $gradle)) {
    throw "Set DAYMARK_GRADLE_HOME to the prepared Gradle distribution."
}
if (-not (Test-Path -LiteralPath $git)) {
    throw 'The pinned Git executable was not found.'
}
if ($ExpectedCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'ExpectedCommit must be the exact lowercase 40-character Git commit.'
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

function Write-DaymarkWebProvenance {
    param(
        [Parameter(Mandatory)][string]$ClientRoot,
        [Parameter(Mandatory)][string]$Commit
    )

    if (-not (Test-Path -LiteralPath $ClientRoot -PathType Container)) {
        throw "Daymark web client directory does not exist: $ClientRoot"
    }
    $metadataPath = Join-Path $ClientRoot '.daymark-web-provenance.json'
    Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue

    $files = @(
        Get-ChildItem -LiteralPath $ClientRoot -Recurse -File |
            Where-Object { $_.FullName -ne $metadataPath } |
            Sort-Object FullName |
            ForEach-Object {
                $relativePath = $_.FullName.Substring($ClientRoot.Length).TrimStart('\').Replace('\', '/')
                [ordered]@{
                    path = $relativePath
                    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                    bytes = [int64]$_.Length
                }
            }
    )
    $index = $files | Where-Object { $_.path -eq 'index.html' }
    if (-not $index) {
        throw 'Daymark web client build did not emit index.html.'
    }
    $manifestText = ($files | ForEach-Object {
        "$($_.path)|$($_.sha256)|$($_.bytes)"
    } | Sort-Object) -join "`n"
    $metadata = [ordered]@{
        schemaVersion = 1
        sourceCommit = $Commit
        fileCount = $files.Count
        indexSha256 = $index.sha256
        filesSha256 = Get-DaymarkSha256 -Bytes ([Text.Encoding]::UTF8.GetBytes($manifestText))
        files = $files
    } | ConvertTo-Json -Depth 10
    $temporaryPath = Join-Path $ClientRoot (
        '.daymark-web-provenance.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    )
    Set-Content -LiteralPath $temporaryPath -Value ($metadata + [Environment]::NewLine) -Encoding ASCII
    Move-Item -LiteralPath $temporaryPath -Destination $metadataPath -Force
}

function Clear-DaymarkReleaseEnvironment {
    foreach ($name in @(
            'DAYMARK_SIGNING_STORE',
            'DAYMARK_SIGNING_STORE_PASSWORD',
            'DAYMARK_SIGNING_KEY_ALIAS',
            'DAYMARK_SIGNING_KEY_PASSWORD',
            'DAYMARK_SIGNING_ESCROW_HASH',
            'DAYMARK_SIGNING_RESOLVED',
            'DAYMARK_GIT_COMMIT',
            'DAYMARK_WEB_CLIENT_PREBUILT'
        )) {
        [Environment]::SetEnvironmentVariable(
            $name,
            $null,
            [EnvironmentVariableTarget]::Process
        )
    }
}

$head = (& $git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) {
    throw "Repository HEAD $head does not match expected release commit $ExpectedCommit."
}

$repositoryChanges = @(& $git -C $repo status --porcelain)
if ($LASTEXITCODE -ne 0 -or $repositoryChanges.Count -gt 0) {
    throw 'Repository has changes. Commit the exact release source before building.'
}

$npm = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path -LiteralPath $npm)) {
    throw 'The pinned Node.js npm.cmd was not found.'
}
Push-Location $repo
try {
    & $npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Daymark web client build failed.'
    }
    Write-DaymarkWebProvenance `
        -ClientRoot (Join-Path $repo 'dist\client') `
        -Commit $ExpectedCommit
}
finally {
    Pop-Location
}

try {
    & (Join-Path $repo 'android\Protect-DaymarkSigningKey.ps1')
    & (Join-Path $repo 'android\DaymarkSigningResolver.ps1') -ApplyEnvironment
    $env:DAYMARK_GIT_COMMIT = $ExpectedCommit
    $env:DAYMARK_WEB_CLIENT_PREBUILT = '1'

    try {
        Push-Location (Join-Path $repo "android")
        try {
            & $gradle assembleRelease --no-daemon
            if ($LASTEXITCODE -ne 0) {
                throw 'Android release build failed.'
            }
        }
        finally {
            Pop-Location
        }
    }
    finally {
        Clear-DaymarkReleaseEnvironment
    }

    $headAfterBuild = (& $git -C $repo rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $headAfterBuild -ne $ExpectedCommit) {
        throw "Repository HEAD changed during the release build: $headAfterBuild."
    }
    $changesAfterBuild = @(& $git -C $repo status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $changesAfterBuild.Count -gt 0) {
        throw 'Repository changed during the release build.'
    }

    $apkPath = Join-Path $repo 'android\app\build\outputs\apk\release\app-release.apk'
    & (Join-Path $repo 'android\Test-DaymarkReleaseReadiness.ps1') `
        -ApkPath $apkPath `
        -ExpectedCommit $ExpectedCommit
}
finally {
    Clear-DaymarkReleaseEnvironment
}
