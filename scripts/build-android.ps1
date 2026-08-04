$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$gradle = Join-Path $env:DAYMARK_GRADLE_HOME "bin\gradle.bat"
if (-not (Test-Path $gradle)) {
    throw "Set DAYMARK_GRADLE_HOME to the prepared Gradle distribution."
}

Push-Location (Join-Path $repo "android")
try {
    & $gradle assembleRelease --no-daemon
} finally {
    Pop-Location
}
