# Bili Focus 0.4.2 — Lightning icon

- Apply the approved blue double-lightning design to Android launcher icons, Windows executable/window branding, the app header, sign-in dialog, and browser favicon.
- Add adaptive Android layers, a themed monochrome icon, and density-specific legacy icons.
- Include the Android SMS/password CAPTCHA compatibility fix, confirmed working by the user on Android 14. Official Bilibili verification is still required; no CAPTCHA bypass is provided.
- Keep existing search, English/Simplified Chinese, quality selection with Compatible recovery, subscriptions/groups, and save-folder management.

## Downloads

- Android: `Bili-Focus-0.4.2-lightning-debug.apk` (version code 6). Signed with the existing development certificate. Install over the previous app to retain local data.
- Windows x64: `Bili-Focus-0.4.2-lightning-win-x64.zip`. Extract the complete archive and run `Bili Focus.exe`. This build is unsigned; Windows may show a reputation warning.
- `SHA256SUMS.txt` contains checksums for both downloads.

Verification: 457 app tests and 53 Android JVM tests passed. Android instrumentation compiled but was not run. Packaged Windows checks passed for icon loading, search, language switching, video playback, fullscreen, download/cover saving, and quality recovery using synthetic fixtures. The Windows executable icon was visually verified; packaged web/branding assets match the production source. APK signing matches the existing development certificate.

Android automated JVM tests and build checks do not replace playback/sign-in testing on a real device. No phone or emulator is accessed during this release workflow. If an old icon remains after updating, launcher/Windows icon caches may take time to refresh; app data does not need to be cleared.
