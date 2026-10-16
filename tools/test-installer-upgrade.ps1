param(
    [Parameter(Mandatory = $true)]
    [string]$Installer
)

$ErrorActionPreference = 'Stop'
# This test installs a machine service. Only run on the disposable Windows CI host.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Installer upgrade tests must run on a disposable Windows GitHub Actions runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Installer upgrade tests require an administrator runner.'
}

$Installer = (Resolve-Path -LiteralPath $Installer).Path
$installDirectory = Join-Path $env:RUNNER_TEMP 'EarsMixer upgrade test'
$dataDirectory = Join-Path $env:ProgramData 'EarsMixer'
$uninstallKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{A42F9674-2894-41BA-8BA6-729771736A80}_is1'
$logDirectory = Join-Path $PSScriptRoot '..\dist\installer-smoke'
if ((Get-Service EarsMixer -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $dataDirectory) -or
    (Test-Path -LiteralPath $installDirectory)) {
    throw 'Refusing to test over an existing EarsMixer installation or data folder.'
}
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Setup([string]$Name, [string[]]$ExtraArguments = @(), [bool]$ExpectSuccess = $true) {
    Write-Host "Starting installer check: $Name"
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    $log = Join-Path $logDirectory "$Name.log"
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/LOG=`"$log`"") + $ExtraArguments
    $process = Start-Process -FilePath $Installer -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) {
        $process.Kill()
        throw "Installer timed out: $Name. See $log"
    }
    $process.Refresh()
    Assert-True (($process.ExitCode -eq 0) -eq $ExpectSuccess) "Unexpected installer exit $($process.ExitCode): $Name. See $log"
    Write-Host ("Completed {0} in {1:N1}s (exit {2})." -f $Name, $elapsed.Elapsed.TotalSeconds, $process.ExitCode)
}

function Assert-Running {
    Write-Host 'Checking the service and mixer web response...'
    $service = Get-Service EarsMixer
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    $servicePath = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\EarsMixer').ImagePath
    Assert-True ($servicePath.Trim('"') -eq (Join-Path $installDirectory 'EarsMixerService.exe')) 'Service moved out of the custom installation directory.'
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:18081/' -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200) { Write-Host 'Service is running and the mixer responds.'; return }
        } catch { Start-Sleep -Milliseconds 250 }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The installed mixer did not respond after the update.'
}

try {
    Invoke-Setup 'fresh-install' @("/DIR=`"$installDirectory`"", '/TASKS=""')
    $originalVersion = (Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion
    Stop-Service EarsMixer
    (Get-Service EarsMixer).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))

    $configPath = Join-Path $dataDirectory 'config\global.json'
    $config = '{"debug":false,"server":{"port":18081},"osc":{"port":18082},"desk":{"ip":"","port":19000},"externalDevices":[]}'
    [IO.File]::WriteAllText($configPath, $config)
    $templatePath = Join-Path $dataDirectory 'data\upgrade-test.txt'
    $pluginPath = Join-Path $dataDirectory 'plugins\upgrade-test.txt'
    [IO.File]::WriteAllText($templatePath, 'saved template')
    [IO.File]::WriteAllText($pluginPath, 'saved plugin')
    $xmlPath = Join-Path $installDirectory 'EarsMixerService.xml'
    $xml = [IO.File]::ReadAllText($xmlPath).Replace('</service>', '<!-- keep custom service settings --></service>')
    [IO.File]::WriteAllText($xmlPath, $xml)
    Start-Service EarsMixer
    Assert-Running

    # Upgrade a running service, exercising numeric (rather than lexical) comparison.
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '0.0.9999'
    Invoke-Setup 'running-upgrade'
    Assert-Running
    Assert-True ((Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion -eq $originalVersion) 'Installed version was not updated.'
    Assert-True ((Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation.TrimEnd('\') -eq $installDirectory) 'Previous installation folder was not reused.'

    # Same-version repair must also work with a stopped service and missing wrapper.
    Stop-Service EarsMixer
    (Get-Service EarsMixer).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    Remove-Item -LiteralPath (Join-Path $installDirectory 'EarsMixerService.exe')
    Invoke-Setup 'stopped-service-repair'
    Assert-Running
    Assert-True ([IO.File]::ReadAllText($configPath) -eq $config) 'Saved mixer configuration changed.'
    Assert-True ([IO.File]::ReadAllText($templatePath) -eq 'saved template') 'Saved data changed.'
    Assert-True ([IO.File]::ReadAllText($pluginPath) -eq 'saved plugin') 'Saved plugin changed.'
    Assert-True ([IO.File]::ReadAllText($xmlPath) -eq $xml) 'Custom service XML changed.'

    # Legacy product names must migrate even when the install directory is reused.
    Stop-Service EarsMixer
    (Get-Service EarsMixer).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    [IO.File]::WriteAllText($xmlPath, $xml.Replace('EarsMixer.exe', 'OSCWebMixer2.exe'))
    Invoke-Setup 'legacy-service-config'
    Assert-Running
    Assert-True ([IO.File]::ReadAllText($xmlPath) -eq $xml) 'Legacy executable reference was not migrated.'

    # Rejection happens before shutdown or file replacement, including silent setup.
    $processId = (Get-CimInstance Win32_Service -Filter "Name='EarsMixer'").ProcessId
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '9999.0.0'
    Invoke-Setup 'blocked-downgrade' @() $false
    Assert-True ((Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion -eq '9999.0.0') 'Downgrade changed the registered version.'
    Assert-True ((Get-CimInstance Win32_Service -Filter "Name='EarsMixer'").ProcessId -eq $processId) 'Downgrade stopped the running service.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $logDirectory 'blocked-downgrade.log') -Raw) -match 'already installed') 'Downgrade failed for an unexpected reason.'
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value $originalVersion
    Write-Host 'Installer upgrade, repair, settings preservation and downgrade checks passed.'
} finally {
    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        Write-Host 'Uninstalling the test installation...'
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -PassThru
        if (-not $process.WaitForExit(120000)) { throw 'Test uninstall timed out.' }
        $process.Refresh()
        Assert-True ($process.ExitCode -eq 0) 'Test uninstall failed.'
        Assert-True (-not (Get-Service EarsMixer -ErrorAction SilentlyContinue)) 'Uninstall left the service registered.'
        Assert-True (Test-Path -LiteralPath $dataDirectory) 'Uninstall removed saved data.'
        Write-Host 'Test cleanup completed; saved data was retained.'
    }
}
