package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import androidx.test.ext.junit.runners.AndroidJUnit4;
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

/** Authenticated transport fixtures never use an account, network, or persisted credentials. */
@RunWith(AndroidJUnit4.class)
public final class SubscriptionMetadataInstrumentedTest {
    private static final String SESSION_A = "SESSDATA=fixture-session-a; bili_jct=fixture-csrf";
    private static final String SESSION_B = "SESSDATA=fixture-session-b; bili_jct=fixture-csrf";

    private static JSONObject upload(int number, String uploader, long timestamp) throws Exception {
        return new JSONObject().put("type", "DYNAMIC_TYPE_AV").put("modules", new JSONObject()
            .put("module_author", new JSONObject().put("mid", uploader).put("name", "Followed uploader").put("pub_ts", timestamp))
            .put("module_dynamic", new JSONObject().put("major", new JSONObject().put("type", "MAJOR_TYPE_ARCHIVE")
                .put("archive", new JSONObject().put("bvid", "BV" + String.format(java.util.Locale.ROOT, "%010d", number))
                    .put("title", "Original upload " + number).put("cover", "https://i0.hdslb.com/cover.jpg")
                    .put("duration_text", "02:05").put("stat", new JSONObject().put("play", "1234"))))));
    }

    private static JSONObject feed(JSONArray items, boolean more, String offset) throws Exception {
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("items", items).put("has_more", more).put("offset", offset));
    }

    private static JSONObject relation(String mid, int attribute) throws Exception {
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("mid", mid).put("attribute", attribute));
    }

    @Test public void verifiesEveryOriginalUploaderAndPreservesUploadsBeyondTwenty() throws Exception {
        JSONArray items = new JSONArray();
        for (int index = 1; index <= 35; index++) items.put(upload(index, "123", 1750000000L + index));
        items.put(upload(35, "123", 1750000035L)); // BVID duplicate, not a second card.
        items.put(upload(36, "456", 1750000036L)); // Independently verified not followed.
        items.put(upload(37, "123", 1750000037L).put("type", "DYNAMIC_TYPE_FORWARD"));
        items.put(upload(38, "123", 1750000038L).put("orig", new JSONObject()));
        items.put(upload(39, "123", 1750000039L).put("business_info", new JSONObject()));
        JSONObject explicitFalse = upload(40, "123", 1750000040L);
        explicitFalse.getJSONObject("modules").getJSONObject("module_author").put("following", false);
        items.put(explicitFalse);
        JSONObject malformedFlag = upload(41, "123", 1750000041L);
        malformedFlag.getJSONObject("modules").getJSONObject("module_author").put("following", "true");
        items.put(malformedFlag);
        JSONObject unknownTime = upload(42, "123", 0);
        unknownTime.getJSONObject("modules").getJSONObject("module_author").remove("pub_ts");
        items.put(unknownTime);
        AtomicInteger relationCalls = new AtomicInteger();
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            assertEquals(SESSION_A, cookies);
            if (endpoint.contains("feed/all")) return feed(items, true, "next:page_2");
            relationCalls.incrementAndGet();
            return endpoint.endsWith("fid=123") ? relation("123", 6) : relation("456", 0);
        });
        try {
            JSONObject page = client.subscriptionPage(null, SESSION_A);
            JSONArray videos = page.getJSONArray("videos");
            assertEquals(36, videos.length());
            assertEquals(2, relationCalls.get());
            assertEquals("next:page_2", page.getString("cursor"));
            assertTrue(page.getBoolean("hasMore"));
            assertEquals("BV0000000035", videos.getJSONObject(0).getString("bvid"));
            assertTrue(videos.getJSONObject(videos.length() - 1).isNull("publishedAt"));
            for (int index = 0; index < videos.length(); index++) {
                JSONObject video = videos.getJSONObject(index);
                assertEquals(7, video.length());
                assertEquals("123", video.getJSONObject("uploader").getString("id"));
                assertEquals(125, video.getInt("durationSeconds"));
                assertFalse(video.has("modules"));
                assertFalse(video.has("following"));
            }
        } finally { client.close(); }
    }

    @Test public void rejectsMalformedMembershipAndNeverTrustsTheFollowingFlagAlone() throws Exception {
        JSONObject trustedFlag = upload(1, "123", 1750000001L);
        trustedFlag.getJSONObject("modules").getJSONObject("module_author").put("following", true);
        for (JSONObject malformed : new JSONObject[] {
            relation("999", 2), new JSONObject().put("code", 0).put("data", new JSONObject().put("mid", "123")),
            new JSONObject().put("code", 0).put("data", new JSONObject().put("mid", "123").put("attribute", "2")),
            relation("123", 4), relation("123", 2).put("code", "0"),
            new JSONObject().put("code", -500).put("data", JSONObject.NULL)
        }) {
            BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> endpoint.contains("feed/all")
                ? feed(new JSONArray().put(trustedFlag), false, "") : malformed);
            try { assertThrows(Exception.class, () -> client.subscriptionPage(null, SESSION_A)); }
            finally { client.close(); }
        }
        assertFalse(BiliSubscriptionClient.relationDecision(relation("123", 0), "123"));
        assertTrue(BiliSubscriptionClient.relationDecision(relation("123", 2), "123"));
        assertTrue(BiliSubscriptionClient.relationDecision(relation("123", 6), "123"));
        assertThrows(BiliNativeClient.SessionExpired.class,
            () -> BiliSubscriptionClient.relationDecision(new JSONObject().put("code", -101), "123"));
    }

    @Test public void verificationFailureDrainsAlreadyStartedWorkersBeforeRejectingThePage() throws Exception {
        JSONArray items = new JSONArray();
        for (int index = 0; index < 20; index++) items.put(upload(index + 1, Integer.toString(100 + index), 1750000000L + index));
        CountDownLatch allStarted = new CountDownLatch(4);
        CountDownLatch failed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            if (endpoint.contains("feed/all")) return feed(items, false, "");
            calls.incrementAndGet(); allStarted.countDown();
            assertTrue(allStarted.await(3, TimeUnit.SECONDS));
            if (endpoint.endsWith("fid=100")) { failed.countDown(); throw new Exception("Fixture membership failure"); }
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return relation(endpoint.substring(endpoint.lastIndexOf('=') + 1), 2);
        });
        ExecutorService work = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> pending = work.submit(() -> client.subscriptionPage(null, SESSION_A));
            assertTrue(failed.await(3, TimeUnit.SECONDS));
            android.os.SystemClock.sleep(100);
            assertFalse("Page admission must stay held while already-started requests drain", pending.isDone());
            release.countDown();
            assertThrows(ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
            assertEquals("No new verification requests should start after failure", 4, calls.get());
        } finally { release.countDown(); work.shutdownNow(); client.close(); }
    }

    @Test public void refreshAndAccountChangesRecheckMembershipAndRejectRepeatedOffsets() throws Exception {
        AtomicInteger attribute = new AtomicInteger(2);
        AtomicInteger relationCalls = new AtomicInteger();
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            if (endpoint.contains("feed/all")) return feed(new JSONArray().put(upload(1, "123", 1750000001L)), false, "");
            relationCalls.incrementAndGet(); return relation("123", attribute.get());
        });
        try {
            assertEquals(1, client.subscriptionPage(null, SESSION_A).getJSONArray("videos").length());
            client.subscriptionPage("older:1", SESSION_A);
            assertEquals(1, relationCalls.get());
            attribute.set(0);
            assertEquals(0, client.subscriptionPage(null, SESSION_A).getJSONArray("videos").length());
            assertEquals(2, relationCalls.get());
            attribute.set(2);
            assertEquals(1, client.subscriptionPage("older:1", SESSION_B).getJSONArray("videos").length());
            assertEquals(3, relationCalls.get());
        } finally { client.close(); }
        BiliSubscriptionClient repeated = new BiliSubscriptionClient((endpoint, cookies) -> feed(new JSONArray(), true, "same:offset"));
        try { assertThrows(Exception.class, () -> repeated.subscriptionPage("same:offset", SESSION_A)); }
        finally { repeated.close(); }
    }

    @Test public void invalidatedPendingResultsAndExpiredOrGuestSessionsCannotReturnVideos() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            if (endpoint.contains("feed/all")) return feed(new JSONArray().put(upload(1, "123", 1750000001L)), false, "");
            entered.countDown(); assertTrue(release.await(3, TimeUnit.SECONDS)); return relation("123", 2);
        });
        ExecutorService work = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> pending = work.submit(() -> client.subscriptionPage(null, SESSION_A));
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            client.clear(); release.countDown();
            assertThrows(ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
            assertThrows(Exception.class, () -> client.subscriptionPage(null, null));
        } finally { release.countDown(); work.shutdownNow(); client.close(); }
        BiliSubscriptionClient expired = new BiliSubscriptionClient((endpoint, cookies) -> new JSONObject().put("code", -101));
        try { assertThrows(BiliNativeClient.SessionExpired.class, () -> expired.subscriptionPage(null, SESSION_A)); }
        finally { expired.close(); }
    }
}
