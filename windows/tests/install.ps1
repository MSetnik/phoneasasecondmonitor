$ErrorActionPreference = 'Stop'
$setup=(Get-ChildItem dist/*Setup.exe).FullName
$result=Start-Process $setup -ArgumentList '/S' -Wait -PassThru
if($result.ExitCode -ne 0){throw "Installer exited with $($result.ExitCode)."}
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
    if($device){Get-PnpDeviceProperty -InstanceId $instance -KeyName DEVPKEY_Device_ProblemCode | Format-List}
    Get-Content "$env:windir/inf/setupapi.dev.log" -Tail 100
    throw 'Windows did not start the display adapter.'
  }
  Write-Host 'The Windows PnP manager started the virtual display adapter.'
  $installed=Get-CimInstance Win32_PnPSignedDriver | Where-Object DeviceID -eq $instance
  if(!$installed.IsSigned){throw 'Windows did not report a signed installed driver.'}
  $result='{"id":1,"op":"check"}' | & "$app\resources\MonitorHost.exe"
  if($LASTEXITCODE -or !($result | ConvertFrom-Json).PSObject.Properties['result']){throw 'The native helper failed.'}
}finally{
  $remove=Start-Process "$app/Uninstall.exe" -ArgumentList "/S _?=$app" -Wait -PassThru
  if($remove.ExitCode -ne 0){throw "Uninstall exited with $($remove.ExitCode)."}
  if(Get-PnpDevice -PresentOnly -InstanceId 'ROOT\MCODEPASM\0000' -ErrorAction SilentlyContinue){throw 'The app adapter is still installed.'}
}
