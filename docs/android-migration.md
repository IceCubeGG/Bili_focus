# Android build and shared application design

The application has a checked-in Capacitor 8 Android project. The Android app uses the same React screens, navigation, live Browse cards, followed-video Subscribe page, shared preset matching rules, and account snapshots as the desktop app. A platform adapter chooses the Electron bridge, the native Android bridge, or the browser preview. Feed filtering, preset rules, and subscription ordering/deduplication live in `src/core` so both apps use the same behavior.

## Open and build

Run `npm run android:build` from the project directory to build without Android Studio. The command synchronizes the shared web interface, finds an existing SDK 36 and Java 21, and builds/tests the native project. It checks `ANDROID_HOME` / `ANDROID_SDK_ROOT` and `JAVA_HOME` first, then the common SDK locations and this machine's installed Microsoft JDK. Its Gradle cache stays in the project at `.gradle-cache/`. The Gradle distribution has a pinned SHA-256 checksum.

For development in Android Studio:

1. Install Android Studio with the Android SDK and its bundled Java runtime when you are ready to build an APK. The project uses Java 21, compile/target SDK 36, and Gradle settings supplied by Capacitor 8. See [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup).
2. From the project directory, run `npm run android:sync`. This builds the shared web interface and copies it into the Android project.
3. Run `npm run android:open` to open the existing Android project in Android Studio.
4. Let Android Studio finish its Gradle sync, then run on an Android 9 or newer device/emulator. Use Android Studio's build menu to produce a debug APK. Create a signing key separately when preparing a release.
5. Repeat `npm run android:sync` after changing the React interface or shared logic. Edit native Android behavior in `android/app/src/main/java/app/bilifocus/desktop`; syncing preserves those source files. Keep `android/` rather than regenerating it with `cap add`.

The repository includes the Android wrapper and native account implementation. This machine has Android SDK 36 at `C:\Program Files (x86)\Android\android-sdk` and Microsoft OpenJDK 21.0.8 at `C:\Program Files\Android\openjdk\jdk-21.0.8`. They are not on the default command path; an earlier check incorrectly reported them missing.

To use these existing installations from PowerShell without changing global environment variables:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$env:ANDROID_HOME = 'C:\Program Files (x86)\Android\android-sdk'
Set-Location android
.\gradlew.bat --gradle-user-home '..\.gradle-cache' :app:assembleDebug :app:testDebugUnitTest --no-daemon --console=plain
```

The first Gradle build downloads its build dependencies and requires network access. A built debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`; it is signed with a development debug key, not a production release key. Compilation and unit tests do not establish that real-account login works. Complete the device checks below before considering the mobile account flow verified.

The sign-in activity handles normal screen rotation and theme/configuration changes without recreation, preserving the official page and its temporary login state. Android can still terminate its process in the background; reopening sign-in starts a fresh isolated session.

## Native account implementation

`BiliAccountPlugin` implements the shared bridge methods and `accountChanged` / `loginChanged` events. Android advertises both `qr` and `web` sign-in. The QR code is generated and polled by the native account client; the interface receives only its rendered image, expiry time, and progress. Scan it with the Bilibili app on another device and confirm there. Bilibili's official page provides password and SMS selection and handles its own CAPTCHA.

`WebLoginActivity` opens the official HTTPS Bilibili login URL in a private, unexported `:bili_auth` process. `WebView.setDataDirectorySuffix("bili_auth")` gives that process a different cookie and storage directory from the Capacitor application WebView. This requires Android 9/API 28, which is the project's minimum SDK. The official page has no Capacitor or app JavaScript interface, and WebView debugging is explicitly disabled in this process. Top-level navigation is restricted to `passport.bilibili.com`, `account.bilibili.com`, and `www.bilibili.com` over HTTPS; other Bilibili hosts and the known official CDN and CAPTCHA resources are permitted only as subresources. File access, cleartext traffic, popup windows, and content access are disabled. The temporary authentication jar is cleared before and after sign-in.

The native client checks the resulting session against Bilibili's account endpoint before accepting it. Only a safe profile, sign-in status, timestamps, and messages reach React. Cookies stay in native memory and in an AES-256-GCM encrypted preference record; the encryption key stays in Android Keystore. Device backup is disabled to avoid restoring unusable session ciphertext or a transient authentication WebView database onto another device. Sign-out removes the local saved session and encryption key, then attempts Bilibili's remote sign-out.

Before saving or using a session, native cookie validation rejects control characters, non-ASCII header data, invalid names, unsafe value characters, conflicting duplicate cookies, oversized headers, and missing or empty session/CSRF cookies. Android unit tests cover these rejection cases; they require the Android Java toolchain to execute.

