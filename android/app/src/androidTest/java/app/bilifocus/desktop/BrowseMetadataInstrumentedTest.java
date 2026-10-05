package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** JSON and storage checks use Android's actual JSONObject and SharedPreferences. */
@RunWith(AndroidJUnit4.class)
public final class BrowseMetadataInstrumentedTest {
    private static JSONObject settings() throws Exception {
        return new JSONObject("{\"version\":1,\"activePresetId\":\"study\",\"presets\":[{\"id\":\"study\",\"name\":\"Study\",\"labels\":[\"数学\"],\"uploaders\":[{\"id\":\"123\",\"name\":\"Teacher\"}],\"match\":\"all\"}]}");
    }

    @Test public void presetsSurviveAStoreRecreationAndEmptyCustomPresetsAreAllowed() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        SharedPreferences preferences = context.getSharedPreferences("bili-focus.browse-test", Context.MODE_PRIVATE);
        assertTrue(preferences.edit().clear().commit());
        try {
            BrowseSettingsStore store = new BrowseSettingsStore(preferences);
            assertTrue(store.read().isNull("activePresetId"));
            JSONObject saved = store.write(settings());
            assertEquals(saved.toString(), new BrowseSettingsStore(preferences).read().toString());
            JSONObject emptyPreset = settings();
            emptyPreset.getJSONArray("presets").getJSONObject(0).put("labels", new JSONArray()).put("uploaders", new JSONArray());
            assertEquals(0, BrowseSettingsStore.validate(emptyPreset).getJSONArray("presets").getJSONObject(0).getJSONArray("labels").length());
            assertEquals("study", store.read().getString("activePresetId"));
            JSONObject unnamedUploader = settings();
            unnamedUploader.getJSONArray("presets").getJSONObject(0).getJSONArray("uploaders").getJSONObject(0).put("name", "");
            assertEquals("", BrowseSettingsStore.validate(unnamedUploader).getJSONArray("presets").getJSONObject(0).getJSONArray("uploaders").getJSONObject(0).getString("name"));
        } finally { assertTrue(preferences.edit().clear().commit()); }
    }

    @Test public void malformedSettingsNeverReplaceThePreviouslySavedPreset() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        SharedPreferences preferences = context.getSharedPreferences("bili-focus.browse-test-invalid", Context.MODE_PRIVATE);
        assertTrue(preferences.edit().clear().commit());
        try {
            BrowseSettingsStore store = new BrowseSettingsStore(preferences);
            store.write(settings());
            JSONObject duplicate = settings();
            duplicate.getJSONArray("presets").put(duplicate.getJSONArray("presets").getJSONObject(0));
            JSONObject unknownActive = settings().put("activePresetId", "missing");
            JSONObject untrustedField = settings().put("credentials", "should-not-be-saved");
            JSONObject wrongVersion = settings().put("version", "1");
            JSONObject malformedUid = settings();
            malformedUid.getJSONArray("presets").getJSONObject(0).getJSONArray("uploaders").getJSONObject(0).put("id", "https://evil.example");
            JSONObject tooManyLabels = settings();
            JSONArray labels = new JSONArray();
            for (int index = 0; index < 31; index++) labels.put("tag-" + index);
            tooManyLabels.getJSONArray("presets").getJSONObject(0).put("labels", labels);
            for (JSONObject invalid : new JSONObject[] {duplicate, unknownActive, untrustedField, wrongVersion, malformedUid, tooManyLabels}) {
                assertThrows(IllegalArgumentException.class, () -> store.write(invalid));
            }
            assertEquals("study", store.read().getString("activePresetId"));
            assertFalse(preferences.getString("browseSettings.v1", "").contains("credentials"));
            assertTrue(preferences.edit().putString("browseSettings.v1", "{broken-json").commit());
            assertThrows(Exception.class, store::read);
            assertEquals("{broken-json", preferences.getString("browseSettings.v1", ""));
        } finally { assertTrue(preferences.edit().clear().commit()); }
    }

    private static JSONObject video(String bvid, String kind) throws Exception {
        return new JSONObject().put("goto", kind).put("bvid", bvid).put("title", "Video title")
            .put("pic", "http://i0.hdslb.com/bfs/archive/image.jpg").put("duration", 125).put("pubdate", 1750000000)
            .put("owner", new JSONObject().put("mid", 123).put("name", "Teacher"))
            .put("stat", new JSONObject().put("view", 500));
    }

    @Test public void metadataReturnsOnlyVideoFieldsAndExcludesAdsAndNonvideoCards() throws Exception {
        JSONArray items = new JSONArray().put(video("BV1xx411c7mD", "av"))
            .put(video("BV1xx411c7mD", "av"))
            .put(video("BV2xx411c7mD", "live"))
            .put(video("BV3xx411c7mD", "av").put("ad_info", new JSONObject().put("id", 9)))
            .put(video("BV5xx411c7mD", "av").put("business_info", new JSONObject().put("id", 10)))
            .put(video("BV6xx411c7mD", "av").put("is_ad", 1))
            .put(video("BV7xx411c7mD", "av").put("is_ad", true))
            .put(video("BV8xx411c7mD", "av").put("is_ad", "1"))
            .put(video("BV4xx411c7mD", "av").put("bvid", "invalid"));
        JSONObject body = new JSONObject().put("code", 0).put("data", new JSONObject().put("item", items));
        JSONObject page = BiliFeedClient.normalizePage(body, 1);
        assertEquals(1, page.getJSONArray("videos").length());
        assertEquals("2", page.getString("cursor"));
        JSONObject candidate = page.getJSONArray("videos").getJSONObject(0);
        assertEquals(7, candidate.length());
        assertEquals("123", candidate.getJSONObject("uploader").getString("id"));
        assertEquals(1750000000000L, candidate.getLong("publishedAt"));
        assertEquals("https://i0.hdslb.com/bfs/archive/image.jpg", candidate.getString("cover"));
        assertFalse(candidate.has("ad_info"));
        assertFalse(candidate.has("owner"));
        JSONObject empty = BiliFeedClient.normalizePage(new JSONObject().put("data", new JSONObject().put("item", new JSONArray())), 1);
        assertFalse(empty.getBoolean("hasMore"));
        assertTrue(empty.isNull("cursor"));
    }

    @Test public void labelsAreNormalizedWithoutTreatingMalformedDataAsAnEmptyKnownList() throws Exception {
        JSONArray tags = new JSONArray().put(new JSONObject().put("tag_name", " Math "))
            .put(new JSONObject().put("tag_name", "math"))
            .put(new JSONObject().put("tag_name", "数学"));
        JSONObject result = BiliFeedClient.normalizeLabels("BV1xx411c7mD", new JSONObject().put("data", tags));
        assertEquals("ready", result.getString("status"));
        assertEquals(2, result.getJSONArray("labels").length());
        assertEquals("Math", result.getJSONArray("labels").getString(0));
        assertThrows(Exception.class, () -> BiliFeedClient.normalizeLabels("BV1xx411c7mD", new JSONObject().put("data", JSONObject.NULL)));
    }
}
