# Uninstalls FlowNote by finding its registered uninstall entry in the
# Windows registry — the same one Settings > Apps / Programs and Features
# reads from — and running it. Works whether the last install used the
# .msi or the NSIS setup .exe (tauri.conf.json's `bundle.targets: "all"`
# produces both; either registers under the Uninstall key below), and
# regardless of whether scripts\windows\install.ps1 ran silently.
#
# Deliberately avoids `Get-CimInstance Win32_Product`, which silently
# reconfigures/repairs every other installed MSI package as a side effect
# of enumerating them — the registry scan below only reads.
#
# Usage:
#   .\scripts\windows\uninstall.ps1            # runs the uninstaller with its normal UI
#   .\scripts\windows\uninstall.ps1 -Silent    # passes /qn (msi) or /S (NSIS) for an unattended uninstall

[CmdletBinding()]
param(
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'

$UninstallKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$Entry = Get-ItemProperty -Path $UninstallKeys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'FlowNote' } |
    Select-Object -First 1

if (-not $Entry) {
    Write-Warning "FlowNote doesn't appear to be registered as installed (no 'FlowNote' entry under the Windows Uninstall registry key)."
    exit 1
}

# Prefer QuietUninstallString when present (both msiexec- and NSIS-generated
# entries can carry one) since it's the vendor-supplied silent form; fall
# back to UninstallString otherwise, adding our own silent flag if asked.
$Command = if ($Silent -and $Entry.QuietUninstallString) {
    $Entry.QuietUninstallString
} else {
    $Entry.UninstallString
}

if (-not $Command) {
    Write-Error "Found FlowNote's registry entry but it has no UninstallString — remove it manually via Settings > Apps."
    exit 1
}

if ($Silent -and $Command -eq $Entry.UninstallString) {
    # No QuietUninstallString was available — append the right silent flag
    # ourselves: msiexec entries look like 'MsiExec.exe /X{GUID}', NSIS
    # entries point at an uninstall.exe.
    if ($Command -match 'msiexec' -or $Command -match 'MsiExec') {
        $Command = "$Command /qn"
    } else {
        $Command = "$Command /S"
    }
}

Write-Host "==> Uninstalling FlowNote: $Command"
# UninstallString is a full command line (often with quoted paths/args) —
# cmd /c parses it the same way Windows itself does when a user clicks
# "Uninstall" in Settings.
$proc = Start-Process cmd.exe -ArgumentList "/c $Command" -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Error "Uninstaller exited with code $($proc.ExitCode)"
    exit $proc.ExitCode
}

Write-Host '==> FlowNote uninstalled. Your notes (SQLite DB under your user data dir) were not touched.'