Android currently does not persist a refresh token from either sign-in method. Account refresh checks whether the saved session still works. If Bilibili expires it, sign in again with QR, password, or SMS. An unavailable network produces an offline account state rather than discarding the saved session.

The isolation and plugin registration follow the primary [Android WebView API](https://developer.android.com/reference/android/webkit/WebView#setDataDirectorySuffix(java.lang.String)) and [Capacitor custom Android code guidance](https://capacitorjs.com/docs/android/custom-code). AES-GCM uses the [Android Keystore key-generation API](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec).

## Native recommendation and preset implementation

`BiliFeedClient` fetches the fixed HTTPS recommendation endpoint and video-tag endpoint, bounds response sizes, validates cursor/BVID inputs, normalizes metadata, and caches verified tags. Feed work uses a separate bounded executor so slow feed requests cannot block account/QR polling. Credentials remain native; pending responses are rejected if account generation or credentials change.

`BrowseSettingsStore` validates the versioned preset schema and commits it to private app preferences. Missing settings start with All recommendations, but an existing malformed document raises an error and leaves the feed hidden. Android presets and active selection survive app restart, independent of account credentials. Tag and UID matching and the preset editor are shared React/TypeScript; no Android-only fork of the filtering behavior is needed.

## Native Subscribe implementation

`BiliSubscriptionClient` fetches the authenticated video dynamics feed and independently verifies each original uploader through the outgoing relationship endpoint. Only a matching uploader UID and numeric following/mutual-following status are accepted. Missing follow flags require this proof; explicit unfollow flags, reposts, live streams, ads, and malformed cards are excluded. A failed membership lookup fails the page instead of substituting recommendations or guessing that an uploader is followed.

Requests have bounded metadata, opaque cursors, and four verification workers. Follow decisions are cached for at most 30 seconds under the native credential scope; Refresh and session changes clear them. The plugin requires a verified profile and signed-in/offline session, rejects stale generation/credential results, and keeps cookies entirely native. React shares newest-first ordering, BVID deduplication, a 400-upload batch limit for All followed only, sign-in/error/empty states, and paging across desktop and Android. Subscribe does not read Browse presets. This step covers original video uploads, not text/image dynamics, repost display, or playback.

The same shared React directory/editor runs on both platforms. `getFollowedUploaderPage` fetches the native account's own followings in 50-profile pages, returning only UID, display name, and safe avatar URL. Roster requests share bounded HTTP/admission slots, reject stale sessions, and are not invalidated just because the video feed refreshes. The account UID is derived by the host, never supplied by React.

`getUploaderVideoPage` loads an individual selected uploader's complete available upload library. `BiliSubscriptionClient` verifies the followed relation, fetches public signing keys from navigation, signs the fixed `/x/space/wbi/arc/search` request using native `WbiSignature`, and validates the returned page/total metadata and exact creator UID. It uses 30-video pages with newest-first ordering; shared React retains every loaded creator page without the recent feed's 400-video cap. The library has its own source/cursor, so rapid selection changes cannot mix videos. Account generation/credential checks reject stale native results and signing/session data never enters React. Only All followed continues to use the recent feed. Only uploads exposed by Bilibili can be listed.

Group libraries use the shared `src/core/group-library.ts` pager and this existing native endpoint, without an Android-specific algorithm or new credential boundary. Each member has its own cursor and buffered videos; the pager merges library heads into 30-video pages in global newest-first order, reports the summed library count, and continues until every library ends. There is no 400-video cap. It loads at most two native pages concurrently and drains started requests before reporting failure. Atomic page commits and a successful-request cache allow retry without losing or duplicating uploads. Selection/account/member changes cancel the previous pager; renaming a group does not reset its library. Large groups must fetch an initial page for every member before chronological results can be shown.

`SubscriptionGroupStore` validates and persists lists in private preferences under `subscriptionGroups.v1.<UID>`. Missing data starts empty; corrupt data raises an error rather than overwriting it. `getSubscriptionGroups` and `updateSubscriptionGroups` require a native signed-in/offline account. Group names/UIDs are nonsecret and separate from the encrypted session. Shared `src/core/subscription-groups.ts` filters loaded uploads by exact creator/group UIDs, never broadens empty selections, and does not call a remote following mutation. Groups survive restart per account on this device, but do not sync between desktop and Android.

## Native video page, media, Danmu, and comments

`VideoPage.tsx` is shared React for desktop and Android. The platform-neutral bridge supplies `getVideoDetails`, `getVideoPlayback`, `releaseVideoPlayback`, `getDanmu`, `sendDanmu`, `getVideoComments`, `sendVideoComment`, and `openCreatorProfile`. The source feed remains mounted while watching, so Back retains the selected group/uploader, pages, and directory. Video/account/part changes discard delayed UI results and release media handles.

`BiliVideoClient` normalizes metadata and validates exact part ownership before playback or Danmu actions. A dedicated three-worker executor admits at most six page requests. The native client signs fixed playback/Danmu endpoints, decodes bounded protobuf segments through `DanmuDecoder`, and supplies safe comment/episode DTOs. Posting requires a verified native session; only an explicit user submission starts a POST. Native cookies, CSRF and WBI keys never enter React. Sends have a five-second native throttle and are never automatically replayed after an uncertain response. Metadata caches are credential-scoped even across delayed clear/write races.

Playback returns `https://localhost/__bili_media/<opaque-handle>/<segment>` URLs. A `BridgeWebViewClient` subclass intercepts only this local route and forwards validated single byte ranges to HTTPS Bilibili CDNs, attaching a fixed Referer but no account cookies. Redirects, unrecognized CDN domains/MIME types, arbitrary URLs and invalid ranges are rejected. Connections are capped at four per handle and disconnected/rejected when a handle or account is invalidated. `MainActivity` hosts the player stage in a native fullscreen view so the shared Danmu overlay stays with it; Back exits fullscreen first, then video history. App backgrounding pauses shared playback. Runtime behavior still requires device verification.

This saved compatibility copy restores the direct progressive MP4 player with `format: 'progressive'`. Native hosts therefore use `qn=64`, `fnval=1`, `fourk=0`, and `platform=html5`, as before the quality selector. React sets the opaque local URL directly on the video element; it never loads Shaka or a DASH manifest. The quality selector is removed. Standard controls, speed, parts/episodes, metadata, Danmu, comments, downloads, and English/简体中文 remain. The native stream/range and fullscreen repairs are preserved. Native Back still exits fullscreen without an extra exit overlay.

The shared language context and English/zh-CN dictionary translate app controls without touching video titles, creator names, tags, messages or user-created names. `language` is saved in the existing native preferences, with old/missing/invalid values defaulting to English. The isolated official sign-in activity receives only the nonsecret language choice via Intent for its own instruction/cancel controls; the Bilibili page itself is not rewritten. Dates/numbers use the selected locale. OS dialogs and unrecognized diagnostics retain their own language.

`WebViewMediaStream` fixes the early-freeze boundary: [Chromium's InputStreamReader](https://raw.githubusercontent.com/chromium/chromium/main/components/embedder_support/android/util/input_stream_reader.cc) uses `available()` to compute the resource size and separately skips the requested range offset. HttpURLConnection's buffered availability is not the full video size, and the CDN already applies the range. The adapter reports full validated Content-Range/Length metadata, acknowledges the prepaid skip without discarding bytes, bounds reads, validates requested versus actual ranges, and rejects short/revoked streams. Known resource lengths below 2 GiB are required by this intercepted-player path. No insecure loopback server, direct credential URL, cleartext exception or full-file buffering was added.

## Native download destinations and queue

`BiliDownloads` resolves current native video/cover sources through `BiliVideoClient`, executes one job at a time, and exports to a user-selected DocumentsContract tree. The [Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files) grants and persists access only to the selected folder; no broad storage permission is requested. Android 11+ can require a subfolder rather than the Downloads root. React sees a destination label, bounded job/status/progress records and completed names, not tree URIs, native CDN URLs or cookies.

Transfers are staged in private cache, verified for declared byte count and matching MIME/format, then copied into temporary provider documents and renamed after successful writing/size checks. Generated filenames are sanitized and randomized. Cancel/account invalidation disconnects the active transfer and removes this attempt's partial outputs when permissions allow. Removing a completed queue entry only removes history. Retry starts again with fresh native access, and interrupted persisted jobs never auto-run on restart. Maximum 50 entries, 2 GiB per video segment, 20 MiB per cover. Multiple segments are separate files, not concatenated. Keep the app running; foreground-service/background scheduling, byte-resume and offline playback remain future work. Abrupt process death can leave temporary documents or already validated exported segments.

## Completed build checks

The compatibility debug APK compiled. All 42 native unit tests and 423 TypeScript tests pass. Native coverage includes stream-size/range/double-skip/revocation/truncation and download boundaries. Native DASH helpers remain unused by the compatibility UI. Instrumentation and device runtime checks were not run for this saved copy; the previous device-access decision is respected.

The compatibility desktop production check sustains direct WebM and muxed AVC/AAC MP4 playback and asserts legacy-only native request parameters. It verifies no quality selector, MP4 reload/parts, saved Chinese/English switching, fullscreen, downloads, Danmu/comments, revocation, source preservation, and phone-width layout. Real Android playback/fullscreen/Back, folder exports, real posting, and Android 9 compatibility remain unverified.

The saved Android handoff is `../../release/android/Bili-Focus-0.1.0-playback-compatible-debug.apk` relative to this copy's root. The original quality-selection APK is not overwritten. Historical sign-in screenshots remain in `docs/screenshots`; they are not evidence of phone playback in this compatibility build.

Build the instrumentation package with `npm run android:build -- --instrumentation`, then install the main APK and `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` on a dedicated test device. Run the test runner `app.bilifocus.desktop.test/androidx.test.runner.AndroidJUnitRunner` using Android Studio or ADB.

## Device checks before the first mobile release

- Build successfully with SDK 36 and run the same Browse, Subscribe, and Options screens at phone width, including dark mode and keyboard display.
- Open official sign-in, complete password sign-in and SMS sign-in separately, and verify CAPTCHA works. Check cancellation, the system back gesture, and reopening the page.
- Confirm a validated account appears after sign-in, the account survives an app restart, and Options never contains cookie/token data.
- Refresh while offline, then reconnect and validate again. Confirm an expired session asks for another sign-in.
- Sign out, restart, and confirm that the local session does not return. Check behavior if remote sign-out cannot reach Bilibili.
- Verify signed-in Browse recommendations and strict tag/uploader presets on a real device; restore the active preset after restart and check unavailable tag lookups without broadening the feed.
- Sign in and compare Subscribe with the official followed-video feed. Check Refresh after following/unfollowing, older pages, an account switch, sign-out during loading, offline errors, and independence from Browse presets. Fixture checks do not establish real-account endpoint compatibility.
- Open the subscription directory, load all followed-account pages, search loaded names, and select a creator without loaded uploads. Verify exact creator/group filtering, toggle preservation, group creation/edit/deletion, restart persistence, account separation, and phone keyboard/layout on an actual device. The desktop production smoke checks shared controls at phone width; Android fixtures verify native roster/storage, not a real signed-in full UI journey.
- Select a followed uploader with a large library, compare the total and older videos with their Bilibili space, page beyond 400 uploads, test retry/Refresh and rapid switching. Run the updated 36-test instrumentation package when emulator/device access is available.
- Change English/简体中文 in Options, restart, and check account/QR/web sign-in, feed presets, groups, player, comments and queue on the phone. Confirm source content and user-created names are unchanged.
- On a qualifying upload/account, compare returned resolutions against Bilibili, select 1080p and 4K, check actual decoding, audio sync, seeking, pause/speed/part retention and fullscreen/Back. Check guest/VIP limits and unsupported codecs without entitlement bypass. Native intercepted resources above 2 GiB remain outside this implementation.
- Recheck the reported freeze with a public video: playback must continue beyond the initial buffer, seek near the middle/end, then switch parts. Select a writable folder and download a video part/cover; check saved contents, Cancel/Retry, folder-grant persistence, revoked permissions/full disk, process interruption and that removing history does not delete completed files.
- Open a video from Browse and a selected Subscribe group, play/seek/pause, switch parts/UGC episodes, change speed, reload an expired stream, and verify Back retains the original feed/group/pages. Check fullscreen Danmu, system Back, rotation and background pause on both Android 9 and a current device.
- Compare Danmu/comments with Bilibili: toggle overlays, seek across a six-minute boundary, send one permitted Danmu at a known time, read Popular/Newest/older comments and reply threads, and explicitly post a test comment/reply only with user authorization. Check signed-out/expired/low-level/restricted input gates, closed comments, moderation, throttling, and uncertain-send behavior without replaying a message automatically.
- Select a group whose members have different upload cadences, compare its combined total and chronological order, and load beyond 400 videos until every member library ends. Test a failed member-page retry, Refresh, and removing a member while loading; delayed videos from that member must not reappear. Check loading progress for a large group and keep empty groups empty.
- Check rotation, app backgrounding, process recreation, and Android 9 as well as a current Android version. The private authentication activity may require reopening if Android destroys it before login completes.

## Keep the next features portable

Preset rules, the video page/Danmu timing and download UI are shared TypeScript. Native hosts supply metadata, tags, persistence, safe media handles, social actions and download execution. Do not import Electron, Node filesystem APIs, remote stream URLs or native credentials into React.

The download bridge exposes get/choose/start/control operations rather than arbitrary file paths or network URLs. Android keeps the persisted tree URI native. A future foreground service can extend download lifetime without rewriting Browse/Subscribe or the queue UI; native playback can likewise replace the embedded player through the same contracts if needed.
