package app.bilifocus.desktop;

import static org.junit.Assert.*;
import org.junit.Test;

public final class AuthResourcePolicyTest {
    @Test public void allowsOfficialTopLevelLoginAndReturnOnly() {
        for (String url : new String[]{BiliNativeClient.LOGIN_URL, "https://passport.bilibili.com/login", "https://account.bilibili.com/h5/account-h5/auth/login", "https://www.bilibili.com/", "https://PASSPORT.BILIBILI.COM:443/login"}) {
            assertTrue(url, AuthResourcePolicy.navigation(url)); assertTrue(url, AuthResourcePolicy.resource(url, true));
        }
        for (String url : new String[]{"https://api.bilibili.com/", "https://m.bilibili.com/", "https://gcaptcha4.geetest.com/load", "https://static.geetest.com/v4/gt4.js", "https://www.example.com/"}) assertFalse(url, AuthResourcePolicy.resource(url, true));
    }

    @Test public void permitsDocumentedPrimaryAndFallbackCaptchaHostsAsResourcesOnly() {
        // gcaptcha4 / api.geevisit / gsensebot / qbox were blocked by the old exact-host list.
        for (String url : new String[]{"https://gcaptcha4.geetest.com/load", "https://api.geetest.com/get.php", "https://static.geetest.com/v4/gt4.js", "https://monitor.geetest.com/monitor/send", "https://gcaptcha4.geevisit.com/load", "https://api.geevisit.com/get.php", "https://static.geevisit.com/a.js", "https://gcaptcha4.gsensebot.com/load", "https://dn-staticdown.qbox.me/static/a.js"}) {
            assertTrue(url, AuthResourcePolicy.captchaResource(url)); assertTrue(url, AuthResourcePolicy.resource(url, false)); assertFalse(url, AuthResourcePolicy.resource(url, true));
        }
    }

    @Test public void retainsBilibiliApiAndCdnResources() {
        for (String url : new String[]{"https://passport.bilibili.com/x/passport-login/web/sms/send", "https://api.bilibili.com/x/web-interface/nav", "https://s1.hdslb.com/bfs/a.js"}) assertTrue(url, AuthResourcePolicy.resource(url, false));
    }

    @Test public void rejectsCleartextAndLocalSchemes() {
        for (String url : new String[]{null, "", "not a URL", "//static.geetest.com/a.js", "http://gcaptcha4.geetest.com/load", "file:///private", "content://private", "javascript:alert(1)", "data:text/html,hello", "intent://passport.bilibili.com/"}) {
            assertFalse(AuthResourcePolicy.resource(url, false)); assertFalse(AuthResourcePolicy.navigation(url));
        }
    }

    @Test public void rejectsLookalikesCredentialsAndUnexpectedPorts() {
        for (String url : new String[]{"https://gcaptcha4.geetest.com.evil.example/load", "https://evilgeetest.com/a.js", "https://geetest.com@evil.example/load", "https://user:secret@gcaptcha4.geetest.com/load", "https://@passport.bilibili.com/login", "https://static.geetest.com:8443/a.js", "https://passport.bilibili.com:8443/login", "https://evil.qbox.me/a.js", "https://dn-staticdown.qbox.me.evil.example/a.js", "https://127.0.0.1/a.js", "https://[::1]/a.js", "https://passport.bilibili.com./login"}) {
            assertFalse(url, AuthResourcePolicy.resource(url, false)); assertFalse(url, AuthResourcePolicy.navigation(url));
        }
    }
}
