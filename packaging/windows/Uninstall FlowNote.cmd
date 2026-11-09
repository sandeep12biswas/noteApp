@echo off
rem Double-click wrapper for Uninstall-FlowNote.ps1 (must sit in the same folder).
rem Runs it with -ExecutionPolicy Bypass, since Windows blocks .ps1 scripts by
rem default. The script shows its own window to confirm, and asks whether to
rem delete your notes too.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Uninstall-FlowNote.ps1" %*
exit /b %ERRORLEVEL%
