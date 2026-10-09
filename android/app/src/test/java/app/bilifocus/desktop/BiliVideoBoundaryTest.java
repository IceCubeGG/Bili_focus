package app.bilifocus.desktop;
import org.junit.Test;
import static org.junit.Assert.*;

public class BiliVideoBoundaryTest {
    @Test public void unknownQualityIsRejectedBeforeMetadataOrNetworkRequests() {
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        BiliVideoClient client = new BiliVideoClient((url, cookies, form) -> { calls.incrementAndGet(); return new byte[0]; });
        assertThrows(IllegalArgumentException.class, () -> client.playback("BV1xx411c7mD", "62131", null, () -> {}, "https://localhost", 127, false));
        assertThrows(IllegalArgumentException.class, () -> client.playback("BV1xx411c7mD", "62131", null, () -> {}, "https://localhost", 0, true));
        assertEquals(0, calls.get());
    }
    @Test public void qualitySelectionIsStrict() { assertEquals("4K", BiliVideoClient.qualityLabel(120)); assertEquals("1080p", BiliVideoClient.qualityLabel(80)); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.qualityLabel(127)); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.qualityLabel(0)); }
    @Test public void dashRangesAreOrderedAndBounded() { assertEquals("0-999", BiliVideoClient.byteRange("0-999")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.byteRange("1-0")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.byteRange("0-2147483648")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.byteRange("0-10\r\nCookie:x")); }
    @Test public void bvidIsStrict() { assertEquals("BV1xx411c7mD", BiliVideoClient.bvid("BV1xx411c7mD")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.bvid("BV1xx411c7mD?cookie=secret")); }
    @Test public void numericIdsPreserveLargeStrings() { assertEquals("9007199254740999999", BiliVideoClient.id("9007199254740999999")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.id(9007199254740999L)); }
    @Test public void numericIdsRejectZeroAndControlCharacters() { assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.id("0")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.id("3\r\n")); }
    @Test public void postTextPreservesMultiline() { assertEquals("Hello\n世界", BiliVideoClient.postText(" Hello\n世界 ", 1000)); }
    @Test public void unicodeLengthUsesCodePoints() { assertEquals(200, BiliVideoClient.postText("😀".repeat(100), 100).length()); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.postText("😀".repeat(101), 100)); }
    @Test public void postTextRejectsEmptyAndControls() { assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.postText(" ", 100)); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.postText("a\u0000b", 100)); }
    @Test public void mediaRequiresKnownCdnAndHttps() throws Exception { assertEquals("https://cdn.bilivideo.com/a.mp4", BiliVideoClient.mediaUrl("http://cdn.bilivideo.com/a.mp4")); assertThrows(Exception.class, () -> BiliVideoClient.mediaUrl("https://bilivideo.com.evil/a.mp4")); }
    @Test public void mediaRejectsLocalTargetsCredentialsAndPorts() { assertThrows(Exception.class, () -> BiliVideoClient.mediaUrl("https://127.0.0.1/a")); assertThrows(Exception.class, () -> BiliVideoClient.mediaUrl("https://user:password@cdn.bilivideo.cn/a")); assertThrows(Exception.class, () -> BiliVideoClient.mediaUrl("https://cdn.bilivideo.com:8443/a")); }
    @Test public void mediaRejectsFragmentsAndFiles() { assertThrows(Exception.class, () -> BiliVideoClient.mediaUrl("file:///a.mp4")); assertThrows(Exception.class, () -> BiliVideoClient.mediaUrl("https://cdn.bilivideo.com/a#fragment")); }
    @Test public void byteRangesAreSingleAndOrdered() { assertEquals("bytes=0-20", BiliVideoClient.range("bytes=0-20")); assertEquals("bytes=20-", BiliVideoClient.range("bytes=20-")); assertEquals("bytes=-20", BiliVideoClient.range("bytes=-20")); assertNull(BiliVideoClient.range(null)); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.range("bytes=20-0")); }
    @Test public void byteRangesRejectMultipleAndInjection() { assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.range("bytes=0-1,4-5")); assertThrows(IllegalArgumentException.class, () -> BiliVideoClient.range("bytes=0-1\r\nCookie:x")); }
    @Test public void metadataCountsAreBounded() { assertEquals(42, BiliVideoClient.number(42, 100)); assertEquals(0, BiliVideoClient.number(101, 100)); assertEquals(0, BiliVideoClient.number(Double.NaN, 100)); assertEquals(0, BiliVideoClient.number("42", 100)); }
}
