<#
.SYNOPSIS
  Builds FlowNote from this source tree and installs it.

.DESCRIPTION
  Runs scripts\windows\package.ps1 (a clean release build of the Windows
  bundle), then starts the bundle's setup wizard — the same setup.exe
  shipped to users (per-user install, no admin rights needed).

.PARAMETER Silent
  Install unattended (setup.exe /S) instead of showing the wizard.

.PARAMETER Msi
  Install the .msi instead of setup.exe (msiexec; /qn with -Silent).

.PARAMETER NoClean
  Incremental build (passed to package.ps1).

.EXAMPLE
  .\scripts\windows\install.ps1
  .\scripts\windows\install.ps1 -Silent
#>
[CmdletBinding()]
param(
  [switch]$Silent,
  [switch]$Msi,
  [switch]$NoClean
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

& (Join-Path $PSScriptRoot 'package.ps1') -NoClean:$NoClean

$Version = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
$Bundle = Join-Path $RepoRoot "dist-release\FlowNote-$Version-windows-x64"

if ($Msi) {
  $installer = (Get-ChildItem $Bundle -Filter '*.msi' | Select-Object -First 1).FullName
  $msiArgs = "/i `"$installer`"" + $(if ($Silent) { ' /qn /norestart' } else { '' })
  Write-Host "==> Running $installer"
  $proc = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru
} else {
  $installer = (Get-ChildItem $Bundle -Filter '*-setup.exe' | Select-Object -First 1).FullName
  Write-Host "==> Running $installer"
  $proc = if ($Silent) { Start-Process $installer -ArgumentList '/S' -Wait -PassThru } else { Start-Process $installer -Wait -PassThru }
}

if ($proc.ExitCode -ne 0) { throw "installer exited with code $($proc.ExitCode)" }
Write-Host '==> Installed. Launch FlowNote from the Start menu.'
