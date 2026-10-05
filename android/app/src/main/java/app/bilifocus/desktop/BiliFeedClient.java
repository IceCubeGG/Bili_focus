package app.bilifocus.desktop;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONArray;
import org.json.JSONObject;

/** Fixed public metadata endpoints. Account cookies stay in the native request layer. */
final class BiliFeedClient {
    private static final String RECOMMENDATIONS = "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd";
    private static final String TAGS = "https://api.bilibili.com/x/tag/archive/tags?bvid=";
    static final int PAGE_SIZE = 24;
    static final int MAX_TAG_BATCH = 24;
    private final ExecutorService tagWork = Executors.newFixedThreadPool(4);
    private final Map<String, CachedLabels> labelCache = new LinkedHashMap<String, CachedLabels>(256, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, CachedLabels> eldest) { return size() > 256; }
    };

    private static final class CachedLabels {
        final JSONObject value;
        final long expiresAt;
        CachedLabels(JSONObject value, long expiresAt) { this.value = value; this.expiresAt = expiresAt; }
    }

    static String requireBvid(String value) {
        if (value == null || !value.matches("BV[A-Za-z0-9]{10}")) throw new IllegalArgumentException("Choose a valid Bilibili video.");
        return value;
    }

    static int pageIndex(String cursor) {
        if (cursor == null) return 1;
        if (!cursor.matches("[1-9][0-9]{0,3}")) throw new IllegalArgumentException("The recommendation page is invalid. Refresh the list.");
        int page = Integer.parseInt(cursor);
        if (page > 1000) throw new IllegalArgumentException("Refresh the recommendation list to continue.");
        return page;
    }

    static String coverUrl(String value) {
        if (value == null || value.length() > 2048) return "";
        if (value.startsWith("//")) value = "https:" + value;
        if (value.startsWith("http://")) value = "https://" + value.substring(7);
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getRawFragment() != null) return "";
            host = host.toLowerCase(Locale.ROOT);
            if (!host.endsWith(".hdslb.com")) return "";
            return uri.toASCIIString();
        } catch (Exception ignored) { return ""; }
    }

    private static String shortText(Object value, int maximum) {
        if (!(value instanceof String)) return "";
        String text = ((String) value).trim();
        if (text.isEmpty() || text.length() > maximum) return "";
        for (int index = 0; index < text.length(); index++) {
            if (Character.isISOControl(text.charAt(index))) return "";
        }
        return text;
    }

    private static long nonNegative(JSONObject object, String name, long maximum) {
        Object raw = object.opt(name);
        if (!(raw instanceof Number)) return 0;
        double number = ((Number) raw).doubleValue();
        if (!Double.isFinite(number) || number < 0 || number > maximum || Math.floor(number) != number) return 0;
        return ((Number) raw).longValue();
    }

    static JSONObject normalizePage(JSONObject body, int page) throws Exception {
        JSONObject data = body.optJSONObject("data");
        JSONArray input = data == null ? null : data.optJSONArray("item");
        if (input == null || input.length() > 100) throw new Exception("Bilibili returned an unexpected recommendation list.");
        JSONArray videos = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int index = 0; index < input.length() && videos.length() < PAGE_SIZE; index++) {
            JSONObject item = input.optJSONObject(index);
            if (item == null || item.has("ad_info") && !item.isNull("ad_info")
                || item.has("business_info") && !item.isNull("business_info")) continue;
            Object advertisement = item.opt("is_ad");
            if (Boolean.TRUE.equals(advertisement) || Integer.valueOf(1).equals(advertisement) || "1".equals(advertisement)) continue;
            String kind = item.optString("goto", "");
            if (!kind.equals("av") && !kind.equals("video")) continue;
            String bvid = item.optString("bvid", "");
            if (!bvid.matches("BV[A-Za-z0-9]{10}") || seen.contains(bvid)) continue;
            String title = shortText(item.opt("title"), 300);
            JSONObject owner = item.optJSONObject("owner");
            if (owner == null || title.isEmpty()) continue;
            long uid = nonNegative(owner, "mid", 9007199254740991L);
            String name = shortText(owner.opt("name"), 100);
            if (uid == 0 || name.isEmpty()) continue;
            JSONObject stat = item.optJSONObject("stat");
            long publishedAt = nonNegative(item, "pubdate", 4102444800L);
            JSONObject video = new JSONObject().put("bvid", bvid).put("title", title)
                .put("cover", coverUrl(item.optString("pic", "")))
                .put("durationSeconds", nonNegative(item, "duration", 604800))
                .put("uploader", new JSONObject().put("id", Long.toString(uid)).put("name", name))
                .put("views", stat == null ? 0 : nonNegative(stat, "view", 9007199254740991L))
                .put("publishedAt", publishedAt == 0 ? JSONObject.NULL : publishedAt * 1000);
            videos.put(video);
            seen.add(bvid);
        }
        boolean hasMore = input.length() > 0 && page < 1000;
        return new JSONObject().put("videos", videos).put("cursor", hasMore ? Integer.toString(page + 1) : JSONObject.NULL)
            .put("hasMore", hasMore);
    }

    static JSONObject normalizeLabels(String bvid, JSONObject body) throws Exception {
        JSONArray input = body.optJSONArray("data");
        if (input == null || input.length() > 200) throw new Exception("Bilibili returned unexpected video labels.");
        JSONArray labels = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int index = 0; index < input.length() && labels.length() < 30; index++) {
            JSONObject tag = input.optJSONObject(index);
            if (tag == null) continue;
            String label = shortText(tag.opt("tag_name"), 80);
            if (!label.isEmpty() && seen.add(label.toLowerCase(Locale.ROOT))) labels.put(label);
        }
        return new JSONObject().put("bvid", bvid).put("labels", labels).put("status", "ready");
    }

    private JSONObject request(String endpoint, String cookies) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
        connection.setRequestProperty("Referer", "https://www.bilibili.com/");
        connection.setRequestProperty("Accept", "application/json");
        if (cookies != null) connection.setRequestProperty("Cookie", BiliNativeClient.requireSession(cookies));
        try {
            if (connection.getResponseCode() != 200) throw new Exception("Could not load Bilibili videos. Please retry.");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 2097152) throw new Exception("Bilibili returned an unexpected response.");
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject body = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            int code = body.optInt("code", -1);
            if (code == -101) throw new BiliNativeClient.SessionExpired();
            if (code != 0) throw new Exception("Bilibili could not provide this feed. Please retry later.");
            return body;
        } finally { connection.disconnect(); }
    }

    JSONObject recommendationPage(String cursor, String cookies) throws Exception {
        int page = pageIndex(cursor);
        String endpoint = RECOMMENDATIONS + "?fresh_type=" + (page == 1 ? 3 : 4)
            + "&ps=" + PAGE_SIZE + "&fresh_idx=" + page + "&fresh_idx_1h=" + page;
        return normalizePage(request(endpoint, cookies), page);
    }

    private JSONObject labels(String bvid) {
        synchronized (labelCache) {
            CachedLabels cached = labelCache.get(bvid);
            if (cached != null && cached.expiresAt > System.currentTimeMillis()) return cached.value;
        }
        JSONObject result;
        boolean available = true;
        try { result = normalizeLabels(bvid, request(TAGS + bvid, null)); }
        catch (Exception ignored) {
            available = false;
            result = new JSONObject();
            try { result.put("bvid", bvid).put("labels", new JSONArray()).put("status", "unavailable"); }
            catch (Exception impossible) { throw new IllegalStateException(impossible); }
        }
        synchronized (labelCache) {
            if (available) labelCache.put(bvid, new CachedLabels(result, System.currentTimeMillis() + 600000));
            else labelCache.remove(bvid);
        }
        return result;
    }

    JSONArray videoLabels(List<String> bvids) throws Exception {
        if (bvids.size() > MAX_TAG_BATCH) throw new IllegalArgumentException("Too many videos were requested at once.");
        List<Future<JSONObject>> pending = new ArrayList<>();
        for (String bvid : bvids) { requireBvid(bvid); pending.add(tagWork.submit(() -> labels(bvid))); }
        JSONArray values = new JSONArray();
        for (Future<JSONObject> future : pending) values.put(future.get());
        return values;
    }

    void close() { tagWork.shutdownNow(); synchronized (labelCache) { labelCache.clear(); } }
}
