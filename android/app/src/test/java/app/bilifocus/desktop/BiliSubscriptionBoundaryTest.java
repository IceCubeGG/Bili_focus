package app.bilifocus.desktop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import org.junit.Test;

public final class BiliSubscriptionBoundaryTest {
    @Test public void followingPageCursorsAreBoundedAndCannotInjectQueries() {
        assertEquals(1, BiliSubscriptionClient.followedPageIndex(null));
        assertEquals(2000, BiliSubscriptionClient.followedPageIndex("2000"));
        for (String cursor : new String[] {"", "0", "01", "2001", "2&vmid=999", "https://evil.example"}) {
            assertThrows(IllegalArgumentException.class, () -> BiliSubscriptionClient.followedPageIndex(cursor));
        }
    }
    @Test public void opaqueOffsetsCannotInjectAnotherQueryOrHost() {
        assertNull(BiliSubscriptionClient.requireCursor(null));
        assertEquals("next_offset:12-AB", BiliSubscriptionClient.requireCursor("next_offset:12-AB"));
        for (String value : new String[] {"", "offset&fid=123", "https://evil.example", "line\nbreak", "a".repeat(257)}) {
            assertThrows(IllegalArgumentException.class, () -> BiliSubscriptionClient.requireCursor(value));
        }
    }
    @Test public void parsesArchiveTimeWithoutAcceptingMalformedOrUnboundedValues() {
        assertEquals(125, BiliSubscriptionClient.durationSeconds("02:05"));
        assertEquals(3723, BiliSubscriptionClient.durationSeconds("1:02:03"));
        assertEquals(0, BiliSubscriptionClient.durationSeconds("99:99"));
        assertEquals(0, BiliSubscriptionClient.durationSeconds("999:59:59"));
        assertEquals(0, BiliSubscriptionClient.durationSeconds("02:05&url=evil"));
    }
}
