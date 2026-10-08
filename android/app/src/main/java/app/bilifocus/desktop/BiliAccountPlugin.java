package app.bilifocus.desktop;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** The same safe account/settings contract as the desktop host; native secrets are never resolved. */
@CapacitorPlugin(name = "BiliAccount")
public final class BiliAccountPlugin extends Plugin {
    private static final long QR_LIFETIME_MS = 180000;
    private static final long QR_POLL_INTERVAL_MS = 2000;
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final ExecutorService feedWork = Executors.newFixedThreadPool(2);
    private final ExecutorService videoWork = Executors.newFixedThreadPool(3);
    private final AtomicInteger videoRequests = new AtomicInteger();
    private final BiliVideoClient videoClient = new BiliVideoClient();
    private final AtomicInteger feedRequests = new AtomicInteger();
    private final Handler qrHandler = new Handler(Looper.getMainLooper());
    private final AtomicInteger generation = new AtomicInteger();
    private final Object sessionLock = new Object();
    private final BiliNativeClient client = new BiliNativeClient();
    private final BiliFeedClient feedClient = new BiliFeedClient();
    private final BiliSubscriptionClient subscriptionClient = new BiliSubscriptionClient();
    private BrowseSettingsStore browseStore;
    private SubscriptionGroupStore subscriptionGroups;
    private SecureSessionStore store;
    private SharedPreferences preferences;
    private BiliDownloads downloads;
    private boolean downloadFolderPicker;
    private volatile String credentials;
    private volatile JSObject account;
    private volatile JSObject login = loginSnapshot("idle", null);
    private boolean secureStorage;
    private boolean webActivityPending;
    private int webGeneration;

    private int invalidate() {
        synchronized (sessionLock) {
            qrHandler.removeCallbacksAndMessages(null);
            subscriptionClient.clear();
            videoClient.clear();
            if (downloads != null) downloads.cancelPending();
            return generation.incrementAndGet();
        }
    }

