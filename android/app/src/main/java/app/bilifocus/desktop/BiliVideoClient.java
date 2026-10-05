package app.bilifocus.desktop;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native metadata, social actions and range-streaming. No cookies/CDN URLs enter React. */
final class BiliVideoClient {
    interface Transport { byte[] request(String url, String cookies, String form) throws Exception; }
    private final Transport transport;
    private static final class CachedVideo { final String cookies; final JSONObject value; CachedVideo(String cookies, JSONObject value) { this.cookies = cookies; this.value = value; } }
    private final Map<String, CachedVideo> details = new ConcurrentHashMap<>();
    private final Map<String, Media> media = new ConcurrentHashMap<>();
    private final Map<String, Long> lastPosts = new ConcurrentHashMap<>();
    private final java.util.Set<String> posting = ConcurrentHashMap.newKeySet();
    private static final class Media {
        final List<String> urls; final Runnable check;
        volatile boolean released;
        final java.util.Set<HttpURLConnection> connections = ConcurrentHashMap.newKeySet();
        Media(List<String> urls, Runnable check) { this.urls = urls; this.check = check; }
    }
    BiliVideoClient() { this(BiliVideoClient::request); }
    BiliVideoClient(Transport transport) { this.transport = transport; }
    void clear() { details.clear(); for (String handle : media.keySet()) release(handle); }
    void release(String handle) { Media value = media.remove(handle); if (value != null) synchronized (value) { value.released = true; for (HttpURLConnection connection : value.connections) connection.disconnect(); } }
    static String bvid(Object value) { if (!(value instanceof String) || !((String) value).matches("BV[0-9A-Za-z]{10}")) throw new IllegalArgumentException("Invalid video identifier."); return (String) value; }
    static String id(Object value) {
        if (value instanceof String && ((String) value).matches("[1-9][0-9]{0,19}")) return (String) value;
        if (value instanceof Number) { double number = ((Number) value).doubleValue(); if (number > 0 && number <= 9007199254740991L && Math.floor(number) == number) return Long.toString(((Number) value).longValue()); }
        throw new IllegalArgumentException("Invalid numeric identifier.");
    }
    static String text(Object value, int maximum) { String result = value instanceof String ? ((String) value).replaceAll("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]", "") : ""; return result.substring(0, Math.min(result.length(), maximum)); }
    static String postText(Object value, int maximum) {
        if (!(value instanceof String)) throw new IllegalArgumentException("Enter a message."); String result = ((String) value).trim();
        if (result.isEmpty() || result.codePointCount(0, result.length()) > maximum || !text(result, result.length()).equals(result)) throw new IllegalArgumentException("Enter 1–" + maximum + " characters without control characters."); return result;
    }
    static long number(Object value, long maximum) { if (!(value instanceof Number)) return 0; double result = ((Number) value).doubleValue(); return Double.isFinite(result) && result >= 0 && result <= maximum && Math.floor(result) == result ? ((Number) value).longValue() : 0; }
    static String mediaUrl(String value) throws Exception {
        if (value == null || value.length() > 8192) throw new Exception("Unexpected video stream."); URI uri = new URI(value); String host = uri.getHost();
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || host == null || !(host.endsWith(".bilivideo.com") || host.endsWith(".bilivideo.cn")) || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getRawFragment() != null) throw new Exception("Unexpected video stream.");
        return value.replaceFirst("^http:", "https:");
    }
    static String range(String value) {
        if (value == null) return null; if (!value.matches("bytes=(?:[0-9]{1,16}-[0-9]{0,16}|-[0-9]{1,16})")) throw new IllegalArgumentException("Invalid video range.");
        if (value.matches("bytes=[0-9]+-[0-9]+")) { String[] bounds = value.substring(6).split("-"); if (Long.parseLong(bounds[0]) > Long.parseLong(bounds[1])) throw new IllegalArgumentException("Invalid video range."); } return value;
    }
    private static JSONObject object(JSONObject parent, String key) { JSONObject result = parent.optJSONObject(key); return result == null ? new JSONObject() : result; }
    private static String query(Map<String, String> values) throws Exception { StringBuilder result = new StringBuilder(); for (Map.Entry<String, String> value : values.entrySet()) { if (result.length() > 0) result.append('&'); result.append(URLEncoder.encode(value.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(value.getValue(), "UTF-8")); } return result.toString(); }
    private static Map<String, String> params(String... values) { Map<String, String> result = new LinkedHashMap<>(); for (int i = 0; i < values.length; i += 2) result.put(values[i], values[i + 1]); return result; }
    private static byte[] request(String endpoint, String cookies, String form) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(20000);
            connection.setRequestProperty("Referer", "https://www.bilibili.com/"); connection.setRequestProperty("Origin", "https://www.bilibili.com"); connection.setRequestProperty("User-Agent", "Mozilla/5.0");
            if (cookies != null) connection.setRequestProperty("Cookie", BiliNativeClient.requireSession(cookies));
            if (form != null) { connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded"); try (java.io.OutputStream output = connection.getOutputStream()) { output.write(form.getBytes(StandardCharsets.UTF_8)); } }
            if (connection.getResponseCode() != 200) throw new Exception("Bilibili video request failed.");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) { byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > 2 * 1024 * 1024) throw new Exception("Unexpected video response size."); bytes.write(buffer, 0, count); } return bytes.toByteArray(); }
        } finally { connection.disconnect(); }
    }
    private JSONObject api(String path, Map<String, String> parameters, String cookies, Runnable check, String form) throws Exception {
        check.run(); byte[] bytes;
        try { bytes = transport.request("https://api.bilibili.com" + path + "?" + query(parameters), cookies, form); }
        catch (Exception error) { throw new Exception(form == null ? "Could not reach Bilibili. Please retry." : "The send result could not be confirmed. Check Bilibili before sending again."); }
        check.run(); JSONObject body = new JSONObject(new String(bytes, StandardCharsets.UTF_8)); Object code = body.opt("code");
        boolean guestKeys = path.equals("/x/web-interface/nav") && cookies == null && Objects.equals(code, -101) && body.optJSONObject("data") != null && body.optJSONObject("data").optJSONObject("wbi_img") != null;
        if ((!(code instanceof Number) || ((Number) code).intValue() != 0) && !guestKeys) {
            if (Objects.equals(code, -101)) throw new BiliNativeClient.SessionExpired();
            if (Objects.equals(code, 12002) && form == null && parameters.containsKey("pn")) return new JSONObject().put("page", new JSONObject().put("num", Integer.parseInt(parameters.get("pn"))).put("count", 0)).put("replies", JSONObject.NULL).put("input_disable", true);
            throw new Exception("Bilibili rejected the video request (code " + (code instanceof Number ? code : "unknown") + "). Access or posting may be restricted.");
        }
        JSONObject data = body.optJSONObject("data"); return data == null ? new JSONObject().put("array", body.opt("data")) : data;
    }
    private String key(String cookies, Runnable check) throws Exception { JSONObject keys = object(api("/x/web-interface/nav", params(), cookies, check, null), "wbi_img"); return WbiSignature.key(keys.optString("img_url"), keys.optString("sub_url")); }
    JSONObject details(String bvid, String cookies, Runnable check) throws Exception {
        bvid(bvid); JSONObject raw = api("/x/web-interface/view", params("bvid", bvid), cookies, check, null), owner = object(raw, "owner"); JSONArray pages = raw.optJSONArray("pages");
        if (!bvid.equals(raw.optString("bvid")) || text(raw.opt("title"), 300).trim().isEmpty() || pages == null || pages.length() == 0 || pages.length() > 1000) throw new Exception("Unexpected video details.");
        JSONArray parts = new JSONArray(), episodes = new JSONArray(), tags = new JSONArray(); java.util.Set<String> unique = new java.util.HashSet<>();
        for (int i = 0; i < pages.length(); i++) { JSONObject part = pages.getJSONObject(i); String cid = id(part.opt("cid")); if (!unique.add(cid)) throw new Exception("Duplicate video parts."); parts.put(new JSONObject().put("cid", cid).put("page", i + 1).put("title", text(part.opt("part"), 300)).put("durationSeconds", number(part.opt("duration"), 604800))); }
        JSONArray sections = object(raw, "ugc_season").optJSONArray("sections");
        if (sections != null) for (int i = 0; i < Math.min(100, sections.length()); i++) { JSONObject section = sections.optJSONObject(i); if (section == null) continue; JSONArray list = section.optJSONArray("episodes"); if (list == null) continue; for (int j = 0; j < Math.min(500, list.length()) && episodes.length() < 500; j++) { JSONObject episode = list.optJSONObject(j); if (episode == null) continue; try { episodes.put(new JSONObject().put("bvid", bvid(episode.opt("bvid"))).put("title", text(episode.opt("title"), 300)).put("section", text(section.opt("title"), 120))); } catch (IllegalArgumentException ignored) {} } }
        try { JSONArray list = api("/x/tag/archive/tags", params("bvid", bvid), cookies, check, null).optJSONArray("array"); if (list != null) for (int i = 0; i < Math.min(100, list.length()); i++) { JSONObject tag = list.optJSONObject(i); if (tag != null) { String name = text(tag.opt("tag_name"), 80).trim(); if (!name.isEmpty()) tags.put(name); } } } catch (Exception ignored) { check.run(); }
        long published = number(raw.opt("pubdate"), 4102444800L);
        JSONObject result = new JSONObject().put("bvid", bvid).put("aid", id(raw.opt("aid"))).put("title", text(raw.opt("title"), 300)).put("cover", BiliFeedClient.coverUrl(raw.optString("pic"))).put("durationSeconds", number(raw.opt("duration"), 604800))
            .put("uploader", new JSONObject().put("id", id(owner.opt("mid"))).put("name", text(owner.opt("name"), 80))).put("uploaderAvatar", BiliFeedClient.coverUrl(owner.optString("face")))
            .put("views", number(object(raw, "stat").opt("view"), 9007199254740991L)).put("publishedAt", published > 0 ? published * 1000 : JSONObject.NULL).put("description", text(raw.opt("desc"), 20000)).put("tags", tags).put("parts", parts).put("episodes", episodes);
        check.run(); if (details.size() >= 32) details.clear(); details.put(bvid, new CachedVideo(cookies, result)); return new JSONObject(result.toString());
    }
    private JSONObject video(String bvid, String cookies, Runnable check) throws Exception { CachedVideo cached = details.get(bvid); JSONObject result = cached != null && Objects.equals(cookies, cached.cookies) ? cached.value : details(bvid, cookies, check); check.run(); return result; }
    private JSONObject part(JSONObject video, String cid) throws Exception { JSONArray parts = video.getJSONArray("parts"); for (int i = 0; i < parts.length(); i++) { JSONObject part = parts.getJSONObject(i); if (cid.equals(part.getString("cid"))) return part; } throw new Exception("Choose a part belonging to this video."); }
    JSONObject playback(String bvid, String cid, String cookies, Runnable check, String localUrl) throws Exception {
        return playback(bvid, cid, cookies, check, localUrl, 64, false);
    }
    static String qualityLabel(int value) {
        switch (value) { case 16: return "360p"; case 32: return "480p"; case 64: return "720p"; case 74: return "720p 60fps"; case 80: return "1080p"; case 112: return "1080p+"; case 116: return "1080p 60fps"; case 120: return "4K"; default: throw new IllegalArgumentException("Invalid video quality."); }
    }
    static String byteRange(String value) {
        if (value == null || !value.matches("[0-9]{1,10}-[0-9]{1,10}")) throw new IllegalArgumentException("Invalid DASH byte range.");
        String[] pieces = value.split("-"); long start = Long.parseLong(pieces[0]), end = Long.parseLong(pieces[1]);
        if (start > end || end > 2147483647L || end - start > 2097152L) throw new IllegalArgumentException("Invalid DASH byte range."); return value;
    }
    private static JSONArray dashTracks(JSONArray values, String kind, List<String> urls, String localUrl, String handle) {
        JSONArray result = new JSONArray();
        if (values == null) return result;
        for (int i = 0; i < Math.min(kind.equals("audio") ? 6 : 40, values.length()); i++) try {
            JSONObject raw = values.getJSONObject(i), base = raw.optJSONObject("SegmentBase"); if (base == null) base = raw.getJSONObject("segment_base");
            int quality = raw.getInt("id"); if (kind.equals("video")) qualityLabel(quality);
            String mime = raw.optString("mimeType", raw.optString("mime_type")), codec = raw.getString("codecs");
            if (!mime.equals(kind + "/mp4") || !(kind.equals("video") ? codec.matches("(avc1|hev1|hvc1|av01)\\.[a-zA-Z0-9.]{1,60}") : codec.matches("mp4a\\.[a-zA-Z0-9.]{1,30}"))) continue;
            long bandwidth = number(raw.opt("bandwidth"), 200000000); if (bandwidth == 0) continue;
            JSONObject track = new JSONObject().put("quality", quality).put("mimeType", mime).put("codecs", codec).put("bandwidth", bandwidth)
                .put("initialization", byteRange(base.optString("Initialization", base.optString("initialization"))))
                .put("indexRange", byteRange(base.optString("indexRange", base.optString("index_range"))))
                .put("width", number(raw.opt("width"), 16384)).put("height", number(raw.opt("height"), 16384));
            String url = mediaUrl(raw.optString("baseUrl", raw.optString("base_url"))); urls.add(url);
            result.put(track.put("url", localUrl + "/__bili_media/" + handle + "/" + (urls.size() - 1)));
        } catch (Exception ignored) {}
        return result;
    }
    JSONObject playback(String bvid, String cid, String cookies, Runnable check, String localUrl, int requested, boolean progressive) throws Exception {
        qualityLabel(requested);
        JSONObject video = video(bvid, cookies, check); part(video, cid);
        Map<String, String> playbackParams = params("bvid", bvid, "cid", cid, "qn", Integer.toString(requested), "fnval", progressive ? "1" : "144", "fnver", "0", "fourk", progressive ? "0" : "1"); if (progressive) playbackParams.put("platform", "html5");
        String query = WbiSignature.query(playbackParams, key(cookies, check), System.currentTimeMillis());
        JSONObject raw = signedApi("/x/player/wbi/playurl", query, cookies, check, null); JSONArray durl = raw.optJSONArray("durl");
        if (raw.optBoolean("is_preview") || raw.optInt("is_preview") == 1) throw new Exception("A playable stream is unavailable or restricted. Paid/preview access is not bypassed.");
        JSONObject dash = raw.optJSONObject("dash");
        if (!progressive && dash != null) {
            String handle = UUID.randomUUID().toString(); List<String> urls = new ArrayList<>();
            JSONArray videos = dashTracks(dash.optJSONArray("video"), "video", urls, localUrl, handle), audio = dashTracks(dash.optJSONArray("audio"), "audio", urls, localUrl, handle);
            java.util.TreeSet<Integer> ids = new java.util.TreeSet<>(Collections.reverseOrder()); for (int i = 0; i < videos.length(); i++) ids.add(videos.getJSONObject(i).getInt("quality"));
            long duration = number(dash.opt("duration"), 604800);
            if (ids.isEmpty() || audio.length() == 0 || duration == 0) throw new Exception("A playable DASH stream is unavailable or restricted.");
            int quality = ids.last(); for (int id : ids) if (id <= requested) { quality = id; break; }
            JSONArray qualities = new JSONArray(); for (int id : ids) qualities.put(new JSONObject().put("id", id).put("label", qualityLabel(id)));
            check.run(); if (media.size() >= 8) release(media.keySet().iterator().next()); media.put(handle, new Media(urls, check));
            return new JSONObject().put("handle", handle).put("sources", new JSONArray()).put("quality", quality).put("qualityLabel", qualityLabel(quality)).put("qualities", qualities)
                .put("dash", new JSONObject().put("durationSeconds", duration).put("video", videos).put("audio", audio));
        }
        if (durl == null || durl.length() == 0 || durl.length() > 50 || raw.optBoolean("is_preview") || raw.optInt("is_preview") == 1) throw new Exception("A playable MP4 stream is unavailable or restricted. Paid/preview access is not bypassed.");
        List<String> urls = new ArrayList<>(); JSONArray sources = new JSONArray(); String handle = UUID.randomUUID().toString();
        for (int i = 0; i < durl.length(); i++) { JSONObject item = durl.getJSONObject(i); urls.add(mediaUrl(item.getString("url"))); sources.put(new JSONObject().put("url", localUrl + "/__bili_media/" + handle + "/" + i).put("durationSeconds", number(item.opt("length"), 604800000) / 1000.0)); }
        check.run(); if (media.size() >= 8) release(media.keySet().iterator().next()); media.put(handle, new Media(urls, check));
        int quality = raw.optInt("quality"); String label; try { label = qualityLabel(quality); } catch (IllegalArgumentException ignored) { label = "Available MP4"; }
        return new JSONObject().put("handle", handle).put("sources", sources).put("quality", quality).put("qualityLabel", label).put("qualities", new JSONArray().put(new JSONObject().put("id", quality).put("label", label)));
    }
    private JSONObject signedApi(String path, String signed, String cookies, Runnable check, String form) throws Exception {
        Map<String, String> values = new LinkedHashMap<>(); for (String value : signed.split("&")) { String[] pair = value.split("=", 2); values.put(java.net.URLDecoder.decode(pair[0], "UTF-8"), java.net.URLDecoder.decode(pair[1], "UTF-8")); } return api(path, values, cookies, check, form);
    }
    // Native-only source resolution for the download worker; never a plugin DTO.
    BiliDownloads.Source download(String bvid, String cid, String kind, String cookies, Runnable check) throws Exception {
        JSONObject video = details(bvid, cookies, check); List<String> urls = new ArrayList<>();
        if (kind.equals("cover")) { String cover = video.getString("cover"); if (cover.isEmpty()) throw new Exception("Cover unavailable."); urls.add(cover); }
        else { JSONObject playback = playback(bvid, cid, cookies, check, "https://localhost", 64, true); String handle = playback.getString("handle"); try { Media value = media.get(handle); if (value == null) throw new Exception(); urls.addAll(value.urls); } finally { release(handle); } }
        check.run(); return new BiliDownloads.Source(video.getString("title"), urls, check);
    }
    JSONObject danmu(String bvid, String cid, int segment, String cookies, Runnable check) throws Exception {
        JSONObject part = part(video(bvid, cookies, check), cid); long duration = part.optLong("durationSeconds", 0);
        if (segment < 1 || segment > 1680 || segment > Math.max(1, (long) Math.ceil((duration > 0 ? duration : 604800) / 360.0))) throw new IllegalArgumentException("Invalid Danmu segment.");
        String signed = WbiSignature.query(params("type", "1", "oid", cid, "segment_index", Integer.toString(segment)), key(cookies, check), System.currentTimeMillis()); check.run();
        byte[] bytes = transport.request("https://api.bilibili.com/x/v2/dm/web/seg.so?" + signed, cookies, null); check.run();
        return new JSONObject().put("segment", segment).put("items", DanmuDecoder.decode(bytes));
    }
    private static JSONObject comment(JSONObject raw, boolean preview) throws Exception {
        JSONObject member = object(raw, "member"); String message = text(object(raw, "content").opt("message"), 4000); if (message.isEmpty()) return null;
        JSONArray replies = new JSONArray(), list = raw.optJSONArray("replies"); if (preview && list != null) for (int i = 0; i < Math.min(10, list.length()); i++) { try { JSONObject item = comment(list.getJSONObject(i), false); if (item != null) replies.put(item); } catch (Exception ignored) {} }
        long published = number(raw.opt("ctime"), 4102444800L);
        return new JSONObject().put("id", id(raw.has("rpid_str") ? raw.opt("rpid_str") : raw.opt("rpid"))).put("author", new JSONObject().put("id", id(member.opt("mid"))).put("name", text(member.opt("uname"), 80)).put("avatar", BiliFeedClient.coverUrl(member.optString("avatar"))))
            .put("text", message).put("publishedAt", published > 0 ? published * 1000 : JSONObject.NULL).put("likes", number(raw.opt("like"), 9007199254740991L)).put("replyCount", number(raw.opt("rcount"), 9007199254740991L)).put("replies", replies);
    }
    JSONObject comments(String bvid, int page, String sort, String root, String cookies, Runnable check) throws Exception {
        if (page < 1 || page > 1000000 || !("hot".equals(sort) || "newest".equals(sort))) throw new IllegalArgumentException("Invalid comment page."); JSONObject video = video(bvid, cookies, check);
        Map<String, String> values = params("oid", video.getString("aid"), "type", "1", "pn", Integer.toString(page), "ps", "20", "sort", "hot".equals(sort) ? "2" : "0"); if (root != null) values.put("root", id(root));
        JSONObject raw = api(root == null ? "/x/v2/reply" : "/x/v2/reply/reply", values, cookies, check, null), paging = object(raw, "page");
        if (number(paging.opt("num"), 1000000) != page || !(raw.isNull("replies") || raw.opt("replies") instanceof JSONArray)) throw new Exception("Unexpected comment page.");
        LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>(); List<JSONArray> lists = new ArrayList<>(); if (root == null && page == 1) { if (raw.optJSONArray("top_replies") != null) lists.add(raw.optJSONArray("top_replies")); JSONArray top = new JSONArray(); for (String name : new String[]{"upper", "admin", "vote"}) { JSONObject item = object(raw, "top").optJSONObject(name); if (item != null) top.put(item); } lists.add(top); } if (raw.optJSONArray("replies") != null) lists.add(raw.optJSONArray("replies"));
        for (JSONArray list : lists) for (int i = 0; i < Math.min(50, list.length()); i++) try { JSONObject item = comment(list.getJSONObject(i), true); if (item != null) unique.put(item.getString("id"), item); } catch (Exception ignored) {}
        long total = number(paging.opt("count"), 9007199254740991L), size = number(paging.opt("size"), 50); if (size == 0) size = 20;
        return new JSONObject().put("items", new JSONArray(unique.values())).put("page", page).put("total", total).put("hasMore", page * size < total).put("closed", raw.optBoolean("input_disable") || object(raw, "control").optBoolean("input_disable"));
    }
    private static String csrf(String cookies) throws Exception { if (cookies == null) throw new Exception("Sign in to send Danmu or comments."); String validated = BiliNativeClient.requireSession(cookies); for (String cookie : validated.split(";")) { String[] pair = cookie.trim().split("=", 2); if (pair[0].equals("bili_jct")) return pair[1]; } throw new Exception("Sign in again before sending."); }
    private synchronized void beginPost(String kind) throws Exception { long now = System.currentTimeMillis(); if (posting.contains(kind) || now - lastPosts.getOrDefault(kind, 0L) < 5000) throw new Exception("Wait five seconds before sending another message."); posting.add(kind); lastPosts.put(kind, now); }
    JSONObject sendDanmu(String bvid, String cid, Object text, double time, String cookies, Runnable check) throws Exception {
        String message = postText(text, 100), csrf = csrf(cookies); JSONObject part = part(video(bvid, cookies, check), cid); double duration = part.optDouble("durationSeconds", 0);
        if (!Double.isFinite(time) || time < 0 || time > (duration > 0 ? duration : 604800)) throw new IllegalArgumentException("Invalid Danmu position."); beginPost("danmu");
        try { String signed = WbiSignature.query(params("csrf", csrf, "web_location", "1315873"), key(cookies, check), System.currentTimeMillis()); signedApi("/x/v2/dm/post", signed, cookies, check, query(params("type", "1", "oid", cid, "bvid", bvid, "msg", message, "progress", Long.toString(Math.round(time * 1000)), "color", "16777215", "fontsize", "25", "pool", "0", "mode", "1", "rnd", Long.toString(System.currentTimeMillis() * 1000), "csrf", csrf))); return new JSONObject().put("message", "Sent to Bilibili. Moderation may delay its appearance."); } finally { posting.remove("danmu"); }
    }
    JSONObject sendComment(String bvid, Object text, String root, String parent, String cookies, Runnable check) throws Exception {
        String message = postText(text, 1000), csrf = csrf(cookies); JSONObject video = video(bvid, cookies, check); if ((root == null) != (parent == null)) throw new IllegalArgumentException("Choose a valid reply target.");
        Map<String, String> values = params("oid", video.getString("aid"), "type", "1", "message", message, "plat", "1", "csrf", csrf); if (root != null) { values.put("root", id(root)); values.put("parent", id(parent)); } beginPost("comment");
        try { api("/x/v2/reply/add", params(), cookies, check, query(values)); return new JSONObject().put("message", "Sent to Bilibili. Moderation may delay its appearance."); } finally { posting.remove("comment"); }
    }
    WebResourceResponse intercept(WebResourceRequest request, String localUrl) {
        HttpURLConnection connection = null; Media entry = null;
        try {
            URI local = new URI(localUrl), url = new URI(request.getUrl().toString());
            if (!Objects.equals(local.getScheme(), url.getScheme()) || !Objects.equals(local.getAuthority(), url.getAuthority()) || url.getRawQuery() != null || url.getRawFragment() != null || !request.getMethod().equals("GET")) throw new Exception();
            String[] pieces = url.getPath().split("/"); if (pieces.length != 4 || !pieces[2].matches("[a-f0-9-]{36}") || !pieces[3].matches("[0-9]{1,2}")) throw new Exception();
            entry = media.get(pieces[2]); int index = Integer.parseInt(pieces[3]); if (entry == null || index >= entry.urls.size()) throw new Exception(); entry.check.run();
            synchronized (entry) { if (entry.released || entry.connections.size() >= 4) throw new Exception(); connection = (HttpURLConnection) new URL(entry.urls.get(index)).openConnection(); entry.connections.add(connection); }
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(20000); connection.setRequestProperty("Referer", "https://www.bilibili.com/"); connection.setRequestProperty("User-Agent", "Mozilla/5.0"); connection.setRequestProperty("Accept-Encoding", "identity");
            String range = null; for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) if (header.getKey().equalsIgnoreCase("Range")) range = range(header.getValue()); if (range != null) connection.setRequestProperty("Range", range);
            int status = connection.getResponseCode(); if (status != 200 && status != 206 || entry.released) throw new Exception(); entry.check.run();
            String mime = connection.getContentType(); mime = mime == null ? "video/mp4" : mime.split(";")[0].trim().toLowerCase(java.util.Locale.ROOT);
            if (!(mime.equals("video/mp4") || mime.equals("audio/mp4") || mime.equals("video/webm") || mime.equals("application/octet-stream"))) throw new Exception();
            Map<String, String> headers = new LinkedHashMap<>(); headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
            for (String name : new String[]{"Content-Length", "Content-Range", "Accept-Ranges"}) { String value = connection.getHeaderField(name); if (value != null) headers.put(name, value); }
            long length = Long.parseLong(connection.getHeaderField("Content-Length")), total = length, start = 0;
            if (status == 206) {
                java.util.regex.Matcher bounds = java.util.regex.Pattern.compile("bytes ([0-9]+)-([0-9]+)/([0-9]+)").matcher(connection.getHeaderField("Content-Range"));
                if (!bounds.matches()) throw new Exception();
                start = Long.parseLong(bounds.group(1)); long end = Long.parseLong(bounds.group(2)); total = Long.parseLong(bounds.group(3));
                if (length != end - start + 1 || !WebViewMediaStream.matchesRange(range, start, end, total)) throw new Exception();
            } else if (range != null) throw new Exception("The CDN did not honor the requested range.");
            HttpURLConnection active = connection; Media owner = entry;
            InputStream stream = new WebViewMediaStream(connection.getInputStream(), total, start, length,
                () -> { owner.check.run(); if (owner.released) throw new IllegalStateException("Video stream closed."); },
                () -> { active.disconnect(); owner.connections.remove(active); });
            return new WebResourceResponse(mime.equals("application/octet-stream") ? "video/mp4" : mime, null, status, status == 206 ? "Partial Content" : "OK", headers, stream);
        } catch (Exception ignored) { if (connection != null) { connection.disconnect(); if (entry != null) entry.connections.remove(connection); } return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0])); }
    }
}
