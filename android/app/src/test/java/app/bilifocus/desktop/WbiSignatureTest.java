package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import java.util.Map;
import org.junit.Test;

public final class WbiSignatureTest {
    @Test public void knownKeyAndSignatureMatchCanonicalWebRequest() throws Exception {
        String key = WbiSignature.key("https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png", "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png");
        assertEquals("ea1db124af3c7062474693fa704f4ff8", key);
        assertEquals("bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4",
            WbiSignature.query(Map.of("foo", "114!'()*", "bar", "514", "zab", "1919810"), key, 1702204169000L));
    }
    @Test public void signingKeysAndCreatorPagingRejectInjectedOrMalformedInputs() {
        assertThrows(Exception.class, () -> WbiSignature.key("https://evil.example/key.png", "bad"));
        assertEquals(1, BiliSubscriptionClient.uploaderPageIndex(null));
        assertEquals(31, BiliSubscriptionClient.uploaderPageIndex("31"));
        for (String cursor : new String[] {"0", "01", "-1", "2&mid=999", "33333335", "999999999"}) {
            assertThrows(IllegalArgumentException.class, () -> BiliSubscriptionClient.uploaderPageIndex(cursor));
        }
    }
}
