; Build with npm run installer:windows. Keep AppId stable across releases.
#include "version.inc.iss"
#define AppExe "EarsMixer.exe"

[Setup]
AppId={{A42F9674-2894-41BA-8BA6-729771736A80}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\EarsMixer
UsePreviousAppDir=no
DefaultGroupName={#AppName}
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.14393
LicenseFile=..\LICENSE
SetupIconFile=..\web\images\favicon.ico
UninstallDisplayIcon={app}\{#AppExe}
OutputDir=..\dist
OutputBaseFilename={#OutputBase}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern polar hidebevels dynamic 
CloseApplications=yes
CloseApplicationsFilter=*.exe
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "traystartup"; Description: "Show the EarsMixer tray icon when signing in"; GroupDescription: "Startup:"

[Files]
Source: "..\dist\windows\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\windows\EarsMixerService.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "EarsMixerService.xml"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "..\dist\windows\EarsMixerTray.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\windows\WinSW-LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\web\images\favicon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\EarsMixer tray"; Filename: "{app}\EarsMixerTray.exe"; WorkingDir: "{app}"; IconFilename: "{app}\favicon.ico"
Name: "{group}\Settings and plugins"; Filename: "{commonappdata}\EarsMixer"
Name: "{group}\Uninstall EarsMixer"; Filename: "{uninstallexe}"
Name: "{autodesktop}\EarsMixer Service Manager"; Filename: "{app}\EarsMixerTray.exe"; WorkingDir: "{app}"; IconFilename: "{app}\favicon.ico"; Tasks: desktopicon
Name: "{commonstartup}\EarsMixer tray"; Filename: "{app}\EarsMixerTray.exe"; WorkingDir: "{app}"; Tasks: traystartup

[InstallDelete]
Type: files; Name: "{autodesktop}\Ears Mixer.lnk"; Tasks: desktopicon
Type: files; Name: "{autodesktop}\Start Ears Mixer Tray App.lnk"; Tasks: desktopicon
Type: files; Name: "{commonstartup}\Ears Mixer tray.lnk"
Type: files; Name: "{commonprograms}\Ears Mixer\Ears Mixer tray.lnk"
Type: files; Name: "{commonprograms}\Ears Mixer\Settings and plugins.lnk"
Type: files; Name: "{commonprograms}\Ears Mixer\Uninstall Ears Mixer.lnk"
Type: files; Name: "{commonprograms}\OSCWebMixer2 - Ears Mixer\Start Ears Mixer server.lnk"
Type: files; Name: "{commonprograms}\OSCWebMixer2 - Ears Mixer\Ears Mixer tray.lnk"
Type: files; Name: "{commonprograms}\OSCWebMixer2 - Ears Mixer\Open admin dashboard.lnk"
Type: files; Name: "{commonprograms}\OSCWebMixer2 - Ears Mixer\Settings and plugins.lnk"
Type: files; Name: "{commonprograms}\OSCWebMixer2 - Ears Mixer\Uninstall Ears Mixer.lnk"

[Dirs]
; Runtime data lives outside {app} and is retained on uninstall.
Name: "{commonappdata}\EarsMixer"; Permissions: users-readexec; Flags: uninsneveruninstall
Name: "{commonappdata}\EarsMixer\config"; Flags: uninsneveruninstall
Name: "{commonappdata}\EarsMixer\data"; Flags: uninsneveruninstall
Name: "{commonappdata}\EarsMixer\plugins"; Flags: uninsneveruninstall
Name: "{commonappdata}\EarsMixer\logs"; Flags: uninsneveruninstall

[Run]
Filename: "{app}\EarsMixerTray.exe"; Description: "Show EarsMixer tray icon"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{app}\EarsMixerTray.exe"; Parameters: "--exit"; Flags: runhidden skipifdoesntexist; RunOnceId: "CloseTray"
Filename: "{app}\EarsMixerService.exe"; Parameters: "stopwait"; Flags: runhidden skipifdoesntexist; RunOnceId: "StopService"
Filename: "{app}\EarsMixerService.exe"; Parameters: "uninstall"; Flags: runhidden skipifdoesntexist; RunOnceId: "RemoveService"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""EarsMixer server"" program=""{app}\{#AppExe}"""; Flags: runhidden; RunOnceId: "RemoveFirewallRule"

[Code]
var
  LegacyInstallDir: String;
  MigrateLegacyServiceConfig: Boolean;

function RunChecked(const Filename, Parameters: String): Boolean;
var
  ExitCode: Integer;
begin
  Result := Exec(Filename, Parameters, '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
  if Result then Result := ExitCode = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Wrapper: String;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\EarsMixerTray.exe')) then
    RunChecked(ExpandConstant('{app}\EarsMixerTray.exe'), '--exit');
  if RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\EarsMixer') then
  begin
    if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\EarsMixer', 'ImagePath', Wrapper) then
    begin
      Result := 'Cannot locate the existing EarsMixer service. Check Windows Services before upgrading.';
      Exit;
    end;
    StringChangeEx(Wrapper, '"', '', True);
    LegacyInstallDir := ExtractFileDir(Wrapper);
    MigrateLegacyServiceConfig := (CompareText(LegacyInstallDir, ExpandConstant('{app}')) <> 0) and
      not FileExists(ExpandConstant('{app}\EarsMixerService.xml'));
    if FileExists(LegacyInstallDir + '\EarsMixerTray.exe') then
      RunChecked(LegacyInstallDir + '\EarsMixerTray.exe', '--exit');
    if not RunChecked(Wrapper, 'stopwait') then
      Result := 'Cannot stop the EarsMixer service. Stop it in Windows Services and try again.';
  end;
end;

// Copy legacy settings once, without overwriting settings at the new location.
// Keep the old files intact so they can be recovered if migration fails.
procedure CopyTree(const Source, Destination: String);
var
  FindRec: TFindRec;
  FromPath, ToPath: String;
begin
  if not DirExists(Source) then Exit;
  if not ForceDirectories(Destination) then
    RaiseException('Cannot create settings directory: ' + Destination);
  if FindFirst(Source + '\*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then
        begin
          FromPath := Source + '\' + FindRec.Name;
          ToPath := Destination + '\' + FindRec.Name;
          if FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0 then
            CopyTree(FromPath, ToPath)
          else if not FileExists(ToPath) then
            if not CopyFile(FromPath, ToPath, False) then
              RaiseException('Cannot migrate settings file: ' + FromPath);
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

procedure CopySettings(const Source, Destination: String);
begin
  CopyTree(Source + '\config', Destination + '\config');
  CopyTree(Source + '\data', Destination + '\data');
  CopyTree(Source + '\plugins', Destination + '\plugins');
  CopyTree(Source + '\logs', Destination + '\logs');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Home, Wrapper, Command, ServiceXML: String;
  LegacyXML: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;
  Home := ExpandConstant('{commonappdata}\EarsMixer');
  if not FileExists(Home + '\.earsmixer-migrated') then
  begin
    // Machine settings take precedence over legacy per-user settings.
    CopySettings(ExpandConstant('{commonappdata}\OSCWebMixer2'), Home);
    CopySettings(ExpandConstant('{localappdata}\OSCWebMixer2'), Home);
    CopySettings(ExpandConstant('{localappdata}\EarsMixer'), Home);
    if not SaveStringToFile(Home + '\.earsmixer-migrated', 'Legacy settings migration checked.', False) then
      RaiseException('Cannot save the migration marker.');
  end;
  // Retain custom service options when moving out of the old install directory.
  if MigrateLegacyServiceConfig and FileExists(LegacyInstallDir + '\EarsMixerService.xml') then
  begin
    if not LoadStringFromFile(LegacyInstallDir + '\EarsMixerService.xml', LegacyXML) then
      RaiseException('Cannot read the previous service configuration.');
    ServiceXML := String(LegacyXML);
    StringChangeEx(ServiceXML, 'OSCWebMixer2.exe', 'EarsMixer.exe', True);
    StringChangeEx(ServiceXML, '%ProgramData%\OSCWebMixer2', '%ProgramData%\EarsMixer', True);
    StringChangeEx(ServiceXML, ExpandConstant('{commonappdata}\OSCWebMixer2'), Home, True);
    StringChangeEx(ServiceXML, 'Ears Mixer', 'EarsMixer', True);
    if not SaveStringToFile(ExpandConstant('{app}\EarsMixerService.xml'), ServiceXML, False) then
      RaiseException('Cannot migrate the previous service configuration.');
  end;
  // LocalService can write runtime data, without running the server as SYSTEM.
  if not RunChecked(ExpandConstant('{sys}\icacls.exe'), '"' + Home + '" /grant "*S-1-5-19:(OI)(CI)M" /T /Q') then
    RaiseException('Cannot grant the EarsMixer service access to its settings.');
  Wrapper := ExpandConstant('{app}\EarsMixerService.exe');
  if RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\EarsMixer') then
  begin
    Command := 'config EarsMixer binPath= "\"' + Wrapper + '\"" start= delayed-auto displayname= "{#AppName}"';
    if not RunChecked(ExpandConstant('{sys}\sc.exe'), Command) then
      RaiseException('Cannot update the EarsMixer service configuration.');
  end
  else if not RunChecked(Wrapper, 'install') then
    RaiseException('Cannot install the EarsMixer service. See the logs in ' + Home + '\logs');
  if LegacyInstallDir <> '' then
    RunChecked(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="Ears Mixer server" program="' +
      LegacyInstallDir + '\OSCWebMixer2.exe"');
  Command := 'advfirewall firewall delete rule name="EarsMixer server" program="' + ExpandConstant('{app}\{#AppExe}') + '"';
  RunChecked(ExpandConstant('{sys}\netsh.exe'), Command);
  Command := 'advfirewall firewall add rule name="EarsMixer server" dir=in action=allow program="' +
    ExpandConstant('{app}\{#AppExe}') + '" enable=yes profile=private protocol=any remoteip=localsubnet';
  if not RunChecked(ExpandConstant('{sys}\netsh.exe'), Command) then
    RaiseException('Cannot configure the private-network EarsMixer firewall rule.');
  if not RunChecked(Wrapper, 'start') then
    RaiseException('The EarsMixer service could not start. See the logs in ' + Home + '\logs');
end;
