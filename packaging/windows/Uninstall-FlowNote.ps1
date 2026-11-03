<#
.SYNOPSIS
  Uninstalls FlowNote from Windows, whichever installer was used (the NSIS
  setup.exe or the MSI), and optionally deletes its data.

.DESCRIPTION
  Both FlowNote installers already register an uninstaller with Windows
  (Settings -> Apps -> Installed apps -> FlowNote -> Uninstall). This script
  does the same thing without the UI:
    1. finds FlowNote's uninstall entry/entries in the registry (per-user and
       per-machine, 64- and 32-bit views);
    2. closes FlowNote if it is running;
    3. runs each entry's own uninstaller silently and waits until Windows
       reports it gone;
    4. with -RemoveData, also deletes FlowNote's data — your notes database,
       attachments, and the embedded browser's cache.

  Without -RemoveData your notes are kept, so a later reinstall picks them up.

.PARAMETER RemoveData
  Also delete %APPDATA%\com.sandeep.flownote (notes database + attachments)
  and %LOCALAPPDATA%\com.sandeep.flownote (WebView2 cache). Irreversible.

.PARAMETER TimeoutSeconds
  How long to wait for each uninstaller to finish. Default 120.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1
  powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1 -RemoveData

.NOTES
  Exit codes: 0 = uninstalled (or nothing to uninstall), 1 = an uninstaller
  failed or timed out. Works on Windows PowerShell 5.1 and PowerShell 7.
#>
[CmdletBinding()]
param(
  [switch]$RemoveData,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$ProductName = 'FlowNote'
$AppIdentifier = 'com.sandeep.flownote'   # tauri.conf.json "identifier"

$UninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

function Get-FlowNoteEntries {
  foreach ($root in $UninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
      if ($props -and $props.DisplayName -eq $ProductName) {
        [pscustomobject]@{
          KeyPath   = $key.PSPath
          KeyName   = $key.PSChildName
          Version   = $props.DisplayVersion
          IsMsi     = ($props.WindowsInstaller -eq 1) -or ("$($props.UninstallString)" -match 'msiexec')
          Uninstall = "$($props.UninstallString)"
          Quiet     = "$($props.QuietUninstallString)"
          Location  = "$($props.InstallLocation)"
        }
      }
    }
  }
}

# Splits a registry command line like `"C:\path\uninstall.exe" /S` into
# executable + arguments.
function Split-CommandLine([string]$commandLine) {
  $commandLine = $commandLine.Trim()
  if ($commandLine.StartsWith('"')) {
    $end = $commandLine.IndexOf('"', 1)
    return @($commandLine.Substring(1, $end - 1), $commandLine.Substring($end + 1).Trim())
  }
  $space = $commandLine.IndexOf(' ')
  if ($space -lt 0) { return @($commandLine, '') }
  return @($commandLine.Substring(0, $space), $commandLine.Substring($space + 1).Trim())
}

function Stop-FlowNote($entry) {
  $dir = $entry.Location
  if (-not $dir -and -not $entry.IsMsi -and $entry.Uninstall) {
    $dir = Split-Path (Split-CommandLine $entry.Uninstall)[0] -Parent
  }
  $running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -eq $ProductName -or ($dir -and $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase))
  }
  foreach ($p in $running) {
    Write-Host "  Closing running FlowNote (pid $($p.Id))..."
    $p.CloseMainWindow() | Out-Null
    if (-not $p.WaitForExit(5000)) { Stop-Process -Id $p.Id -Force }
  }
}

function Invoke-Uninstall($entry) {
  if ($entry.IsMsi) {
    # The key name of an MSI uninstall entry is its ProductCode.
    $exe = 'msiexec.exe'
    $arguments = "/x $($entry.KeyName) /qn /norestart"
  } elseif ($entry.Quiet) {
    $exe, $arguments = Split-CommandLine $entry.Quiet
  } else {
    $exe, $arguments = Split-CommandLine $entry.Uninstall
    $arguments = "$arguments /S".Trim()
  }

  Write-Host "  Running: $exe $arguments"
  $proc = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -Wait
  if ($entry.IsMsi -and $proc.ExitCode -notin 0, 1605, 3010) {
    throw "msiexec exited with code $($proc.ExitCode)"
  }

  # The NSIS uninstaller re-launches itself from %TEMP% and returns at once,
  # so wait for the registry entry itself to disappear.
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (Test-Path $entry.KeyPath) {
    if ((Get-Date) -gt $deadline) { throw "timed out after $TimeoutSeconds s waiting for the uninstaller" }
    Start-Sleep -Milliseconds 500
  }
}

$failed = $false
$entries = @(Get-FlowNoteEntries)

if ($entries.Count -eq 0) {
  Write-Host 'FlowNote is not installed (no uninstall entry found).'
} else {
  foreach ($entry in $entries) {
    $kind = if ($entry.IsMsi) { 'MSI' } else { 'setup.exe' }
    Write-Host "Uninstalling FlowNote $($entry.Version) ($kind install)..."
    try {
      Stop-FlowNote $entry
      Invoke-Uninstall $entry
      Write-Host '  Done.'
    } catch {
      Write-Host "  FAILED: $_" -ForegroundColor Red
      $failed = $true
    }
  }
}

if ($RemoveData) {
  foreach ($dir in @((Join-Path $env:APPDATA $AppIdentifier), (Join-Path $env:LOCALAPPDATA $AppIdentifier))) {
    if (Test-Path $dir) {
      Write-Host "Deleting data: $dir"
      Remove-Item -LiteralPath $dir -Recurse -Force
    }
  }
} elseif (Test-Path (Join-Path $env:APPDATA $AppIdentifier)) {
  Write-Host "Your notes were kept in $(Join-Path $env:APPDATA $AppIdentifier) (use -RemoveData to delete them)."
}

if ($failed) { exit 1 }
Write-Host 'FlowNote has been uninstalled.'
exit 0
