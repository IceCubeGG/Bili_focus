# Bili Focus implementation scope

## Step 1 — Define the first version

The desktop client has three bottom tabs, following the user's sketches:

1. **Browse:** user-controlled recommendations. Avatar at top left; recommendation settings at top right.
2. **Subscribe:** videos/content published by accounts the signed-in user follows.
3. **Options:** account management, interface preferences, save-folder selection and the download queue.

The highest-priority feature is a strict recommendation allowlist. Feed settings and preset selection belong on **Browse**, where users can see the effect. Options contains global settings. Subscribe has its own followed-account source and does not silently inherit Browse filters.

Steps 1–8 now cover the shell, account foundation, live Browse recommendations, strict presets, followed-account libraries/groups, the video page with playback/Danmu/comments, and video/cover downloads. The browser-only development preview can edit presets but cannot access native streams or destinations.

## Step 2 — Create the app shell

Electron supplies the desktop window and secure main process; Capacitor supplies the checked-in Android host. React supplies a shared interface, with reusable cards and explicit loading/empty/error components. A platform adapter and typed, narrowly scoped messages connect the interface to each native host. The interface has no Node.js access, arbitrary network proxy, or credential access. Shared feature rules belong in `src/core` rather than desktop-specific components.

Local preferences have a versioned schema. Updates are validated and written atomically. Appearance, compact cards, and the last tab survive restart. The app follows the operating system's theme unless the user chooses a theme.

## Step 3 — Build account management

The user opens Options and chooses a supported sign-in method. Desktop and Android support QR: scan in the Bilibili mobile app and confirm there. Android displays the code for scanning with another device. Both platforms also open Bilibili's official page for password or SMS sign-in, with its own verification challenges. The official page is isolated from the application interface and has no application JavaScript bridge. Polling stops on success, cancellation, expiry, or failure. Concurrent or delayed responses cannot override sign-out or a newer login.

After confirmation, the native host validates the session and saves it with operating-system encryption (Windows DPAPI or Android Keystore AES-GCM). The interface receives only a profile and status. On startup/Refresh, the app checks the session. Desktop QR sessions can renew credentials if required: a rotated session is saved before the previous refresh token is confirmed, and interrupted confirmation can be retried. Android QR and official web sessions currently save cookies without a refresh token and ask for sign-in again when expired.

Sign-out cancels login, clears local credentials, resets account display, and attempts Bilibili's logout endpoint. Network errors retain an offline status or report local-only logout. Only a confirmed invalid session is marked expired.

## Step 4 — Retrieve recommendation candidates

Desktop and Android fetch Bilibili's current web recommendation feed in native host code. Signed-out users get guest recommendations; signed-in sessions are attached only inside the native host. Cards contain real thumbnails, titles, duration, views, publication date when supplied, and uploader name/UID. Sponsored, live, and malformed entries are omitted.

Refresh starts a new batch. Load more advances the candidate cursor, deduplicates BVIDs, and bounds the displayed batch to 400 candidates. Errors, no results, and the end of a batch have separate states. Account changes invalidate pending results and replace the feed, without showing the previous account's cards.

## Step 5 — Create, edit, and select strict presets

Browse's Feed settings editor creates named presets with allowed exact Bilibili video tags and uploader UIDs. Users can add uploaders directly from cards, inspect/retry tags, edit saved choices, select a preset, and delete inactive presets. Up to 20 presets are persisted separately from credentials. The active choice survives restart on the device; desktop and Android use the same editor and matching rules.

- Within each list, any selected entry can match.
- When both lists have entries, **AND** is the default: match a selected tag and a selected UID. **OR** is an explicit alternative.
- A single nonempty list filters by that list; an empty custom preset matches nothing.
- Missing or failed tag lookups never count as tag matches. No matches remains empty, with Load more and Edit preset actions; it never broadens automatically.
- Only an explicit **All recommendations** selection disables filtering. Saved settings load before cards can appear; corrupt native preset storage blocks the feed instead of silently resetting the allowlist.

Presets filter the available recommendation candidates, not Bilibili's entire video catalog. Exact tags are trimmed and compared case-insensitively; they are not title keyword searches. Playback is not part of these two steps.

## Step 6 — Populate Subscribe from followed creators

Subscribe loads the authenticated followed-account video dynamics feed in native code. Only original video uploads are admitted: each uploader must be verified as currently followed through Bilibili's relation endpoint. Reposts, live streams, sponsored/injected cards, and unverified/unfollowed uploaders are excluded. A failed follow-status check produces an error rather than unfiltered results.

