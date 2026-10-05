package app.bilifocus.desktop;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.TreeMap;

/** Bilibili web request signing using public navigation keys, entirely in native code. */
final class WbiSignature {
    private static final int[] MIX = {46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13};
    private static String part(String value) throws Exception {
        URI url = new URI(value);
        if (!"https".equals(url.getScheme()) || url.getHost() == null || !url.getHost().endsWith(".hdslb.com") || url.getUserInfo() != null || url.getPort() != -1) throw new Exception("Unexpected uploader signing key.");
        String file = url.getPath().substring(url.getPath().lastIndexOf('/') + 1);
        if (!file.matches("[a-fA-F0-9]{32}\\.[a-zA-Z]+")) throw new Exception("Unexpected uploader signing key.");
        return file.substring(0, 32);
    }
    static String key(String imageUrl, String subUrl) throws Exception {
        String combined = part(imageUrl) + part(subUrl);
        StringBuilder key = new StringBuilder();
        for (int index : MIX) key.append(combined.charAt(index));
        return key.toString();
    }
    static String query(Map<String, String> parameters, String key, long now) throws Exception {
        TreeMap<String, String> sorted = new TreeMap<>(parameters);
        sorted.put("wts", Long.toString(now / 1000));
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> parameter : sorted.entrySet()) {
            if (query.length() > 0) query.append('&');
            query.append(URLEncoder.encode(parameter.getKey(), "UTF-8")).append('=')
                .append(URLEncoder.encode(parameter.getValue().replaceAll("[!'()*]", ""), "UTF-8"));
        }
        byte[] digest = MessageDigest.getInstance("MD5").digest((query.toString() + key).getBytes(StandardCharsets.UTF_8));
        StringBuilder signature = new StringBuilder();
        for (byte value : digest) signature.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return query.append("&w_rid=").append(signature).toString();
    }
}
