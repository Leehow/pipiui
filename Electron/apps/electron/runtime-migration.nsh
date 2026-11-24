# Preserve electron-builder's process check before touching the legacy tree.
# Its old uninstaller moves files into $PLUGINSDIR\old-install; that prefix
# makes even successfully installed SDK paths exceed MAX_PATH. Rename the
# immutable runtime root first so both that uninstall and the new install fit.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    IfFileExists "$INSTDIR\resources\pipiui-embedded\manifest.json" 0 pipiui_runtime_done
    IfFileExists "$INSTDIR\resources\pi\*.*" pipiui_runtime_failed 0
    ClearErrors
    Rename "$INSTDIR\resources\pipiui-embedded" "$INSTDIR\resources\pi"
    IfErrors pipiui_runtime_failed pipiui_runtime_done
    pipiui_runtime_failed:
      MessageBox MB_OK|MB_ICONEXCLAMATION "PipiUI could not prepare its old runtime for upgrade. Please close PipiUI and run the installer again." /SD IDOK
      SetErrorLevel 2
      Quit
    pipiui_runtime_done:
  !endif
!macroend
