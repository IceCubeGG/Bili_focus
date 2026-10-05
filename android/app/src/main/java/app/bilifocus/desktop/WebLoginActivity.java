package app.bilifocus.desktop;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Official sign-in page in a separate WebView process, with no app JavaScript interface. */
public final class WebLoginActivity extends Activity {
    static final String EXTRA_COOKIES = "bili.native.session";
    static final String EXTRA_ERROR = "bili.native.error";
    static final String EXTRA_LANGUAGE = "bili.interface.language";
    static final String ACTION_CANCEL = "app.bilifocus.desktop.bili.auth.CANCEL";
    static final String AUTH_PERMISSION = "app.bilifocus.desktop.permission.AUTH_CONTROL";
    private static boolean directoryConfigured;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final BiliNativeClient client = new BiliNativeClient();
    private WebView webView;
    private TextView status;
    private boolean finishing;
    private boolean checking;
    private boolean chinese;
    private long startedAt;
    private boolean receiverRegistered;
    private final Runnable poll = this::checkSession;
    private final BroadcastReceiver cancelReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_CANCEL.equals(intent.getAction())) complete(RESULT_CANCELED, null);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before constructing any WebView or using CookieManager in this process.
        if (!directoryConfigured) {
            WebView.setDataDirectorySuffix("bili_auth");
            directoryConfigured = true;
        }
        super.onCreate(savedInstanceState);
        chinese = "zh-CN".equals(getIntent().getStringExtra(EXTRA_LANGUAGE));
        // This process renders account credentials; never expose it to WebView debugging.
        WebView.setWebContentsDebuggingEnabled(false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.WHITE);
        layout.setPadding(0, 0, 0, 0);
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        status = new TextView(this);
        status.setTextColor(Color.rgb(40, 44, 53));
        status.setText(chinese ? "请在哔哩哔哩官方页面选择密码或短信登录。" : "Sign in on Bilibili's official page. Select password or SMS on that page.");
        status.setPadding(24, 12, 24, 12);
        layout.addView(status);
        Button close = new Button(this);
        close.setText(chinese ? "取消登录" : "Cancel sign-in");
        close.setOnClickListener(view -> complete(RESULT_CANCELED, null));
        layout.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !BiliNativeClient.officialPage(request.getUrl())) {
                    status.setText(chinese ? "此登录窗口仅允许访问哔哩哔哩官方页面。" : "This sign-in window only opens official Bilibili pages.");
                    return true;
                }
                return !allowedResource(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!allowedResource(request.getUrl())
                    || (request.isForMainFrame() && !BiliNativeClient.officialPage(request.getUrl()))) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
        });
        layout.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(layout);
        IntentFilter cancellation = new IntentFilter(ACTION_CANCEL);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(cancelReceiver, cancellation, AUTH_PERMISSION, null, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(cancelReceiver, cancellation, AUTH_PERMISSION, null);
        }
        receiverRegistered = true;
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                () -> complete(RESULT_CANCELED, null));
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        WebStorage.getInstance().deleteAllData();
        cookies.removeAllCookies(removed -> {
            cookies.flush();
            if (!finishing) {
                startedAt = System.currentTimeMillis();
                webView.loadUrl(BiliNativeClient.LOGIN_URL);
                handler.postDelayed(poll, 2000);
            }
        });
    }

    private static boolean allowedResource(Uri uri) {
        if (BiliNativeClient.officialPage(uri)) return true;
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null
            || (uri.getPort() != -1 && uri.getPort() != 443) || host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.endsWith(".bilibili.com") || host.equals("bilibili.com")
            || host.endsWith(".hdslb.com") || host.equals("hdslb.com")
            || host.equals("api.geetest.com") || host.equals("static.geetest.com")
            || host.equals("monitor.geetest.com") || host.equals("static.geevisit.com");
    }

    private void checkSession() {
        if (finishing) return;
        if (System.currentTimeMillis() - startedAt > 15 * 60 * 1000) {
            complete(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, "The sign-in window timed out. Please try again."));
            return;
        }
        String cookies = CookieManager.getInstance().getCookie(BiliNativeClient.SITE);
        try {
            String candidate = BiliNativeClient.requireSession(cookies);
            if (!checking) {
                checking = true;
                network.execute(() -> {
                    boolean valid;
                    try { client.validate(candidate); valid = true; }
                    catch (Exception ignored) { valid = false; }
                    final boolean signedIn = valid;
                    handler.post(() -> {
                        checking = false;
                        if (!finishing && signedIn) complete(RESULT_OK, new Intent().putExtra(EXTRA_COOKIES, candidate));
                    });
                });
            }
        } catch (Exception ignored) { /* Wait for the official page to complete sign-in. */ }
        handler.postDelayed(poll, 2000);
    }

    private void complete(int code, Intent result) {
        if (finishing) return;
        finishing = true;
        handler.removeCallbacks(poll);
        webView.stopLoading();
        WebStorage.getInstance().deleteAllData();
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(removed -> {
            cookies.flush();
            setResult(code, result);
            finish();
        });
    }

    @Override
    public void onBackPressed() {
        complete(RESULT_CANCELED, null);
    }

    @Override
    public void onDestroy() {
        finishing = true;
        handler.removeCallbacksAndMessages(null);
        network.shutdownNow();
        if (receiverRegistered) unregisterReceiver(cancelReceiver);
        if (webView != null) {
            webView.stopLoading();
            webView.clearHistory();
            webView.clearCache(true);
            webView.destroy();
        }
        // A configuration change or system-driven finish also removes the transient auth jar.
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(removed -> cookies.flush());
        WebStorage.getInstance().deleteAllData();
        super.onDestroy();
    }
}
