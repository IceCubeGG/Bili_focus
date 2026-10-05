package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.Base64;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.Arrays;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the packaged React UI and real Capacitor bridge without starting sign-in. */
@RunWith(AndroidJUnit4.class)
public final class NativeShellInstrumentedTest {
    private static final long PAGE_TIMEOUT_MS = 30000;

    @Test
    public void subscribeGateRequiresAnAccountAndNeverProvidesAGuestFeed() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario, "!!(window.Capacitor?.Plugins?.BiliAccount && document.querySelectorAll('nav[aria-label=\"Main navigation\"] button').length === 3 && !document.querySelector('nav[aria-label=\"Main navigation\"] button:disabled'))");
            openTab(scenario, "subscribe");
            waitFor(scenario, "document.querySelector('#main-content').classList.contains('tab-subscribe')");
            waitFor(scenario, "document.querySelector('.subscription-sign-in button')");
            evaluate(scenario, "window.__biliSubscriptionGate=null;window.Capacitor.Plugins.BiliAccount.getSubscriptionPage({cursor:null}).then(value=>window.__biliSubscriptionGate={unexpected:value}).catch(error=>window.__biliSubscriptionGate={error:String(error)});true");
            waitFor(scenario, "window.__biliSubscriptionGate !== null");
            assertEquals("true", evaluate(scenario, "!!window.__biliSubscriptionGate.error && /[Ss]ign in/.test(window.__biliSubscriptionGate.error) && !window.__biliSubscriptionGate.unexpected"));
            assertEquals("true", evaluate(scenario, "document.querySelectorAll('.subscription-grid .video-card').length === 0"));
            evaluate(scenario, "window.__biliDirectoryGate=null;Promise.allSettled([window.Capacitor.Plugins.BiliAccount.getFollowedUploaderPage({cursor:null}),window.Capacitor.Plugins.BiliAccount.getUploaderVideoPage({uploaderId:'123',cursor:null}),window.Capacitor.Plugins.BiliAccount.getSubscriptionGroups(),window.Capacitor.Plugins.BiliAccount.updateSubscriptionGroups({settings:{version:1,groups:[]}}),window.Capacitor.Plugins.BiliAccount.sendDanmu({bvid:'BV1xx411c7mD',cid:'62131',text:'must not send',timeSeconds:0}),window.Capacitor.Plugins.BiliAccount.sendVideoComment({bvid:'BV1xx411c7mD',text:'must not send',root:null,parent:null})]).then(results=>window.__biliDirectoryGate=results);true");
            waitFor(scenario, "window.__biliDirectoryGate !== null");
            assertEquals("true", evaluate(scenario, "window.__biliDirectoryGate.every(result=>result.status==='rejected' && /[Ss]ign in/.test(String(result.reason)))"));
            evaluate(scenario, "delete window.__biliDirectoryGate;true");
            evaluate(scenario, "delete window.__biliSubscriptionGate;true");
        }
    }

    @Test
    public void liveGuestFeedAndVisibleUploaderPresetWork() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario, "!!(window.Capacitor?.Plugins?.BiliAccount && document.querySelectorAll('nav[aria-label=\"Main navigation\"] button').length === 3 && !document.querySelector('nav[aria-label=\"Main navigation\"] button:disabled'))");
            evaluate(scenario, "window.__biliBrowseSetup = null; window.Capacitor.Plugins.BiliAccount.updateBrowseSettings({settings:{version:1,activePresetId:null,presets:[]}}).then(() => window.__biliBrowseSetup = true).catch(error => window.__biliBrowseSetup = String(error)); true");
            waitFor(scenario, "window.__biliBrowseSetup !== null");
            assertEquals("true", evaluate(scenario, "window.__biliBrowseSetup === true"));
            // Remount Browse to read its actual saved settings through the native adapter.
            openTab(scenario, "options");
            openTab(scenario, "browse");
            waitFor(scenario, "document.querySelectorAll('.live-video-card').length > 0");
            assertEquals("true", evaluate(scenario, "document.querySelectorAll('.live-video-card').length >= 1 && !document.querySelector('.thumbnail-preview')"));
            String firstPageCount = evaluate(scenario, "document.querySelectorAll('.live-video-card').length");
            String uploaderId = (String) new JSONTokener(evaluate(scenario, "document.querySelector('.live-video-card').dataset.uploaderId")).nextValue();
            assertTrue(uploaderId.matches("[1-9][0-9]{0,19}"));
            evaluate(scenario, "window.__biliLiveMetadata=null;Promise.all([window.Capacitor.Plugins.BiliAccount.getVideoLabels({bvids:Array.from(document.querySelectorAll('.live-video-card')).slice(0,3).map(card=>card.dataset.bvid)}),window.Capacitor.Plugins.BiliAccount.getRecommendationPage({cursor:'2'})]).then(values=>window.__biliLiveMetadata={tags:values[0],page:values[1]}).catch(error=>window.__biliLiveMetadata={error:String(error)});true");
            waitFor(scenario, "window.__biliLiveMetadata !== null");
            assertEquals("true", evaluate(scenario, "!window.__biliLiveMetadata.error && Array.isArray(window.__biliLiveMetadata.tags.labels) && window.__biliLiveMetadata.tags.labels.some(value=>value.status==='ready' && value.labels.length>0) && window.__biliLiveMetadata.page.videos.length>0 && window.__biliLiveMetadata.page.cursor==='3'"));
            evaluate(scenario, "window.__biliTaggedVideo=window.__biliLiveMetadata.tags.labels.find(value=>value.status==='ready' && value.labels.length>0).bvid;Array.from(document.querySelectorAll('.live-video-card')).find(card=>card.dataset.bvid===window.__biliTaggedVideo).querySelector('.video-labels button').click();true");
            waitFor(scenario, "Array.from(document.querySelectorAll('.live-video-card')).find(card=>card.dataset.bvid===window.__biliTaggedVideo)?.querySelector('.video-labels span')");
            evaluate(scenario, "document.querySelector('.feed-pagination button').click();true");
            waitFor(scenario, "document.querySelectorAll('.live-video-card').length > " + firstPageCount + " && !document.querySelector('.feed-pagination button:disabled')");
            assertEquals("true", evaluate(scenario, "new Set(Array.from(document.querySelectorAll('.live-video-card')).map(card=>card.dataset.bvid)).size === document.querySelectorAll('.live-video-card').length"));
            String initialCount = evaluate(scenario, "document.querySelectorAll('.live-video-card').length");
            waitFor(scenario, "Array.from(document.querySelectorAll('.live-thumbnail img')).some(image => image.complete && image.naturalWidth > 0)");
            capture("browse-android.png");
            evaluate(scenario, "document.querySelector('.live-video-card .video-uploader button').click(); true");
            waitFor(scenario, "document.querySelector('dialog.preset-dialog')?.open");
            evaluate(scenario, "(() => {const input=document.querySelector('.preset-form .field-label input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android uploader check');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
            waitFor(scenario, "document.querySelector('.preset-form .field-label input').value === 'Android uploader check'");
            assertEquals("true", evaluate(scenario, "document.querySelectorAll('.preset-field')[1].querySelectorAll('.selected-rules button').length === 1"));
            capture("browse-presets-android.png");
            evaluate(scenario, "document.querySelector('.preset-editor-actions .primary').click(); true");
            waitFor(scenario, "!document.querySelector('dialog.preset-dialog') && document.querySelector('select[aria-label=\"Active recommendation preset\"]').value !== ''");
            assertEquals("true", evaluate(scenario, "document.querySelectorAll('.live-video-card').length >= 1 && Array.from(document.querySelectorAll('.live-video-card')).every(card => card.dataset.uploaderId === " + JSONObject.quote(uploaderId) + ")"));
            evaluate(scenario, "window.__biliSavedPreset = null;window.Capacitor.Plugins.BiliAccount.getBrowseSettings().then(value => window.__biliSavedPreset=value).catch(error => window.__biliSavedPreset={error:String(error)});true");
            waitFor(scenario, "window.__biliSavedPreset !== null");
            JSONObject saved = new JSONObject((String) new JSONTokener(evaluate(scenario, "JSON.stringify(window.__biliSavedPreset)")).nextValue());
            assertFalse(saved.has("error"));
            assertEquals(1, saved.getJSONArray("presets").length());
            assertEquals("Android uploader check", saved.getJSONArray("presets").getJSONObject(0).getString("name"));
            assertEquals(saved.getJSONArray("presets").getJSONObject(0).getString("id"), saved.getString("activePresetId"));
            assertEquals(uploaderId, saved.getJSONArray("presets").getJSONObject(0).getJSONArray("uploaders").getJSONObject(0).getString("id"));
            evaluate(scenario, "(() => {const select=document.querySelector('select[aria-label=\"Active recommendation preset\"]');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
            waitFor(scenario, "document.querySelector('select[aria-label=\"Active recommendation preset\"]').value === '' && document.querySelectorAll('.live-video-card').length === " + initialCount);
            evaluate(scenario, "delete window.__biliBrowseSetup;delete window.__biliSavedPreset;delete window.__biliLiveMetadata;delete window.__biliTaggedVideo;true");
        }
    }

    private static void capture(String name) throws Exception {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        // WebView paints on a separate compositor after its JavaScript state has committed.
        SystemClock.sleep(500);
        Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull("Android should provide a screenshot", screenshot);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getExternalFilesDir(null), "screenshots");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        try (FileOutputStream output = new FileOutputStream(new File(directory, name))) {
            assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally { screenshot.recycle(); }
    }

    @Test
    public void authenticationActivityIsPrivateAndIsolated() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("app.bilifocus.desktop", context.getPackageName());
        ActivityInfo auth = context.getPackageManager().getActivityInfo(
            new ComponentName(context, WebLoginActivity.class), 0);
        assertFalse("Official authentication must not be callable by other apps", auth.exported);
        assertEquals(context.getPackageName() + ":bili_auth", auth.processName);
        assertTrue("Rotation should preserve the official login page",
            (auth.configChanges & ActivityInfo.CONFIG_ORIENTATION) != 0);
        assertTrue((auth.configChanges & ActivityInfo.CONFIG_SCREEN_SIZE) != 0);
    }

    @Test
    public void generatedQrImageDecodesToTheExactOfficialScanLink() throws Exception {
        String scanUrl = "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=sample-key";
        String image = QrImage.toDataUrl(scanUrl);
        assertTrue(image.startsWith("data:image/png;base64,"));
        byte[] png = Base64.decode(image.substring("data:image/png;base64,".length()), Base64.DEFAULT);
        Bitmap bitmap = BitmapFactory.decodeByteArray(png, 0, png.length);
        assertNotNull("The QR image must be a decodable PNG", bitmap);
        assertTrue(bitmap.getWidth() >= 256);
        assertEquals(bitmap.getWidth(), bitmap.getHeight());
        int[] pixels = new int[bitmap.getWidth() * bitmap.getHeight()];
        bitmap.getPixels(pixels, 0, bitmap.getWidth(), 0, 0, bitmap.getWidth(), bitmap.getHeight());
        BinaryBitmap source = new BinaryBitmap(new HybridBinarizer(
            new RGBLuminanceSource(bitmap.getWidth(), bitmap.getHeight(), pixels)));
        assertEquals(scanUrl, new QRCodeReader().decode(source).getText());
    }

    @Test
    public void packagedScreensAndSafeNativeAccountContractWork() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario,
                "!!(window.Capacitor && window.Capacitor.Plugins && "
                    + "window.Capacitor.Plugins.BiliAccount && "
                    + "document.querySelectorAll('nav[aria-label=\"Main navigation\"] button').length === 3 && "
                    + "!document.querySelector('nav[aria-label=\"Main navigation\"] button:disabled'))");

            evaluate(scenario,
                "window.__biliInstrumentationResult = null; "
                    + "Promise.all([window.Capacitor.Plugins.BiliAccount.getPlatform(), "
                    + "window.Capacitor.Plugins.BiliAccount.getAccount()])"
                    + ".then(values => { window.__biliInstrumentationResult = {platform: values[0], account: values[1]}; })"
                    + ".catch(error => { window.__biliInstrumentationResult = {error: String(error)}; }); true");
            waitFor(scenario, "window.__biliInstrumentationResult !== null");
            String encoded = evaluate(scenario, "JSON.stringify(window.__biliInstrumentationResult)");
            Object decoded = new JSONTokener(encoded).nextValue();
            assertTrue("JavaScript bridge should return JSON", decoded instanceof String);
            JSONObject result = new JSONObject((String) decoded);
            assertFalse("Native public account methods should resolve", result.has("error"));

            JSONObject platform = result.getJSONObject("platform");
            assertKeys(platform, "kind", "loginMethods");
            assertEquals("android", platform.getString("kind"));
            assertEquals(2, platform.getJSONArray("loginMethods").length());
            assertEquals("qr", platform.getJSONArray("loginMethods").getString(0));
            assertEquals("web", platform.getJSONArray("loginMethods").getString(1));
            JSONObject account = result.getJSONObject("account");
            assertKeys(account, "status", "profile", "lastCheckedAt", "message", "secureStorage");
            assertTrue("Android Keystore should be usable on the test device", account.getBoolean("secureStorage"));
            assertTrue(new HashSet<>(Arrays.asList("signed-out", "checking", "signed-in", "expired", "offline"))
                .contains(account.getString("status")));
            if (!account.isNull("profile")) {
                assertKeys(account.getJSONObject("profile"), "uid", "name", "avatar", "level", "isVip");
            }

            openTab(scenario, "browse");
            openTab(scenario, "subscribe");
            openTab(scenario, "options");
            waitFor(scenario, "document.querySelectorAll('.login-method-button').length === 2");
            assertEquals("true", evaluate(scenario,
                "!document.querySelectorAll('.login-method-button')[0].disabled && "
                    + "!document.querySelectorAll('.login-method-button')[1].disabled"));
            assertEquals("true", evaluate(scenario,
                "document.querySelector('.build-tag').textContent.includes('ANDROID')"));
            evaluate(scenario, "delete window.__biliInstrumentationResult; true");
        }
    }

    private static void assertKeys(JSONObject value, String... expected) {
        Set<String> actual = new HashSet<>();
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) actual.add(keys.next());
        assertEquals("Public DTO must contain only the documented safe fields", new HashSet<>(Arrays.asList(expected)), actual);
    }

    private static void openTab(ActivityScenario<MainActivity> scenario, String name) throws Exception {
        int index = "browse".equals(name) ? 0 : "subscribe".equals(name) ? 1 : 2;
        evaluate(scenario, "document.querySelectorAll('nav[aria-label=\"Main navigation\"] button')[" + index + "].click(); true");
        waitFor(scenario, "document.querySelector('#main-content').classList.contains('tab-" + name + "')");
        assertEquals("true", evaluate(scenario,
            "document.querySelectorAll('nav[aria-label=\"Main navigation\"] button')[" + index + "].getAttribute('aria-current') === 'page'"));
    }

    private static void waitFor(ActivityScenario<MainActivity> scenario, String condition) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + PAGE_TIMEOUT_MS;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, "Boolean(" + condition + ")"))) return;
            SystemClock.sleep(100);
        }
        fail("Packaged WebView did not reach the expected state within 30 seconds: " + condition);
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> {
            assertNotNull("MainActivity should create the Capacitor bridge", activity.getBridge());
            WebView webView = activity.getBridge().getWebView();
            assertNotNull(webView);
            webView.evaluateJavascript(script, value -> {
                result.set(value);
                completed.countDown();
            });
        });
        assertTrue("WebView JavaScript callback timed out", completed.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
