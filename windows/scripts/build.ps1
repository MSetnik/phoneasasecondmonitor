$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
Set-Location $root
New-Item -ItemType Directory -Force out | Out-Null
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$refs = "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8"
if (!(Test-Path "$refs/UIAutomationClient.dll")) { throw 'Install the .NET Framework 4.8 Developer Pack.' }
$libs = 'mscorlib.dll,System.dll,System.Core.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll,UIAutomationClient.dll,UIAutomationTypes.dll,WindowsBase.dll'
& $csc /nologo /noconfig /nostdlib+ /platform:x64 /optimize+ /out:out\MonitorHost.exe "/lib:$refs" "/reference:$libs" windows\native\Host.cs windows\native\Adapter.cs | ForEach-Object { Write-Host $_; if ($_ -match "error CS") { Write-Host "::error::$_" } }
if ($LASTEXITCODE) { throw "Native helper compilation failed with exit code $LASTEXITCODE." }
npm ci --prefix windows/app --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
python windows/scripts/package.py
if ($LASTEXITCODE) { throw 'Packaging failed.' }
$sig=Get-AuthenticodeSignature out/product/driver/mttvdd.cat
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notlike '*SignPath Foundation*') { throw "Driver signature verification failed: $($sig.Status)" }
$nsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
if (!(Test-Path $nsis)) { throw 'Install NSIS 3.x first.' }
Push-Location windows/installer
try {
  $lines = & $nsis /V3 setup.nsi 2>&1
  if ($LASTEXITCODE) { throw ("NSIS: " + (($lines | Select-Object -Last 8) -join " / ")) }
} finally { Pop-Location }
Get-FileHash dist/*.exe
