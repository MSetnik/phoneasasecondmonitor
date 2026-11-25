# Phone as a Second Monitor for Windows

A Windows x64 host for Android and iOS browsers. Both devices use the same private network. Start the app from the Start menu, scan the QR code and approve the device on the PC. Touch and keyboard control are opt-in. The app remains available in the notification area after closing its window. Choose Quit there to stop it completely.

## Build the website installer

Use Windows 10 22H2 or Windows 11 x64, Node 22+, Python 3.11+, NSIS 3 and the .NET Framework 4.8 Developer Pack. Run from the repository root:

```powershell
node --test windows/tests/*.test.js
./windows/scripts/build.ps1
```

The installer is written to `dist/Phone-as-a-Second-Monitor-Windows-x64-Setup.exe`. Setup requires administrator approval to stage the pinned MIT-licensed VirtualDrivers user-mode driver and register the product's display adapter. The interactive app runs as the signed-in user. A private-network, local-subnet firewall rule allows the phone to connect. The signing identity on the upstream driver catalog belongs to SignPath Foundation. The installer has a separate publisher signature when signed by the distributor.

The host attaches only its own adapter and checks that Windows has extended the desktop before capture. If the OS has duplicated the screens, use Settings → System → Display → Extend. Resolution is selected from the driver's advertised modes, including portrait and Fold modes. Refresh targets depend on the monitor, receiver, Wi-Fi and video encoder. The viewer supports WebRTC video and encrypted keyboard control, with a JPEG fallback. Password fields require a WebRTC data channel. Disconnecting releases the display, keyboard lease and any active drag.

## Billing and distribution

The 20-minute trial begins on first launch. The website edition uses the existing MCODE production license endpoint, Stripe Checkout and recovery codes. The PC protects its saved license with Windows DPAPI through Electron safeStorage. Never commit a recovery code, certificate or Stripe credential. Uninstall preserves the trial start and license in the Windows profile.

The Windows workflow checks the client/host protocol, builds the native helper and installer, verifies the upstream catalog, then exercises installation and removal on a Windows runner. Before public release, test the installer with standard Windows security settings on consumer Windows hardware, pair Android and iOS, check moving a window and typing into the extended display, and sign the website installer with the publisher's Authenticode identity. See the workflow run for actual verification status.
