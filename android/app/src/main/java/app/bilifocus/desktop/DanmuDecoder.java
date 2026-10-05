package app.bilifocus.desktop;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded protobuf decoding. Advanced/code/BAS items are excluded, never evaluated. */
final class DanmuDecoder {
    private static final class Reader {
        final byte[] bytes; int offset; final int end;
        Reader(byte[] bytes) { this(bytes, 0, bytes.length); }
        Reader(byte[] bytes, int start, int end) { this.bytes = bytes; this.offset = start; this.end = end; }
        long varint() throws Exception { long result = 0; for (int i = 0; i < 10; i++) { if (offset >= end) throw new Exception("Invalid Danmu data."); int value = bytes[offset++] & 255; if (i == 9 && value > 1) throw new Exception("Invalid Danmu integer."); result |= (long) (value & 127) << (i * 7); if ((value & 128) == 0) return result; } throw new Exception("Invalid Danmu data."); }
        Reader chunk() throws Exception { long length = varint(); if (length < 0 || length > end - offset) throw new Exception("Invalid Danmu length."); Reader result = new Reader(bytes, offset, offset + (int) length); offset += (int) length; return result; }
        String string() throws Exception { Reader chunk = chunk(); return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, chunk.offset, chunk.end - chunk.offset)).toString(); }
        void skip(int wire) throws Exception { if (wire == 0) varint(); else if (wire == 2) chunk(); else if (wire == 1 || wire == 5) { offset += wire == 1 ? 8 : 4; if (offset > end) throw new Exception("Invalid Danmu data."); } else throw new Exception("Invalid Danmu field."); }
    }
    static JSONArray decode(byte[] bytes) throws Exception {
        if (bytes.length > 2 * 1024 * 1024) throw new Exception("Danmu segment too large."); Reader outer = new Reader(bytes); LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>();
        while (outer.offset < outer.end) {
            long key = outer.varint(); int field = (int) (key >>> 3), wire = (int) (key & 7); if (field != 1 || wire != 2) { outer.skip(wire); continue; }
            Reader reader = outer.chunk(); String id = "", text = ""; long progress = 0, mode = 0, color = 16777215;
            while (reader.offset < reader.end) { key = reader.varint(); field = (int) (key >>> 3); wire = (int) (key & 7);
                if ((field == 1 || field == 2 || field == 3 || field == 5) && wire == 0) { long value = reader.varint(); if (field == 1) id = Long.toUnsignedString(value); else if (field == 2) progress = value; else if (field == 3) mode = value; else color = value; }
                else if ((field == 7 || field == 12) && wire == 2) { String value = reader.string(); if (field == 7) text = BiliVideoClient.text(value, 300); else id = value; } else reader.skip(wire);
            }
            if (id.matches("[0-9]{1,20}") && !text.isEmpty() && (mode == 1 || mode == 4 || mode == 5) && progress >= 0 && progress <= 604800000 && color >= 0 && color <= 16777215) unique.put(id, new JSONObject().put("id", id).put("timeSeconds", progress / 1000.0).put("text", text).put("color", color).put("mode", mode));
            if (unique.size() > 6000) throw new Exception("Too many Danmu items.");
        }
        List<JSONObject> list = new ArrayList<>(unique.values()); list.sort(Comparator.comparingDouble(item -> item.optDouble("timeSeconds"))); return new JSONArray(list);
    }
}
