[CmdletBinding(DefaultParameterSetName='Sign')]
param(
    [Parameter(Mandatory, Position=0, ParameterSetName='Sign')][string]$File,
    [Parameter(Mandatory, ParameterSetName='Check')][switch]$CheckConfiguration
)
$ErrorActionPreference = 'Stop'
foreach ($name in 'PASM_SIGNTOOL','PASM_SIGNING_DLIB','PASM_SIGNING_METADATA') {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (!$value -or ![IO.Path]::IsPathRooted($value) -or !(Test-Path -LiteralPath $value -PathType Leaf)) {
        throw "Set $name to an absolute file path before signing. See windows/SIGNING.md."
    }
}
if ([string]::IsNullOrWhiteSpace($env:PASM_SIGNING_PUBLISHER)) {
    throw 'Set PASM_SIGNING_PUBLISHER to the verified certificate common name.'
}
$config = Get-Content -Raw -LiteralPath $env:PASM_SIGNING_METADATA | ConvertFrom-Json
if (!$config.CodeSigningAccountName -or !$config.CertificateProfileName -or
    $config.Endpoint -notmatch '^https://[a-z0-9]+\.codesigning\.azure\.net/?$') {
    throw 'Check the signing account, certificate profile and regional endpoint in the metadata file.'
}
if ($CheckConfiguration) { return }

$target = (Resolve-Path -LiteralPath $File).Path
& $env:PASM_SIGNTOOL sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $env:PASM_SIGNING_DLIB /dmdf $env:PASM_SIGNING_METADATA $target
if ($LASTEXITCODE -ne 0) { throw "SignTool could not sign $target." }
& $env:PASM_SIGNTOOL verify /pa /all /v $target
if ($LASTEXITCODE -ne 0) { throw "The Authenticode signature failed verification for $target." }
$signature = Get-AuthenticodeSignature -LiteralPath $target
if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
    throw "A valid, timestamped signature is required for $target."
}
$publisher = $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($publisher -cne $env:PASM_SIGNING_PUBLISHER) {
    throw "Unexpected publisher on ${target}: $publisher"
}
