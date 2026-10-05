package app.bilifocus.desktop;

import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** A bounded, nonsecret preset store shared by every account on this device. */
final class BrowseSettingsStore {
    private static final String KEY = "browseSettings.v1";
    private static final int MAX_BYTES = 131072;
    private final SharedPreferences preferences;

    BrowseSettingsStore(SharedPreferences preferences) { this.preferences = preferences; }

    static JSONObject empty() {
        try { return new JSONObject().put("version", 1).put("activePresetId", JSONObject.NULL).put("presets", new JSONArray()); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }

    private static void keys(JSONObject object, String... allowed) {
        Set<String> expected = new HashSet<>(java.util.Arrays.asList(allowed));
        Iterator<String> names = object.keys();
        while (names.hasNext()) if (!expected.remove(names.next())) throw invalid();
        if (!expected.isEmpty()) throw invalid();
    }

    private static IllegalArgumentException invalid() { return new IllegalArgumentException("The Browse preset settings are invalid. Please edit them and retry."); }

    private static String text(Object value, int maximum) { return text(value, maximum, false); }

    private static String text(Object value, int maximum, boolean allowEmpty) {
        if (!(value instanceof String)) throw invalid();
        String result = ((String) value).trim();
        if (!allowEmpty && result.isEmpty() || result.length() > maximum) throw invalid();
        for (int index = 0; index < result.length(); index++) if (Character.isISOControl(result.charAt(index))) throw invalid();
        return result;
    }

    static JSONObject validate(JSONObject input) throws Exception {
        if (input == null || input.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_BYTES) throw invalid();
        keys(input, "version", "activePresetId", "presets");
        Object version = input.opt("version");
        if (!(version instanceof Number) || ((Number) version).doubleValue() != 1) throw invalid();
        Object rawActive = input.opt("activePresetId");
        String active = rawActive == JSONObject.NULL ? null : text(rawActive, 64);
        JSONArray presets = input.optJSONArray("presets");
        if (presets == null || presets.length() > 20) throw invalid();
        JSONArray normalized = new JSONArray();
        Set<String> ids = new HashSet<>();
        for (int index = 0; index < presets.length(); index++) {
            JSONObject preset = presets.optJSONObject(index);
            if (preset == null) throw invalid();
            keys(preset, "id", "name", "labels", "uploaders", "match");
            String id = text(preset.opt("id"), 64);
            if (!id.matches("[A-Za-z0-9_-]+") || !ids.add(id)) throw invalid();
            String name = text(preset.opt("name"), 80);
            String match = text(preset.opt("match"), 3);
            if (!match.equals("all") && !match.equals("any")) throw invalid();
            JSONArray labels = preset.optJSONArray("labels");
            JSONArray uploaders = preset.optJSONArray("uploaders");
            if (labels == null || labels.length() > 30 || uploaders == null || uploaders.length() > 50) throw invalid();
            JSONArray checkedLabels = new JSONArray();
            Set<String> names = new HashSet<>();
            for (int labelIndex = 0; labelIndex < labels.length(); labelIndex++) {
                String label = text(labels.opt(labelIndex), 80);
                if (!names.add(label.toLowerCase(Locale.ROOT))) throw invalid();
                checkedLabels.put(label);
            }
            JSONArray checkedUploaders = new JSONArray();
            Set<String> uploaderIds = new HashSet<>();
            for (int uploaderIndex = 0; uploaderIndex < uploaders.length(); uploaderIndex++) {
                JSONObject uploader = uploaders.optJSONObject(uploaderIndex);
                if (uploader == null) throw invalid();
                keys(uploader, "id", "name");
                String uploaderId = text(uploader.opt("id"), 20);
                if (!uploaderId.matches("[1-9][0-9]{0,19}") || !uploaderIds.add(uploaderId)) throw invalid();
                checkedUploaders.put(new JSONObject().put("id", uploaderId).put("name", text(uploader.opt("name"), 80, true)));
            }
            normalized.put(new JSONObject().put("id", id).put("name", name).put("labels", checkedLabels)
                .put("uploaders", checkedUploaders).put("match", match));
        }
        if (active != null && !ids.contains(active)) throw invalid();
        return new JSONObject().put("version", 1).put("activePresetId", active == null ? JSONObject.NULL : active).put("presets", normalized);
    }

    synchronized JSONObject read() throws Exception {
        String saved = preferences.getString(KEY, null);
        if (saved == null) return empty();
        if (saved.length() > MAX_BYTES) throw invalid();
        return validate(new JSONObject(saved));
    }

    synchronized JSONObject write(JSONObject settings) throws Exception {
        JSONObject checked = validate(settings);
        if (!preferences.edit().putString(KEY, checked.toString()).commit()) throw new Exception("Your Browse presets could not be saved. Please retry.");
        return checked;
    }
}
