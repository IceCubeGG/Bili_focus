package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real native JSON/signing/transport boundaries exercised without real credentials or network. */
@RunWith(AndroidJUnit4.class)
public final class UploaderLibraryInstrumentedTest {
    private static final String SESSION = "SESSDATA=library-fixture; bili_jct=fixture-csrf";
    private static JSONObject envelope(JSONObject data) throws Exception { return new JSONObject().put("code", 0).put("data", data); }
    private static JSONObject images() throws Exception {
        return envelope(new JSONObject().put("wbi_img", new JSONObject()
            .put("img_url", "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png")
            .put("sub_url", "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png")));
    }
    private static JSONObject archive(int number, String uid) throws Exception {
        return new JSONObject().put("mid", uid).put("bvid", "BV" + String.format(java.util.Locale.ROOT, "%010d", number))
            .put("title", "Creator upload " + number).put("author", "Creator").put("created", 1700000000L - number)
            .put("pic", "https://i0.hdslb.com/cover.jpg").put("length", "03:05").put("play", 12);
    }
    private static JSONObject page(int page, int count) throws Exception {
        JSONArray videos = new JSONArray();
        for (int i = (page - 1) * 30 + 1; i <= Math.min(page * 30, count); i++) videos.put(archive(i, "123"));
        return new JSONObject().put("page", new JSONObject().put("pn", page).put("ps", 30).put("count", count))
            .put("list", new JSONObject().put("vlist", videos));
    }

    @Test public void signedLibraryPagesReachTheCatalogEndWithoutUsingDynamics() throws Exception {
        AtomicInteger catalogCalls = new AtomicInteger();
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            assertEquals(SESSION, cookies);
            if (endpoint.contains("/x/relation?")) return envelope(new JSONObject().put("mid", "123").put("attribute", 6));
            if (endpoint.endsWith("/nav")) return images();
            assertTrue(endpoint.contains("/x/space/wbi/arc/search?"));
            String query = new URI(endpoint).getRawQuery();
            assertTrue(query.contains("mid=123")); assertTrue(query.contains("ps=30")); assertTrue(query.contains("order=pubdate"));
            assertTrue(query.matches(".*w_rid=[a-f0-9]{32}$"));
            int requestedPage = Integer.parseInt(java.util.regex.Pattern.compile("(?:^|&)pn=([0-9]+)").matcher(query).results().findFirst().get().group(1));
            catalogCalls.incrementAndGet(); return envelope(page(requestedPage, 65));
        });
        try {
            JSONObject first = client.uploaderVideoPage("123", null, SESSION), second = client.uploaderVideoPage("123", first.getString("cursor"), SESSION);
            JSONObject last = client.uploaderVideoPage("123", second.getString("cursor"), SESSION);
            assertEquals(30, first.getJSONArray("videos").length()); assertEquals(30, second.getJSONArray("videos").length()); assertEquals(5, last.getJSONArray("videos").length());
            assertEquals(65, first.getInt("total")); assertFalse(last.getBoolean("hasMore")); assertTrue(last.isNull("cursor"));
            assertEquals(185, first.getJSONArray("videos").getJSONObject(0).getInt("durationSeconds"));
            assertEquals(3, catalogCalls.get()); assertFalse(first.toString().contains("library-fixture"));
            JSONObject beyondFeedLimit = BiliSubscriptionClient.uploaderVideoPageData(page(15, 905), "123", 15);
            assertEquals(30, beyondFeedLimit.getJSONArray("videos").length()); assertEquals("16", beyondFeedLimit.getString("cursor"));
        } finally { client.close(); }
    }

    @Test public void parserRejectsWrongPagingAndFiltersOnlyRequestedCreator() throws Exception {
        JSONObject mixed = page(1, 5);
        mixed.getJSONObject("list").put("vlist", new JSONArray().put(archive(1, "123")).put(archive(1, "123"))
            .put(archive(2, "999")).put(archive(3, "123").put("bvid", "bad"))
            .put(archive(4, "123").put("pic", "https://evil.example/image.jpg")));
        JSONArray videos = BiliSubscriptionClient.uploaderVideoPageData(mixed, "123", 1).getJSONArray("videos");
        assertEquals(2, videos.length()); assertEquals("", videos.getJSONObject(1).getString("cover"));
        JSONObject empty = BiliSubscriptionClient.uploaderVideoPageData(page(1, 0), "123", 1);
        assertEquals(0, empty.getJSONArray("videos").length()); assertFalse(empty.getBoolean("hasMore"));
        assertThrows(Exception.class, () -> BiliSubscriptionClient.uploaderVideoPageData(page(2, 65), "123", 1));
        JSONObject malformed = page(1, 65); malformed.getJSONObject("page").put("count", "65");
        assertThrows(Exception.class, () -> BiliSubscriptionClient.uploaderVideoPageData(malformed, "123", 1));
        JSONObject missing = page(1, 65); missing.getJSONObject("list").put("vlist", new JSONArray());
        assertThrows(Exception.class, () -> BiliSubscriptionClient.uploaderVideoPageData(missing, "123", 1));
    }

    @Test public void guestsAndUnfollowedOrExpiredAccountsNeverReceiveACatalog() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> { calls.incrementAndGet(); return envelope(new JSONObject().put("mid", "123").put("attribute", 0)); });
        try {
            assertThrows(Exception.class, () -> client.uploaderVideoPage("123", null, null)); assertEquals(0, calls.get());
            assertThrows(Exception.class, () -> client.uploaderVideoPage("123", null, SESSION)); assertEquals(1, calls.get());
        } finally { client.close(); }
        BiliSubscriptionClient expired = new BiliSubscriptionClient((endpoint, cookies) -> new JSONObject().put("code", -101));
        try { assertThrows(BiliNativeClient.SessionExpired.class, () -> expired.uploaderVideoPage("123", null, SESSION)); }
        finally { expired.close(); }
    }

    @Test public void accountInvalidationRejectsAnAlreadyPendingCatalogResponse() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            if (endpoint.contains("/x/relation?")) return envelope(new JSONObject().put("mid", "123").put("attribute", 2));
            if (endpoint.endsWith("/nav")) return images();
            entered.countDown(); assertTrue(release.await(3, TimeUnit.SECONDS)); return envelope(page(1, 65));
        });
        ExecutorService work = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> pending = work.submit(() -> client.uploaderVideoPage("123", null, SESSION));
            assertTrue(entered.await(3, TimeUnit.SECONDS)); client.clear(); release.countDown();
            assertThrows(ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
        } finally { release.countDown(); work.shutdownNow(); client.close(); }
    }
}
