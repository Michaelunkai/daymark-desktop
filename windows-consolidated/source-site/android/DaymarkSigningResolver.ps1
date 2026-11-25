[CmdletBinding()]
param(
    [switch]$ApplyEnvironment,
    [switch]$AllowProcessEnvironmentSecrets
)

$ErrorActionPreference = 'Stop'

$script:DaymarkExpectedSigner = '890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676'
$script:DaymarkSigningCredentialRoot = if (
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('DAYMARK_SIGNING_CREDENTIAL_TARGET'))
) {
    'Daymark/AndroidSigning'
}
else {
    [Environment]::GetEnvironmentVariable('DAYMARK_SIGNING_CREDENTIAL_TARGET')
}

function Get-DaymarkSigningBackupRoots {
    return @(
        'F:\backup\windowsapps\Daymark\signing',
        'C:\ProgramData\Codex\DaymarkSigning'
    )
}

function Get-DaymarkProcessEnvironmentValue {
    param([Parameter(Mandatory)][string]$Name)

    return [Environment]::GetEnvironmentVariable(
        $Name,
        [EnvironmentVariableTarget]::Process
    )
}

function Clear-DaymarkSigningEnvironment {
    foreach ($name in @(
            'DAYMARK_SIGNING_STORE',
            'DAYMARK_SIGNING_STORE_PASSWORD',
            'DAYMARK_SIGNING_KEY_ALIAS',
            'DAYMARK_SIGNING_KEY_PASSWORD',
            'DAYMARK_SIGNING_ESCROW_HASH',
            'DAYMARK_SIGNING_RESOLVED'
        )) {
        [Environment]::SetEnvironmentVariable(
            $name,
            $null,
            [EnvironmentVariableTarget]::Process
        )
    }
}

function Set-DaymarkSigningEnvironment {
    param([Parameter(Mandatory)][psobject]$SigningEnvironment)

    [Environment]::SetEnvironmentVariable(
        'DAYMARK_SIGNING_STORE',
        $SigningEnvironment.Store,
        [EnvironmentVariableTarget]::Process
    )
    [Environment]::SetEnvironmentVariable(
        'DAYMARK_SIGNING_KEY_ALIAS',
        $SigningEnvironment.Alias,
        [EnvironmentVariableTarget]::Process
    )
    [Environment]::SetEnvironmentVariable(
        'DAYMARK_SIGNING_STORE_PASSWORD',
        $SigningEnvironment.StorePassword,
        [EnvironmentVariableTarget]::Process
    )
    [Environment]::SetEnvironmentVariable(
        'DAYMARK_SIGNING_KEY_PASSWORD',
        $SigningEnvironment.KeyPassword,
        [EnvironmentVariableTarget]::Process
    )
    [Environment]::SetEnvironmentVariable(
        'DAYMARK_SIGNING_RESOLVED',
        'daymark-signing-resolver-v1',
        [EnvironmentVariableTarget]::Process
    )
}

function Get-DaymarkFullPath {
    param([Parameter(Mandatory)][string]$Path)

    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "Daymark signing path must be absolute: $Path"
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Assert-DaymarkPathChain {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = Get-DaymarkFullPath -Path $Path
    $cursor = $fullPath
    while (-not (Test-Path -LiteralPath $cursor)) {
        $parent = Split-Path -LiteralPath $cursor -Parent
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -ieq $cursor) {
            throw "Daymark signing path has no existing secure parent: $fullPath"
        }
        $cursor = $parent
    }

    $root = [System.IO.Path]::GetPathRoot($fullPath)
    while ($true) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Daymark signing path contains a reparse point: $($item.FullName)"
        }

        if ($item.FullName.TrimEnd('\') -ieq $root.TrimEnd('\')) {
            break
        }
        if (-not $item.Parent) {
            break
        }
        $cursor = $item.Parent.FullName
    }

    return $fullPath
}

if (-not ('Daymark.Security.NativeFile' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

namespace Daymark.Security
{
    [StructLayout(LayoutKind.Sequential)]
    public struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    public static class NativeFile
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetFileInformationByHandle(
            IntPtr hFile,
            out BY_HANDLE_FILE_INFORMATION lpFileInformation);
    }
}
'@
}

