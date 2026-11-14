[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$PackageRoot = $PSScriptRoot
$DestinationRoot = (Resolve-Path -LiteralPath $LabRoot).Path
if (!(Test-Path -LiteralPath (Join-Path $DestinationRoot 'src\app.mjs') -PathType Leaf)) {
    throw 'Choose the existing 3D Lab SOURCE folder containing src\app.mjs.'
}
$Manifest = Get-Content -Raw -LiteralPath (Join-Path $PackageRoot 'UPDATE-MANIFEST.json') | ConvertFrom-Json
$Changes = @()
foreach ($Entry in $Manifest.files) {
    $Relative = [string]$Entry.path
    if ($Relative.StartsWith('/') -or $Relative.Contains('..') -or $Relative.Contains(':') -or $Relative.Contains('\')) { throw "Invalid update path: $Relative" }
    $Incoming = Join-Path (Join-Path $PackageRoot '3d-lab') $Relative
    $Target = Join-Path $DestinationRoot $Relative
    $IncomingHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Incoming).Hash.ToLowerInvariant()
    if ($IncomingHash -ne $Entry.after_sha256) { throw "The update package is damaged: $Relative" }
    $Exists = Test-Path -LiteralPath $Target -PathType Leaf
    $CurrentHash = if ($Exists) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Target).Hash.ToLowerInvariant() } else { $null }
    if ($CurrentHash -eq $Entry.after_sha256) { continue }
    if ($Entry.before_sha256) {
        if (!$Exists -or $CurrentHash -ne $Entry.before_sha256) { throw "Source mismatch: $Relative. No files have been changed. Use the same source version as 3d-lab(20261016-210403).zip, or review this file before merging." }
    } elseif ($Exists -or (Test-Path -LiteralPath $Target)) { throw "A different file already occupies $Relative. No files have been changed." }
    $Changes += [PSCustomObject]@{ Relative = $Relative; Incoming = $Incoming; Target = $Target; Exists = $Exists; Hash = $IncomingHash }
}
Write-Host ("Verified {0} package files; {1} source files need updating." -f @($Manifest.files).Count, $Changes.Count)
if ($CheckOnly -or $Changes.Count -eq 0) { return }
$BackupRoot = Join-Path $DestinationRoot ('update-backups\disk-storage-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$Applied = @()
try {
    foreach ($Change in $Changes) {
        $Backup = Join-Path $BackupRoot $Change.Relative
        if ($Change.Exists) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $Backup) -Force | Out-Null
            Copy-Item -LiteralPath $Change.Target -Destination $Backup
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $Change.Target) -Force | Out-Null
        $Applied += $Change
        Copy-Item -LiteralPath $Change.Incoming -Destination $Change.Target -Force
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Change.Target).Hash.ToLowerInvariant() -ne $Change.Hash) { throw "Copy verification failed: $($Change.Relative)" }
    }
    Copy-Item -LiteralPath (Join-Path $PackageRoot 'UPDATE-MANIFEST.json') -Destination (Join-Path $BackupRoot 'UPDATE-MANIFEST.json')
} catch {
    $OriginalError = $_
    for ($i = $Applied.Count - 1; $i -ge 0; $i--) {
        $Change = $Applied[$i]
        if ($Change.Exists) { Copy-Item -LiteralPath (Join-Path $BackupRoot $Change.Relative) -Destination $Change.Target -Force }
        elseif (Test-Path -LiteralPath $Change.Target -PathType Leaf) { Remove-Item -LiteralPath $Change.Target }
    }
    throw $OriginalError
}
Write-Host "Updated 3D Lab to 0.16.0. Originals are backed up in $BackupRoot"
Write-Host 'Freshly Compile and Package the existing app identity, then run Start-3D-Asset-Storage.cmd.'
Write-Host 'Open the existing installed Lab and use Asset storage -> Connect & migrate.'
Write-Host 'Your Windows browser drafts have not been migrated by this source updater; migration runs inside the updated Lab.'