    @Override
    public void load() {
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView view, android.webkit.WebResourceRequest request) {
                if (request.getUrl().getPath() != null && request.getUrl().getPath().startsWith("/__bili_media/")) return videoClient.intercept(request, getBridge().getLocalUrl());
                return super.shouldInterceptRequest(view, request);
            }
        });
        store = new SecureSessionStore(getContext());
        preferences = getContext().getSharedPreferences("bili-focus.settings.v1", Context.MODE_PRIVATE);
        downloads = new BiliDownloads(getContext(), preferences, (bvid, cid, kind) -> {
            final int current; final String saved, cookies;
            synchronized (sessionLock) { current = generation.get(); saved = credentials; cookies = videoCookies(); }
            Runnable check = () -> { synchronized (sessionLock) { if (current != generation.get() || !Objects.equals(saved, credentials) || !Objects.equals(cookies, videoCookies())) throw new IllegalStateException("Account changed."); } };
            return videoClient.download(bvid, cid, kind, cookies, check);
        });
        browseStore = new BrowseSettingsStore(preferences);
        subscriptionGroups = new SubscriptionGroupStore(preferences);
        secureStorage = store.available();
        account = accountSnapshot("signed-out", null, null, secureStorage ? null : "Android secure storage is unavailable on this device.");
        int current = generation.get();
        work.execute(() -> {
            try {
                String saved = secureStorage ? store.load() : null;
                if (current != generation.get() || saved == null) return;
                credentials = saved;
                checkAccount(current);
            } catch (Exception ignored) {
                publishAccountIfCurrent(current, accountSnapshot("signed-out", null, null,
                    "Your saved session could not be unlocked. Please sign in again."));
            }
        });
    }

    private JSObject accountSnapshot(String state, JSONObject profile, Long checkedAt, String message) {
        return new JSObject().put("status", state).put("profile", profile == null ? JSONObject.NULL : profile)
            .put("lastCheckedAt", checkedAt == null ? JSONObject.NULL : checkedAt)
            .put("message", message == null ? JSONObject.NULL : message).put("secureStorage", secureStorage);
    }

    private static JSObject loginSnapshot(String state, String message) {
        return loginSnapshot("web", state, message, null, null);
    }

    private static JSObject loginSnapshot(String method, String state, String message, String qrDataUrl, Long expiresAt) {
        return new JSObject().put("status", state)
            .put("qrDataUrl", qrDataUrl == null ? JSONObject.NULL : qrDataUrl)
            .put("expiresAt", expiresAt == null ? JSONObject.NULL : expiresAt)
            .put("message", message == null ? JSONObject.NULL : message).put("method", method);
    }

    private void publishAccount(JSObject value) {
        if ("expired".equals(value.optString("status")) || "signed-out".equals(value.optString("status"))) { videoClient.clear(); if (downloads != null) downloads.cancelPending(); }
        account = value;
        getActivity().runOnUiThread(() -> { if (account == value) notifyListeners("accountChanged", value); });
    }

    private void publishLogin(JSObject value) {
        login = value;
        getActivity().runOnUiThread(() -> { if (login == value) notifyListeners("loginChanged", value); });
    }

    private void publishAccountIfCurrent(int current, JSObject value) {
        synchronized (sessionLock) {
            if (current == generation.get()) publishAccount(value);
        }
    }

    private void publishLoginIfCurrent(int current, JSObject value) {
        synchronized (sessionLock) {
            if (current == generation.get()) publishLogin(value);
        }
    }

    private JSObject settings() {
        String tab = preferences.getString("lastTab", "browse");
        String appearance = preferences.getString("appearance", "system");
        if (!"browse".equals(tab) && !"subscribe".equals(tab) && !"options".equals(tab)) tab = "browse";
        if (!"system".equals(appearance) && !"light".equals(appearance) && !"dark".equals(appearance)) appearance = "system";
        return new JSObject().put("version", 1).put("lastTab", tab).put("appearance", appearance)
            .put("compactCards", preferences.getBoolean("compactCards", false))
            .put("language", "zh-CN".equals(preferences.getString("language", "en")) ? "zh-CN" : "en");
    }

    @PluginMethod
    public void getPlatform(PluginCall call) {
        JSArray methods = new JSArray();
        methods.put("qr");
        methods.put("web");
        call.resolve(new JSObject().put("kind", "android").put("loginMethods", methods));
    }

    @PluginMethod
    public void getSettings(PluginCall call) { call.resolve(settings()); }

    @PluginMethod
    public void updateSettings(PluginCall call) {
        JSObject patch = call.getObject("patch", new JSObject());
        SharedPreferences.Editor edit = preferences.edit();
        String tab = patch.getString("lastTab", "");
        String appearance = patch.getString("appearance", "");
        String language = patch.getString("language", "");
        if ("en".equals(language) || "zh-CN".equals(language)) edit.putString("language", language);
        if ("browse".equals(tab) || "subscribe".equals(tab) || "options".equals(tab)) edit.putString("lastTab", tab);
        if ("system".equals(appearance) || "light".equals(appearance) || "dark".equals(appearance)) edit.putString("appearance", appearance);
        Object compact = patch.opt("compactCards");
        if (compact instanceof Boolean) edit.putBoolean("compactCards", (Boolean) compact);
        if (edit.commit()) call.resolve(settings());
        else call.reject("Your settings could not be saved. Please retry.");
    }

    @PluginMethod
    public void getBrowseSettings(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(browseStore.read())); }
        catch (Exception ignored) { call.reject("Your Browse presets could not be loaded. Please retry."); }
    }

    @PluginMethod
    public void updateBrowseSettings(PluginCall call) {
        JSObject settings = call.getObject("settings");
        try { call.resolve(JSObject.fromJSONObject(browseStore.write(settings))); }
        catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage()); }
        catch (Exception ignored) { call.reject("Your Browse presets could not be saved. Please retry."); }
    }

    private boolean admitFeedRequest(PluginCall call) {
        if (feedRequests.incrementAndGet() <= 4) return true;
        feedRequests.decrementAndGet();
        call.reject("Please wait for the current videos to finish loading.");
        return false;
    }

    @PluginMethod
    public void getRecommendationPage(PluginCall call) {
        Object rawCursor = call.getData().opt("cursor");
        if (rawCursor != null && rawCursor != JSONObject.NULL && !(rawCursor instanceof String)) {
            call.reject("The recommendation page is invalid. Refresh the list.");
            return;
        }
        String cursor = rawCursor instanceof String ? (String) rawCursor : null;
        try { BiliFeedClient.pageIndex(cursor); }
        catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage()); return; }
        if (!admitFeedRequest(call)) return;
        int current = generation.get();
        String saved = credentials;
        String cookieHeader = "expired".equals(account.optString("status")) ? null : saved;
        feedWork.execute(() -> {
            try {
                JSONObject page = feedClient.recommendationPage(cursor, cookieHeader);
                synchronized (sessionLock) {
                    if (current != generation.get() || !Objects.equals(saved, credentials)) {
                        call.reject("Your account changed. Refresh the recommendation list.");
                        return;
                    }
                    call.resolve(JSObject.fromJSONObject(page));
                }
            } catch (BiliNativeClient.SessionExpired ignored) {
                synchronized (sessionLock) {
                    if (current == generation.get() && Objects.equals(saved, credentials)) {
                        publishAccount(accountSnapshot("expired", account.optJSONObject("profile"), System.currentTimeMillis(),
                            "Your session has expired. Please sign in again."));
                    }
                }
                call.reject("Your Bilibili session has expired. Sign in again or refresh to browse as a guest.");
            } catch (Exception ignored) { call.reject("Could not load Bilibili recommendations. Please check your connection and retry."); }
            finally { feedRequests.decrementAndGet(); }
        });
    }

    @PluginMethod
    public void getVideoLabels(PluginCall call) {
        JSArray input = call.getArray("bvids");
        if (input == null || input.length() > BiliFeedClient.MAX_TAG_BATCH) {
            call.reject("Too many videos were requested at once.");
            return;
        }
        List<String> bvids = new ArrayList<>();
        try {
            for (int index = 0; index < input.length(); index++) {
                Object value = input.opt(index);
                if (!(value instanceof String)) throw new IllegalArgumentException("Choose valid Bilibili videos.");
                bvids.add(BiliFeedClient.requireBvid((String) value));
            }
        } catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage()); return; }
        if (!admitFeedRequest(call)) return;
        int current = generation.get();
        String saved = credentials;
        feedWork.execute(() -> {
            try {
                org.json.JSONArray labels = feedClient.videoLabels(bvids);
                synchronized (sessionLock) {
                    if (current != generation.get() || !Objects.equals(saved, credentials)) {
                        call.reject("Your account changed. Refresh the recommendation list.");
                        return;
                    }
                    call.resolve(new JSObject().put("labels", labels));
                }
            } catch (Exception ignored) { call.reject("Could not load video labels. Please retry."); }
            finally { feedRequests.decrementAndGet(); }
        });
    }

    @PluginMethod
    public void getSubscriptionPage(PluginCall call) {
        Object rawCursor = call.getData().opt("cursor");
        if (rawCursor != null && rawCursor != JSONObject.NULL && !(rawCursor instanceof String)) {
            call.reject("The subscription page is invalid. Refresh Subscribe."); return;
        }
        String cursor = rawCursor instanceof String ? (String) rawCursor : null;
        try { BiliSubscriptionClient.requireCursor(cursor); }
        catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage()); return; }
        int current = generation.get();
        String saved = credentials;
        String status = account.optString("status");
        if (saved == null || account.optJSONObject("profile") == null || !"signed-in".equals(status) && !"offline".equals(status)) {
            call.reject("Sign in to Bilibili to see videos from your followed accounts."); return;
        }
        if (!admitFeedRequest(call)) return;
        feedWork.execute(() -> {
            try {
                JSONObject page = subscriptionClient.subscriptionPage(cursor, saved);
                synchronized (sessionLock) {
                    if (current != generation.get() || !Objects.equals(saved, credentials)) {
                        call.reject("Your account changed. Refresh Subscribe."); return;
                    }
                    call.resolve(JSObject.fromJSONObject(page));
                }
            } catch (BiliNativeClient.SessionExpired ignored) {
                synchronized (sessionLock) {
                    if (current == generation.get() && Objects.equals(saved, credentials)) {
                        subscriptionClient.clear();
                        publishAccount(accountSnapshot("expired", account.optJSONObject("profile"), System.currentTimeMillis(),
                            "Your session has expired. Please sign in again."));
                    }
                }
                call.reject("Your Bilibili session has expired. Sign in again to load Subscribe.");
            } catch (Exception ignored) { call.reject("Your followed videos could not be verified. Check your connection and refresh Subscribe."); }
            finally { feedRequests.decrementAndGet(); }
        });
    }

    @PluginMethod
    public void getAccount(PluginCall call) { call.resolve(account); }

    private interface VideoTask { JSONObject run(String cookies, Runnable check) throws Exception; }
    private String videoCookies() { return account != null && account.optJSONObject("profile") != null && ("signed-in".equals(account.optString("status")) || "offline".equals(account.optString("status"))) ? credentials : null; }
    private void videoTask(PluginCall call, boolean posting, VideoTask task) {
        final int current; final String saved, cookies;
        synchronized (sessionLock) {
            if (posting) { try { subscriptionUid(); } catch (Exception ignored) { call.reject("Sign in to send Danmu or comments."); return; } }
            current = generation.get(); saved = credentials; cookies = videoCookies();
        }
        if (videoRequests.incrementAndGet() > 6) { videoRequests.decrementAndGet(); call.reject("Please wait for the current video requests."); return; }
        Runnable check = () -> { synchronized (sessionLock) { if (current != generation.get() || !Objects.equals(saved, credentials) || !Objects.equals(cookies, videoCookies())) throw new IllegalStateException("Your account changed. Reopen the video."); } };
        videoWork.execute(() -> {
            try { check.run(); JSONObject result = task.run(cookies, check); synchronized (sessionLock) { check.run(); call.resolve(JSObject.fromJSONObject(result)); } }
            catch (BiliNativeClient.SessionExpired expired) { synchronized (sessionLock) { if (current == generation.get() && Objects.equals(saved, credentials)) publishAccount(accountSnapshot("expired", account.optJSONObject("profile"), System.currentTimeMillis(), "Sign in again to continue.")); } call.reject("Sign in again to continue."); }
            catch (org.json.JSONException invalid) { call.reject("Bilibili returned unexpected video data. Please retry."); }
            catch (Exception error) { call.reject(error.getMessage() == null ? "The video request could not finish. Please retry." : error.getMessage()); }
            finally { videoRequests.decrementAndGet(); }
        });
    }
    private static String videoBvid(PluginCall call) { return BiliVideoClient.bvid(call.getData().opt("bvid")); }
    @PluginMethod public void getDownloads(PluginCall call) { try { call.resolve(JSObject.fromJSONObject(downloads.snapshot())); } catch (Exception ignored) { call.reject("Could not load downloads."); } }
    @PluginMethod public void getSaveFolders(PluginCall call) { try { call.resolve(JSObject.fromJSONObject(downloads.folderSnapshot())); } catch(Exception error) { call.reject(error.getMessage()); } }
    @PluginMethod public void controlSaveFolder(PluginCall call) {
        videoWork.execute(()->{ try { call.resolve(JSObject.fromJSONObject(downloads.controlFolder(call.getString("id",""),call.getString("action","")))); } catch(Exception error) { call.reject(error.getMessage()==null?"Folder access changed. Select it again with the system picker.":error.getMessage()); } });
    }
    @PluginMethod public void listSavedFiles(PluginCall call) {
        videoWork.execute(()->{ try { call.resolve(JSObject.fromJSONObject(downloads.savedFiles(call.getString("folderId","")))); } catch(Exception error) { call.reject("Folder access changed. Select it again with the system picker."); } });
    }
    @PluginMethod public void openSavedFile(PluginCall call) {
        videoWork.execute(()->{
            try {
                Intent intent=downloads.savedFileIntent(call.getString("folderId",""),call.getString("fileId",""));
                getActivity().runOnUiThread(()->{ try { getActivity().startActivity(Intent.createChooser(intent,null)); call.resolve(); } catch(Exception error) { call.reject("No app could open this file. Install a compatible video or image viewer."); } });
            } catch(Exception error) { call.reject("Choose a video or cover from this folder."); }
        });
    }
    @PluginMethod public void startDownload(PluginCall call) {
        try { String kind=call.getString("kind", ""); call.resolve(JSObject.fromJSONObject(downloads.start(videoBvid(call), kind.equals("video") ? videoCid(call) : null, kind))); }
        catch(Exception error) { call.reject(error.getMessage()==null ? "Could not add this download." : error.getMessage()); }
    }
    @PluginMethod public void controlDownload(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(downloads.control(call.getString("id", ""), call.getString("action", "")))); }
        catch(Exception error) { call.reject(error.getMessage()==null ? "Could not change this download." : error.getMessage()); }
    }
    @PluginMethod public void chooseDownloadFolder(PluginCall call) {
        if (downloadFolderPicker) { call.reject("A folder picker is already open."); return; } downloadFolderPicker=true;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try { startActivityForResult(call, intent, "downloadFolderResult"); } catch(Exception ignored) { downloadFolderPicker=false; call.reject("The system folder picker could not open."); }
    }
    @ActivityCallback private void downloadFolderResult(PluginCall call, ActivityResult result) {
        downloadFolderPicker=false; if(call==null) return;
        try {
            if(result.getResultCode()==Activity.RESULT_OK && result.getData()!=null && result.getData().getData()!=null) {
                android.net.Uri uri=result.getData().getData(); int flags=result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0) throw new Exception();
                getContext().getContentResolver().takePersistableUriPermission(uri,flags); downloads.choose(uri);
            }
            call.resolve(JSObject.fromJSONObject(downloads.snapshot()));
        } catch(Exception ignored) { call.reject("The folder could not be used. Choose a writable subfolder; Android may not allow the Downloads root."); }
    }
    private static String videoCid(PluginCall call) { return BiliVideoClient.id(call.getData().opt("cid")); }
    private static String replyId(PluginCall call, String key) { Object value = call.getData().opt(key); return value == null || value == JSONObject.NULL ? null : BiliVideoClient.id(value); }
    @PluginMethod public void getVideoDetails(PluginCall call) { videoTask(call, false, (cookies, check) -> videoClient.details(videoBvid(call), cookies, check)); }
    private int videoQuality(PluginCall call) {
        if (!call.getData().has("quality")) return 64;
        Object value = call.getData().opt("quality");
        if (!(value instanceof Number) || ((Number) value).doubleValue() != ((Number) value).intValue()) throw new IllegalArgumentException("Invalid video quality.");
        int quality = ((Number) value).intValue(); BiliVideoClient.qualityLabel(quality); return quality;
    }
    private boolean progressivePlayback(PluginCall call) {
        if (!call.getData().has("format")) return false;
        if (!"progressive".equals(call.getString("format"))) throw new IllegalArgumentException("Invalid playback format."); return true;
    }
    @PluginMethod public void getVideoPlayback(PluginCall call) { videoTask(call, false, (cookies, check) -> videoClient.playback(videoBvid(call), videoCid(call), cookies, check, getBridge().getLocalUrl().replaceAll("/+$", ""), videoQuality(call), progressivePlayback(call))); }
    @PluginMethod public void releaseVideoPlayback(PluginCall call) { String handle = call.getString("handle"); if (handle != null) videoClient.release(handle); call.resolve(); }
    @PluginMethod public void getDanmu(PluginCall call) { videoTask(call, false, (cookies, check) -> videoClient.danmu(videoBvid(call), videoCid(call), (int) BiliVideoClient.number(call.getData().opt("segment"), 1680), cookies, check)); }
    @PluginMethod public void sendDanmu(PluginCall call) { videoTask(call, true, (cookies, check) -> { Object time = call.getData().opt("timeSeconds"); if (!(time instanceof Number)) throw new IllegalArgumentException("Invalid Danmu position."); return videoClient.sendDanmu(videoBvid(call), videoCid(call), call.getData().opt("text"), ((Number) time).doubleValue(), cookies, check); }); }
    @PluginMethod public void getVideoComments(PluginCall call) { videoTask(call, false, (cookies, check) -> videoClient.comments(videoBvid(call), (int) BiliVideoClient.number(call.getData().opt("page"), 1000000), call.getString("sort"), replyId(call, "root"), cookies, check)); }
    @PluginMethod public void sendVideoComment(PluginCall call) { videoTask(call, true, (cookies, check) -> videoClient.sendComment(videoBvid(call), call.getData().opt("text"), replyId(call, "root"), replyId(call, "parent"), cookies, check)); }
    @PluginMethod public void openCreatorProfile(PluginCall call) {
        final String uid; try { uid = BiliVideoClient.id(call.getData().opt("uploaderId")); } catch (Exception ignored) { call.reject("Invalid creator identifier."); return; }
        getActivity().runOnUiThread(() -> { try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://space.bilibili.com/" + uid))); call.resolve(); } catch (Exception ignored) { call.reject("No browser is available to open the creator profile."); } });
    }

    private String subscriptionUid() {
        JSONObject profile = account.optJSONObject("profile");
        String status = account.optString("status");
        if (credentials == null || profile == null || !"signed-in".equals(status) && !"offline".equals(status)) throw new IllegalArgumentException("Sign in to manage subscriptions.");
        String uid = profile.optString("uid", "");
        if (!uid.matches("[1-9][0-9]{0,19}")) throw new IllegalArgumentException("Sign in to manage subscriptions.");
        return uid;
    }

    @PluginMethod public void getFollowedUploaderPage(PluginCall call) {
        final String uid; final String cursor;
        try {
            uid = subscriptionUid(); Object raw = call.getData().opt("cursor");
            if (raw != JSONObject.NULL && !(raw instanceof String)) throw new IllegalArgumentException("Invalid followed-uploader page.");
            cursor = raw instanceof String ? (String) raw : null; BiliSubscriptionClient.followedPageIndex(cursor);
        } catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage()); return; }
        int current = generation.get(); String saved = credentials;
        if (!admitFeedRequest(call)) return;
        feedWork.execute(() -> {
            try {
                JSONObject page = subscriptionClient.followedUploaderPage(cursor, saved, uid);
                synchronized (sessionLock) {
                    if (current != generation.get() || !Objects.equals(saved, credentials) || !uid.equals(subscriptionUid())) { call.reject("Your account changed. Reopen subscriptions."); return; }
                    call.resolve(JSObject.fromJSONObject(page));
                }
            } catch (BiliNativeClient.SessionExpired expired) {
                synchronized (sessionLock) { if (current == generation.get() && Objects.equals(saved, credentials)) publishAccount(accountSnapshot("expired", account.optJSONObject("profile"), System.currentTimeMillis(), "Sign in again to load followed uploaders.")); }
                call.reject("Your session expired. Sign in again.");
            } catch (Exception ignored) { call.reject("Could not load followed uploaders. Please refresh and retry."); }
            finally { feedRequests.decrementAndGet(); }
        });
    }

    @PluginMethod public void getUploaderVideoPage(PluginCall call) {
        final String uploaderId, cursor, saved; final int current;
        try {
            synchronized (sessionLock) {
                subscriptionUid(); Object rawId = call.getData().opt("uploaderId"), rawCursor = call.getData().opt("cursor");
                if (!(rawId instanceof String) || !((String) rawId).matches("[1-9][0-9]{0,19}") || rawCursor != JSONObject.NULL && !(rawCursor instanceof String)) throw new IllegalArgumentException("Invalid uploader video request.");
                uploaderId = (String) rawId; cursor = rawCursor instanceof String ? (String) rawCursor : null;
                BiliSubscriptionClient.uploaderPageIndex(cursor); saved = credentials; current = generation.get();
            }
        } catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage()); return; }
        if (!admitFeedRequest(call)) return;
        feedWork.execute(() -> {
            try {
                JSONObject page = subscriptionClient.uploaderVideoPage(uploaderId, cursor, saved);
                synchronized (sessionLock) {
                    if (current != generation.get() || !Objects.equals(saved, credentials)) { call.reject("Your account changed. Refresh this uploader."); return; }
                    subscriptionUid(); call.resolve(JSObject.fromJSONObject(page));
                }
            } catch (BiliNativeClient.SessionExpired expired) {
                synchronized (sessionLock) {
                    if (current == generation.get() && Objects.equals(saved, credentials)) {
                        subscriptionClient.clear(); publishAccount(accountSnapshot("expired", account.optJSONObject("profile"), System.currentTimeMillis(), "Sign in again to view uploader videos."));
                    }
                }
                call.reject("Your session expired. Sign in again.");
            } catch (Exception ignored) { call.reject("Could not load this uploader’s video library. Check your connection and following status, then retry."); }
            finally { feedRequests.decrementAndGet(); }
        });
    }

    @PluginMethod public void getSubscriptionGroups(PluginCall call) { subscriptionGroups(call, false); }
    @PluginMethod public void updateSubscriptionGroups(PluginCall call) { subscriptionGroups(call, true); }
    private void subscriptionGroups(PluginCall call, boolean write) {
        try {
            synchronized (sessionLock) {
                String uid = subscriptionUid();
                JSONObject result = write ? subscriptionGroups.write(uid, call.getObject("settings")) : subscriptionGroups.read(uid);
                call.resolve(JSObject.fromJSONObject(result));
            }
        } catch (Exception invalid) { call.reject("Subscription groups could not be loaded or saved. Please sign in and retry."); }
    }

    @PluginMethod
    public void getLogin(PluginCall call) { call.resolve(login); }

    @PluginMethod
    public void startLogin(PluginCall call) {
        if (!secureStorage) {
            JSObject value = loginSnapshot("qr", "error", "Android secure storage is unavailable. Sign-in is disabled.", null, null);
            publishLogin(value);
            call.resolve(value);
            return;
        }
        int current = invalidate();
        if (webActivityPending) {
            getContext().sendBroadcast(new Intent(WebLoginActivity.ACTION_CANCEL).setPackage(getContext().getPackageName()),
                WebLoginActivity.AUTH_PERMISSION);
        }
        JSObject pending = loginSnapshot("qr", "generating", null, null, null);
        publishLogin(pending);
        call.resolve(pending);
        work.execute(() -> {
            try {
                BiliNativeClient.QrCode qr = client.generateQr();
                if (current != generation.get()) return;
                String image = QrImage.toDataUrl(qr.url);
                if (current != generation.get()) return;
                long expiresAt = System.currentTimeMillis() + QR_LIFETIME_MS;
                publishLoginIfCurrent(current, loginSnapshot("qr", "waiting", null, image, expiresAt));
                scheduleQrPoll(current, qr.key, image, expiresAt);
            } catch (Exception ignored) {
                publishLoginIfCurrent(current, loginSnapshot("qr", "error", "Could not create a Bilibili QR code. Please retry.", null, null));
            }
        });
    }

    private void scheduleQrPoll(int current, String key, String image, long expiresAt) {
        qrHandler.postDelayed(() -> {
            if (current != generation.get()) return;
            if (System.currentTimeMillis() >= expiresAt) {
                publishLoginIfCurrent(current, loginSnapshot("qr", "expired", "This QR code has expired. Generate a new one to continue.", null, null));
                return;
            }
            work.execute(() -> pollQr(current, key, image, expiresAt));
        }, QR_POLL_INTERVAL_MS);
    }

    private void pollQr(int current, String key, String image, long expiresAt) {
        if (current != generation.get()) return;
        try {
            BiliNativeClient.QrPoll result = client.pollQr(key);
            if (current != generation.get()) return;
            if (result.code == 86038 || System.currentTimeMillis() >= expiresAt) {
                publishLoginIfCurrent(current, loginSnapshot("qr", "expired", "This QR code has expired. Generate a new one to continue.", null, null));
                return;
            }
            if (result.code == 86101 || result.code == 86090) {
                publishLoginIfCurrent(current, loginSnapshot("qr", result.code == 86090 ? "scanned" : "waiting", null, image, expiresAt));
                scheduleQrPoll(current, key, image, expiresAt);
                return;
            }
            if (result.code != 0 || result.cookieHeader == null) throw new Exception("QR sign-in was not confirmed.");
            String checked = BiliNativeClient.requireSession(result.cookieHeader);
            JSONObject profile = client.validate(checked);
            if (current != generation.get()) return;
            String previous = credentials;
            store.save(checked);
            synchronized (sessionLock) {
                if (current != generation.get()) {
                    if (previous == null) store.clear();
                    else store.save(previous);
                    return;
                }
                credentials = checked;
                publishAccount(accountSnapshot("signed-in", profile, System.currentTimeMillis(), null));
                publishLogin(loginSnapshot("qr", "success", "You are signed in to Bilibili.", null, null));
            }
        } catch (Exception ignored) {
            publishLoginIfCurrent(current, loginSnapshot("qr", "error", "QR sign-in could not be verified or saved. Please generate a new code.", null, null));
        }
    }

    @PluginMethod
    public void startWebLogin(PluginCall call) {
        if (!secureStorage) {
            JSObject value = loginSnapshot("error", "Android secure storage is unavailable. Sign-in is disabled.");
            publishLogin(value);
            call.resolve(value);
            return;
        }
        if (webActivityPending) { call.reject("A sign-in window is already open."); return; }
        webGeneration = invalidate();
        int current = webGeneration;
        webActivityPending = true;
        publishLogin(loginSnapshot("web-login", "Complete password or SMS sign-in on Bilibili's official page."));
        getActivity().runOnUiThread(() -> {
            if (current != generation.get()) {
                webActivityPending = false;
                call.resolve(login);
                return;
            }
            try { startActivityForResult(call, new Intent(getContext(), WebLoginActivity.class).putExtra(WebLoginActivity.EXTRA_LANGUAGE, preferences.getString("language", "en")), "webLoginResult"); }
            catch (Exception ignored) {
                webActivityPending = false;
                JSObject value = loginSnapshot("error", "The official sign-in window could not be opened. Please retry.");
                publishLoginIfCurrent(current, value);
                call.resolve(login);
            }
        });
    }

    @ActivityCallback
    private void webLoginResult(PluginCall call, ActivityResult result) {
        webActivityPending = false;
        if (call == null) return;
        int current = webGeneration;
        if (current != generation.get()) { call.resolve(login); return; }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            String error = data == null ? null : data.getStringExtra(WebLoginActivity.EXTRA_ERROR);
            JSObject value = loginSnapshot(error == null ? "idle" : "error", error == null ? "Official sign-in was cancelled." : error);
            publishLogin(value);
            call.resolve(value);
            if (credentials != null) work.execute(() -> checkAccount(generation.get()));
            return;
        }
        // This private activity result is native-to-native; cookies are never copied into a JSObject.
        String candidate = data.getStringExtra(WebLoginActivity.EXTRA_COOKIES);
        data.removeExtra(WebLoginActivity.EXTRA_COOKIES);
        work.execute(() -> {
            try {
                String checked = BiliNativeClient.requireSession(candidate);
                JSONObject profile = client.validate(checked);
                if (current != generation.get()) { call.resolve(login); return; }
                String previous = credentials;
                store.save(checked);
                synchronized (sessionLock) {
                    if (current != generation.get()) {
                        if (previous == null) store.clear();
                        else store.save(previous);
                        call.resolve(login);
                        return;
                    }
                    credentials = checked;
                    publishAccount(accountSnapshot("signed-in", profile, System.currentTimeMillis(), null));
                    publishLogin(loginSnapshot("success", "You are signed in to Bilibili."));
                }
            } catch (Exception ignored) {
                publishLoginIfCurrent(current, loginSnapshot("error", "Sign-in could not be verified or saved. Please try again."));
            }
            call.resolve(login);
        });
    }

    @PluginMethod
    public void cancelLogin(PluginCall call) {
        String method = login.optString("method", "web");
        invalidate();
        getContext().sendBroadcast(new Intent(WebLoginActivity.ACTION_CANCEL).setPackage(getContext().getPackageName()),
            WebLoginActivity.AUTH_PERMISSION);
        publishLogin(loginSnapshot(method, "idle", "Sign-in was cancelled.", null, null));
        call.resolve(login);
        if (credentials != null) work.execute(() -> checkAccount(generation.get()));
    }

    private void checkAccount(int current) {
        String saved = credentials;
        JSONObject oldProfile;
        synchronized (sessionLock) {
            if (saved == null || current != generation.get()) return;
            oldProfile = account.optJSONObject("profile");
            publishAccount(accountSnapshot("checking", oldProfile, null, null));
        }
        try {
            JSONObject profile = client.validate(saved);
            publishAccountIfCurrent(current, accountSnapshot("signed-in", profile, System.currentTimeMillis(), null));
        } catch (BiliNativeClient.SessionExpired ignored) {
            publishAccountIfCurrent(current, accountSnapshot("expired", oldProfile, System.currentTimeMillis(), "Your session has expired. Please sign in again."));
        } catch (Exception ignored) {
            publishAccountIfCurrent(current, accountSnapshot("offline", oldProfile, System.currentTimeMillis(), "Could not reach Bilibili. Check your connection and retry."));
        }
    }

    @PluginMethod
    public void refreshAccount(PluginCall call) {
        int current = generation.get();
        work.execute(() -> { checkAccount(current); call.resolve(account); });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        int current = invalidate();
        getContext().sendBroadcast(new Intent(WebLoginActivity.ACTION_CANCEL).setPackage(getContext().getPackageName()),
            WebLoginActivity.AUTH_PERMISSION);
        work.execute(() -> {
            String previous = credentials;
            credentials = null;
            publishLoginIfCurrent(current, loginSnapshot("idle", null));
            try { store.clear(); }
            catch (Exception ignored) {
                publishAccountIfCurrent(current, accountSnapshot("signed-out", null, null, "The saved session could not be fully removed. Please retry sign-out."));
                call.resolve(account);
                return;
            }
            publishAccountIfCurrent(current, accountSnapshot("signed-out", null, null, null));
            if (previous != null) {
                try { client.logout(previous); }
                catch (Exception ignored) {
                    publishAccountIfCurrent(current, accountSnapshot("signed-out", null, null, "Signed out on this device. Bilibili could not be reached to end the remote session."));
                }
            }
            call.resolve(account);
        });
    }

    @Override
    protected void handleOnDestroy() {
        invalidate();
        work.shutdownNow();
        feedWork.shutdownNow();
        videoWork.shutdownNow();
        if (downloads != null) downloads.close();
        feedClient.close();
        subscriptionClient.close();
    }
}
