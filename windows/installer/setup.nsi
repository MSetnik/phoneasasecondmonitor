Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
Name "Phone as a Second Monitor"
OutFile "..\..\dist\Phone-as-a-Second-Monitor-Windows-x64-Setup.exe"
InstallDir "$PROGRAMFILES64\MCODE\Phone as a Second Monitor"
RequestExecutionLevel admin
SetCompressor lzma
Icon "..\..\out\monitor.ico"
UninstallIcon "..\..\out\monitor.ico"
ShowInstDetails show
VIProductVersion "1.0.1.0"
VIAddVersionKey /LANG=1033 "ProductName" "Phone as a Second Monitor"
VIAddVersionKey /LANG=1033 "CompanyName" "MCODE"
VIAddVersionKey /LANG=1033 "FileDescription" "Windows x64 installer"
VIAddVersionKey /LANG=1033 "FileVersion" "1.0.1"
VIAddVersionKey /LANG=1033 "LegalCopyright" "MCODE"
!define MUI_WELCOMEPAGE_TEXT "Setup installs the Windows app and the virtual display driver that creates your second monitor. Windows may ask you to approve the signed driver. The app can connect to phones on your private local network. You approve each device before it can see the display."
!define MUI_FINISHPAGE_TEXT "Open Phone as a Second Monitor from Start to pair your phone. Use the same private Wi-Fi network on both devices."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!define APPKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MCODEPhoneAsMonitor"
!define VDDKEY "SOFTWARE\MikeTheTech\VirtualDisplayDriver"
Function .onInit
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_OK "This installer requires 64-bit Windows on an Intel or AMD processor."
    Abort
  ${EndIf}
FunctionEnd
Section
  SetRegView 64
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  File /r "..\..\out\product\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${APPKEY}" "DisplayName" "Phone as a Second Monitor"
  WriteRegStr HKLM "${APPKEY}" "Publisher" "MCODE"
  WriteRegStr HKLM "${APPKEY}" "DisplayVersion" "1.0.1"
  WriteRegStr HKLM "${APPKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${APPKEY}" "DisplayIcon" "$INSTDIR\monitor.ico"
  ReadRegStr $1 HKLM "${VDDKEY}" "VDDPATH"
  ${If} $1 == ""
  ${AndIfNot} ${FileExists} "C:\VirtualDisplayDriver\*.*"
    WriteRegStr HKLM "${VDDKEY}" "VDDPATH" "$INSTDIR\driver"
  ${EndIf}
  ${DisableX64FSRedirection}
  nsExec::ExecToLog /TIMEOUT=240000 '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\driver\MttVDD.inf"'
  Pop $0
  ${EnableX64FSRedirection}
  ${If} $0 != 0
  ${AndIf} $0 != 3010
    DetailPrint "Windows rejected the virtual monitor driver (code $0)."
    SetErrorLevel 1
    Abort "Windows could not stage the display driver. See installation details."
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\resources\MonitorHost.exe" install'
  Pop $0
  ${If} $0 == 3010
    SetRebootFlag true
  ${ElseIf} $0 != 0
    SetErrorLevel 1
    Abort "Windows could not bind the driver to the virtual monitor."
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="MCODE Phone as a Second Monitor" program="$INSTDIR\PhoneAsMonitor.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="MCODE Phone as a Second Monitor" dir=in action=allow program="$INSTDIR\PhoneAsMonitor.exe" profile=private remoteip=LocalSubnet'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Allow Phone as a Second Monitor on your private network in Windows Firewall."
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\Phone as a Second Monitor.lnk" "$INSTDIR\PhoneAsMonitor.exe" "" "$INSTDIR\monitor.ico"
SectionEnd
Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  nsExec::ExecToLog '"$INSTDIR\resources\MonitorHost.exe" uninstall'
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 1
    Abort "Close the app from the system tray and try uninstalling again."
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="MCODE Phone as a Second Monitor" program="$INSTDIR\PhoneAsMonitor.exe"'
  Pop $0
  ReadRegStr $1 HKLM "${VDDKEY}" "VDDPATH"
  ${If} $1 == "$INSTDIR\driver"
    DeleteRegValue HKLM "${VDDKEY}" "VDDPATH"
  ${EndIf}
  Delete "$SMPROGRAMS\Phone as a Second Monitor.lnk"
  DeleteRegKey HKLM "${APPKEY}"
  !include "..\..\out\uninstall-files.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
