<#
.SYNOPSIS
  Builds FlowNote's Windows release bundle from this source tree, from a
  clean slate.

.DESCRIPTION
  Produces, under dist-release\:
    FlowNote-<ver>-windows-x64\
      FlowNote_<ver>_x64-setup.exe      setup wizard (per-user, no admin)
      FlowNote_<ver>_x64_en-US.msi      Windows Installer package
      Uninstall FlowNote.cmd            double-click uninstaller
      Uninstall-FlowNote.ps1            (for either install)
      README.txt  RELEASE-NOTICE.txt  VERSION
      docs\FlowNote-Guide.{pdf,docx}
      SHA256SUMS.txt
    FlowNote-<ver>-windows-x64.zip      the bundle, zipped

  Steps: clean old outputs -> sync VERSION into the manifests -> pnpm
  install -> tauri build (frontend + release binary + NSIS + MSI) ->
  assemble -> checksum -> zip.

  Needs Windows with pnpm, node, cargo/rustup and the Tauri prerequisites
  (Visual Studio C++ Build Tools; WebView2 ships with Windows 11). The guide
  (FlowNote-Guide.pdf/.docx) is taken from docs\ (generate it on Linux with
  `pnpm docs`).

.PARAMETER NoClean
  Keep previous build outputs (faster incremental rebuild).

.PARAMETER SkipInstall
  Don't run `pnpm install --frozen-lockfile` first.

.EXAMPLE
  .\scripts\windows\package.ps1
#>
[CmdletBinding()]
param(
  [switch]$NoClean,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Assert-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "'$name' is required but was not found on PATH." }
}
function Invoke-Checked([string]$what, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

Assert-Command pnpm
Assert-Command node
Assert-Command cargo

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $RepoRoot 'pnpm-workspace.yaml'))) { throw "$RepoRoot doesn't look like the FlowNote repo" }
$Version = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
if (-not $Version) { throw 'VERSION is empty' }
$Name = "FlowNote-$Version-windows-x64"
$OutDir = Join-Path $RepoRoot 'dist-release'
$Bundle = Join-Path $OutDir $Name
# Cargo workspace target dir (the Tauri app is a workspace member).
$TauriBundleDir = Join-Path $RepoRoot 'target\release\bundle'

Push-Location $RepoRoot
try {
  if (-not $NoClean) {
    Step 'Cleaning previous build outputs'
    foreach ($rel in 'packages\frontend\dist', 'target\release\bundle', 'dist-release') {
      $path = Join-Path $RepoRoot $rel
      if (Test-Path $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
  }

  Step "Setting version $Version"
  Invoke-Checked 'sync-version' { node scripts/sync-version.mjs }

  if (-not $SkipInstall) {
    Step 'Installing workspace dependencies'
    Invoke-Checked 'pnpm install' { pnpm install --frozen-lockfile }
  }

  # `tauri build` runs tauri.conf.json's beforeBuildCommand (the frontend
  # build) itself, then builds the release binary and both installers.
  Step 'Building FlowNote and its installers (NSIS setup.exe + MSI)'
  Invoke-Checked 'tauri build' { pnpm --filter @flownote/tauri tauri build --bundles nsis,msi }

  Step "Assembling $Name"
  New-Item -ItemType Directory -Force (Join-Path $Bundle 'docs') | Out-Null
  $setup = Get-ChildItem (Join-Path $TauriBundleDir 'nsis') -Filter "*_$Version*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $msi = Get-ChildItem (Join-Path $TauriBundleDir 'msi') -Filter "*_$Version*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { throw "no setup.exe for $Version under $TauriBundleDir\nsis" }
  if (-not $msi) { throw "no .msi for $Version under $TauriBundleDir\msi" }
  Copy-Item $setup.FullName, $msi.FullName $Bundle
  Copy-Item (Join-Path $RepoRoot 'packaging\windows\*') $Bundle
  Copy-Item (Join-Path $RepoRoot 'packaging\RELEASE-NOTICE.txt') $Bundle
  Set-Content -Path (Join-Path $Bundle 'VERSION') -Value $Version -NoNewline
  # Not `$name`: PowerShell variables ignore case, so that would overwrite
  # $Name (the bundle name).
  foreach ($ext in 'pdf', 'docx') {
    $guide = "FlowNote-Guide.$ext"
    $src = Join-Path $RepoRoot "docs\$guide"
    if (Test-Path $src) { Copy-Item $src (Join-Path $Bundle 'docs') }
    else { Write-Warning "docs\$guide is missing (run: pnpm docs); the bundle won't include it" }
  }

  Step 'Writing SHA256SUMS.txt'
  $sums = Get-ChildItem $Bundle -Recurse -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($Bundle.Length + 1).Replace('\', '/')
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $rel
  }
  Set-Content -Path (Join-Path $Bundle 'SHA256SUMS.txt') -Value $sums

  Step 'Zipping'
  $zip = Join-Path $OutDir "$Name.zip"
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path $Bundle -DestinationPath $zip
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  Set-Content -Path (Join-Path $OutDir "$Name.zip.sha256") -Value "$hash  $Name.zip"

  Step 'Done'
  Get-ChildItem $OutDir | Format-Table Name, Length
  Write-Host "Install:   $Bundle\$($setup.Name)   (or the .msi)"
  Write-Host "Uninstall: Start Menu -> FlowNote -> Uninstall FlowNote, or $Bundle\Uninstall FlowNote.cmd"
}
finally {
  Pop-Location
}
