<#
.SYNOPSIS
  Uninstalls FlowNote, however it was installed (setup.exe or MSI).

.DESCRIPTION
  Runs packaging\windows\Uninstall-FlowNote.ps1 — the uninstaller shipped to
  users — so both stay identical. Parameters pass through:
    -RemoveData   also delete your notes
    -KeepData     keep them without asking
    -Silent       no window, no questions

.EXAMPLE
  .\scripts\windows\uninstall.ps1
  .\scripts\windows\uninstall.ps1 -Silent -RemoveData
#>
[CmdletBinding()]
param(
  [switch]$RemoveData,
  [switch]$KeepData,
  [switch]$Silent
)
$script = Join-Path $PSScriptRoot '..\..\packaging\windows\Uninstall-FlowNote.ps1'
& $script -RemoveData:$RemoveData -KeepData:$KeepData -Silent:$Silent
exit $LASTEXITCODE
