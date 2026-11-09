<#
.SYNOPSIS
  Uninstalls FlowNote from Windows, whichever installer was used (the
  setup.exe wizard or the MSI), and optionally deletes its data.

.DESCRIPTION
  Both FlowNote installers register an uninstaller with Windows (Settings ->
  Apps -> Installed apps -> FlowNote -> Uninstall, or Start Menu -> FlowNote
  -> Uninstall FlowNote). This script does the same for either install, in
  one step:
    1. finds FlowNote's uninstall entry/entries in the registry (per-user and
       per-machine, 64- and 32-bit views);
    2. closes FlowNote if it is running;
    3. runs each entry's own uninstaller silently and waits until Windows
       reports it gone;
    4. optionally deletes FlowNote's data — your notes database,
       attachments, and the embedded browser's cache.

  Run without parameters from Explorer (or "Uninstall FlowNote.cmd") and it
  shows a small window: confirm, and tick "Also delete my notes" if wanted.
  With -RemoveData / -KeepData / -Silent it asks nothing.

  Without -RemoveData your notes are kept, so a later reinstall picks them up.

.PARAMETER RemoveData
  Also delete %APPDATA%\com.sandeep.flownote (notes database + attachments)
  and %LOCALAPPDATA%\com.sandeep.flownote (WebView2 cache). Irreversible.

.PARAMETER KeepData
  Keep your notes (don't ask).

.PARAMETER Silent
  No window and no questions; notes are kept unless -RemoveData is given.

.PARAMETER TimeoutSeconds
  How long to wait for each uninstaller to finish. Default 120.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1
  powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1 -RemoveData
  powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1 -Silent -KeepData

.NOTES
  Exit codes: 0 = uninstalled (or nothing to uninstall), 1 = an uninstaller
  failed or timed out, 2 = cancelled. Works on Windows PowerShell 5.1 and
  PowerShell 7.
#>
[CmdletBinding()]
param(
  [switch]$RemoveData,
  [switch]$KeepData,
  [switch]$Silent,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$ProductName = 'FlowNote'
$AppIdentifier = 'com.sandeep.flownote'   # tauri.conf.json "identifier"
$DataDirs = @((Join-Path $env:APPDATA $AppIdentifier), (Join-Path $env:LOCALAPPDATA $AppIdentifier))

if ($RemoveData -and $KeepData) { throw '-RemoveData and -KeepData cannot be used together.' }

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
          PerUser   = $root.StartsWith('HKCU')
          Uninstall = "$($props.UninstallString)"
          Quiet     = "$($props.QuietUninstallString)"
          Location  = "$($props.InstallLocation)".Trim('"')
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

# The confirmation window shown when run interactively without flags.
# Returns $null if cancelled, else @{ RemoveData = <bool> }.
function Show-UninstallDialog($entries) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Uninstall FlowNote'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = 'CenterScreen'
  $form.ClientSize = New-Object System.Drawing.Size(460, 220)
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Remove FlowNote from this computer?'
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(16, 16)
  $form.Controls.Add($title)

  $what = ($entries | ForEach-Object {
      $kind = if ($_.IsMsi) { 'MSI' } else { 'setup' }
      $scope = if ($_.PerUser) { 'for this user' } else { 'for all users' }
      "  - FlowNote $($_.Version) ($kind install, $scope)"
    }) -join "`r`n"
  $body = New-Object System.Windows.Forms.Label
  $body.Text = "This removes:`r`n$what"
  $body.AutoSize = $true
  $body.Location = New-Object System.Drawing.Point(18, 50)
  $form.Controls.Add($body)

  $check = New-Object System.Windows.Forms.CheckBox
  $check.Text = 'Also delete my notes and attachments (cannot be undone)'
  $check.AutoSize = $true
  $check.Location = New-Object System.Drawing.Point(18, 118)
  $check.Enabled = [bool]($DataDirs | Where-Object { Test-Path $_ })
  $form.Controls.Add($check)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = "Leave unticked to keep them in $($DataDirs[0])"
  $hint.ForeColor = [System.Drawing.Color]::DimGray
  $hint.AutoSize = $true
  $hint.Location = New-Object System.Drawing.Point(36, 140)
  $form.Controls.Add($hint)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Uninstall'
  $ok.DialogResult = 'OK'
  $ok.Size = New-Object System.Drawing.Size(96, 28)
  $ok.Location = New-Object System.Drawing.Point(244, 178)
  $form.Controls.Add($ok)
  $form.AcceptButton = $ok

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancel'
  $cancel.DialogResult = 'Cancel'
  $cancel.Size = New-Object System.Drawing.Size(96, 28)
  $cancel.Location = New-Object System.Drawing.Point(348, 178)
  $form.Controls.Add($cancel)
  $form.CancelButton = $cancel

  if ($form.ShowDialog() -ne 'OK') { return $null }
  return @{ RemoveData = $check.Checked }
}

function Show-Message([string]$text, [string]$icon = 'Information') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($text, 'Uninstall FlowNote', 'OK', $icon) | Out-Null
}

$entries = @(Get-FlowNoteEntries)

# Interactive: no data flag, not -Silent, a desktop session, not CI.
$interactive = -not ($Silent -or $RemoveData -or $KeepData) -and
  [Environment]::UserInteractive -and -not $env:CI -and -not $env:GITHUB_ACTIONS

if ($interactive) {
  if ($entries.Count -eq 0) {
    Show-Message 'FlowNote is not installed on this computer.'
    exit 0
  }
  $choice = Show-UninstallDialog $entries
  if (-not $choice) { Write-Host 'Cancelled - nothing was changed.'; exit 2 }
  $RemoveData = [switch]$choice.RemoveData
}

$failed = $false
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

# FlowNote's WebView2 helper processes (msedgewebview2.exe, started with
# --user-data-dir=<data dir>\EBWebView) outlive FlowNote.exe by a moment and
# keep files in that folder open, so deleting it straight after closing the
# app can fail with "Access to the path ... is denied". Wait for them to
# exit (stopping any that hang), then delete, retrying briefly.
function Remove-DataDir([string]$dir) {
  $helpers = { @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($dir, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
  $deadline = (Get-Date).AddSeconds(10)
  while ((& $helpers).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  foreach ($p in (& $helpers)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }

  for ($attempt = 1; ; $attempt++) {
    try {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -ge 10) { throw }
      Start-Sleep -Seconds 1
    }
  }
}

if ($RemoveData) {
  foreach ($dir in $DataDirs) {
    if (Test-Path $dir) {
      Write-Host "Deleting data: $dir"
      Remove-DataDir $dir
    }
  }
  $dataNote = ''
} elseif (Test-Path $DataDirs[0]) {
  $dataNote = "Your notes were kept in $($DataDirs[0]) - reinstalling FlowNote picks them back up."
  Write-Host "$dataNote (use -RemoveData to delete them)"
} else {
  $dataNote = ''
}

if ($failed) {
  if ($interactive) { Show-Message 'FlowNote could not be fully uninstalled. Try Settings -> Apps -> FlowNote -> Uninstall.' 'Error' }
  exit 1
}
Write-Host 'FlowNote has been uninstalled.'
if ($interactive) { Show-Message ("FlowNote has been uninstalled.`r`n`r`n$dataNote").Trim() }
exit 0
