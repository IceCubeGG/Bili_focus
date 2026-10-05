package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import org.junit.Test;

public final class BiliFeedBoundaryTest {
    @Test public void acceptsOnlyBvidsWithoutQueryOrPathInjection() {
        assertEquals("BV1xx411c7mD", BiliFeedClient.requireBvid("BV1xx411c7mD"));
        for (String value : new String[] {"av123", "BV1xx411c7mD&foo=bar", "../nav", "BV1xx411c7mD\n", "", "BV1xx411c7mDmore"}) {
            assertThrows(IllegalArgumentException.class, () -> BiliFeedClient.requireBvid(value));
        }
    }

    @Test public void paginationCannotEscapeTheFixedEndpointOrGrowWithoutLimit() {
        assertEquals(1, BiliFeedClient.pageIndex(null));
        assertEquals(42, BiliFeedClient.pageIndex("42"));
        assertEquals(1000, BiliFeedClient.pageIndex("1000"));
        for (String value : new String[] {"0", "01", "-1", "1&cookie=secret", "https://example.com", "1001", "1.5"}) {
            assertThrows(IllegalArgumentException.class, () -> BiliFeedClient.pageIndex(value));
        }
    }

    @Test public void coversAreRestrictedToHttpsBilibiliImageHosts() {
        assertEquals("https://i0.hdslb.com/bfs/archive/cover.jpg", BiliFeedClient.coverUrl("http://i0.hdslb.com/bfs/archive/cover.jpg"));
        assertEquals("https://i0.hdslb.com/cover.jpg", BiliFeedClient.coverUrl("//i0.hdslb.com/cover.jpg"));
        for (String value : new String[] {"https://evil.example/image", "https://i0.hdslb.com.evil.example/image", "https://user:secret@i0.hdslb.com/image", "https://i0.hdslb.com:8443/image", "javascript:alert(1)", "file:///private/session"}) {
            assertEquals("", BiliFeedClient.coverUrl(value));
        }
    }
}
