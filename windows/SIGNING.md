# Sign the Windows website installer as MCODE

A verified Authenticode signature lets Windows show the verified legal publisher when Setup asks to install the virtual display driver. Microsoft Defender SmartScreen also considers the download history of the file and its publisher. A newly signed website download can still show **Windows protected your PC**. The bundled driver has its own SignPath Foundation catalog. [Microsoft's explanation of SmartScreen reputation](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)

## 1. Verify the business in Azure

1. Use MCODE's Microsoft Entra tenant and Azure subscription. In **Subscriptions → Resource providers**, register `Microsoft.CodeSigning`. In **Artifact Signing Accounts → Create**, choose the subscription, resource group, **West Europe** and **Basic**. Microsoft lists pricing from US$9.99/month. Confirm the price and currency in Azure before creating the account. [Azure setup](https://learn.microsoft.com/azure/artifact-signing/quickstart) · [Pricing](https://azure.microsoft.com/pricing/details/trusted-signing/)
2. Assign the person doing verification the **Artifact Signing Identity Verifier** role on that account. Open **Identity validations → Organization → New identity → Public**. Microsoft supports organizations registered in the EU and will assess MCODE's registration as a Croatian *obrt*. Use the full legal name and address exactly as recorded in the Croatian trade register, the registration identifier the form requests, and the business-owned website. Compare **Certificate subject preview** with the registry before submitting. [Organization requirements](https://learn.microsoft.com/azure/artifact-signing/quickstart)
3. Provide two different monitored addresses on the same domain owned by MCODE. Use an individual mailbox on that domain as primary. A shared support mailbox can be secondary. The owner completes Microsoft's identity check in the portal. Have a current trade-register extract and evidence of domain ownership available if Microsoft requests them. Watch the primary mailbox for **Action required** until the portal shows **Completed**. [Identity validation](https://learn.microsoft.com/azure/artifact-signing/quickstart)
4. Under **Certificate profiles**, create a **Public Trust** profile linked to the completed validation. Record the approved publisher common name and the account's regional endpoint. Grant the release operator **Artifact Signing Certificate Profile Signer** on this specific profile. [Profile setup and roles](https://learn.microsoft.com/azure/artifact-signing/quickstart)

## 2. Configure the Windows build machine

Use the project's normal x64 packaging tools (Node.js, Python 3.11+, .NET Framework 4.8 Developer Pack and NSIS 3) plus Azure CLI, the x64 .NET runtime required by the signing client, Windows SDK x64 SignTool and the matching Microsoft Artifact Signing client DLL. Microsoft maintains the compatible tool versions and provides a combined installer. [Microsoft signing tools and dependencies](https://learn.microsoft.com/azure/artifact-signing/how-to-signing-integrations)

Save the metadata outside this repository, for example at `C:\MCODE\signing\metadata.json`. Replace the example account and profile with the names from Azure. The endpoint below is for West Europe.

```json
{
  "Endpoint": "https://weu.codesigning.azure.net",
  "CodeSigningAccountName": "your-signing-account",
  "CertificateProfileName": "your-public-trust-profile"
}
```

In PowerShell at the repository root, sign in as the release operator and set the following variables to the installed file paths and the exact approved common name.

```powershell
az login --tenant "<MCODE tenant ID>"
$env:PASM_SIGNTOOL = "C:\path\to\x64\signtool.exe"
$env:PASM_SIGNING_DLIB = "C:\path\to\x64\Azure.CodeSigning.Dlib.dll"
$env:PASM_SIGNING_METADATA = "C:\MCODE\signing\metadata.json"
$env:PASM_SIGNING_PUBLISHER = "<approved certificate common name>"
.\windows\scripts\build.ps1 -SignRelease
```

The build signs the app and display helper, signs the uninstaller before embedding it, then signs the final installer. Each step verifies the signature chain, timestamp and publisher. A successful run prints the SHA-256 of `dist\signed\Phone-as-a-Second-Monitor-Windows-x64-Setup.exe`. The ordinary build produces an unsigned preview in `dist\`. [SignTool integration](https://learn.microsoft.com/azure/artifact-signing/how-to-signing-integrations)

## 3. Check the download before release

1. Use the signed file and hash from the successful build. Upload it to the project's versioned download storage and test this exact file on a clean Windows PC before switching the website link.
2. Right-click the downloaded installer and open **Properties → Digital Signatures → Details**. Confirm that the signature is valid. During installation, confirm that the elevation dialog shows MCODE's verified legal name. Once installed, check the app, display helper and uninstaller with `Get-AuthenticodeSignature`. Pair a phone and test the virtual display.
3. Point the website download to that tested hash. Download it again through the public link and compare `(Get-FileHash .\Phone-as-a-Second-Monitor-Windows-x64-Setup.exe -Algorithm SHA256).Hash` with the signed build output.
