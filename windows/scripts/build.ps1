param([switch]$SignRelease)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
Set-Location $root
$signer = Join-Path $PSScriptRoot 'sign-release.ps1'
if ($SignRelease) { & $signer -CheckConfiguration }
New-Item -ItemType Directory -Force out | Out-Null
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$refs = "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8"
if (!(Test-Path "$refs/UIAutomationClient.dll")) { throw 'Install the .NET Framework 4.8 Developer Pack.' }
$libs = 'mscorlib.dll,System.dll,System.Core.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll,UIAutomationClient.dll,UIAutomationTypes.dll,WindowsBase.dll'
& $csc /nologo /noconfig /nostdlib+ /platform:x64 /optimize+ /out:out\MonitorHost.exe "/lib:$refs" "/reference:$libs" windows\native\Host.cs windows\native\Adapter.cs windows\native\SwipeWheel.cs | ForEach-Object { Write-Host $_; if ($_ -match "error CS") { Write-Host "::error::$_" } }
if ($LASTEXITCODE) { throw "Native helper compilation failed with exit code $LASTEXITCODE." }
npm ci --prefix windows/app --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
python windows/scripts/package.py
if ($LASTEXITCODE) { throw 'Packaging failed.' }
$sig=Get-AuthenticodeSignature out/product/driver/mttvdd.cat
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notlike '*SignPath Foundation*') { throw "Driver signature verification failed: $($sig.Status)" }
$nsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
if (!(Test-Path $nsis)) { throw 'Install NSIS 3.x first.' }
$fileName = 'Phone-as-a-Second-Monitor-Windows-x64-Setup.exe'
$options = @('/V3')
if ($SignRelease) {
  & $signer "$root/out/product/PhoneAsMonitor.exe"
  & $signer "$root/out/product/resources/MonitorHost.exe"
  New-Item -ItemType Directory -Force out/signed-candidate | Out-Null
  $options += "/DMCODE_SIGN_SCRIPT=$signer"
}
Push-Location windows/installer
try {
  $lines = & $nsis @options setup.nsi 2>&1
  if ($LASTEXITCODE) { throw ("NSIS: " + (($lines | Select-Object -Last 8) -join " / ")) }
} finally { Pop-Location }
if ($SignRelease) {
  $candidate = Join-Path "$root/out/signed-candidate" $fileName
  & $signer $candidate
  New-Item -ItemType Directory -Force dist/signed | Out-Null
  Move-Item -Force -LiteralPath $candidate -Destination "dist/signed/$fileName"
  Get-FileHash "dist/signed/$fileName"
} else {
  Get-FileHash "dist/$fileName"
}
