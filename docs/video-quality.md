# Reliable quality selection (0.3.0)

The player starts in **Compatible**, using the same direct progressive route as the saved playback-compatible version. The background quality catalog does not pause the video or download DASH media. Catalog failure leaves Compatible available. The separate 0.2.0 release and its build artifacts are not overwritten.

Choose a resolution in **Quality** to switch manually. Only qualities returned for the current upload/session and supported by the device's media capability check are listed. The selected rendition uses a single AVC video track when available, plus AAC-LC audio when available, rather than mixing AVC, HEVC and AV1 representations in one adaptation set. The interface continues to support English and Simplified Chinese.

Switching preserves position, playback speed, volume, and whether playback was paused. The player keeps the same video element. New selections cancel pending attachment immediately; late native requests release their media handles without replacing the current selection. Leaving the page or changing account revokes playback access as before.

Rejected qualities, unsupported codecs, decoding/attachment errors, startup exceeding 20 seconds, and a manual-quality playback stall lasting 15 seconds return to Compatible with an explanation. There is one fallback, not an endless retry loop. If Compatible itself fails, the normal Reload player action remains available. Browser autoplay restrictions can still require a tap to resume after a switch. Changing part/video starts in Compatible; quality choices are not persisted globally.

Resolution availability depends on Bilibili, the upload, account permissions and the device. No paid, restricted or preview content is unlocked. A guest-only check on 2026-10-09 found the public test upload `BV1xx411c7mD` offered progressive 720p but only DASH 480p/360p, even for a 4K request. Both AVC/AAC initialization and index ranges returned HTTP 206 with valid MP4 boxes. This is evidence for one public upload, not a guarantee for all content or accounts.

## Verification

- `npm test`: includes quality bounds, metadata validation, codec selection, AAC requirements and the safe default/language guards.
- `npm run test:video`: production bridge/UI, locally generated direct WebM and AVC/AAC MP4, parts, fullscreen, Danmu, comments, saved folders, language changes and handle revocation. The catalog deliberately fails to verify that default playback is unaffected.
- `npm run test:quality`: production bridge/UI with isolated synthetic session and locally recorded AVC video + AAC audio in separate DASH streams. Exercises quality switching, paused/playing position and speed, native byte ranges, rejected/corrupt/unsupported streams, rapid selections, Back cancellation, and catalog failure. The clips are 320×180 with synthetic 1080p/4K metadata: this verifies selection and decoding behavior, **not actual 4K hardware performance**.
- `node scripts/probe-quality.mjs`: optional live guest-only native media/metadata check. No saved credentials, signed stream URLs or messages are logged or posted.
- `npm run test:quality:live`: optional isolated guest-only production UI check. On 2026-10-09, the public test upload decoded both video and audio in Compatible, 480p DASH, 360p DASH and Compatible again, preserving position and paused/playing state. No real account, posts or downloads are involved.

Android shares this controller. Its native metadata and boundary tests are built separately; instrumentation sources can be compiled without running a device. **Phone playback and hardware 4K decoding still require real-device verification.** Android's existing intercepted-stream limit remains a known resource length below 2 GiB; a larger manual-quality stream falls back rather than bypassing this boundary. Download behavior and download size limits are unchanged; the playback quality selector does not alter download resolution.

Handoff builds use version 0.3.0 (Android version code 3, same development certificate). Following the upload request, source and both clients are being published in the private repository as [v0.3.0-video-quality](https://github.com/IceCubeGG/Bili_focus/releases/tag/v0.3.0-video-quality). Earlier compatibility releases remain available.

Verified locally: 433 TypeScript tests, 44 Android JVM tests, the production desktop video and quality fixtures, and the live public-video quality check. Android instrumentation sources compile but were not executed. The local 1080p/4K fixture labels are synthetic as described above; guest live decoding verified 480p/360p, not real 4K.
