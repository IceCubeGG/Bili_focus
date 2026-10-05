package app.bilifocus.desktop;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Authenticated followed-video feed with independently verified uploader membership. */
final class BiliSubscriptionClient {
    private static final String FEED = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video";
    private static final String RELATION = "https://api.bilibili.com/x/relation?fid=";
    private final ExecutorService verificationWork = Executors.newFixedThreadPool(4);
    private final Semaphore httpSlots = new Semaphore(4);
    private final Object cacheLock = new Object();
    private final Map<String, Decision> membership = new LinkedHashMap<String, Decision>(256, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Decision> eldest) { return size() > 256; }
    };
    private String sessionScope;
    private long revision;
    private long accountRevision;
    private final Transport transport;

    interface Transport { JSONObject get(String endpoint, String cookies) throws Exception; }
    private static final class Decision {
        final boolean followed;
        final long expiresAt;
        Decision(boolean followed) { this.followed = followed; this.expiresAt = System.currentTimeMillis() + 30000; }
    }

    BiliSubscriptionClient() { this(BiliSubscriptionClient::request); }
    BiliSubscriptionClient(Transport transport) { this.transport = transport; }

    static String requireCursor(String value) {
        if (value == null) return null;
        if (!value.matches("[A-Za-z0-9_:-]{1,256}")) throw new IllegalArgumentException("The subscription page is invalid. Refresh Subscribe.");
        return value;
    }

    static int followedPageIndex(String cursor) {
        if (cursor == null) return 1;
        if (!cursor.matches("[1-9][0-9]{0,3}") || Integer.parseInt(cursor) > 2000) throw new IllegalArgumentException("Invalid followed-uploader page.");
        return Integer.parseInt(cursor);
    }

    static int uploaderPageIndex(String cursor) {
        if (cursor == null) return 1;
        if (!cursor.matches("[1-9][0-9]{0,7}") || Integer.parseInt(cursor) > 33333334) throw new IllegalArgumentException("Invalid uploader video page. Refresh this uploader.");
        return Integer.parseInt(cursor);
    }

    JSONObject uploaderVideoPage(String uploaderId, String cursor, String cookies) throws Exception {
        if (uploaderId == null || !uploaderId.matches("[1-9][0-9]{0,19}")) throw new IllegalArgumentException("Choose a valid followed uploader.");
        int page = uploaderPageIndex(cursor);
        String checked = BiliNativeClient.requireSession(cookies);
        startScope(checked, false);
        final long current;
        synchronized (cacheLock) { current = accountRevision; }
        if (!relationDecision(callAccount(RELATION + uploaderId, checked, current), uploaderId)) throw new Exception("This uploader is no longer followed. Refresh your subscriptions.");
        JSONObject navigation = callAccount("https://api.bilibili.com/x/web-interface/nav", checked, current);
        if (responseCode(navigation) == -101) throw new BiliNativeClient.SessionExpired();
        JSONObject navData = navigation.optJSONObject("data"), images = navData == null ? null : navData.optJSONObject("wbi_img");
        if (responseCode(navigation) != 0 || images == null) throw new Exception("Could not prepare the uploader video request.");
        String key = WbiSignature.key(images.optString("img_url"), images.optString("sub_url"));
        Map<String, String> parameters = new java.util.TreeMap<>();
        parameters.put("mid", uploaderId); parameters.put("pn", Integer.toString(page)); parameters.put("ps", "30");
        parameters.put("order", "pubdate"); parameters.put("tid", "0"); parameters.put("keyword", "");
        parameters.put("platform", "web"); parameters.put("web_location", "333.1387"); parameters.put("order_avoided", "true");
        JSONObject body = callAccount("https://api.bilibili.com/x/space/wbi/arc/search?" + WbiSignature.query(parameters, key, System.currentTimeMillis()), checked, current);
        if (responseCode(body) == -101) throw new BiliNativeClient.SessionExpired();
        if (responseCode(body) != 0) throw new Exception("Bilibili rejected the uploader video request. Please retry.");
        JSONObject result = uploaderVideoPageData(body.optJSONObject("data"), uploaderId, page);
        requireAccountCurrent(current, checked);
        return result;
    }

    static JSONObject uploaderVideo(JSONObject item, String requestedUid) throws Exception {
        if (item == null || !requestedUid.equals(uid(item.opt("mid"))) || sponsored(item)) return null;
        String bvid = item.optString("bvid"), title = boundedText(item.opt("title"), 300), name = boundedText(item.opt("author"), 80);
        if (!bvid.matches("BV[A-Za-z0-9]{10}") || title.isEmpty() || name.isEmpty()) return null;
        Object rawTime = item.opt("created"), rawViews = item.opt("play");
        Long published = null; long views = 0;
        if (rawTime instanceof Number) {
            double time = ((Number) rawTime).doubleValue();
            if (Double.isFinite(time) && time > 0 && time <= 4102444800L && Math.floor(time) == time) published = ((Number) rawTime).longValue() * 1000;
        }
        if (rawViews instanceof Number) {
            double count = ((Number) rawViews).doubleValue();
            if (Double.isFinite(count) && count >= 0 && count <= 9007199254740991L && Math.floor(count) == count) views = ((Number) rawViews).longValue();
        }
        return new JSONObject().put("bvid", bvid).put("title", title).put("cover", BiliFeedClient.coverUrl(item.optString("pic")))
            .put("durationSeconds", durationSeconds(item.optString("length")))
            .put("uploader", new JSONObject().put("id", requestedUid).put("name", name))
            .put("views", views).put("publishedAt", published == null ? JSONObject.NULL : published);
    }

    static JSONObject uploaderVideoPageData(JSONObject data, String requestedUid, int page) throws Exception {
        JSONObject paging = data == null ? null : data.optJSONObject("page"), listData = data == null ? null : data.optJSONObject("list");
        JSONArray list = listData == null ? null : listData.optJSONArray("vlist");
        Object rawCount = paging == null ? null : paging.opt("count"), rawPage = paging == null ? null : paging.opt("pn"), rawSize = paging == null ? null : paging.opt("ps");
        if (list == null || list.length() > 30 || !(rawCount instanceof Number) || !(rawPage instanceof Number) || !(rawSize instanceof Number)
            || ((Number) rawPage).doubleValue() != page || ((Number) rawSize).doubleValue() != 30) throw new Exception("Bilibili returned an unexpected uploader library. Please retry.");
        double total = ((Number) rawCount).doubleValue();
        if (!Double.isFinite(total) || total < 0 || total > 1000000000L || Math.floor(total) != total || list.length() == 0 && (page - 1L) * 30 < total) throw new Exception("Bilibili returned an unexpected uploader library. Please retry.");
        JSONArray videos = new JSONArray(); java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject video = uploaderVideo(list.optJSONObject(i), requestedUid);
            if (video != null && seen.add(video.getString("bvid"))) videos.put(video);
        }
        boolean more = page * 30L < total;
        return new JSONObject().put("videos", videos).put("total", (long) total).put("hasMore", more).put("cursor", more ? String.valueOf(page + 1) : JSONObject.NULL);
    }

    JSONObject followedUploaderPage(String cursor, String cookies, String accountUid) throws Exception {
        int page = followedPageIndex(cursor);
        if (accountUid == null || !accountUid.matches("[1-9][0-9]{0,19}")) throw new IllegalArgumentException("Sign in to load followed uploaders.");
        String checked = BiliNativeClient.requireSession(cookies);
        startScope(checked, false);
        final long accountCurrent;
        synchronized (cacheLock) { accountCurrent = accountRevision; }
        JSONObject body;
        body = callAccount("https://api.bilibili.com/x/relation/followings?vmid=" + accountUid + "&pn=" + page + "&ps=50&order=desc&order_type=attention", checked, accountCurrent);
        if (responseCode(body) == -101) throw new BiliNativeClient.SessionExpired();
        JSONObject data = body.optJSONObject("data");
        JSONArray list = data == null ? null : data.optJSONArray("list");
        Object rawTotal = data == null ? null : data.opt("total");
        if (responseCode(body) != 0 || list == null || list.length() > 50 || !(rawTotal instanceof Number)) throw new Exception("Could not load followed uploaders.");
        double total = ((Number) rawTotal).doubleValue();
        if (!Double.isFinite(total) || total < 0 || total > 100000 || Math.floor(total) != total || list.length() == 0 && page * 50 < total) throw new Exception("Unexpected followed-uploader list.");
        JSONArray uploaders = new JSONArray(); java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject item = list.optJSONObject(i); if (item == null) continue;
            String id = uid(item.opt("mid")), name = boundedText(item.opt("uname"), 80);
            Object attr = item.opt("attribute");
            if (id.isEmpty() || name.isEmpty() || !(attr instanceof Number) || ((Number) attr).doubleValue() != 2 && ((Number) attr).doubleValue() != 6 || !seen.add(id)) continue;
            uploaders.put(new JSONObject().put("id", id).put("name", name).put("avatar", BiliFeedClient.coverUrl(item.optString("face", ""))));
        }
        requireAccountCurrent(accountCurrent, checked);
        boolean more = page * 50 < total && page < 2000;
        return new JSONObject().put("uploaders", uploaders).put("total", (int) total).put("hasMore", more).put("cursor", more ? String.valueOf(page + 1) : JSONObject.NULL);
    }

    static int durationSeconds(String value) {
        if (value == null || !value.matches("[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?")) return 0;
        String[] sections = value.split(":");
        int seconds = 0;
        for (String section : sections) seconds = seconds * 60 + Integer.parseInt(section);
        return seconds <= 604800 ? seconds : 0;
    }

    private static String boundedText(Object value, int maximum) {
        if (!(value instanceof String)) return "";
        String result = ((String) value).trim();
        if (result.isEmpty() || result.length() > maximum) return "";
        for (int index = 0; index < result.length(); index++) if (Character.isISOControl(result.charAt(index))) return "";
        return result;
    }

    private static String uid(Object value) {
        if (value instanceof String && ((String) value).matches("[1-9][0-9]{0,19}")) return (String) value;
        if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            if (Double.isFinite(number) && number > 0 && number <= 9007199254740991L && Math.floor(number) == number) {
                return Long.toString(((Number) value).longValue());
            }
        }
        return "";
    }

    private static boolean sponsored(JSONObject item) {
        Object ad = item.opt("is_ad");
        return item.has("ad_info") && !item.isNull("ad_info")
            || item.has("business_info") && !item.isNull("business_info")
            || Boolean.TRUE.equals(ad) || ad instanceof Number && ((Number) ad).doubleValue() == 1 || "1".equals(ad);
    }

    static JSONObject originalVideo(JSONObject item) throws Exception {
        if (item == null || !"DYNAMIC_TYPE_AV".equals(item.optString("type")) || sponsored(item)
            || item.has("orig") && !item.isNull("orig")) return null;
        JSONObject modules = item.optJSONObject("modules");
        JSONObject author = modules == null ? null : modules.optJSONObject("module_author");
        JSONObject dynamic = modules == null ? null : modules.optJSONObject("module_dynamic");
        JSONObject major = dynamic == null ? null : dynamic.optJSONObject("major");
        JSONObject archive = major == null ? null : major.optJSONObject("archive");
        Object following = author == null ? null : author.opt("following");
        if (author == null || Boolean.FALSE.equals(following)
            || following != null && following != JSONObject.NULL && !(following instanceof Boolean)
            || major == null || !"MAJOR_TYPE_ARCHIVE".equals(major.optString("type"))
            || archive == null || sponsored(major) || sponsored(archive)) return null;
        String uploaderId = uid(author.opt("mid"));
        String uploaderName = boundedText(author.opt("name"), 80);
        String bvid = archive.optString("bvid", "");
        String title = boundedText(archive.opt("title"), 300);
        Object rawTimestamp = author.opt("pub_ts");
        if (uploaderId.isEmpty() || uploaderName.isEmpty() || title.isEmpty() || !bvid.matches("BV[A-Za-z0-9]{10}")) return null;
        Long publishedAt = null;
        if (rawTimestamp instanceof Number) {
            double timestamp = ((Number) rawTimestamp).doubleValue();
            if (Double.isFinite(timestamp) && timestamp > 0 && timestamp <= 4102444800L && Math.floor(timestamp) == timestamp) {
                publishedAt = ((Number) rawTimestamp).longValue() * 1000;
            }
        }
        JSONObject stat = archive.optJSONObject("stat");
        Object rawViews = stat == null ? null : stat.opt("play");
        long views = 0;
        if (rawViews instanceof Number) {
            double number = ((Number) rawViews).doubleValue();
            if (Double.isFinite(number) && number >= 0 && number <= 9007199254740991L && Math.floor(number) == number) views = ((Number) rawViews).longValue();
        } else if (rawViews instanceof String && ((String) rawViews).matches("[0-9]{1,16}")) {
            long number = Long.parseLong((String) rawViews);
            if (number <= 9007199254740991L) views = number;
        }
        return new JSONObject().put("bvid", bvid).put("title", title).put("cover", BiliFeedClient.coverUrl(archive.optString("cover", "")))
            .put("durationSeconds", durationSeconds(archive.optString("duration_text", "")))
            .put("uploader", new JSONObject().put("id", uploaderId).put("name", uploaderName))
            .put("views", views).put("publishedAt", publishedAt == null ? JSONObject.NULL : publishedAt);
    }

    static boolean relationDecision(JSONObject body, String requestedUid) throws Exception {
        int code = responseCode(body);
        if (code == -101) throw new BiliNativeClient.SessionExpired();
        JSONObject data = body.optJSONObject("data");
        Object attribute = data == null ? null : data.opt("attribute");
        if (code != 0 || data == null || !requestedUid.equals(uid(data.opt("mid")))
            || !(attribute instanceof Number)) throw new Exception("Your followed accounts could not be verified. Refresh Subscribe.");
        double number = ((Number) attribute).doubleValue();
        if (!Double.isFinite(number) || Math.floor(number) != number
            || number != 0 && number != 1 && number != 2 && number != 6 && number != 128) {
            throw new Exception("Your followed accounts could not be verified. Refresh Subscribe.");
        }
        return number == 2 || number == 6;
    }

    private long startScope(String cookies, boolean refresh) {
        synchronized (cacheLock) {
            if (!Objects.equals(sessionScope, cookies)) accountRevision++;
            if (refresh || !Objects.equals(sessionScope, cookies)) {
                membership.clear(); sessionScope = cookies; revision++;
            }
            return revision;
        }
    }

    private void requireAccountCurrent(long current, String cookies) throws Exception {
        synchronized (cacheLock) { if (current != accountRevision || !Objects.equals(sessionScope, cookies)) throw new Exception("Your account changed. Refresh subscriptions."); }
    }

    private void requireCurrent(long current, String cookies) throws Exception {
        synchronized (cacheLock) {
            if (current != revision || !Objects.equals(sessionScope, cookies)) throw new Exception("Your account or subscription feed changed. Refresh Subscribe.");
        }
    }

    private boolean verified(String uploaderId, String cookies, long current) throws Exception {
        requireCurrent(current, cookies);
        synchronized (cacheLock) {
            Decision cached = membership.get(uploaderId);
            if (cached != null && cached.expiresAt > System.currentTimeMillis()) return cached.followed;
        }
        boolean followed = relationDecision(call(RELATION + uploaderId, cookies, current), uploaderId);
        synchronized (cacheLock) {
            if (current != revision || !Objects.equals(sessionScope, cookies)) throw new Exception("Your account or subscription feed changed. Refresh Subscribe.");
            membership.put(uploaderId, new Decision(followed));
        }
        return followed;
    }

    JSONObject subscriptionPage(String cursor, String cookies) throws Exception {
        requireCursor(cursor);
        String checked = BiliNativeClient.requireSession(cookies);
        long current = startScope(checked, cursor == null);
        JSONObject body = call(FEED + (cursor == null ? "" : "&offset=" + URLEncoder.encode(cursor, "UTF-8")), checked, current);
        int code = responseCode(body);
        if (code == -101) throw new BiliNativeClient.SessionExpired();
        JSONObject data = body.optJSONObject("data");
        JSONArray items = data == null ? null : data.optJSONArray("items");
        Object rawMore = data == null ? null : data.opt("has_more");
        boolean validMore = rawMore instanceof Boolean || rawMore instanceof Number
            && (((Number) rawMore).doubleValue() == 0 || ((Number) rawMore).doubleValue() == 1);
        if (code != 0 || items == null || items.length() > 100 || !validMore) {
            throw new Exception("Bilibili returned an unexpected subscription feed. Please retry.");
        }
        boolean hasMore = Boolean.TRUE.equals(rawMore) || rawMore instanceof Number && ((Number) rawMore).doubleValue() == 1;
        if (hasMore && !(data.opt("offset") instanceof String)) throw new Exception("Bilibili returned an unexpected Subscribe cursor. Please retry.");
        String next = hasMore ? requireCursor((String) data.opt("offset")) : null;
        if (hasMore && next.equals(cursor)) throw new Exception("Bilibili could not advance the subscription feed. Refresh Subscribe.");
        List<JSONObject> candidates = new ArrayList<>();
        java.util.Set<String> uniqueUploaders = new java.util.LinkedHashSet<>();
        for (int index = 0; index < items.length(); index++) {
            JSONObject video = originalVideo(items.optJSONObject(index));
            if (video == null) continue;
            candidates.add(video);
            String uploaderId = video.getJSONObject("uploader").getString("id");
            uniqueUploaders.add(uploaderId);
        }
        List<String> ids = new ArrayList<>(uniqueUploaders);
        Map<String, Boolean> followed = new java.util.concurrent.ConcurrentHashMap<>();
        AtomicInteger index = new AtomicInteger();
        AtomicBoolean failed = new AtomicBoolean();
        AtomicReference<Exception> failure = new AtomicReference<>();
        List<Future<?>> workers = new ArrayList<>();
        for (int worker = 0; worker < Math.min(4, ids.size()); worker++) {
            workers.add(verificationWork.submit(() -> {
                try {
                    while (!failed.get()) {
                        int position = index.getAndIncrement();
                        if (position >= ids.size() || failed.get()) return;
                        String id = ids.get(position);
                        followed.put(id, verified(id, checked, current));
                    }
                } catch (Exception error) { failure.compareAndSet(null, error); failed.set(true); }
            }));
        }
        // Keep page admission until every started worker drains; failed HTTP calls
        // must not detach while new pages continue filling the executor queue.
        boolean interrupted = false;
        for (Future<?> worker : workers) {
            while (true) {
                try { worker.get(); break; }
                catch (InterruptedException error) { interrupted = true; failed.set(true); }
                catch (ExecutionException error) {
                    failure.compareAndSet(null, new Exception("Your followed accounts could not be verified. Refresh Subscribe."));
                    failed.set(true); break;
                }
            }
        }
        if (interrupted) { Thread.currentThread().interrupt(); throw new InterruptedException("Subscribe was interrupted."); }
        if (failure.get() != null) throw failure.get();
        requireCurrent(current, checked);
        candidates.sort(Comparator.comparingLong((JSONObject video) -> video.optLong("publishedAt")).reversed());
        JSONArray videos = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (JSONObject video : candidates) {
            if (Boolean.TRUE.equals(followed.get(video.getJSONObject("uploader").getString("id"))) && seen.add(video.getString("bvid"))) videos.put(video);
        }
        return new JSONObject().put("videos", videos).put("cursor", next == null ? JSONObject.NULL : next).put("hasMore", hasMore);
    }

    private static JSONObject request(String endpoint, String cookies) throws Exception {
        String checked = BiliNativeClient.requireSession(cookies);
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36");
        connection.setRequestProperty("Referer", endpoint.contains("/x/space/wbi/arc/search?") ? "https://space.bilibili.com/" : "https://t.bilibili.com/");
        if (endpoint.contains("/x/space/wbi/arc/search?")) connection.setRequestProperty("Origin", "https://space.bilibili.com");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", checked);
        try {
            if (connection.getResponseCode() == 401) throw new BiliNativeClient.SessionExpired();
            if (connection.getResponseCode() != 200) throw new Exception("Could not load your subscriptions. Please retry.");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 2097152) throw new Exception("Bilibili returned an unexpected subscription response.");
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject body = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            int code = responseCode(body);
            if (code == -101) throw new BiliNativeClient.SessionExpired();
            if (code != 0) throw new Exception("Your subscriptions could not be verified. Please retry.");
            return body;
        } finally { connection.disconnect(); }
    }

    private static int responseCode(JSONObject body) throws Exception {
        Object value = body == null ? null : body.opt("code");
        if (!(value instanceof Number)) throw new Exception("Bilibili returned an unexpected subscription response.");
        double code = ((Number) value).doubleValue();
        if (!Double.isFinite(code) || Math.floor(code) != code || code < Integer.MIN_VALUE || code > Integer.MAX_VALUE) {
            throw new Exception("Bilibili returned an unexpected subscription response.");
        }
        return ((Number) value).intValue();
    }

    private JSONObject call(String endpoint, String cookies, long current) throws Exception {
        httpSlots.acquire();
        try {
            requireCurrent(current, cookies);
            JSONObject body;
            try { body = transport.get(endpoint, cookies); }
            catch (Exception error) { requireCurrent(current, cookies); throw error; }
            requireCurrent(current, cookies);
            return body;
        } finally { httpSlots.release(); }
    }

    private JSONObject callAccount(String endpoint, String cookies, long current) throws Exception {
        httpSlots.acquire();
        try {
            requireAccountCurrent(current, cookies);
            JSONObject body;
            try { body = transport.get(endpoint, cookies); }
            catch (Exception error) { requireAccountCurrent(current, cookies); throw error; }
            requireAccountCurrent(current, cookies);
            return body;
        } finally { httpSlots.release(); }
    }

    void clear() { synchronized (cacheLock) { membership.clear(); sessionScope = null; revision++; accountRevision++; } }
    void close() { clear(); verificationWork.shutdown(); }
}
