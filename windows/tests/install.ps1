$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/driver-consent.ps1"
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
  $installed=Get-CimInstance Win32_PnPSignedDriver | Where-Object DeviceID -eq $instance
  if(!$installed.IsSigned){throw 'Windows did not report a signed installed driver.'}
  $result='{"id":1,"op":"check"}' | & "$app\resources\MonitorHost.exe"
  if($LASTEXITCODE -or !($result | ConvertFrom-Json).PSObject.Properties['result']){throw 'The native helper failed.'}
  if ($env:PASM_TEST_DESKTOP -eq '1') {
    npm ci --prefix windows/tests --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE) {throw 'Desktop test dependency installation failed.'}
    $lines = node windows/tests/display.cjs 2>&1
    if ($LASTEXITCODE) {throw ("Extended desktop test: " + ($lines -join ' '))}
    Write-Host $lines
  }
}finally{
  $remove=Start-Process "$app/Uninstall.exe" -ArgumentList "/S _?=$app" -Wait -PassThru
  if($remove.ExitCode -ne 0){throw "Uninstall exited with $($remove.ExitCode)."}
  if(Get-PnpDevice -PresentOnly -InstanceId 'ROOT\MCODEPASM\0000' -ErrorAction SilentlyContinue){throw 'The app adapter is still installed.'}
}
