package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** QR transport boundaries that can be checked without a device or Bilibili account. */
public final class BiliQrLoginTest {
    private static final String PASSPORT_SCAN =
        "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=login-key";
    private static final String ACCOUNT_SCAN =
        "https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=login-key&from=";
    private static final String SESSION =
        "SESSDATA=encoded%2Csession; Domain=.bilibili.com; Path=/; Secure; HttpOnly";
    private static final String CSRF =
        "bili_jct=csrf-value; Domain=bilibili.com; Path=/; Secure";

    @Test
    public void acceptsOnlyTheTwoKnownHttpsScanPages() throws Exception {
        assertEquals(PASSPORT_SCAN, BiliNativeClient.validateQrUrl(PASSPORT_SCAN));
        assertEquals(ACCOUNT_SCAN, BiliNativeClient.validateQrUrl(ACCOUNT_SCAN));
    }

    @Test
    public void rejectsForeignOrDeceptiveScanLinks() {
        for (String candidate : Arrays.asList(
            "http://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=login-key",
            "https://passport.bilibili.com.evil.example/h5-app/passport/login/scan?qrcode_key=login-key",
            "https://user:password@passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=login-key",
            "https://passport.bilibili.com:8443/h5-app/passport/login/scan?qrcode_key=login-key",
            "https://passport.bilibili.com/h5-app/passport/login/scan/other?qrcode_key=login-key",
            "https://account.bilibili.com/h5/account-h5/auth/scan-web/other?qrcode_key=login-key",
            "https://account.bilibili.com.evil.example/h5/account-h5/auth/scan-web?qrcode_key=login-key",
            "https://account.bilibili.com/h5/account-h5/auth/scan-web?callback=https%3A%2F%2Fevil.example&qrcode_key=login-key",
            "javascript:alert(1)",
            "not a URL"
        )) {
            assertThrows("Unsafe QR link was accepted: " + candidate, Exception.class,
                () -> BiliNativeClient.validateQrUrl(candidate));
        }
    }

    @Test
    public void collectsACompleteSessionWithoutCookieAttributes() throws Exception {
        String header = BiliNativeClient.parseQrCookieHeaders(Arrays.asList(SESSION, CSRF));
        assertEquals("SESSDATA=encoded%2Csession; bili_jct=csrf-value", header);
        assertEquals(header, BiliNativeClient.requireSession(header));
        assertFalse(header.contains("Domain"));
        assertFalse(header.contains("HttpOnly"));
    }

    @Test
    public void ignoresForeignDomainCookiesAndRequiresBothSessionParts() {
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Collections.singletonList(SESSION)));
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Collections.singletonList(CSRF)));
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            SESSION,
            "bili_jct=foreign-csrf; Domain=bilibili.com.evil.example; Secure"
        )));
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            "SESSDATA=foreign-session; Domain=evil.example; Secure",
            CSRF
        )));
    }

    @Test
    public void rejectsConflictingOrMalformedSessionCookieHeaders() {
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            SESSION,
            "SESSDATA=different-session; Domain=.bilibili.com; Secure",
            CSRF
        )));
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            "SESSDATA=bad\r\nInjected: value; Domain=.bilibili.com; Secure",
            CSRF
        )));
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            SESSION,
            "bili_jct=has space; Domain=.bilibili.com; Secure"
        )));
        assertThrows(Exception.class, () -> BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            SESSION,
            "bili_jct=; Domain=.bilibili.com; Secure"
        )));
    }

    @Test
    public void ignoresUnrelatedCookiesWithoutExposingThemInTheSession() throws Exception {
        String header = BiliNativeClient.parseQrCookieHeaders(Arrays.asList(
            "tracking=irrelevant; Domain=.bilibili.com; Secure",
            SESSION,
            CSRF
        ));
        assertTrue(header.contains("SESSDATA=encoded%2Csession"));
        assertTrue(header.contains("bili_jct=csrf-value"));
        assertFalse(header.contains("tracking"));
    }
}
