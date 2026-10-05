package app.bilifocus.desktop;

import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local, bounded, account-scoped lists; never changes remote follows. */
final class SubscriptionGroupStore {
    private final SharedPreferences preferences;
    SubscriptionGroupStore(SharedPreferences preferences) { this.preferences = preferences; }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("The subscription groups are invalid. Please edit them and retry."); }
    private static void keys(JSONObject value, String... expected) {
        if (value == null) throw invalid();
        Set<String> names = new HashSet<>(java.util.Arrays.asList(expected));
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) if (!names.remove(keys.next())) throw invalid();
        if (!names.isEmpty()) throw invalid();
    }
    static JSONObject empty() throws Exception { return new JSONObject().put("version", 1).put("groups", new JSONArray()); }
    static JSONObject validate(JSONObject input) throws Exception {
        keys(input, "version", "groups");
        if (!(input.opt("version") instanceof Number) || ((Number) input.opt("version")).doubleValue() != 1
            || input.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512000) throw invalid();
        JSONArray groups = input.optJSONArray("groups");
        if (groups == null || groups.length() > 30) throw invalid();
        Set<String> ids = new HashSet<>(); JSONArray checked = new JSONArray();
        for (int i = 0; i < groups.length(); i++) {
            JSONObject group = groups.optJSONObject(i); keys(group, "id", "name", "uploaderIds");
            Object rawId = group.opt("id"), rawName = group.opt("name");
            if (!(rawId instanceof String) || !((String) rawId).matches("[A-Za-z0-9_-]{1,64}") || !ids.add((String) rawId)
                || !(rawName instanceof String) || ((String) rawName).trim().isEmpty() || ((String) rawName).length() > 80) throw invalid();
            for (char c : ((String) rawName).toCharArray()) if (Character.isISOControl(c)) throw invalid();
            JSONArray members = group.optJSONArray("uploaderIds");
            if (members == null || members.length() > 500) throw invalid();
            Set<String> seen = new HashSet<>(); JSONArray safeMembers = new JSONArray();
            for (int j = 0; j < members.length(); j++) {
                Object member = members.opt(j);
                if (!(member instanceof String) || !((String) member).matches("[1-9][0-9]{0,19}") || !seen.add((String) member)) throw invalid();
                safeMembers.put(member);
            }
            checked.put(new JSONObject().put("id", rawId).put("name", ((String) rawName).trim()).put("uploaderIds", safeMembers));
        }
        return new JSONObject().put("version", 1).put("groups", checked);
    }
    private String key(String uid) { if (uid == null || !uid.matches("[1-9][0-9]{0,19}")) throw invalid(); return "subscriptionGroups.v1." + uid; }
    synchronized JSONObject read(String uid) throws Exception {
        String raw = preferences.getString(key(uid), null);
        if (raw == null) return empty();
        if (raw.length() > 512000) throw invalid();
        return validate(new JSONObject(raw));
    }
    synchronized JSONObject write(String uid, JSONObject input) throws Exception {
        JSONObject next = validate(input);
        if (!preferences.edit().putString(key(uid), next.toString()).commit()) throw new Exception("Your subscription groups could not be saved.");
        return next;
    }
}