function Get-DaymarkHardLinkCount {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = Assert-DaymarkPathChain -Path $Path
    $share = [System.IO.FileShare]::Read -bor `
        [System.IO.FileShare]::Write -bor `
        [System.IO.FileShare]::Delete
    $stream = New-Object System.IO.FileStream(
        $fullPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        $share
    )
    try {
        $info = New-Object Daymark.Security.BY_HANDLE_FILE_INFORMATION
        $ok = [Daymark.Security.NativeFile]::GetFileInformationByHandle(
            $stream.SafeFileHandle.DangerousGetHandle(),
            [ref]$info
        )
        if (-not $ok) {
            throw "Could not inspect hard-link identity: $fullPath"
        }
        return [int]$info.NumberOfLinks
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-DaymarkSecureFile {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = Assert-DaymarkPathChain -Path $Path
    $item = Get-Item -LiteralPath $fullPath -Force
    if ($item.PSIsContainer) {
        throw "Expected a regular Daymark signing file: $fullPath"
    }
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Daymark signing file is a reparse point: $fullPath"
    }
    $linkCount = Get-DaymarkHardLinkCount -Path $fullPath
    if ($linkCount -ne 1) {
        throw "Daymark signing file must have exactly one hard link: $fullPath"
    }
    return $fullPath
}

function Assert-DaymarkSecureDirectory {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = Assert-DaymarkPathChain -Path $Path
    $item = Get-Item -LiteralPath $fullPath -Force
    if (-not $item.PSIsContainer) {
        throw "Expected a Daymark signing directory: $fullPath"
    }
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Daymark signing directory is a reparse point: $fullPath"
    }
    return $fullPath
}

function Get-DaymarkRequiredAclSids {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $identity.User) {
        throw 'The current Windows identity could not be resolved.'
    }
    $systemSid = (
        New-Object System.Security.Principal.NTAccount(
            'NT AUTHORITY',
            'SYSTEM'
        )
    ).Translate([System.Security.Principal.SecurityIdentifier]).Value
    return @($identity.User.Value, $systemSid)
}

function Assert-DaymarkStrictAcl {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('File', 'Directory')][string]$Kind
    )

    $fullPath = if ($Kind -eq 'File') {
        Assert-DaymarkSecureFile -Path $Path
    }
    else {
        Assert-DaymarkSecureDirectory -Path $Path
    }
    $acl = Get-Acl -LiteralPath $fullPath
    if (-not $acl.AreAccessRulesProtected) {
        throw "Daymark signing ACL inherits permissions: $fullPath"
    }

    $requiredSids = Get-DaymarkRequiredAclSids
    $rules = @($acl.Access)
    if ($rules.Count -ne 2) {
        throw "Daymark signing ACL contains unexpected entries: $fullPath"
    }

    $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
    $expectedInheritance = if ($Kind -eq 'Directory') {
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }

    foreach ($rule in $rules) {
        $sid = $rule.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if (
            $sid -notin $requiredSids -or
            $rule.IsInherited -or
            $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            (($rule.FileSystemRights -band $fullControl) -ne $fullControl) -or
            $rule.InheritanceFlags -ne $expectedInheritance -or
            $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None
        ) {
            throw "Daymark signing ACL is broader than the protected owner/SYSTEM contract: $fullPath"
        }
    }

    return $fullPath
}

function Set-DaymarkStrictAcl {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('File', 'Directory')][string]$Kind
    )

    $fullPath = if ($Kind -eq 'File') {
        Assert-DaymarkSecureFile -Path $Path
    }
    else {
        Assert-DaymarkSecureDirectory -Path $Path
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
    $allow = [System.Security.AccessControl.AccessControlType]::Allow

    if ($Kind -eq 'Directory') {
        $security = New-Object System.Security.AccessControl.DirectorySecurity
        $security.SetAccessRuleProtection($true, $false)
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        $security.AddAccessRule(
            (New-Object System.Security.AccessControl.FileSystemAccessRule(
                $identity,
                $fullControl,
                $inheritance,
                [System.Security.AccessControl.PropagationFlags]::None,
                $allow
            ))
        )
        $security.AddAccessRule(
            (New-Object System.Security.AccessControl.FileSystemAccessRule(
                'NT AUTHORITY\SYSTEM',
                $fullControl,
                $inheritance,
                [System.Security.AccessControl.PropagationFlags]::None,
                $allow
            ))
        )
    }
    else {
        $security = New-Object System.Security.AccessControl.FileSecurity
        $security.SetAccessRuleProtection($true, $false)
        $security.AddAccessRule(
            (New-Object System.Security.AccessControl.FileSystemAccessRule(
                $identity,
                $fullControl,
                $allow
            ))
        )
        $security.AddAccessRule(
            (New-Object System.Security.AccessControl.FileSystemAccessRule(
                'NT AUTHORITY\SYSTEM',
                $fullControl,
                $allow
            ))
        )
    }

    Set-Acl -LiteralPath $fullPath -AclObject $security
    Assert-DaymarkStrictAcl -Path $fullPath -Kind $Kind | Out-Null
}

