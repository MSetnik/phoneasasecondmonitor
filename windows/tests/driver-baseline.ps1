# Isolate the runner's graphics support from the application's custom display modes.
# This runs only after an installed-app test failure in a disposable hosted VM.
function Test-UpstreamMonitor {
  if($env:GITHUB_ACTIONS -ne 'true' -or $env:PASM_RUNNER_KIND -ne 'github-hosted'){return}
  $device='ROOT\MCODEPASM\0000'
  $children=(Get-PnpDeviceProperty -InstanceId $device -KeyName DEVPKEY_Device_Children -ErrorAction SilentlyContinue).Data
  if($children){return}
  $key='HKLM:\SOFTWARE\MikeTheTech\VirtualDisplayDriver'
  $original=(Get-ItemProperty $key).VDDPATH
  $dir=Join-Path $env:windir 'ServiceProfiles\LocalService\AppData\Local\MCODE-Driver-Test'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $zip="$dir/vendor.zip"
  curl.exe --location --fail --silent --show-error 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip' -o $zip
  if($LASTEXITCODE -or (Get-FileHash $zip).Hash -ne 'E24210692B442B39AF763536330CE78B423F19342B7A7792C26DE3944E418B3A'){throw 'Unexpected vendor baseline package.'}
  Expand-Archive $zip "$dir/upstream" -Force
  $xml=[xml](Get-Content "$dir/upstream/VirtualDisplayDriver/vdd_settings.xml" -Raw)
  $xml.vdd_settings.options.logging='true'
  $xml.vdd_settings.options.debuglogging='true'
  $xml.Save("$dir/vdd_settings.xml")
  try{
    Set-ItemProperty $key -Name VDDPATH -Value $dir
    pnputil.exe /restart-device $device | Out-Host
    Start-Sleep -Seconds 10
    $after=(Get-PnpDeviceProperty -InstanceId $device -KeyName DEVPKEY_Device_Children -ErrorAction SilentlyContinue).Data
    $events=@(Get-ChildItem "$dir/Logs" -File -ErrorAction SilentlyContinue | ForEach-Object {Get-Content $_.FullName} |
      Where-Object {$_ -match 'failed|error|adapter initialization|GPU found|monitor arrival|GPU selected|adapter init|no GPU'} | Select-Object -Last 8)
    Write-Host "::notice::Vendor default resolution configuration, Windows Server 2022: child monitors '$($after -join ', ')'. Driver diagnostics: $($events -join ' / ')"
  }finally{
    if($original){Set-ItemProperty $key -Name VDDPATH -Value $original}else{Remove-ItemProperty $key -Name VDDPATH -ErrorAction SilentlyContinue}
  }
}
