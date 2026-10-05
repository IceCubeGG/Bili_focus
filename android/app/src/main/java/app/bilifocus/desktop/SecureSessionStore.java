package app.bilifocus.desktop;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Credentials never pass through Capacitor. Only ciphertext is written to app storage. */
final class SecureSessionStore {
    private static final String ALIAS = "bili-focus.session.v1";
    private static final byte[] AAD = "bili-focus.session.v1".getBytes(StandardCharsets.UTF_8);
    private final SharedPreferences preferences;

    SecureSessionStore(Context context) {
        preferences = context.getSharedPreferences("bili-focus.secure-session", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    boolean available() {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            cipher.updateAAD(AAD);
            cipher.doFinal(new byte[0]);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    synchronized String load() throws Exception {
        String encrypted = preferences.getString("ciphertext", null);
        String iv = preferences.getString("iv", null);
        if (encrypted == null || iv == null) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        cipher.updateAAD(AAD);
        String cookieHeader = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        return BiliNativeClient.requireSession(cookieHeader);
    }

    synchronized void save(String cookieHeader) throws Exception {
        String checked = BiliNativeClient.requireSession(cookieHeader);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(AAD);
        byte[] encrypted = cipher.doFinal(checked.getBytes(StandardCharsets.UTF_8));
        boolean saved = preferences.edit()
            .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .commit();
        if (!saved) throw new Exception("Your session could not be saved on this device.");
    }

    synchronized void clear() throws Exception {
        boolean removed = preferences.edit().clear().commit();
        // Deleting the key also makes any old ciphertext unrecoverable.
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        store.deleteEntry(ALIAS);
        if (!removed) throw new Exception("The saved session could not be fully removed. Please retry.");
    }
}