function Get-DaymarkKeytoolPath {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $candidates += Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    }
    $candidates += 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
    $command = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        $candidates += $command.Source
    }
    $path = $candidates |
        Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
        Select-Object -First 1
    if (-not $path) {
        throw 'keytool.exe was not found. Configure JAVA_HOME or Android Studio JBR.'
    }
    return $path
}

if (-not ('Daymark.CredentialManager.NativeCredential' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Daymark.CredentialManager
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    public static class NativeCredential
    {
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredRead(
            string targetName,
            uint type,
            uint reservedFlag,
            out IntPtr credentialPtr);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern void CredFree(IntPtr credentialPtr);
    }
}
'@
}

function Get-DaymarkCredentialRecord {
    param([Parameter(Mandatory)][string]$Target)

    $credentialPtr = [IntPtr]::Zero
    $ok = [Daymark.CredentialManager.NativeCredential]::CredRead(
        $Target,
        1,
        0,
        [ref]$credentialPtr
    )
    if (-not $ok) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Windows Credential Manager entry is unavailable: $Target (error $errorCode)."
    }

    try {
        $record = [Runtime.InteropServices.Marshal]::PtrToStructure(
            $credentialPtr,
            [type][Daymark.CredentialManager.CREDENTIAL]
        )
        $bytes = New-Object byte[] ([int]$record.CredentialBlobSize)
        if ($record.CredentialBlobSize -gt 0) {
            [Runtime.InteropServices.Marshal]::Copy(
                $record.CredentialBlob,
                $bytes,
                0,
                [int]$record.CredentialBlobSize
            )
        }

        $likelyUtf16 = $bytes.Length -gt 1
        if ($likelyUtf16) {
            for ($i = 1; $i -lt $bytes.Length; $i += 2) {
                if ($bytes[$i] -ne 0) {
                    $likelyUtf16 = $false
                    break
                }
            }
        }
        $secret = if ($likelyUtf16) {
            [Text.Encoding]::Unicode.GetString($bytes).TrimEnd([char]0)
        }
        else {
            [Text.Encoding]::UTF8.GetString($bytes).TrimEnd([char]0)
        }
        $userName = if ($record.UserName -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::PtrToStringUni($record.UserName)
        }
        else {
            ''
        }
        return [pscustomobject]@{
            Target = $Target
            Secret = $secret
            UserName = $userName
        }
    }
    finally {
        [Daymark.CredentialManager.NativeCredential]::CredFree($credentialPtr)
    }
}

function Get-DaymarkCredentialValue {
    param([Parameter(Mandatory)][string]$Target)

    $record = Get-DaymarkCredentialRecord -Target $Target
    if ([string]::IsNullOrWhiteSpace($record.Secret)) {
        throw "Windows Credential Manager entry is empty: $Target"
    }
    return $record.Secret
}

