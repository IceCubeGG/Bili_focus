package app.bilifocus.desktop;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Fixed metadata endpoints; session and guest browser cookies never cross the app bridge. */
final class BiliSearchClient {
    interface Transport { JSONObject get(String endpoint, String cookies) throws Exception; }
    private final Transport transport;
    BiliSearchClient() { this(BiliSearchClient::request); }
    BiliSearchClient(Transport transport) { this.transport = transport; }
    static String query(Object value) {
        if (!(value instanceof String) || ((String) value).length() > 200 || Pattern.compile("[\\x00-\\x1f\\x7f]").matcher((String) value).find()) throw new IllegalArgumentException("Enter a keyword or BV code (1–200 characters).");
        String text = ((String) value).trim();
        if (text.isEmpty()) throw new IllegalArgumentException("Enter a keyword or BV code (1–200 characters).");
        if (text.matches("(?i)bv[A-Za-z0-9]*")) {
            if (!text.matches("(?i)bv[A-Za-z0-9]{10}")) throw new IllegalArgumentException("Enter a complete BV code: BV followed by 10 letters or numbers.");
            return "BV" + text.substring(2);
        }
        return text;
    }
    static int page(Object value) {
        if (value == null || value == JSONObject.NULL) return 1;
        if (!(value instanceof String) || !((String) value).matches("[1-9][0-9]{0,3}") || Integer.parseInt((String) value) > 1000) throw new IllegalArgumentException("Invalid search page. Start a new search.");
        return Integer.parseInt((String) value);
    }
    static String title(Object value) {
        if (!(value instanceof String) || ((String) value).length() > 4000) return "";
        String text = ((String) value).replaceAll("<[^>]*>", "");
        Matcher entities = Pattern.compile("&(?:amp|lt|gt|quot|apos|#39|#[0-9]{1,7}|#x[0-9a-f]{1,6});", Pattern.CASE_INSENSITIVE).matcher(text);
        StringBuffer decoded = new StringBuffer();
        while (entities.find()) {
            String token = entities.group().toLowerCase(java.util.Locale.ROOT), replacement = "";
            switch (token) {
                case "&amp;": replacement = "&"; break;
                case "&lt;": replacement = "<"; break;
                case "&gt;": replacement = ">"; break;
                case "&quot;": replacement = "\""; break;
                case "&apos;": case "&#39;": replacement = "'"; break;
                default:
                    int code = Integer.parseInt(token.substring(token.startsWith("&#x") ? 3 : 2, token.length() - 1), token.startsWith("&#x") ? 16 : 10);
                    if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) replacement = new String(Character.toChars(code));
            }
            entities.appendReplacement(decoded, Matcher.quoteReplacement(replacement));
        }
        entities.appendTail(decoded);
        text = decoded.toString().replaceAll("[\\x00-\\x1f\\x7f]", "").trim();
        return text.substring(0, Math.min(300, text.length()));
    }
    static long count(Object value, long maximum) throws Exception {
        if (!(value instanceof Number)) throw new Exception("Bilibili returned unexpected search results. Please retry.");
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number < 0 || number > maximum || Math.floor(number) != number) throw new Exception("Bilibili returned unexpected search results. Please retry.");
        return ((Number) value).longValue();
    }
    static JSONObject normalize(JSONObject data, int page) throws Exception {
        if (data != null && !data.optString("v_voucher", "").isEmpty()) throw new Exception("Bilibili requires verification. Sign in on the official Bilibili page, then retry search.");
        JSONArray items = data == null ? null : data.optJSONArray("result");
        if (items == null || items.length() > 100 || count(data.opt("page"), 1000) != page) throw new Exception("Bilibili returned unexpected search results. Please retry.");
        long total = count(data.opt("numResults"), 1000000000), pages = count(data.opt("numPages"), 1000000);
        JSONArray candidates = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !"video".equals(item.optString("type"))) continue;
            JSONObject candidate = new JSONObject(item.toString());
            candidate.put("goto", "av").put("title", title(item.opt("title")))
                .put("owner", new JSONObject().put("mid", item.opt("mid")).put("name", item.opt("author")))
                .put("stat", new JSONObject().put("view", item.opt("play")))
                .put("duration", BiliSubscriptionClient.durationSeconds(item.optString("duration")));
            candidates.put(candidate);
        }
        JSONObject result = BiliFeedClient.normalizePage(new JSONObject().put("data", new JSONObject().put("item", candidates)), page);
        boolean more = items.length() > 0 && page < pages && page < 1000;
        return result.put("total", total).put("hasMore", more).put("cursor", more ? String.valueOf(page + 1) : JSONObject.NULL);
    }
    private JSONObject call(String path, String cookies, Runnable check) throws Exception {
        check.run(); JSONObject body = transport.get("https://api.bilibili.com" + path, cookies); check.run();
        if (body.optInt("code", -1) == -101) throw new BiliNativeClient.SessionExpired();
        return body;
    }
    JSONObject search(Object rawQuery, Object cursor, String cookies, Runnable check) throws Exception {
        String query = query(rawQuery); int page = page(cursor);
        if (query.matches("BV[A-Za-z0-9]{10}")) {
            if (page != 1) throw new IllegalArgumentException("Invalid search page. Start a new search.");
            JSONObject body = call("/x/web-interface/view?bvid=" + query, cookies, check);
            if (body.optInt("code", -1) == -404) return new JSONObject().put("videos", new JSONArray()).put("total", 0).put("cursor", JSONObject.NULL).put("hasMore", false);
            JSONObject data = body.optJSONObject("data");
            if (body.optInt("code", -1) != 0 || data == null || !query.equals(data.optString("bvid"))) throw new Exception("Bilibili returned unexpected search results. Please retry.");
            data.put("goto", "av");
            JSONObject result = BiliFeedClient.normalizePage(new JSONObject().put("data", new JSONObject().put("item", new JSONArray().put(data))), 1);
            if (result.getJSONArray("videos").length() != 1) throw new Exception("Bilibili returned unexpected search results. Please retry.");
            return result.put("total", 1).put("cursor", JSONObject.NULL).put("hasMore", false);
        }
        String header = cookies == null ? "" : BiliNativeClient.requireSession(cookies);
        if (!Pattern.compile("(?:^|;\\s*)buvid3=").matcher(header).find()) {
            JSONObject spi = call("/x/frontend/finger/spi", cookies, check), data = spi.optJSONObject("data");
            String buvid = data == null ? "" : data.optString("b_3");
            if (spi.optInt("code", -1) != 0 || !buvid.matches("[A-Za-z0-9_-]{1,128}")) throw new Exception("Could not prepare Bilibili search. Please retry.");
            header += (header.isEmpty() ? "" : "; ") + "buvid3=" + buvid;
        }
        JSONObject body = call("/x/web-interface/search/type?search_type=video&page_size=20&order=totalrank&page=" + page + "&keyword=" + URLEncoder.encode(query, "UTF-8"), header, check);
        if (body.optInt("code", -1) != 0) throw new Exception("Bilibili rejected the search request. Please retry.");
        return normalize(body.optJSONObject("data"), page);
    }
    private static JSONObject request(String endpoint, String cookies) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36");
        connection.setRequestProperty("Referer", "https://search.bilibili.com/"); connection.setRequestProperty("Accept", "application/json");
        if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
        try {
            int status = connection.getResponseCode();
            if (status == 412) throw new Exception("Bilibili requires verification. Sign in on the official Bilibili page, then retry search.");
            if (status != 200) throw new Exception("Could not reach Bilibili search. Check your connection and retry.");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192]; int size;
                while ((size = input.read(buffer)) != -1) { if (bytes.size() + size > 2097152) throw new Exception("Bilibili returned unexpected search results. Please retry."); bytes.write(buffer, 0, size); }
            }
            return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } finally { connection.disconnect(); }
    }
}
