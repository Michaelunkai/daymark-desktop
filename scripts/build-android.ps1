[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ExpectedCommit
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$gradle = Join-Path $env:DAYMARK_GRADLE_HOME "bin\gradle.bat"
if (-not (Test-Path $gradle)) {
    throw "Set DAYMARK_GRADLE_HOME to the prepared Gradle distribution."
}

$head = (& 'C:\Program Files\Git\cmd\git.exe' -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) {
    throw "Repository HEAD $head does not match expected release commit $ExpectedCommit."
}

$trackedChanges = & 'C:\Program Files\Git\cmd\git.exe' -C $repo status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $trackedChanges) {
    throw 'Repository has tracked changes. Commit the exact release source before building.'
}

& (Join-Path $repo 'android\Protect-DaymarkSigningKey.ps1')
$env:DAYMARK_GIT_COMMIT = $ExpectedCommit

Push-Location (Join-Path $repo "android")
try {
    & $gradle assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) {
        throw 'Android release build failed.'
    }
} finally {
    Pop-Location
}

$apkPath = Join-Path $repo 'android\app\build\outputs\apk\release\app-release.apk'
& (Join-Path $repo 'android\Test-DaymarkReleaseReadiness.ps1') -ApkPath $apkPath -ExpectedCommit $ExpectedCommit
