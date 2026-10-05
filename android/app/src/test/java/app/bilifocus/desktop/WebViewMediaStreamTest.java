package app.bilifocus.desktop;
import static org.junit.Assert.*;
import java.io.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
public class WebViewMediaStreamTest {
    @Test public void actualCdnRangesMustMatchTheBrowsersRequest() { assertTrue(WebViewMediaStream.matchesRange("bytes=50-",50,99,100)); assertTrue(WebViewMediaStream.matchesRange("bytes=-10",90,99,100)); assertTrue(WebViewMediaStream.matchesRange("bytes=40-41",40,41,100)); assertFalse(WebViewMediaStream.matchesRange("bytes=50-",0,49,100)); assertFalse(WebViewMediaStream.matchesRange("bytes=-0",99,99,100)); }
    @Test public void networkBufferIsNotMistakenForFullFileLength() throws Exception {
        InputStream slow = new ByteArrayInputStream(new byte[100000]) { @Override public int available() { return 8192; } };
        try (WebViewMediaStream input = new WebViewMediaStream(slow, 100000, 0, 100000, () -> {}, () -> {})) { assertEquals(100000, input.available()); assertEquals(100000, input.readAllBytes().length); }
    }
    @Test public void webviewSeekDoesNotApplyCdnRangeTwice() throws Exception {
        try (WebViewMediaStream input = new WebViewMediaStream(new ByteArrayInputStream(new byte[]{10,11,12,13}), 100000, 99996, 4, () -> {}, () -> {})) { assertEquals(100000, input.available()); assertEquals(90000, input.skip(90000)); assertEquals(9996, input.skip(9996)); assertArrayEquals(new byte[]{10,11,12,13}, input.readAllBytes()); }
    }
    @Test public void boundedAndSuffixRangesExposeTotalBeforeSeekAndOnlyTheirBody() throws Exception {
        try (WebViewMediaStream input = new WebViewMediaStream(new ByteArrayInputStream(new byte[]{1,2}), 100, 40, 2, () -> {}, () -> {})) { assertEquals(100, input.available()); assertEquals(40, input.skip(40)); assertEquals(1, input.read()); assertEquals(1, input.available()); assertEquals(2, input.read()); assertEquals(-1, input.read()); }
    }
    @Test public void revocationClosesExactlyOnceAndShortBodiesFail() throws Exception {
        AtomicInteger closed = new AtomicInteger(); WebViewMediaStream input = new WebViewMediaStream(new ByteArrayInputStream(new byte[]{1}), 2, 0, 2, () -> {}, closed::incrementAndGet); assertThrows(IOException.class, input::readAllBytes); input.close(); assertEquals(1, closed.get());
        WebViewMediaStream stale = new WebViewMediaStream(new ByteArrayInputStream(new byte[]{1}), 1, 0, 1, () -> { throw new IllegalStateException(); }, () -> {}); assertThrows(IOException.class, stale::read);
    }
}
