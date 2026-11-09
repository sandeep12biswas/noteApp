FlowNote for Windows
====================

Step-by-step instructions: docs\FlowNote-Installation-Guide.pdf
Using FlowNote: docs\FlowNote-User-Guide.pdf and docs\FlowNote-Feature-Guide.pdf
(each guide is also included as an editable Word .docx)
(all three are also in the Start Menu after installing, under FlowNote).

INSTALL
  Double-click FlowNote_<version>_x64-setup.exe and follow the wizard
  (recommended: installs for your user only, no admin rights needed). You
  can choose the install folder and Start Menu folder, and create a desktop
  shortcut on the last page.

  Or use FlowNote_<version>_x64_en-US.msi if you prefer Windows Installer
  packages (installs for all users; needs admin rights).

  Unattended:  FlowNote_<version>_x64-setup.exe /S
               msiexec /i FlowNote_<version>_x64_en-US.msi /qn

  These installers are not code-signed yet, so Windows may show
  "Windows protected your PC". Click "More info", then "Run anyway".

UNINSTALL — any one of these:
  1. Start Menu -> FlowNote -> Uninstall FlowNote.
  2. Settings -> Apps -> Installed apps -> FlowNote -> Uninstall.
  3. Double-click "Uninstall FlowNote.cmd" in this folder. It finds either
     install and asks whether to delete your notes too.
  4. From PowerShell:
       powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1
       powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1 -RemoveData
       powershell -ExecutionPolicy Bypass -File .\Uninstall-FlowNote.ps1 -Silent -KeepData

WHERE YOUR DATA LIVES
  %APPDATA%\com.sandeep.flownote\flownote.sqlite3   (notes)
  %APPDATA%\com.sandeep.flownote\attachments\       (attached files)
  Uninstalling keeps these unless you choose to delete them, so a reinstall
  picks your notes back up.

CHECKING THE DOWNLOAD
  In PowerShell:  Get-FileHash .\FlowNote_*-setup.exe -Algorithm SHA256
  and compare with SHA256SUMS.txt.
