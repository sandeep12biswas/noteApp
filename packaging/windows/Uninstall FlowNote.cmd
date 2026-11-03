@echo off
rem Double-click wrapper for Uninstall-FlowNote.ps1 (must sit in the same folder).
rem Runs it with -ExecutionPolicy Bypass, since Windows blocks .ps1 scripts by default.
setlocal
echo This will uninstall FlowNote from this computer.
echo.
set "REMOVE="
set /p "ANSWER=Also delete your FlowNote notes and data? This cannot be undone. [y/N] "
if /i "%ANSWER%"=="y" set "REMOVE=-RemoveData"
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-FlowNote.ps1" %REMOVE%
set "CODE=%ERRORLEVEL%"
echo.
pause
exit /b %CODE%
