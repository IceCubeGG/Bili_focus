package app.bilifocus.desktop;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private android.view.View fullscreenView;
    private android.webkit.WebChromeClient.CustomViewCallback fullscreenCallback;
    private void exitVideoFullscreen() {
        if (fullscreenView == null) return;
        ((android.widget.FrameLayout) findViewById(android.R.id.content)).removeView(fullscreenView);
        fullscreenView = null; getBridge().getWebView().setVisibility(android.view.View.VISIBLE);
        androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).show(androidx.core.view.WindowInsetsCompat.Type.systemBars());
        android.webkit.WebChromeClient.CustomViewCallback callback = fullscreenCallback; fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }
    @Override public void onPause() {
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().evaluateJavascript("document.querySelectorAll('video').forEach(video => video.pause());", null);
        super.onPause();
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BiliAccountPlugin.class);
        super.onCreate(savedInstanceState);
        // Fullscreen hosts the shared player stage, including the Danmu overlay.
        getBridge().getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(getBridge()) {
            @Override public void onShowCustomView(android.view.View view, android.webkit.WebChromeClient.CustomViewCallback callback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return; }
                fullscreenView = view; fullscreenCallback = callback;
                getBridge().getWebView().setVisibility(android.view.View.GONE);
                ((android.widget.FrameLayout) findViewById(android.R.id.content)).addView(view, new android.widget.FrameLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
                androidx.core.view.WindowInsetsControllerCompat controller = androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                controller.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
            }
            @Override public void onHideCustomView() { exitVideoFullscreen(); }
        });
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (fullscreenView != null) { getBridge().getWebView().evaluateJavascript("if(document.fullscreenElement) document.exitFullscreen();", null); exitVideoFullscreen(); }
                else if (getBridge().getWebView().canGoBack()) getBridge().getWebView().goBack();
                else { setEnabled(false); getOnBackPressedDispatcher().onBackPressed(); setEnabled(true); }
            }
        });
    }
}
