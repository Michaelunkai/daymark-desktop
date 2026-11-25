[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DaymarkSigningResolver.ps1')

$resolvedSigningEnvironment = Resolve-DaymarkSigningEnvironment
$store = $resolvedSigningEnvironment.Store
$alias = $resolvedSigningEnvironment.Alias
$expectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'
$roots = Get-DaymarkSigningBackupRoots

try {
    Assert-DaymarkSecureFile -Path $store | Out-Null
    $sourceHash = (Get-FileHash -LiteralPath $store -Algorithm SHA256).Hash.ToLowerInvariant()
    $sourceCertificate = Get-DaymarkKeytoolCertificate `
        -StorePath $store `
        -Alias $alias `
        -StorePassword $resolvedSigningEnvironment.StorePassword
    if ($sourceCertificate.LeafSigner -ne $expectedSigner) {
        throw 'The configured Daymark leaf signing certificate is not the pinned original signer.'
    }

    $driveRoots = @(
        $roots | ForEach-Object {
            [System.IO.Path]::GetPathRoot($_).ToUpperInvariant()
        }
    )
    if (($driveRoots | Select-Object -Unique).Count -ne $roots.Count) {
        throw 'Daymark signing escrows must remain on separate F: and C: drive roots.'
    }

    foreach ($root in $roots) {
        Assert-DaymarkPathChain -Path $root | Out-Null
        if (-not (Test-Path -LiteralPath $root)) {
            New-Item -ItemType Directory -Path $root -Force | Out-Null
        }
        Set-DaymarkStrictAcl -Path $root -Kind Directory

        $target = Join-Path $root 'daymark-original-signing.keystore'
        if (Test-Path -LiteralPath $target) {
            Assert-DaymarkStrictAcl -Path $target -Kind File
            $existingHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($existingHash -ne $sourceHash) {
                throw "Daymark signing escrow conflict; refusing to overwrite a different key: $target"
            }
        }
        else {
            $temporaryTarget = Join-Path $root (
                '.daymark-original-signing.' + [Guid]::NewGuid().ToString('N') + '.tmp'
            )
            Copy-Item -LiteralPath $store -Destination $temporaryTarget -ErrorAction Stop
            Assert-DaymarkSecureFile -Path $temporaryTarget | Out-Null
            Set-DaymarkStrictAcl -Path $temporaryTarget -Kind File
            Move-Item -LiteralPath $temporaryTarget -Destination $target -Force
            Assert-DaymarkStrictAcl -Path $target -Kind File
        }

        $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($targetHash -ne $sourceHash) {
            throw "Daymark signing escrow hash verification failed: $target"
        }
        $backupCertificate = Get-DaymarkKeytoolCertificate `
            -StorePath $target `
            -Alias $alias `
            -StorePassword $resolvedSigningEnvironment.StorePassword
        if ($backupCertificate.LeafSigner -ne $expectedSigner) {
            throw "Daymark signing escrow leaf certificate verification failed: $target"
        }

        $manifestPath = Join-Path $root 'daymark-signing-manifest.json'
        if (Test-Path -LiteralPath $manifestPath) {
            Assert-DaymarkStrictAcl -Path $manifestPath -Kind File
        }
        $manifest = [ordered]@{
            schemaVersion = 3
            createdAt = (Get-Date).ToUniversalTime().ToString('o')
            certificateSha256 = $expectedSigner
            keystoreSha256 = $sourceHash
            alias = $alias
            backupFile = (Get-Item -LiteralPath $target -Force).FullName
            driveRoot = [System.IO.Path]::GetPathRoot($target).ToUpperInvariant()
            credentialTarget = $script:DaymarkSigningCredentialRoot
        } | ConvertTo-Json
        $temporaryManifest = Join-Path $root (
            '.daymark-signing-manifest.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        )
        Set-Content -LiteralPath $temporaryManifest -Value $manifest -Encoding ASCII
        Assert-DaymarkSecureFile -Path $temporaryManifest | Out-Null
        Set-DaymarkStrictAcl -Path $temporaryManifest -Kind File
        Move-Item -LiteralPath $temporaryManifest -Destination $manifestPath -Force
        Assert-DaymarkStrictAcl -Path $manifestPath -Kind File
    }

    Write-Host "Daymark signing key dual escrow verified for the pinned original leaf signer."
}
finally {
    Clear-DaymarkSigningEnvironment
}
