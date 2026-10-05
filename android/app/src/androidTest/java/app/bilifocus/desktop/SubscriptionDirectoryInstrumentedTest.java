package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** No real account or network: verifies the actual Android JSON and private-storage implementation. */
@RunWith(AndroidJUnit4.class)
public final class SubscriptionDirectoryInstrumentedTest {
    private static final String SESSION = "SESSDATA=directory-fixture; bili_jct=fixture-csrf";

    private static JSONObject creator(String uid, Object attribute, String face) throws Exception {
        return new JSONObject().put("mid", uid).put("uname", " Creator " + uid + " ")
            .put("attribute", attribute).put("face", face).put("private-field", "not-public");
    }
    private static JSONObject roster(JSONArray list, Object total) throws Exception {
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("list", list).put("total", total));
    }
    private static JSONObject groups(String name, String... members) throws Exception {
        return new JSONObject().put("version", 1).put("groups", new JSONArray().put(new JSONObject()
            .put("id", "science").put("name", name).put("uploaderIds", new JSONArray(java.util.Arrays.asList(members)))));
    }

    @Test public void rosterUsesOwnAccountAndReturnsOnlySafeFollowedProfilesWithPaging() throws Exception {
        JSONArray list = new JSONArray().put(creator("123", 2, "https://i0.hdslb.com/avatar.jpg"))
            .put(creator("456", 6, "https://evil.example/avatar.jpg")).put(creator("789", 0, ""))
            .put(creator("999", "2", "")).put(creator("123", 2, ""));
        BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
            assertEquals(SESSION, cookies);
            assertEquals("https://api.bilibili.com/x/relation/followings?vmid=70001&pn=1&ps=50&order=desc&order_type=attention", endpoint);
            return roster(list, 75);
        });
        try {
            JSONObject page = client.followedUploaderPage(null, SESSION, "70001");
            JSONArray uploaders = page.getJSONArray("uploaders");
            assertEquals(2, uploaders.length());
            assertEquals(3, uploaders.getJSONObject(0).length());
            assertEquals("Creator 123", uploaders.getJSONObject(0).getString("name"));
            assertEquals("123", uploaders.getJSONObject(0).getString("id"));
            assertEquals("", uploaders.getJSONObject(1).getString("avatar"));
            assertTrue(page.getBoolean("hasMore"));
            assertEquals("2", page.getString("cursor"));
            assertEquals(75, page.getInt("total"));
            assertFalse(page.toString().contains("private-field"));
        } finally { client.close(); }
    }

    @Test public void malformedRosterAndGuestCannotReturnAnInferredDirectory() throws Exception {
        for (JSONObject response : new JSONObject[] {
            roster(new JSONArray(), "75"), roster(new JSONArray(), 75), roster(new JSONArray(), -1),
            new JSONObject().put("code", -101), new JSONObject().put("code", 0).put("data", new JSONObject())
        }) {
            BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> response);
            try { assertThrows(Exception.class, () -> client.followedUploaderPage(null, SESSION, "70001")); }
            finally { client.close(); }
        }
        BiliSubscriptionClient guest = new BiliSubscriptionClient((endpoint, cookies) -> { throw new AssertionError("No guest network request"); });
        try {
            assertThrows(Exception.class, () -> guest.followedUploaderPage(null, null, "70001"));
            assertThrows(Exception.class, () -> guest.followedUploaderPage(null, SESSION, "70001&pn=1"));
        } finally { guest.close(); }
    }

    @Test public void videoRefreshDoesNotInvalidateRosterButAccountClearDoes() throws Exception {
        for (boolean clear : new boolean[] {false, true}) {
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            BiliSubscriptionClient client = new BiliSubscriptionClient((endpoint, cookies) -> {
                if (endpoint.contains("followings?")) {
                    entered.countDown(); assertTrue(release.await(3, TimeUnit.SECONDS));
                    return roster(new JSONArray().put(creator("123", 2, "")), 1);
                }
                return new JSONObject().put("code", 0).put("data", new JSONObject()
                    .put("items", new JSONArray()).put("has_more", false).put("offset", ""));
            });
            ExecutorService work = Executors.newSingleThreadExecutor();
            try {
                Future<JSONObject> pending = work.submit(() -> client.followedUploaderPage(null, SESSION, "70001"));
                assertTrue(entered.await(3, TimeUnit.SECONDS));
                if (clear) client.clear(); else client.subscriptionPage(null, SESSION);
                release.countDown();
                if (clear) assertThrows(ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
                else assertEquals(1, pending.get(3, TimeUnit.SECONDS).getJSONArray("uploaders").length());
            } finally { release.countDown(); work.shutdownNow(); client.close(); }
        }
    }

    @Test public void groupsPersistAcrossStoreRecreationAndRemainAccountScoped() throws Exception {
        SharedPreferences preferences = InstrumentationRegistry.getInstrumentation().getTargetContext()
            .getSharedPreferences("subscription-directory-fixture", Context.MODE_PRIVATE);
        preferences.edit().clear().commit();
        try {
            SubscriptionGroupStore store = new SubscriptionGroupStore(preferences);
            assertEquals(0, store.read("70001").getJSONArray("groups").length());
            store.write("70001", groups(" Science ", "123", "456"));
            JSONObject saved = new SubscriptionGroupStore(preferences).read("70001");
            assertEquals("Science", saved.getJSONArray("groups").getJSONObject(0).getString("name"));
            assertEquals(2, saved.getJSONArray("groups").getJSONObject(0).getJSONArray("uploaderIds").length());
            assertEquals(0, store.read("70002").getJSONArray("groups").length());
            assertThrows(Exception.class, () -> store.write("70001", groups("Bad", "123", "123")));
            assertEquals(saved.toString(), store.read("70001").toString());
            store.write("70002", groups("Empty"));
            assertEquals(0, store.read("70002").getJSONArray("groups").getJSONObject(0).getJSONArray("uploaderIds").length());
            store.write("70001", SubscriptionGroupStore.empty());
            assertEquals(0, store.read("70001").getJSONArray("groups").length());
        } finally { preferences.edit().clear().commit(); }
    }

    @Test public void invalidSchemaOrCorruptSavedGroupsAreNotSilentlyReset() throws Exception {
        SharedPreferences preferences = InstrumentationRegistry.getInstrumentation().getTargetContext()
            .getSharedPreferences("subscription-directory-corrupt-fixture", Context.MODE_PRIVATE);
        preferences.edit().clear().commit();
        try {
            SubscriptionGroupStore store = new SubscriptionGroupStore(preferences);
            assertThrows(Exception.class, () -> store.write("70001", groups("Extra", "123").put("cookie", "injected")));
            assertThrows(Exception.class, () -> store.write("70001", groups("Invalid UID", "00123")));
            assertThrows(Exception.class, () -> store.write("../other", groups("Bad")));
            preferences.edit().putString("subscriptionGroups.v1.70001", "corrupt").commit();
            assertThrows(Exception.class, () -> store.read("70001"));
            assertEquals("corrupt", preferences.getString("subscriptionGroups.v1.70001", null));
        } finally { preferences.edit().clear().commit(); }
    }
}