The shared page merges and deduplicates uploads by BVID, orders them by publication time newest first, and provides Refresh and Load older uploads. Feed batches are bounded to 400 videos. First-page Refresh rechecks follows; short-lived follow-status caches are scoped to the native account/credentials. Browse presets are never applied to Subscribe.

Show subscriptions / Hide subscriptions toggles a responsive avatar/name directory. The native host pages the signed-in user's actual following roster separately from video uploads; creators with no recent uploads still appear. Search matches loaded names/UIDs and Load more uploaders retrieves the next 50-account page. Selecting one uploader opens their available upload library from Bilibili's space endpoint. The native host rechecks following status, obtains the public WBI signing key, signs the request, and returns only normalized videos for that exact UID. Load older videos pages the library in 30-video pages until the upstream count reports the end; the 400-video recent-feed batch limit does not apply. The total count, empty/end states, retry, and Refresh apply to the selected library. Hiding the list retains it, and All followed uploaders returns to the recent feed. Switching uploader/account discards delayed responses from the previous source. Private/deleted/unavailable videos cannot be listed.

Local groups provide Twitter-Lists-style organization: create, name/rename, choose multiple followed creators, edit, select, and delete. A creator may belong to multiple groups. Groups persist per native account and device, independently of Browse presets and encrypted credentials. Selecting a group combines every member's complete available library into 30-video pages, globally newest first, with independent per-creator cursors and a summed library count. The shared pager loads at most two native pages concurrently, commits a combined page atomically, and preserves successful member requests and failed cursors for retry. Group libraries have no 400-video cap and end only after all member libraries are exhausted. Changes to members or accounts discard previous buffers and reject delayed results; missing/empty groups stay empty. Native validation bounds storage to 30 groups, names of 80 characters, and 500 unique members per group. Group edits/deletion never follow or unfollow anyone remotely. Current selection/list visibility reset when leaving Subscribe, while saved groups remain.

Signed-out and expired sessions show an account sign-in action rather than a guest feed. Account changes hide the old feed immediately and invalidate delayed responses. The browser preview clearly explains that native sign-in is required. This milestone covers video uploads; text/image dynamics, repost display, following/unfollowing controls, and playback are not included.

## Step 7 — Watch videos, Danmu, and comments

Click a thumbnail or title in Browse/Subscribe to open a shared video page. The source feed stays mounted but hidden, preserving its presets, selected uploader/group, loaded pages, directory, and scroll/focus. Back returns to it; selecting a UGC-series episode replaces the current video without adding another source-return history entry. Creator profiles open a fixed HTTPS Bilibili space link through the native system browser, without exporting the app's session.

Native clients validate video metadata and parts. This compatibility copy explicitly requests progressive MP4 with the pre-selector default parameters and uses a direct video source. There is no quality menu or renderer DASH attachment. Opaque local media handles, native Referer/range headers, credential isolation, play/pause, seek, volume, speed, reload, parts, and fullscreen remain. Android hosts fullscreen content and handles system Back natively.

Danmu has an on/off switch and a signed-in Send input. Six-minute protobuf segments load around the playback position and are bounded/deduplicated. Standard scrolling/top/bottom items are timed by the player clock, including pause, seeking, and stream-segment offsets; advanced/code/BAS modes are never evaluated. Sending captures the selected video's validated CID and current position. Native hosts alone add the authenticated cookies, CSRF token, and WBI signature.

Comments support Popular/Newest ordering, deduplicated older pages, pinned items when supplied, previews and full reply threads, and explicit signed-in comment/reply composition. Native code resolves the video AID and validates reply IDs. Closed/input-disabled sections disable posting. Repeated inaccessible pages stop with a session-limit notice rather than an endless load loop. Account changes reject stale reads and native metadata caches are credential-scoped. Posting is never retried automatically: an uncertain transport outcome asks the user to check Bilibili before sending again, with a local five-second send throttle.

Download and Download cover remain adjacent below the player. Watching restores the legacy progressive MP4 path without quality selection. Speed and Danmu visibility survive part changes. Reload restarts the selected part. Access restrictions and moderation are respected. Escape/system Back still exits fullscreen; the redundant exit overlay stays removed.

Options now persists English or Simplified Chinese UI language, applying immediately across account/login, Browse/preset, Subscribe/group, video/comment, and download controls. Content and user-created names keep their source language. OS dialogs and Bilibili's official page are not rewritten.

