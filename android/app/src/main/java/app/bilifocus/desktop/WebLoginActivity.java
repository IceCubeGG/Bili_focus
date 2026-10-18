package app.bilifocus.desktop;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
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
    private ProgressBar progress;
    private boolean pageFailed;
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
        status.setText(instructions());
        status.setPadding(24, 12, 24, 12);
        layout.addView(status);
        LinearLayout actions = new LinearLayout(this);
        Button reload = new Button(this);
        reload.setText(chinese ? "重新加载登录页" : "Reload sign-in");
        reload.setOnClickListener(view -> {
            if (finishing) return;
            pageFailed = false;
            status.setText(instructions());
            webView.stopLoading();
            webView.loadUrl(BiliNativeClient.LOGIN_URL);
        });
        actions.addView(reload, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(this);
        close.setText(chinese ? "取消登录" : "Cancel sign-in");
        close.setOnClickListener(view -> complete(RESULT_CANCELED, null));
        actions.addView(close, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        layout.addView(actions);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        layout.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 6));
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value < 100 ? android.view.View.VISIBLE : android.view.View.GONE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !AuthResourcePolicy.navigation(request.getUrl().toString())) {
                    status.setText(chinese ? "此登录窗口仅允许访问哔哩哔哩官方页面。" : "This sign-in window only opens official Bilibili pages.");
                    return true;
                }
                return !AuthResourcePolicy.resource(request.getUrl().toString(), request.isForMainFrame());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!AuthResourcePolicy.resource(request.getUrl().toString(), request.isForMainFrame())) {
                    WebResourceResponse blocked = new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                    blocked.setStatusCodeAndReasonPhrase(403, "Blocked");
                    if (request.isForMainFrame()) showLoadError();
                    return blocked;
                }
                return null;
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() || AuthResourcePolicy.captchaResource(request.getUrl().toString())) showLoadError();
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() || AuthResourcePolicy.captchaResource(request.getUrl().toString())) showLoadError();
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler ssl, android.net.http.SslError error) {
                ssl.cancel();
                showLoadError();
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
        // CAPTCHA frames need their own browser state. This applies only to this
        // temporary, resource-restricted auth WebView, never the Capacitor renderer.
        cookies.setAcceptThirdPartyCookies(webView, true);
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

    private String instructions() {
        return chinese ? "在官方页面选择密码或短信登录。输入手机号后，点击获取验证码并完成安全验证。"
            : "Choose password or SMS on Bilibili's page. For SMS, enter your number, tap Get code, then complete the CAPTCHA.";
    }

    private void showLoadError() {
        handler.post(() -> {
            if (finishing || pageFailed) return;
            pageFailed = true;
            progress.setVisibility(android.view.View.GONE);
            // Never show or log URLs: the official page may include phone/token parameters.
            status.setText(chinese ? "登录页或安全验证加载失败。请检查网络后点击重新加载登录页；仍失败可使用扫码登录。"
                : "The sign-in page or CAPTCHA could not load. Check your connection and tap Reload sign-in, or use QR sign-in.");
        });
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
