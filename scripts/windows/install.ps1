# Builds FlowNote's Windows shell (apps/tauri, Tauri v2 — Windows/macOS are
# Tauri, not Electron; see apps/electron/electron-builder.yml's own comment)
# from this source tree and runs the generated installer.
#
# tauri.conf.json's `bundle.targets: "all"` produces both an .msi and an
# NSIS setup .exe under apps/tauri/src-tauri/target/release/bundle/. This
# script prefers the .msi: it registers a clean product code under Windows'
# own Programs and Features / Settings > Apps, which scripts\windows\
# uninstall.ps1 (and Windows' own UI) can then remove without hunting for a
# separate uninstaller binary.
#
# Usage (from a PowerShell prompt, repo root or anywhere):
#   .\scripts\windows\install.ps1            # runs the .msi with its normal UI
#   .\scripts\windows\install.ps1 -Silent    # msiexec /qn, no prompts

[CmdletBinding()]
param(
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'

function Assert-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Error "'$name' is required but was not found on PATH."
        exit 1
    }
}

Assert-Command pnpm
Assert-Command node
Assert-Command cargo

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TauriDir = Join-Path $RepoRoot 'apps\tauri'

Write-Host '==> Installing workspace dependencies'
Push-Location $RepoRoot
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }

    Write-Host '==> Building FlowNote (frontend + Tauri bundle: .msi + NSIS .exe)'
    # tauri.conf.json's beforeBuildCommand already builds the frontend
    # (`pnpm --filter @flownote/frontend build`); `tauri build` runs that
    # for us, then compiles src-tauri and bundles the installers.
    pnpm --filter @flownote/tauri exec tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

$BundleDir = Join-Path $TauriDir 'src-tauri\target\release\bundle'
$MsiPath = Get-ChildItem -Path (Join-Path $BundleDir 'msi') -Filter '*.msi' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $MsiPath) {
    Write-Error "No .msi found under $BundleDir\msi — check the tauri build output above for errors."
    exit 1
}

Write-Host "==> Running installer: $($MsiPath.FullName)"
if ($Silent) {
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$($MsiPath.FullName)`" /qn /norestart" -Wait -PassThru
} else {
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$($MsiPath.FullName)`"" -Wait -PassThru
}

if ($proc.ExitCode -ne 0) {
    Write-Error "msiexec exited with code $($proc.ExitCode)"
    exit $proc.ExitCode
}

Write-Host '==> Installed. Launch FlowNote from the Start menu.'