## Step 8 — Save selected video parts and covers

The video page queues either the selected part or the cover. The first request prompts for a native folder if none is selected. Options displays the current destination, queue progress/status, Cancel, Retry from start, and Remove entry. Completed files are never deleted by removing history. Folder and bounded queue history survive restart; interrupted work is failed and never automatically replays with an old session. Downloads are sequential, capped at 50 entries, and re-resolve native metadata and current access for each attempt. Preview/restricted access is not bypassed.

Desktop uses the system directory picker, exclusive staging, and no-overwrite commits. Android persists the system Storage Access Framework tree grant, stages in private cache, and exports validated files through DocumentsContract. There are no broad storage permissions. Only native code sees remote media URLs; cookie/CSRF data is not sent to CDNs or written into queue history. Account invalidation cancels pending work. The worker checks status, declared byte count, MIME and file signatures; empty, truncated, oversized and HTML/SVG/error payloads cannot complete. Limits are 2 GiB per video segment and 20 MiB per cover. Multipart stream segments get separate numbered files, not an invalid concatenation.

This implementation runs while the app process is alive. Background-service downloads, byte-resume, DASH muxing and offline-library playback are not included. Retry starts at byte zero with fresh access. Normal failures/cancellation clean the attempt's partial outputs where provider permissions permit; abrupt process death may leave temporary files or valid exported segments and requires an explicit retry.

The playback repair permits trusted desktop fullscreen only and keeps other permissions denied. Android's WebViewMediaStream reports full size rather than network-buffer availability and prevents a second skip after CDN Range handling. Five pure native tests cover large-versus-buffered size, initial/middle/end ranges, double-skip prevention and stale/truncated streams. Desktop production checks actually enter/exit fullscreen, sustain playback and verify saved fixture video/cover bytes. Android runtime playback/folder export still needs phone verification.

## Acceptance criteria

- All three tabs are navigable with mouse and keyboard, including narrow windows.
- Preferences restore after a process restart.
- Native Browse shows live candidates; the browser preview and later features are clearly identified.
- QR login provides waiting, scanned, cancelled, expired, and error behavior.
- Official password/SMS login has opening, waiting, cancellation, success, and error behavior; verification input remains on Bilibili's page.
- A successful account check shows the correct profile without returning cookies/tokens to the renderer.
- Session refresh does not turn an offline error into a false expiry.
- Sign-out clears the saved session; delayed polling cannot sign the user back in.
- Account secrets have no plaintext persistence fallback.
- Shared web build, Android asset sync, and debug APK compilation succeed. Account and feed/preset tests cover native boundaries and packaged-app behavior. Real-account feed personalization/sign-in and the remaining real-device checks still require user verification; see `android-migration.md`.
- Page cursors advance, malformed metadata is excluded, and duplicate videos are not displayed twice.
- Preset creation, editing, switching, persistence, AND/OR matching, and unavailable-label exclusion are verified. No delayed response can restore a previous account's feed.
- Subscribe verifies followed uploader membership, excludes reposts/suggestions, pages chronologically without duplicate videos, and is independent of Browse presets. Signed-out access cannot fall back to recommendations.
- The subscription directory toggles, includes followed creators without loaded uploads, and selects exact uploader/group membership without falling back to unrelated videos. Groups can be created, edited, reopened, and deleted; native storage is account-scoped and rejects corruption. The open directory and group editor fit at phone width.
- Individual uploader libraries retrieve older uploads independently of the recent feed, retain pages beyond 400 videos, stop at the upstream library end, retry the failed cursor, and cannot display delayed videos from another selection.
- Group libraries retrieve all members' available uploads independently of the recent feed, merge different upload cadences in newest-first order beyond 400 videos, retry without skipped/duplicate uploads, and reject delayed videos from removed members. Empty groups never fall back to the recent feed.
- Video details, actual fixture playback, part/episode switching, Danmu visibility/timing/explicit sends, comment sorting/pagination/replies, and source/group restoration are checked through the production desktop bridge. A guest-only live probe verifies one public video's metadata, MP4 byte range, Danmu, and comments; it never posts.
- Session cookies, CSRF tokens, WBI keys, and remote CDN stream URLs remain native. Media handles are revoked on part/account changes and close; native endpoints reject guest social writes and scripted Danmu is excluded. Android APK/unit-test compilation succeeds, while current device/fullscreen/social-account runtime checks remain pending.

## Later milestones

9. Verify full user journeys and persistence.
10. Improve reliability and prepare release packaging.
