# Bili Focus 0.4.0 — video search and consistent tags

This third-party Bilibili app is designed for a more focused viewing experience. It lets you group creators and filter out videos based on tags you select.

## Video search

Use the search icon in the top bar to search by keyword or an exact BV code. Keyword results support **Load more results**; a BV code looks up only that video. Open a thumbnail or title to watch, then use Back to return to the same search results. Explicit searches are separate from Browse presets. Search is shared by Windows and Android, supports English and Simplified Chinese, and keeps account and Bilibili-issued guest cookies in the native host. Deleted/private videos cannot be shown, and platform verification or network failures are reported with Retry rather than treated as empty results. See [search behavior](docs/search.md).

The English interface now uses **tag**, not **label**, for video tags. Saved presets retain their existing format and remain compatible.

## Video quality

The player starts in **Compatible**, preserving the working direct playback path. Select a resolution in **Quality** to switch manually while keeping your position, speed and paused/playing state. Available resolutions depend on the upload, account permissions and device; unsupported or failed selections automatically recover to Compatible. English and Simplified Chinese remain available. See [quality behavior and verification limits](docs/video-quality.md). [Download Windows and Android 0.3.0](https://github.com/IceCubeGG/Bili_focus/releases/tag/v0.3.0-video-quality). The published 0.2.0 compatibility release remains available.

## Save-folder manager

Open **Options → Save folder & downloads**. Add folders through the system picker, browse any remembered folder, and use **Use for new downloads** to change the destination. The original download location is migrated automatically. Up to 30 folder shortcuts are remembered locally; they are not synced to GitHub or between devices.

Search filenames, filter videos/covers, refresh after downloading, and open a file in your installed player or image viewer. The manager lists MP4/WebM videos and JPG/JPEG/PNG/WebP/GIF images directly in the selected folder, not nested folders. **Forget folder** removes only the shortcut and never deletes files. Forgetting the active folder requires selecting a new destination before starting another download. Already queued downloads keep their original destination; an explicit retry uses the currently selected folder.

Missing folders and revoked Android grants can be reselected through the picker or forgotten. Android uses persisted SAF permissions and grants a viewer read access only to the chosen file; no broad storage permission is requested. Windows blocks path traversal, alternate data streams, and symbolic-link/junction escapes when opening files. Very large directories are explicitly marked as truncated after 1,000 supported media files or 10,000 directory entries. Downloaded files are not uploaded to GitHub.

Android and Windows downloads are available in the **v0.2.0-save-folders** GitHub release. Android uses version code 2 and the existing development signing certificate; Windows is unsigned. Install Android as an update without uninstalling to retain app data. See [save-folder details and build notes](docs/save-folders.md).

## What works now

- Browse, Subscribe, and Options with keyboard-accessible navigation.
- Live Browse candidates with real video metadata, Refresh, deduplicated pagination, and loading/empty/error states. Guest recommendations work without signing in.
- Browse → Feed settings creates, edits, and selects saved tag/uploader presets. Add uploaders from cards or enter their numeric UIDs; View tags loads exact Bilibili video tags.
- Strict matching defaults to tag **AND** uploader when both lists are filled, with an explicit **OR** choice. Unverified tags cannot match; empty results do not silently relax a preset. All recommendations is an explicit unfiltered selection.
- Subscribe shows original video uploads from verified followed accounts, newest first, with Refresh and Load older uploads. Reposts, live streams, unrelated suggestions, and unverified authors are omitted. Subscribe never applies Browse presets and never substitutes guest recommendations when signed out.
- Subscribe → Show subscriptions toggles an avatar/name list fetched from your actual followed-account roster, with search and Load more uploaders. Selecting an uploader opens their video library directly from their Bilibili space, newest first, with the total video count and Load older videos. Hiding the list preserves the library; All followed uploaders returns to the recent followed feed.
- Create, rename, edit members, select, and delete local subscription groups, similar to Twitter Lists. Selecting a group combines its members' complete available video libraries, newest first, with a combined total and Load older videos. A creator can belong to several groups. Groups survive restart separately for each account on each device; they do not change Bilibili follows. Empty groups show no videos rather than broadening the feed.
- Select a video thumbnail/title in Browse or Subscribe to open the shared video page: player, title, uploader, publication time, description, tags, parts, and available UGC-series episodes. Back restores the loaded source feed/group and scroll position. Creator profiles open in your system browser without sharing the native session.
- The player supports play/pause, seeking, volume, playback speed, and fullscreen. Danmu can be switched on/off and sent at the current part/time after sign-in. Ordinary scrolling/top/bottom Danmu are loaded in six-minute segments; scripted/advanced/BAS Danmu are omitted rather than executed.
- Comments offer Popular/Newest order, older pages, reply threads, and an explicit signed-in Post comment/Post reply action. Remote text is rendered as plain text, not HTML. Bilibili can restrict comments, Danmu, sending frequency, account level, and message visibility/moderation.
- Download saves the currently selected part; Download cover saves its cover image. The first action opens a native folder picker if needed. Options → Save folder & downloads shows progress, Cancel, Retry from start, and Remove entry. Removing a queue entry never deletes completed files.
- Appearance (system/light/dark), card density, and last-open tab persist across restarts.
- Options offers QR sign-in and official password/SMS sign-in on desktop and Android. For QR on Android, scan the displayed code with the Bilibili app on another device and approve it there. For password/SMS, choose the method on Bilibili's official page in an isolated native sign-in window; the app does not build its own password or verification-code form.
- QR generation, waiting/scanned/expired/error states, cancellation, and regeneration.
- Profile and account status; session validation on startup and with Refresh.
- Desktop QR sessions support credential renewal when Bilibili requests it, including retry of refresh confirmation after interruption. Android QR and official web sign-in currently save the validated session without a refresh token: sign in again when it expires.
- Sign-out removes the local encrypted session and attempts remote session revocation. Offline failures are shown separately from expired sessions.
- Account cookies and refresh tokens stay in native host code. Windows uses DPAPI-backed encryption; Android uses Android Keystore with AES-GCM. Sign-in is disabled when secure storage is unavailable. No session credentials are returned to the shared interface or logged.

The desktop app stores `settings.json`, `browse-presets.json`, `subscribe-groups-<UID>.json`, `downloads.json`, and `session.enc` in its normal per-user application-data folder (normally `%APPDATA%/Bili Focus`). Android keeps presets, account-scoped groups, the persisted folder grant and download history in private app preferences and sessions in its encrypted native store. Download history never contains remote stream URLs or account cookies. Browse presets apply across accounts; subscription groups are separate per account. The app does not store an account password. To remove a saved session, use **Options → Sign out**.

Downloads resolve fresh native access, reject previews/restricted sources, and run one job at a time (up to 50 queue entries). Video segments are saved separately with numbered filenames; they are not blindly concatenated. File size, MIME and format signatures are checked before completion. Limits: 2 GiB per video segment and 20 MiB per cover. Existing files are not overwritten. Desktop uses exclusive staging/commit; Android stages in private cache and exports through the selected Storage Access Framework folder, without broad storage permissions. Android may require a subfolder rather than the Downloads root. Keep the app running: there is no Android foreground service or byte-resume yet. Interrupted jobs require an explicit restart-from-start retry; abrupt termination can leave temporary files or already validated segments, never a falsely completed job. Normal cancel/failure removes this attempt's partial files, subject to filesystem/provider permission. Only save content you have permission to keep.

Presets filter Bilibili's recommendation candidates rather than searching the entire catalog. A batch checks up to 400 candidates, so a narrow preset may have no matches. Use Load more or Refresh, or deliberately edit the preset. Select a thumbnail or title to watch.

Individual uploader selection pages their available video library in 30-video pages until Bilibili reports the end. Selecting a group independently pages every member's library and combines them into 30-video pages in newest-first order, with the summed library count. Neither creator nor group libraries have a 400-video batch limit; loaded pages are deduplicated and retained until all selected libraries end. Group requests run at most two at a time, so large groups can take longer to open. Retry preserves each member's page position; changing members resets the library and rejects delayed results from the previous membership. Private, deleted, or otherwise unavailable uploads cannot be listed. Only All followed uses the recent followed-video feed, with up to 400 videos per batch. Groups are local, not synced Twitter-style public lists; up to 30 groups with 500 members each are supported. The uploader directory initially loads 50 accounts at a time; search searches the loaded names/UIDs. Selection resets when leaving Subscribe, but the groups remain saved.

## Android foundation

The React interface and platform-neutral account contracts are shared. `src/platform/bridge.ts` selects Electron, the Capacitor Android account plugin, or a harmless browser preview. The Android project is checked in under `android/`; its isolated official-login WebView has no app JavaScript bridge, and authenticated API calls and encrypted cookies stay native.

```powershell
npm install
npm run android:build
```

`android:build` synchronizes the shared interface, finds an installed SDK and Java 21, builds a debug APK, and runs the Android account unit tests. Build dependencies are cached in `.gradle-cache/` inside this project. The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Use `npm run android:open` if you want to work in Android Studio.

Android requires SDK 36 and Java 21; Android Studio is optional for command-line builds. The minimum supported device is Android 9 (API 28). QR sign-in requires another device running the Bilibili app to scan the code. The build command recognizes this machine's existing C: SDK/JDK paths without changing global environment variables. See [Android build and migration instructions](docs/android-migration.md). Real-device playback, folder export and sign-in still need verification.


## Checks and packaging

```powershell
npm test
npm run build
npm run test:feed
npm run test:feed:fail-closed
npm run test:subscribe
npm run test:video
npm run test:quality
npm run package
```

The packaging command generates an unpacked Windows application in `release/win-unpacked/`. An installer and code signing are not part of this milestone.

`npm run test:desktop` uses an isolated temporary profile and needs network access. `npm run test:feed` verifies live guest pagination/tags and strict presets. `npm run test:feed:fail-closed` uses corrupt-rule fixtures. The regression tests include folder migration/persistence, switching/forgetting, pinned queued destinations, media-only listings, directory limits and path boundaries, safe-default guards, codec selection, translation coverage/settings migration, stream boundaries, and download validation.

`npm run test:subscribe` passes using an OS-encrypted synthetic account in a temporary profile with every native network request intercepted by local fixtures. It checks the real production bridge and renderer, followed-only original uploads, ordering/deduplication, Refresh/older-page retry, Browse-preset independence, visible verification failure, the real roster boundary, exact uploader filtering, toggle preservation, group creation/edit/restoration/deletion, all 417 uploads from a two-member group, group retry and removal of a member during a delayed page request, the open phone-width list/editor, and delayed-response rejection after sign-out. Optional `-- --screenshots` captures are clearly marked SIMULATED and stored in `.gradle-cache`; they require a working desktop compositor and were not generated in this run. This does not authenticate a real account or prove the current upstream followed-feed/roster schema works for a real session.

`npm run test:video` passes against this copy's production page/bridge with an isolated encrypted synthetic session and local fixtures. It verifies the save-folder manager's search/type filters, file-open dispatch, traversal rejection, multiple folders, browsing vs. destination selection, safe forgetting/re-adding, and reload persistence in English/Chinese at 392-pixel width. It also creates WebM and muxed AVC/AAC MP4 clips and checks direct default playback even when the quality catalog fails, parts/reload, fullscreen, byte-verified downloads, Danmu/comments/replies, account/part handle revocation, delayed cancellation and source restoration. Only two explicit fixture messages are posted; no real account is used. The separate `npm run test:quality` check exercises AVC/AAC DASH and quality recovery; see [verification details](docs/video-quality.md).

The guest-only `node scripts/probe-video.mjs` check succeeded on October 5, 2026 for `BV1xx411c7mD`: normalized metadata, a 720p progressive MP4 rendition, an HTTP 206 media range, 691 ordinary Danmu items in the first segment, and the available first comment page. It does not load saved credentials or post anything. These observations cover one public video, not every archive or account entitlement. Real-account Danmu/comment posting remains unverified.

This copy's optional `node scripts/probe-video.mjs` uses the legacy progressive route as a guest, without loading credentials or sending messages. On 2026-10-06 it returned progressive 720p for `BV1xx411c7mD`, HTTP 206 MP4 bytes, 691 Danmu items, and a comment page. This verifies one public upload's native access, not every video or phone decoding. Availability still depends on Bilibili and the selected upload.

The Android debug APK builds successfully. All 44 native unit tests pass, including supported library file types and quality boundaries. The instrumentation test package compiles, including folder-registry and DASH metadata tests, but was not executed. The Android stream fix still reports the full resource length and acknowledges offsets already applied by the CDN. Intercepted playback requires known resource lengths below 2 GiB. No device/emulator was accessed. Actual phone playback, fullscreen/Back, folder picking/listing/exports and external file opening need device verification.

## Integration references

Bilibili account support uses its web passport interfaces, documented by the source community rather than a verified public integration agreement. Upstream changes can affect login or renewal.

- [QR login contract](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/login/login_action/QR.md)
- [Session renewal contract](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/login/cookie_refresh.md)
- [Account status contract](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/login/login_info.md)
- [Logout contract](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/login/exit.md)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron secure-storage API](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Official Bilibili sign-in page](https://passport.bilibili.com/login)
- [Capacitor Android setup](https://capacitorjs.com/docs/android)
- [Electron media protocol handling](https://www.electronjs.org/docs/latest/api/protocol)
- [Video stream contract](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/video/videostream_url.md)
- [Danmu operations](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/danmaku/action.md)
- [Comment operations](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/comment/action.md)
- [Android WebView process isolation](https://developer.android.com/reference/android/webkit/WebView#setDataDirectorySuffix(java.lang.String))
