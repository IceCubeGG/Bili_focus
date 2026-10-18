package app.bilifocus.desktop;

import java.net.URI;
import java.util.Locale;

/** Authentication-only resource policy, independent of Android for boundary tests. */
final class AuthResourcePolicy {
    private static String httpsHost(String value) {
        if (value == null || value.length() > 16384) return null;
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getHost() == null) return null;
            return uri.getHost().toLowerCase(Locale.ROOT);
        } catch (Exception ignored) { return null; }
    }

    private static boolean domain(String host, String domain) {
        return host != null && (host.equals(domain) || host.endsWith("." + domain));
    }

    static boolean navigation(String value) {
        String host = httpsHost(value);
        return "passport.bilibili.com".equals(host) || "account.bilibili.com".equals(host) || "www.bilibili.com".equals(host);
    }

    static boolean captchaResource(String value) {
        String host = httpsHost(value);
        // GeeTest's documented primary and fallback domains; never top-level navigation.
        return domain(host, "geetest.com") || domain(host, "geevisit.com")
            || domain(host, "gsensebot.com") || "dn-staticdown.qbox.me".equals(host);
    }

    static boolean resource(String value, boolean mainFrame) {
        if (mainFrame) return navigation(value);
        String host = httpsHost(value);
        return domain(host, "bilibili.com") || domain(host, "hdslb.com") || captchaResource(value);
    }
}
