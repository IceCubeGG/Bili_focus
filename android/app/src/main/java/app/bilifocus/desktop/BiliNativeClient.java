package app.bilifocus.desktop;

import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONObject;

/** A small native account client with fixed endpoints, redirects disabled, and no credential logging. */
final class BiliNativeClient {
    static final String SITE = "https://www.bilibili.com";
    static final String LOGIN_URL = "https://passport.bilibili.com/pc/passport/login?gourl=https%3A%2F%2Fwww.bilibili.com%2F";
    private static final String NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
    private static final String EXIT_URL = "https://passport.bilibili.com/login/exit/v2";
    private static final String QR_GENERATE_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header";
    private static final String QR_POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?source=main-fe-header&qrcode_key=";
    private static final String QR_ERROR = "Bilibili did not provide a complete QR sign-in session. Please try password or SMS sign-in.";

    static final class SessionExpired extends Exception {
        SessionExpired() { super("Your Bilibili session has expired. Please sign in again."); }
    }

    static final class QrCode {
        final String url;
        final String key;

        QrCode(String url, String key) {
            this.url = url;
            this.key = key;
        }
    }

    static final class QrPoll {
        final int code;
        final String cookieHeader;

        QrPoll(int code, String cookieHeader) {
            this.code = code;
            this.cookieHeader = cookieHeader;
        }
    }

    private static final class QrResponse {
        final JSONObject body;
        final List<String> setCookies;

        QrResponse(JSONObject body, List<String> setCookies) {
            this.body = body;
            this.setCookies = setCookies;
        }
    }

