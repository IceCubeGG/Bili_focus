## Reliable video quality

- Keep Compatible as the default, preserving working direct playback.
- Choose available resolutions, including 1080p/4K when exposed by the upload/account and supported by the device.
- Prefer AVC video and AAC-LC audio; preserve position, playback speed and paused/playing state.
- Recover automatically to Compatible if a quality is rejected, unsupported, corrupt, expired or stalled.
- Cancel pending switches safely; delayed responses cannot replace a newer selection or reopen a closed player.
- Retain English/Simplified Chinese, fullscreen, Danmu, comments, downloads and save-folder management.

## Downloads

Windows x64: extract the ZIP and run Bili Focus.exe. Keep all extracted files together. Unsigned development build.

Android: debug-signed APK, version code 3, same application ID and development certificate as the previous build. Install as an update without uninstalling to retain app data. SDK remains on C: on the build machine.

SHA256SUMS.txt contains both artifact hashes. Previous releases remain available.

## Verification and limits

433 TypeScript tests and 44 Android JVM tests passed. Production and packaged Windows tests verify actual AVC/AAC DASH decoding, synthetic 1080p/4K selection, preserved position/pause/speed, rejected/corrupt/unsupported-stream recovery, rapid switches, cancellation, default playback when the catalog fails, and phone-width layout. Existing video/fullscreen/language/Danmu/comment/download/save-folder tests also pass.

An isolated live guest check on public BV1xx411c7mD verified sustained picture and sound in Compatible, 480p DASH, 360p DASH and Compatible again, without using an account or posting anything. Guest quality availability differed from progressive playback. No paid or restricted content is unlocked.

The 1080p/4K fixtures use 320×180 local clips with synthetic quality metadata; they do not prove hardware 4K decoding. Android instrumentation compiles but was not run, and no phone/emulator was accessed. Phone playback and high-resolution hardware decoding still need device verification. Android's existing intercepted-stream limit below 2 GiB remains; failed manual streams fall back. Download resolution is unchanged by the player selector.
