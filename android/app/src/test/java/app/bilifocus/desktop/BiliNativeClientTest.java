package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import org.junit.Test;

/** Pure cookie checks run without a device once the Android Gradle/JDK toolchain is configured. */
public final class BiliNativeClientTest {
    private static final String VALID = "SESSDATA=encoded%2Csession; bili_jct=csrf-value";

    private void rejects(String candidate) {
        assertThrows(Exception.class, () -> BiliNativeClient.requireSession(candidate));
    }

    @Test
    public void acceptsEncodedOfficialCookieValues() throws Exception {
        assertEquals(VALID, BiliNativeClient.requireSession(VALID));
    }

    @Test
    public void rejectsHeaderInjectionAndOtherControlCharacters() {
        rejects(VALID + "\r\nInjected: value");
        rejects(VALID + "; extra=bad\u0000value");
        rejects(VALID + "; extra=bad\tvalue");
        rejects(VALID + "; extra=bad\u007fvalue");
    }

    @Test
    public void rejectsInvalidValueCharactersAndNonAsciiHeaders() {
        rejects(VALID + "; extra=has space");
        rejects(VALID + "; extra=has,comma");
        rejects(VALID + "; extra=\"quoted\"");
        rejects(VALID + "; extra=back\\slash");
        rejects(VALID + "; extra=nonascii\u00e9");
    }

    @Test
    public void rejectsMalformedNamesAndPairs() {
        rejects(VALID + "; bad name=value");
        rejects(VALID + "; invalid-pair");
    }

    @Test
    public void rejectsMissingOrEmptyRequiredCookies() {
        rejects(null);
        rejects("");
        rejects("SESSDATA=session");
        rejects("bili_jct=csrf");
        rejects("SESSDATA=; bili_jct=csrf");
        rejects("SESSDATA=session; bili_jct=");
    }

    @Test
    public void rejectsConflictingDuplicatesAndOversizedHeaders() {
        rejects(VALID + "; SESSDATA=different-session");
        rejects(VALID + "; extra=" + new String(new char[32768]).replace('\0', 'x'));
    }
}