    /** Keep only Bilibili's known scan pages in the QR image shown to the user. */
    static String validateQrUrl(String value) throws Exception {
        if (value == null || value.length() == 0 || value.length() > 2048) {
            throw new Exception("Bilibili returned an invalid QR sign-in link.");
        }
        URI uri;
        try {
            uri = new URI(value);
        } catch (Exception error) {
            throw new Exception("Bilibili returned an invalid QR sign-in link.");
        }
        String host = uri.getHost();
        String path = uri.getRawPath();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getRawFragment() != null
                || host == null || path == null
                || !(host.equalsIgnoreCase("passport.bilibili.com")
                    && path.equals("/h5-app/passport/login/scan")
                    || host.equalsIgnoreCase("account.bilibili.com")
                    && path.equals("/h5/account-h5/auth/scan-web"))) {
            throw new Exception("Bilibili returned an invalid QR sign-in link.");
        }
        String query = uri.getRawQuery();
        if (query == null || query.length() > 512) {
            throw new Exception("Bilibili returned an invalid QR sign-in link.");
        }
        int keys = 0;
        for (String part : query.split("&", -1)) {
            int equals = part.indexOf('=');
            if (equals < 1) throw new Exception("Bilibili returned an invalid QR sign-in link.");
            String name = part.substring(0, equals);
            String parameter = part.substring(equals + 1);
            if (name.equals("qrcode_key") && validQrKey(parameter)) {
                keys++;
            } else if (name.equals("navhide") && (parameter.equals("0") || parameter.equals("1"))) {
                // Bilibili uses this to hide its mobile page navigation.
            } else if (name.equals("callback") && parameter.equals("close")) {
                // The current official mobile scan link closes after approval.
            } else if (name.equals("from") && parameter.matches("[A-Za-z0-9_-]{0,64}")) {
                // Bilibili's optional source marker is not a destination URL.
            } else {
                throw new Exception("Bilibili returned an invalid QR sign-in link.");
            }
        }
        if (keys != 1) throw new Exception("Bilibili returned an invalid QR sign-in link.");
        return value;
    }

    private static boolean validQrKey(String key) {
        return key != null && key.matches("[A-Za-z0-9_-]{1,128}");
    }

    /** Extract only complete account cookies; never retain cookie attributes or unrelated cookies. */
    static String parseQrCookieHeaders(List<String> headers) throws Exception {
        if (headers == null || headers.size() > 64) throw new Exception(QR_ERROR);
        Map<String, String> selected = new LinkedHashMap<>();
        for (String header : headers) {
            if (header == null || header.length() > 8192 || header.indexOf('\r') >= 0 || header.indexOf('\n') >= 0) {
                throw new Exception(QR_ERROR);
            }
            String[] sections = header.split(";", -1);
            int separator = sections[0].indexOf('=');
            if (separator < 1) continue;
            String name = sections[0].substring(0, separator).trim();
            if (!name.equals("SESSDATA") && !name.equals("bili_jct")) continue;
            String content = sections[0].substring(separator + 1).trim();
            String domain = null;
            for (int index = 1; index < sections.length; index++) {
                String attribute = sections[index].trim();
                int attributeSeparator = attribute.indexOf('=');
                if (attributeSeparator > 0 && attribute.substring(0, attributeSeparator).trim().equalsIgnoreCase("Domain")) {
                    if (domain != null) throw new Exception(QR_ERROR);
                    domain = attribute.substring(attributeSeparator + 1).trim().toLowerCase(Locale.ROOT);
                }
            }
            // These headers come from the fixed passport.bilibili.com endpoint. Host-only
            // cookies are valid there; an explicit Domain must belong to Bilibili.
            if (domain != null && !domain.equals("bilibili.com") && !domain.equals(".bilibili.com")
                    && !domain.equals("passport.bilibili.com")) continue;
            if (content.isEmpty()) throw new Exception(QR_ERROR);
            Map<String, String> checked = cookies(name + '=' + content);
            if (!content.equals(checked.get(name))) throw new Exception(QR_ERROR);
            if (selected.containsKey(name) && !content.equals(selected.get(name))) throw new Exception(QR_ERROR);
            selected.put(name, content);
        }
        if (!selected.containsKey("SESSDATA") || !selected.containsKey("bili_jct")) throw new Exception(QR_ERROR);
        return requireSession("SESSDATA=" + selected.get("SESSDATA") + "; bili_jct=" + selected.get("bili_jct"));
    }

    private static QrResponse qrRequest(String endpoint) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        connection.setRequestProperty("Referer", SITE + "/");
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (connection.getResponseCode() != 200) throw new Exception("Bilibili QR sign-in is temporarily unavailable. Please retry.");
            List<String> setCookies = new ArrayList<>();
            for (Map.Entry<String, List<String>> field : connection.getHeaderFields().entrySet()) {
                if (field.getKey() != null && field.getKey().equalsIgnoreCase("Set-Cookie")
                        && field.getValue() != null) setCookies.addAll(field.getValue());
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 131072) throw new Exception("Bilibili returned an unexpected QR response.");
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject body = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            if (body.optInt("code", -1) != 0) throw new Exception("Bilibili rejected the QR request. Please retry.");
            return new QrResponse(body, setCookies);
        } finally {
            connection.disconnect();
        }
    }

    QrCode generateQr() throws Exception {
        JSONObject data = qrRequest(QR_GENERATE_URL).body.getJSONObject("data");
        String key = data.optString("qrcode_key", "");
        String url = validateQrUrl(data.optString("url", ""));
        String scanKey = "";
        for (String part : new URI(url).getRawQuery().split("&")) {
            if (part.startsWith("qrcode_key=")) scanKey = part.substring("qrcode_key=".length());
        }
        if (!validQrKey(key) || !key.equals(scanKey)) {
            throw new Exception("Bilibili returned an invalid QR sign-in link.");
        }
        return new QrCode(url, key);
    }

    QrPoll pollQr(String key) throws Exception {
        if (!validQrKey(key)) throw new Exception("The QR sign-in request is invalid.");
        QrResponse response = qrRequest(QR_POLL_URL + URLEncoder.encode(key, "UTF-8"));
        int code = response.body.getJSONObject("data").optInt("code", -1);
        if (code != 0) return new QrPoll(code, null);
        return new QrPoll(0, parseQrCookieHeaders(response.setCookies));
    }

    static Map<String, String> cookies(String value) throws Exception {
        if (value == null || value.length() > 32768) {
            throw new Exception("Bilibili returned an invalid session. Please sign in again.");
        }
        // Cookies used as an HTTP header must contain printable ASCII only, including separators.
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character < 0x20 || character > 0x7e) {
                throw new Exception("Bilibili returned an invalid session. Please sign in again.");
            }
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (String pair : value.split(";")) {
            if (pair.trim().isEmpty()) continue;
            int separator = pair.indexOf('=');
            if (separator < 1) throw new Exception("Bilibili returned an invalid session. Please sign in again.");
            String name = pair.substring(0, separator).trim();
            String content = pair.substring(separator + 1).trim();
            if (!name.matches("[\\w-]+")) throw new Exception("Bilibili returned an invalid session. Please sign in again.");
            for (int index = 0; index < content.length(); index++) {
                char character = content.charAt(index);
                // RFC cookie-octet ranges exclude spaces, quotes, commas, and backslashes.
                if (!(character == 0x21 || (character >= 0x23 && character <= 0x2b)
                    || (character >= 0x2d && character <= 0x3a) || (character >= 0x3c && character <= 0x5b)
                    || (character >= 0x5d && character <= 0x7e))) {
                    throw new Exception("Bilibili returned an invalid session. Please sign in again.");
                }
            }
            if (content.isEmpty()) continue;
            if (result.containsKey(name) && !result.get(name).equals(content)) {
                throw new Exception("Bilibili returned an ambiguous session. Please sign in again.");
            }
            result.put(name, content);
        }
        return result;
    }

    static String requireSession(String value) throws Exception {
        Map<String, String> parsed = cookies(value);
        if (!parsed.containsKey("SESSDATA") || !parsed.containsKey("bili_jct")) {
            throw new Exception("Bilibili has not provided a complete signed-in session yet.");
        }
        StringBuilder header = new StringBuilder();
        for (Map.Entry<String, String> item : parsed.entrySet()) {
            if (header.length() > 0) header.append("; ");
            header.append(item.getKey()).append('=').append(item.getValue());
        }
        return header.toString();
    }

    static boolean officialPage(Uri uri) {
        String host = uri.getHost();
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null
            && (uri.getPort() == -1 || uri.getPort() == 443) && host != null
            && (host.equalsIgnoreCase("passport.bilibili.com") || host.equalsIgnoreCase("account.bilibili.com")
                || host.equalsIgnoreCase("www.bilibili.com"));
    }

    private JSONObject request(String endpoint, String cookieHeader, String form) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 BiliFocus/0.1");
        connection.setRequestProperty("Referer", SITE + "/");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", requireSession(cookieHeader));
        try {
            if (form != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                byte[] bytes = form.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status != 200) throw new Exception("Bilibili is temporarily unavailable. Please retry.");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 1048576) throw new Exception("Bilibili returned an unexpected response.");
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject body = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            int code = body.optInt("code", -1);
            if (code == -101) throw new SessionExpired();
            if (code != 0) throw new Exception("Bilibili rejected the account request. Please retry.");
            return body;
        } finally {
            connection.disconnect();
        }
    }

    JSONObject validate(String cookieHeader) throws Exception {
        JSONObject data = request(NAV_URL, cookieHeader, null).getJSONObject("data");
        if (!data.optBoolean("isLogin") || data.optLong("mid") <= 0) throw new SessionExpired();
        String avatar = data.optString("face", "");
        Uri image = Uri.parse(avatar);
        String host = image.getHost();
        if (!"https".equalsIgnoreCase(image.getScheme()) || host == null
                || !host.toLowerCase(java.util.Locale.ROOT).endsWith(".hdslb.com")) avatar = "";
        JSONObject level = data.optJSONObject("level_info");
        JSONObject profile = new JSONObject();
        profile.put("uid", data.getLong("mid"));
        profile.put("name", data.optString("uname", "Bilibili account"));
        profile.put("avatar", avatar);
        profile.put("level", level == null ? 0 : level.optInt("current_level"));
        profile.put("isVip", data.optInt("vipStatus") == 1);
        return profile;
    }

    void logout(String cookieHeader) throws Exception {
        String csrf = cookies(cookieHeader).get("bili_jct");
        request(EXIT_URL, cookieHeader, "biliCSRF=" + URLEncoder.encode(csrf, "UTF-8"));
    }
}
