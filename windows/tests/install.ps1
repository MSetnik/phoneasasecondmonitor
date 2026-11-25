$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/driver-consent.ps1"
. "$PSScriptRoot/driver-baseline.ps1"
$setup=(Get-ChildItem dist/*Setup.exe).FullName
$result=Start-Process $setup -ArgumentList '/S' -PassThru
$limit=(Get-Date).AddSeconds(100)
while(!$result.WaitForExit(1200) -and (Get-Date) -lt $limit){
  Confirm-TestDriverPublisher | Out-Null
}
if(!$result.HasExited -or $result.ExitCode -ne 0){
  $errors=Get-Content "$env:windir/inf/setupapi.dev.log" -Tail 160 | Where-Object {$_ -match '!!!|failed|error 0x'} | Select-Object -Last 8
  Add-Type -AssemblyName UIAutomationClient
  $titles=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }
  Write-Host "::notice::Installer test desktop windows: $($titles -join ', ')"
  throw "Installer did not complete successfully (exit $($result.ExitCode)). PnP: $($errors -join ' / ')"
}
$app=Join-Path $env:ProgramFiles 'MCODE\Phone as a Second Monitor'
try {
  $instance='ROOT\MCODEPASM\0000'
  $device=$null
  for($i=0;$i -lt 30;$i++){
    $device=Get-PnpDevice -InstanceId $instance -ErrorAction SilentlyContinue
    if($device -and $device.Status -eq 'OK'){break}
    Start-Sleep -Seconds 1
  }
  if(!$device -or $device.Status -ne 'OK'){
    $problem=(Get-PnpDeviceProperty -InstanceId $instance -KeyName DEVPKEY_Device_ProblemCode -ErrorAction SilentlyContinue).Data
    if($device){Get-PnpDeviceProperty -InstanceId $instance -KeyName DEVPKEY_Device_ProblemCode | Format-List}
    Get-Content "$env:windir/inf/setupapi.dev.log" -Tail 100
    throw "Windows did not start the display adapter. PnP status: $($device.Status). Problem code: $problem."
  }
  Write-Host 'The Windows PnP manager started the virtual display adapter.'
  # Inspect the package bound to this instance; the WMI IsSigned projection
  # can be absent for a newly registered root-enumerated UMDF adapter.
  $inf=$null
  for($i=0;$i -lt 15 -and !$inf;$i++){
    $inf=(Get-PnpDeviceProperty -InstanceId $instance -KeyName DEVPKEY_Device_DriverInfPath -ErrorAction SilentlyContinue).Data
    if(!$inf){Start-Sleep -Seconds 1}
  }
  $provider=(Get-PnpDeviceProperty -InstanceId $instance -KeyName DEVPKEY_Device_DriverProvider -ErrorAction SilentlyContinue).Data
  Write-Host "::notice::The installed adapter reports INF '$inf', provider '$provider' and status '$($device.Status)'."
  if($inf -notmatch '^oem[0-9]+\.inf$' -or $provider -ne 'MikeTheTech'){throw "The registered adapter is not bound to the expected virtual display package (INF '$inf', provider '$provider')."}
  $driver=Get-WindowsDriver -Online -Driver $inf
  $stores=@($driver | ForEach-Object {Split-Path $_.OriginalFileName} | Select-Object -Unique)
  if($stores.Count -ne 1){throw "Unexpected number of driver-store packages for $inf."}
  $store=$stores[0]
  foreach($file in @('mttvdd.cat','MttVDD.dll','MttVDD.inf')){
    if((Get-FileHash "$store/$file").Hash -ne (Get-FileHash "$app/driver/$file").Hash){throw "Installed driver store file differs from the pinned upstream package: $file"}
  }
  $signature=Get-AuthenticodeSignature "$store/mttvdd.cat"
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*SignPath Foundation*'){throw "The installed driver catalog is not valid: $($signature.Status)."}
  Write-Host '::notice::Verified the running adapter, installed driver files and SignPath catalog in the Windows driver store.'
  $children=(Get-PnpDeviceProperty -InstanceId $instance -KeyName DEVPKEY_Device_Children -ErrorAction SilentlyContinue).Data
  $settings=(Get-ItemProperty 'HKLM:\SOFTWARE\MikeTheTech\VirtualDisplayDriver' -ErrorAction SilentlyContinue).VDDPATH
  if($settings -and (Test-Path "$settings/vdd_settings.xml")){
    $hash=(Get-FileHash "$settings/vdd_settings.xml").Hash
    $activePreset=if($hash -eq (Get-FileHash "$app/driver/vdd_defaults.xml").Hash){'vendor defaults'}else{'phone modes'}
    Write-Host "::notice::The installed driver loaded the $activePreset configuration; monitor child '$($children -join ', ')'."
  }
  $monitors=@(Get-PnpDevice -PresentOnly -Class Monitor -ErrorAction SilentlyContinue | ForEach-Object {$_.InstanceId})
  $gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object {$_.Name})
  Write-Host "::notice::Windows test graphics: $($gpus -join ', '); monitor children on our adapter: $($children -join ', '); present monitors: $($monitors -join ', ')."
  $output=node windows/tests/bridge.cjs "$app/resources/MonitorHost.exe" 2>&1
  if($LASTEXITCODE){throw "Display helper IPC: $($output -join ' ')"}
  Write-Host "::notice::$($output -join ' ')"
  if ($env:PASM_TEST_DESKTOP -eq '1') {
    npm ci --prefix windows/tests --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE) {throw 'Desktop test dependency installation failed.'}
    if ($env:GITHUB_ACTIONS -eq 'true' -and $env:PASM_RUNNER_KIND -eq 'github-hosted') {
      $compiler="$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
      & $compiler /nologo /platform:x64 /out:dist\ProjectionTest.exe /reference:System.Windows.Forms.dll,System.Drawing.dll windows/tests/Projection.cs windows/native/Adapter.cs
      if ($LASTEXITCODE) {throw 'Could not compile the projection regression test.'}
      $projection= & dist/ProjectionTest.exe prepare-desktop 2>&1
      if ($LASTEXITCODE) {throw "Could not stage the projection test. $($projection -join ' ')"}
      Write-Host "::notice::$($projection -join ' ')"
    }
    $lines = node windows/tests/display.cjs 2>&1
    if ($LASTEXITCODE) {throw ("Extended desktop test: " + ($lines -join ' '))}
    Write-Host $lines
  }
}catch{
  $failure=$_
  try{Test-UpstreamMonitor}catch{Write-Host "::notice::Vendor baseline diagnostics: $($_.Exception.Message)"}
  throw $failure
}finally{
  $remove=Start-Process "$app/Uninstall.exe" -ArgumentList "/S _?=$app" -Wait -PassThru
  if($remove.ExitCode -ne 0){throw "Uninstall exited with $($remove.ExitCode)."}
  if(Get-PnpDevice -PresentOnly -InstanceId 'ROOT\MCODEPASM\0000' -ErrorAction SilentlyContinue){throw 'The app adapter is still installed.'}
}
