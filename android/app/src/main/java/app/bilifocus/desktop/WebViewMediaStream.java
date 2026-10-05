package app.bilifocus.desktop;

import java.io.IOException;
import java.io.InputStream;

/** WebView treats available() as the resource size, then skips Range's start.
 * A network stream's buffered byte count is NOT its size. The CDN has already
 * applied Range, so acknowledge that initial skip without discarding data twice.
 * See Chromium components/embedder_support/android/util/input_stream_reader.cc.
 */
final class WebViewMediaStream extends InputStream {
    static boolean matchesRange(String requested, long start, long end, long total) {
        if(start < 0 || end < start || end >= total) return false;
        if(requested == null) return start == 0 && end == total-1;
        try {
            String[] bounds=requested.substring(6).split("-",-1);
            long expectedStart=bounds[0].isEmpty()?Math.max(0,total-Long.parseLong(bounds[1])):Long.parseLong(bounds[0]);
            long expectedEnd=bounds[0].isEmpty() || bounds[1].isEmpty()?total-1:Math.min(total-1,Long.parseLong(bounds[1]));
            return start == expectedStart && end == expectedEnd;
        } catch(Exception ignored) { return false; }
    }
    private final InputStream input;
    private final Runnable check, cleanup;
    private final long total;
    private long skipCredit, remaining;
    private boolean started, closed;
    WebViewMediaStream(InputStream input, long total, long start, long length, Runnable check, Runnable cleanup) {
        if (total <= 0 || total > Integer.MAX_VALUE || start < 0 || length <= 0 || start + length > total) throw new IllegalArgumentException("Unsupported media length.");
        this.input = input; this.total = total; skipCredit = start; remaining = length; this.check = check; this.cleanup = cleanup;
    }
    private void current() throws IOException {
        if (closed) throw new IOException("Video stream closed.");
        try { check.run(); } catch (RuntimeException error) { close(); throw new IOException("Video stream stopped."); }
    }
    @Override public int available() throws IOException { current(); return (int) (started ? remaining : total); }
    @Override public long skip(long count) throws IOException {
        current(); if (count <= 0) return 0;
        long acknowledged = Math.min(count, skipCredit); skipCredit -= acknowledged;
        if (acknowledged > 0) return acknowledged;
        started = true; long skipped = input.skip(Math.min(count, remaining)); remaining -= skipped; current(); return skipped;
    }
    @Override public int read() throws IOException { byte[] one = new byte[1]; return read(one, 0, 1) < 0 ? -1 : one[0] & 255; }
    @Override public int read(byte[] bytes, int offset, int length) throws IOException {
        current(); if (length == 0) return 0; started = true; skipCredit = 0; if (remaining == 0) return -1;
        try {
            int count = input.read(bytes, offset, (int) Math.min(length, remaining)); current();
            if (count < 0) throw new IOException("Incomplete video stream.");
            if (count == 0) { int value = input.read(); current(); if (value < 0) throw new IOException("Incomplete video stream."); bytes[offset] = (byte) value; count = 1; }
            remaining -= count; return count;
        } catch (IOException error) { close(); throw error; }
    }
    @Override public void close() throws IOException { if (closed) return; closed = true; try { input.close(); } finally { cleanup.run(); } }
}
