# Save-folder manager (0.2.0)

In Options → Save folder & downloads:

1. Add a folder through the system picker. This remembers it and makes it the new download destination.
2. Browse any remembered folder without changing the destination.
3. Search filenames, filter Videos/Covers, refresh after downloading, and use Open file with an installed player or image viewer.
4. Choose Use for new downloads to switch destinations. Already queued jobs stay pinned to their original folder. An explicit retry uses the current destination.
5. Forget folder removes only its shortcut, not files or queued downloads. Forgetting the active folder clears the destination; choose another before starting a download.

The existing save location is migrated automatically. Up to 30 folders are remembered. This is a local library of direct MP4/WebM and JPG/JPEG/PNG/WebP/GIF files, not a recursive browser. Large directories display a warning when limited to 1,000 media files or 10,000 directory entries. Search applies to the loaded listing. Missing folders or revoked Android permissions can be reselected or forgotten. Files and folder preferences are not uploaded to GitHub.

Desktop opening validates folder identity and direct file membership, rejects links and path/alternate-stream injection, and opens only supported media. Android uses user-granted Storage Access Framework trees, verifies direct-child membership before opening, and shares read access to only the selected file. No broad storage permission or file deletion operation is exposed.

## Download and build

GitHub release: v0.2.0-save-folders. Windows: extract Bili-Focus-0.2.0-save-folders-win-x64.zip and run Bili Focus.exe. Android: install Bili-Focus-0.2.0-save-folders-debug.apk as an update; same application ID/signing certificate, version code 2. Windows is unsigned and Android is debug-signed.

For a source checkout, use npm ci and npm run build. For Android, use SDK 36 on C: and Java 21, then npm run android:build. Always run npm run android:sync before invoking Gradle directly after moving the checkout. The workspace can reuse D:\Maker\Bilibili3rdparty\.gradle-cache via GRADLE_USER_HOME. SDK stays at C:\Program Files (x86)\Android\android-sdk.

The progressive compatibility player remains unchanged: no quality menu or DASH attachment, with English and Simplified Chinese available. Verification: 429 TypeScript tests, 43 Android JVM tests, production desktop folder/playback fixture test; Android instrumentation compiles but was not run. Phone folder permissions, file opening, exports, playback and fullscreen require real-device verification. No device or emulator was accessed.
