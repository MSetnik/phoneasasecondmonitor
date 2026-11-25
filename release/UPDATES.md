# Website updates

The Mac website build uses Sparkle. The Windows app checks at launch and every six hours while running. Users can also choose **Check for Updates…** from the menu bar or tray. The App Store edition uses Apple's update channel.

1. Increment the Windows package, lockfile and NSIS versions, or the Mac direct bundle build number. Build the normal website release. Use the notarized ZIP for macOS. Run the following command once per updated platform from this repository, substituting the signed release tools directory and the actual package.

   ```sh
   python3 release/make-update-feed.py windows dist/Phone-as-a-Second-Monitor-Windows-x64-Setup.exe --tools /path/to/Sparkle/bin --notes "Describe the change for users."
   python3 release/make-update-feed.py macos /path/to/notarized.zip --tools /path/to/Sparkle/bin --notes "Describe the change for users."
   ```

2. Upload each artifact to the exact, hash-specific Google Storage URL printed by the command. Set immutable caching on these objects. Verify that the public file matches the local SHA-256.
3. Publish the generated files from `web/updates/` at `https://phoneasasecondmonitor.app/updates/` with the existing Firebase Hosting site. When using the Mac project's hosting configuration, copy them into `Promo/updates/`. Keep the latest feed for the other platform. Update the ordinary website downloads in the same release.
4. From a previous website version with the updater, choose **Check for Updates…**, review the notes, install and check the installed version. The Windows installer uses the normal Windows elevation prompt. Mac users can choose **Remind Me Later**. On Windows, **Later** snoozes that version for one day.

The private Ed25519 key lives in the release operator's login Keychain under account `com.mcode.phoneasmonitor.updates`. Back it up using Sparkle's supported key export process and protected offline storage. Existing installations trust the corresponding public key. Windows verifies the signed metadata, artifact size and SHA-256. macOS verifies the signed appcast and update archive through Sparkle. The website Windows installer keeps its Windows download-zone marking during in-app updates.
