package app.bilifocus.desktop;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Android JSON/native endpoint boundaries; no real session or network is used. */
@RunWith(AndroidJUnit4.class)
public class VideoMetadataInstrumentedTest {
    private static JSONObject dashTrack(int quality, boolean audio) throws Exception {
        return new JSONObject().put("id", quality).put("mimeType", audio ? "audio/mp4" : "video/mp4").put("codecs", audio ? "mp4a.40.2" : "avc1.640028").put("bandwidth", 3000000)
            .put("width", audio ? 0 : 1920).put("height", audio ? 0 : 1080).put("baseUrl", "https://cdn.bilivideo.com/" + quality + ".mp4?secret=private")
            .put("SegmentBase", new JSONObject().put("Initialization", "0-999").put("indexRange", "1000-2000"));
    }
    private static BiliVideoClient dashClient(boolean preview) {
        return dashClient(preview, null);
    }
    private static BiliVideoClient dashClient(boolean preview, JSONObject dash) {
        return new BiliVideoClient((url, cookies, form) -> {
            String path = new URI(url).getPath();
            if (path.equals("/x/web-interface/view")) return json(details(), 0);
            if (path.equals("/x/web-interface/nav")) return json(keys(), cookies == null ? -101 : 0);
            if (path.equals("/x/player/wbi/playurl")) {
                assertTrue(url.contains("fnval=144")); assertTrue(url.contains("fourk=1"));
                return json(new JSONObject().put("is_preview", preview).put("dash", dash != null ? dash : new JSONObject().put("duration", 400)
                    .put("video", new JSONArray().put(dashTrack(120, false)).put(dashTrack(80, false)))
                    .put("audio", new JSONArray().put(dashTrack(30280, true)))), 0);
            }
            return json(new JSONArray(), 0);
        });
    }
    @Test public void nativeDashQualityAndAudioMetadataUseOnlyOpaqueUrls() throws Exception {
        BiliVideoClient client = dashClient(false);
        JSONObject playback = client.playback(BV, "62131", SESSION, () -> {}, "https://localhost", 120, false);
        assertEquals("4K", playback.getString("qualityLabel")); assertEquals(120, playback.getInt("quality")); assertEquals(2, playback.getJSONArray("qualities").length());
        assertEquals("mp4a.40.2", playback.getJSONObject("dash").getJSONArray("audio").getJSONObject(0).getString("codecs"));
        assertFalse(playback.toString().contains("bilivideo")); assertFalse(playback.toString().contains("private"));
        assertEquals("1080p", client.playback(BV, "62131", SESSION, () -> {}, "https://localhost", 80, false).getString("qualityLabel")); client.clear();
    }
    @Test public void nativeDashCannotBypassPreviewRestrictions() {
        BiliVideoClient client = dashClient(true);
        assertThrows(Exception.class, () -> client.playback(BV, "62131", null, () -> {}, "https://localhost", 120, false)); client.clear();
    }
    @Test public void nativeDashAcceptsSnakeCaseMetadataAndPreservesByteRanges() throws Exception {
        JSONObject track = dashTrack(80, false);
        track.put("base_url", track.remove("baseUrl")).put("mime_type", track.remove("mimeType"));
        track.remove("SegmentBase");
        track.put("segment_base", new JSONObject().put("initialization", "0-999").put("index_range", "1000-2000"));
        BiliVideoClient client = dashClient(false, new JSONObject().put("duration", 400)
            .put("video", new JSONArray().put(track)).put("audio", new JSONArray().put(dashTrack(30280, true))));
        try {
            JSONObject playback = client.playback(BV, "62131", null, () -> {}, "https://localhost", 120, false);
            assertEquals(80, playback.getInt("quality"));
            JSONObject returned = playback.getJSONObject("dash").getJSONArray("video").getJSONObject(0);
            assertEquals("0-999", returned.getString("initialization"));
            assertEquals("1000-2000", returned.getString("indexRange"));
            assertFalse(playback.toString().contains("private"));
        } finally { client.clear(); }
    }
    @Test public void nativeDashCatalogIncludesOnlyValidReturnedQualities() throws Exception {
        JSONObject invalidCodec = dashTrack(120, false).put("codecs", "unsupported.codec");
        JSONObject invalidRanges = dashTrack(112, false).put("SegmentBase", new JSONObject().put("Initialization", "10-0").put("indexRange", "1000-2000"));
        JSONObject invalidSource = dashTrack(116, false).put("baseUrl", "https://example.com/untrusted.mp4");
        JSONObject dash = new JSONObject().put("duration", 400)
            .put("video", new JSONArray().put(invalidCodec).put(invalidRanges).put(invalidSource).put(dashTrack(80, false)).put(dashTrack(32, false)))
            .put("audio", new JSONArray().put(dashTrack(30280, true)));
        BiliVideoClient client = dashClient(false, dash);
        try {
            JSONObject playback = client.playback(BV, "62131", null, () -> {}, "https://localhost", 120, false);
            assertEquals(80, playback.getInt("quality"));
            JSONArray qualities = playback.getJSONArray("qualities");
            assertEquals(2, qualities.length());
            assertEquals(80, qualities.getJSONObject(0).getInt("id"));
            assertEquals(32, qualities.getJSONObject(1).getInt("id"));
            assertEquals("avc1.640028", playback.getJSONObject("dash").getJSONArray("video").getJSONObject(0).getString("codecs"));
            assertEquals("mp4a.40.2", playback.getJSONObject("dash").getJSONArray("audio").getJSONObject(0).getString("codecs"));
        } finally { client.clear(); }
    }
    @Test public void nativeDashRequiresUsableAudioAndCurrentAccount() throws Exception {
        JSONObject dash = new JSONObject().put("duration", 400).put("video", new JSONArray().put(dashTrack(80, false)))
            .put("audio", new JSONArray().put(dashTrack(30280, true).put("mimeType", "audio/unknown")));
        BiliVideoClient client = dashClient(false, dash);
        try {
            assertThrows(Exception.class, () -> client.playback(BV, "62131", null, () -> {}, "https://localhost", 80, false));
            AtomicInteger checked = new AtomicInteger();
            assertThrows(IllegalStateException.class, () -> client.playback(BV, "62131", null, () -> {
                checked.incrementAndGet(); throw new IllegalStateException("Your account changed.");
            }, "https://localhost", 80, false));
            assertEquals(1, checked.get());
        } finally { client.clear(); }
    }
    @Test public void nativeDownloadResolutionChecksSelectedPartWithoutExposingSourcesInTheBridge() throws Exception { BiliVideoClient client=client(new AtomicInteger()); BiliDownloads.Source source=client.download(BV,"62131","video",SESSION,()->{}); assertEquals(1,source.urls.size()); assertTrue(source.urls.get(0).startsWith("https://cdn.bilivideo.com/")); assertThrows(Exception.class,()->client.download(BV,"999","video",SESSION,()->{})); client.clear(); }
    private static final String BV = "BV1xx411c7mD", SESSION = "SESSDATA=fixture-session; bili_jct=fixture-csrf";
    private static byte[] json(Object data, int code) throws Exception { return new JSONObject().put("code", code).put("data", data).toString().getBytes(StandardCharsets.UTF_8); }
    private static JSONObject details() throws Exception { return new JSONObject().put("bvid", BV).put("aid", 2).put("title", "Fixture video").put("desc", "<script>plain text</script>").put("owner", new JSONObject().put("mid", "3").put("name", "Creator")).put("pages", new JSONArray().put(new JSONObject().put("cid", 62131).put("part", "Part one").put("duration", 400))); }
    private static JSONObject keys() throws Exception { return new JSONObject().put("wbi_img", new JSONObject().put("img_url", "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png").put("sub_url", "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png")); }
    private static BiliVideoClient client(AtomicInteger posts) { return new BiliVideoClient((url, cookies, form) -> {
        String path = new URI(url).getPath();
        if (path.equals("/x/web-interface/view")) return json(details(), 0);
        if (path.equals("/x/tag/archive/tags")) return json(new JSONArray().put(new JSONObject().put("tag_name", "Science")), 0);
        if (path.equals("/x/web-interface/nav")) return json(keys(), cookies == null ? -101 : 0);
        if (path.equals("/x/player/wbi/playurl")) { assertTrue(url.contains("w_rid=")); return json(new JSONObject().put("quality", 64).put("durl", new JSONArray().put(new JSONObject().put("url", "https://cdn.bilivideo.com/a.mp4?secret=private-stream").put("length", 400000))), 0); }
        if (path.equals("/x/v2/dm/web/seg.so")) return new byte[]{10, 16, 8, 1, 16, (byte) 0x88, 0x27, 24, 1, 40, (byte) 0xff, (byte) 0xff, (byte) 0xff, 7, 58, 2, 72, 105};
        if (path.equals("/x/v2/reply") || path.equals("/x/v2/reply/reply")) return json(new JSONObject().put("page", new JSONObject().put("num", 1).put("count", 0)).put("replies", JSONObject.NULL).put("input_disable", true), 0);
        if (path.equals("/x/v2/dm/post") || path.equals("/x/v2/reply/add")) { assertEquals(SESSION, cookies); assertTrue(form.contains("csrf=fixture-csrf")); posts.incrementAndGet(); return json(new JSONObject(), 0); }
        throw new Exception("Unexpected fixture endpoint");
    }); }
    @Test public void metadataAndPlaybackStaySafeAndUseExactPart() throws Exception { BiliVideoClient client = client(new AtomicInteger()); JSONObject details = client.details(BV, SESSION, () -> {}); assertEquals("Science", details.getJSONArray("tags").getString(0)); assertEquals("62131", details.getJSONArray("parts").getJSONObject(0).getString("cid")); JSONObject playback = client.playback(BV, "62131", SESSION, () -> {}, "https://localhost"); assertTrue(playback.getJSONArray("sources").getJSONObject(0).getString("url").startsWith("https://localhost/__bili_media/")); assertFalse(playback.toString().contains("private-stream")); assertThrows(Exception.class, () -> client.playback(BV, "999", SESSION, () -> {}, "https://localhost")); client.clear(); }
    @Test public void guestSigningKeysSupportPlaybackAndDanmu() throws Exception { BiliVideoClient client = client(new AtomicInteger()); assertEquals("720p", client.playback(BV, "62131", null, () -> {}, "https://localhost").getString("qualityLabel")); JSONArray items = client.danmu(BV, "62131", 1, null, () -> {}).getJSONArray("items"); assertEquals("Hi", items.getJSONObject(0).getString("text")); assertEquals(5, items.getJSONObject(0).getDouble("timeSeconds"), 0); client.clear(); }
    @Test public void guestWritesAreRejectedBeforeTransport() { AtomicInteger posts = new AtomicInteger(); BiliVideoClient client = client(posts); assertThrows(Exception.class, () -> client.sendDanmu(BV, "62131", "Hello", 5, null, () -> {})); assertThrows(Exception.class, () -> client.sendComment(BV, "Hello", null, null, null, () -> {})); assertEquals(0, posts.get()); }
    @Test public void explicitSocialWritesUseNativeCsrfAndBoundedTiming() throws Exception { AtomicInteger posts = new AtomicInteger(); BiliVideoClient client = client(posts); client.sendDanmu(BV, "62131", "Hello", 5.125, SESSION, () -> {}); client.sendComment(BV, "Reply", "100", "201", SESSION, () -> {}); assertEquals(2, posts.get()); assertThrows(Exception.class, () -> client.sendDanmu(BV, "62131", "Again", 5, SESSION, () -> {})); assertThrows(Exception.class, () -> client.sendDanmu(BV, "62131", "Late", 401, SESSION, () -> {})); }
    @Test public void closedCommentsAndBadDanmuAreHandled() throws Exception { BiliVideoClient client = client(new AtomicInteger()); assertTrue(client.comments(BV, 1, "hot", null, SESSION, () -> {}).getBoolean("closed")); assertThrows(Exception.class, () -> DanmuDecoder.decode(new byte[]{10, 100, 1})); assertEquals(0, DanmuDecoder.decode(new byte[]{}).length()); }
    @Test public void staleAccountGuardPreventsNativeResultsAndWrites() { AtomicInteger posts = new AtomicInteger(); BiliVideoClient client = client(posts); Runnable stale = () -> { throw new IllegalStateException("Your account changed."); }; assertThrows(Exception.class, () -> client.details(BV, SESSION, stale)); assertThrows(Exception.class, () -> client.sendComment(BV, "Hello", null, null, SESSION, stale)); assertEquals(0, posts.get()); }
    @Test public void cachedMetadataIsScopedToCredentialsEvenAcrossClearRaces() throws Exception { AtomicInteger reads = new AtomicInteger(); BiliVideoClient client = new BiliVideoClient((url, cookies, form) -> { if (new URI(url).getPath().equals("/x/web-interface/view")) { reads.incrementAndGet(); return json(details().put("title", cookies == null ? "Public title" : "Private title"), 0); } return json(new JSONArray(), 0); }); client.details(BV, SESSION, client::clear); assertEquals("Public title", client.details(BV, null, () -> {}).getString("title")); assertEquals(2, reads.get()); }
}
