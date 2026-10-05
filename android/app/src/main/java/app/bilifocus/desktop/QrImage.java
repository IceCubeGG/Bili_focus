package app.bilifocus.desktop;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Base64;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.io.ByteArrayOutputStream;
import java.util.EnumMap;
import java.util.Map;

/** Renders a validated Bilibili scan link locally; no image service receives the login key. */
final class QrImage {
    private QrImage() { }

    static String toDataUrl(String url) throws Exception {
        BiliNativeClient.validateQrUrl(url);
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.MARGIN, 4);
        BitMatrix matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 512, 512, hints);
        Bitmap image = Bitmap.createBitmap(matrix.getWidth(), matrix.getHeight(), Bitmap.Config.ARGB_8888);
        try {
            int[] pixels = new int[matrix.getWidth() * matrix.getHeight()];
            for (int y = 0; y < matrix.getHeight(); y++) {
                for (int x = 0; x < matrix.getWidth(); x++) {
                    pixels[y * matrix.getWidth() + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            image.setPixels(pixels, 0, matrix.getWidth(), 0, 0, matrix.getWidth(), matrix.getHeight());
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!image.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                throw new Exception("Could not render the Bilibili QR code.");
            }
            return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } finally {
            image.recycle();
        }
    }
}
