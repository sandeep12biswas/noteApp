; FlowNote NSIS installer hooks (tauri.conf.json -> bundle.windows.nsis.installerHooks).
;
; Tauri's own installer template already provides the wizard pages (welcome,
; release notice, install folder, Start Menu folder, finish with "Run FlowNote"
; and "Create desktop shortcut"), closes a running FlowNote before installing
; or uninstalling, and offers "Delete the application data" when uninstalling.
; These hooks add what's specific to FlowNote:
;   - Start Menu entries for the Installation, User and Feature Guide PDFs (shipped
;     as bundle resources under $INSTDIR\docs) and for the uninstaller;
;   - removing those entries again on uninstall, before the template removes
;     the (then empty) Start Menu folder.
;
; $AppStartMenuFolder and the MUI_STARTMENU_* macros come from the template;
; MUI_STARTMENU_WRITE_BEGIN/END skips everything when the user ticked
; "Do not create shortcuts".

!macro FLOWNOTE_DELETE_EXTRA_SHORTCUTS
  Delete "$SMPROGRAMS\$AppStartMenuFolder\FlowNote Installation Guide.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\FlowNote User Guide.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\FlowNote Feature Guide.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\Uninstall FlowNote.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    ${If} ${FileExists} "$INSTDIR\docs\FlowNote-Installation-Guide.pdf"
      CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\FlowNote Installation Guide.lnk" "$INSTDIR\docs\FlowNote-Installation-Guide.pdf"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\docs\FlowNote-User-Guide.pdf"
      CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\FlowNote User Guide.lnk" "$INSTDIR\docs\FlowNote-User-Guide.pdf"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\docs\FlowNote-Feature-Guide.pdf"
      CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\FlowNote Feature Guide.lnk" "$INSTDIR\docs\FlowNote-Feature-Guide.pdf"
    ${EndIf}
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Uninstall FlowNote.lnk" "$INSTDIR\uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
  !insertmacro FLOWNOTE_DELETE_EXTRA_SHORTCUTS
!macroend
