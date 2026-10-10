# Video search

- Open the top-bar search icon from Browse, Subscribe, or Options. The three main tabs remain unchanged.
- Enter a keyword (including Chinese), or a full BV code. Only the BV prefix is normalized; the remaining case-sensitive identifier is preserved. Empty/control-character input and queries above 200 characters are rejected.
- BV searches use the exact video-details endpoint. Missing/deleted videos show no matches, never a different suggested video.
- Keyword searches use Bilibili's video-only keyword endpoint with 20 results per requested page. Load more retains previous results and deduplicates by BV code. Pagination stops at Bilibili's reported end, an empty source page, or 1,000 requested pages; it does not claim access to every video on the platform.
- Search results are not filtered by Browse recommendation presets. Selecting a result opens the same player, including quality selection, Danmu, comments and downloads. Back retains results and restores scroll; closing Search returns to the loaded source feed. Leaving through a main tab closes Search.
- Only fixed HTTPS native endpoints are used. Keywords are encoded as query values, never interpreted as paths or URLs. Account cookies and standard guest browser identifiers issued by Bilibili remain native. Renderer results contain only normalized video metadata. Response size is bounded to 2 MiB; requests have timeouts, redirects are rejected, and account changes invalidate delayed results.
- Search highlighting is converted to plain text; no result HTML is executed. Ads, non-video entries, malformed metadata and duplicates are omitted.
- Network, verification and session errors are visible with Retry. There is no attempt to bypass Bilibili verification or private/restricted access. Guest search may still be limited by the platform.
- English video terminology uses tag/tags; the existing internal labels field is preserved to avoid breaking saved presets. Simplified Chinese continues to use 标签.

Verification: 452 TypeScript tests and 48 Android JVM tests pass. Production desktop checks cover simulated search pagination/deduplication, retries, stale requests, BV lookup, player Back, both languages and phone-width layout. Live guest keyword/BV lookup and pagination pass. Existing video/quality regression checks pass. Android metadata instrumentation is compiled only, not run without an authorized device/emulator.