function Get-DaymarkKeytoolCertificate {
    param(
        [Parameter(Mandatory)][string]$StorePath,
        [Parameter(Mandatory)][string]$Alias,
        [Parameter(Mandatory)][string]$StorePassword
    )

    Assert-DaymarkSecureFile -Path $StorePath | Out-Null
    $keytool = Get-DaymarkKeytoolPath
    $previousStorePassword = Get-DaymarkProcessEnvironmentValue -Name 'DAYMARK_SIGNING_STORE_PASSWORD'
    try {
        [Environment]::SetEnvironmentVariable(
            'DAYMARK_SIGNING_STORE_PASSWORD',
            $StorePassword,
            [EnvironmentVariableTarget]::Process
        )
        $output = & $keytool `
            -list `
            -v `
            -keystore $StorePath `
            -storepass:env DAYMARK_SIGNING_STORE_PASSWORD `
            -alias $Alias 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "The Daymark signing keystore could not be opened: $StorePath"
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable(
            'DAYMARK_SIGNING_STORE_PASSWORD',
            $previousStorePassword,
            [EnvironmentVariableTarget]::Process
        )
    }

    $text = $output -join "`n"
    if ($text -notmatch 'Entry type:\s*PrivateKeyEntry') {
        throw "The Daymark signing alias is not a PrivateKeyEntry: $Alias"
    }
    $leafSection = [regex]::Match(
        $text,
        '(?ms)^\s*Certificate\[1\]:\s*(.*?)(?=^\s*Certificate\[\d+\]:|\z)'
    )
    if (-not $leafSection.Success) {
        throw "The Daymark leaf certificate could not be read: $Alias"
    }
    $leafFingerprint = [regex]::Match(
        $leafSection.Groups[1].Value,
        '(?im)^\s*(?:Certificate fingerprint \(SHA-256\)|SHA-256|SHA256):\s*([0-9A-F:]+)'
    )
    if (-not $leafFingerprint.Success) {
        throw "The Daymark leaf certificate SHA-256 fingerprint could not be read: $Alias"
    }
    $signer = $leafFingerprint.Groups[1].Value.Replace(':', '').ToLowerInvariant()
    if ($signer -ne $script:DaymarkExpectedSigner) {
        throw "The Daymark leaf signing certificate does not match the pinned original signer."
    }
    return [pscustomobject]@{
        Signer = $signer
        LeafSigner = $signer
        Text = $text
    }
}

function Resolve-DaymarkSigningEnvironment {
    param([switch]$AllowEnvironmentSecrets)

    $store = Get-DaymarkProcessEnvironmentValue -Name 'DAYMARK_SIGNING_STORE'
    if ([string]::IsNullOrWhiteSpace($store)) {
        foreach ($root in Get-DaymarkSigningBackupRoots) {
            $candidate = Join-Path $root 'daymark-original-signing.keystore'
            if (Test-Path -LiteralPath $candidate) {
                $store = $candidate
                break
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace($store)) {
        throw 'DAYMARK_SIGNING_STORE is missing and no protected Daymark escrow key is available.'
    }
    Assert-DaymarkSecureFile -Path $store | Out-Null

    $alias = Get-DaymarkProcessEnvironmentValue -Name 'DAYMARK_SIGNING_KEY_ALIAS'
    if ([string]::IsNullOrWhiteSpace($alias)) {
        $alias = Get-DaymarkCredentialValue -Target (
            "$script:DaymarkSigningCredentialRoot/KeyAlias"
        )
    }
    if ([string]::IsNullOrWhiteSpace($alias)) {
        throw 'The Daymark signing alias is missing.'
    }

    $storePassword = $null
    $keyPassword = $null
    if ($AllowEnvironmentSecrets) {
        $storePassword = Get-DaymarkProcessEnvironmentValue -Name 'DAYMARK_SIGNING_STORE_PASSWORD'
        $keyPassword = Get-DaymarkProcessEnvironmentValue -Name 'DAYMARK_SIGNING_KEY_PASSWORD'
    }
    if ([string]::IsNullOrWhiteSpace($storePassword)) {
        $storePassword = Get-DaymarkCredentialValue -Target (
            "$script:DaymarkSigningCredentialRoot/StorePassword"
        )
    }
    if ([string]::IsNullOrWhiteSpace($keyPassword)) {
        $keyPassword = Get-DaymarkCredentialValue -Target (
            "$script:DaymarkSigningCredentialRoot/KeyPassword"
        )
    }

    return [pscustomobject]@{
        Store = Get-DaymarkFullPath -Path $store
        Alias = $alias
        StorePassword = $storePassword
        KeyPassword = $keyPassword
        CredentialTarget = $script:DaymarkSigningCredentialRoot
    }
}

if ($ApplyEnvironment) {
    $resolvedSigningEnvironment = Resolve-DaymarkSigningEnvironment `
        -AllowEnvironmentSecrets:$AllowProcessEnvironmentSecrets
    Set-DaymarkSigningEnvironment -SigningEnvironment $resolvedSigningEnvironment
    Write-Host 'Daymark signing credentials resolved from protected local sources.'
}
