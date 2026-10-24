FlowNote for Windows — preview build
====================================

INSTALL
  Run FlowNote_<version>_x64-setup.exe (recommended: installs for your user
  only, no admin rights needed). Or use the .msi if you prefer Windows
  Installer packages.

  These installers are not code-signed yet, so Windows may show
  "Windows protected your PC". Click "More info", then "Run anyway".

UNINSTALL — any one of these:
  1. Double-click "Uninstall FlowNote.cmd" (in this folder, next to
     Uninstall-FlowNote.ps1). It asks whether to delete your notes too.
  2. Settings -> Apps -> Installed apps -> FlowNote -> Uninstall.
  3. From PowerShell:
       powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1
       powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1 -RemoveData

WHERE YOUR DATA LIVES
  %APPDATA%\com.sandeep.flownote\flownote.sqlite3   (notes)
  %APPDATA%\com.sandeep.flownote\attachments\       (attached files)
  Uninstalling keeps these unless you choose to delete them, so a reinstall
  picks your notes back up.

KNOWN LIMITATIONS IN THIS PREVIEW
  - Plugins (e.g. the spreadsheet block) install but their blocks don't load.
  - Embedded images don't display (attaching a file as a file works).
  - AI shows "unavailable" (not built yet on any platform).
