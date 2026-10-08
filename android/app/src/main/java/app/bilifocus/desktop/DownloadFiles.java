package app.bilifocus.desktop;
import java.nio.charset.StandardCharsets;
final class DownloadFiles {
    static String mediaKind(String name) {
        if (name == null || name.startsWith(".")) return null;
        if (name.matches("(?i).+\\.(mp4|webm)")) return "video";
        return name.matches("(?i).+\\.(jpe?g|png|webp|gif)") ? "cover" : null;
    }
    static String mediaMime(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT);
        return mime(extension.equals("jpeg") ? "jpg" : extension);
    }
    static String name(String value) {
        String result = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFKC).replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f\\x7f]", "_");
        result = result.substring(0, result.offsetByCodePoints(0, Math.min(70, result.codePointCount(0, result.length())))).replaceAll("[. ]+$", "").trim();
        return result.isEmpty() || result.matches("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\..*)?") ? "video" : result;
    }
    private static boolean ascii(byte[] bytes, int offset, String value) { byte[] expected = value.getBytes(StandardCharsets.US_ASCII); if (bytes.length < offset + expected.length) return false; for (int i=0;i<expected.length;i++) if (bytes[offset+i] != expected[i]) return false; return true; }
    static String type(byte[] bytes, String kind) throws Exception {
        if (kind.equals("video")) { if (bytes.length >= 12 && ascii(bytes, 4, "ftyp")) return "mp4"; if (bytes.length >= 4 && bytes[0]==0x1a && bytes[1]==0x45 && bytes[2]==(byte)0xdf && bytes[3]==(byte)0xa3) return "webm"; }
        else { if (bytes.length>=3 && bytes[0]==(byte)0xff && bytes[1]==(byte)0xd8 && bytes[2]==(byte)0xff) return "jpg"; if (bytes.length>=8 && java.util.Arrays.equals(java.util.Arrays.copyOf(bytes,8), new byte[]{(byte)137,80,78,71,13,10,26,10})) return "png"; if (ascii(bytes,0,"RIFF") && ascii(bytes,8,"WEBP")) return "webp"; if (ascii(bytes,0,"GIF87a") || ascii(bytes,0,"GIF89a")) return "gif"; }
        throw new Exception("Unsupported file contents.");
    }
    static String mime(String extension) { return extension.equals("mp4") ? "video/mp4" : extension.equals("webm") ? "video/webm" : extension.equals("jpg") ? "image/jpeg" : "image/" + extension; }
}
