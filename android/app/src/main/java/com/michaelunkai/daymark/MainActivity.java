package com.michaelunkai.daymark;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final String START_URL =
            "https://daymark-desktop.michaelovsky55555.chatgpt.site/";
    private static final String PREFS_NAME = "daymark";
    private static final String SYNC_KEY_PREF = "sync_key";
    private static final int SURFACE_COLOR = Color.BLACK;
    private WebView webView;
    private SharedPreferences preferences;
    private FrameLayout root;
    private View loadingCover;
    private TextView loadingMessage;
    private String lastRequestedUrl;
    private boolean destroying;
    private int rootBackPresses;
    private long lastRootBackAt;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        applyVantaBlackSystemBars();
        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        root = new FrameLayout(this);
        root.setBackgroundColor(SURFACE_COLOR);
        loadingCover = new View(this);
        loadingCover.setBackgroundColor(SURFACE_COLOR);
        root.addView(
                loadingCover,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        loadingMessage = new TextView(this);
        loadingMessage.setText("Loading Daymark");
        loadingMessage.setTextColor(Color.WHITE);
        loadingMessage.setTextSize(16);
        loadingMessage.setGravity(android.view.Gravity.CENTER);
        root.addView(
                loadingMessage,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView = createWebView();
        root.addView(
                webView,
                0,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        if (savedInstanceState == null) {
            loadDaymarkUrl(urlForIntent(getIntent()));
        } else if (webView.restoreState(savedInstanceState) == null) {
            loadDaymarkUrl(urlForIntent(getIntent()));
        } else {
            lastRequestedUrl = webView.getUrl();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadDaymarkUrl(urlForIntent(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView == null || webView.getUrl() == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){window.dispatchEvent(new Event('daymark:android-back'));return true;})()",
                null);
    }

    @Override
    protected void onDestroy() {
        destroying = true;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView nextWebView = new WebView(this);
        nextWebView.setBackgroundColor(SURFACE_COLOR);
        nextWebView.addJavascriptInterface(new ThemeBridge(), "DaymarkAndroid");
        nextWebView.setWebViewClient(new DaymarkWebViewClient());
        nextWebView.setWebChromeClient(new WebChromeClient());

        WebSettings settings = nextWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        return nextWebView;
    }

    private void loadDaymarkUrl(String url) {
        lastRequestedUrl = url;
        showLoading();
        if (webView != null) webView.loadUrl(url);
    }

    private void showLoading() {
        if (loadingCover != null) loadingCover.setVisibility(View.VISIBLE);
        if (loadingMessage != null) loadingMessage.setVisibility(View.VISIBLE);
    }

    private void hideLoading() {
        if (loadingCover != null) loadingCover.setVisibility(View.GONE);
        if (loadingMessage != null) loadingMessage.setVisibility(View.GONE);
    }

    private void recoverWebView(WebView failedWebView) {
        if (destroying || failedWebView != webView || root == null) {
            return;
        }

        showLoading();
        root.removeView(failedWebView);
        failedWebView.stopLoading();
        failedWebView.destroy();

        webView = createWebView();
        root.addView(
                webView,
                0,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        loadDaymarkUrl(lastRequestedUrl == null ? urlForIntent(getIntent()) : lastRequestedUrl);
    }

    private void handleBackResult(boolean atRoot) {
        if (!atRoot) {
            rootBackPresses = 0;
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastRootBackAt > 2200) rootBackPresses = 0;
        lastRootBackAt = now;
        rootBackPresses += 1;
        if (rootBackPresses >= 2) {
            rootBackPresses = 0;
            super.onBackPressed();
        }
    }

    private void applyVantaBlackSystemBars() {
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        getWindow().getDecorView().setSystemUiVisibility(0);
    }

    private final class DaymarkWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view == webView) hideLoading();
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (view == webView) hideLoading();
        }

        @Override
        public boolean onRenderProcessGone(
                WebView view,
                RenderProcessGoneDetail detail) {
            recoverWebView(view);
            return true;
        }

        @Override
        public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error) {
            if (view == webView && request.isForMainFrame()) {
                hideLoading();
                view.loadDataWithBaseURL(
                        START_URL,
                        "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
                                + "<meta name='theme-color' content='#000000'>"
                                + "<style>html,body{font:16px sans-serif;padding:24px;color:#fff;background:#000}"
                                + "button{padding:12px 16px;border:1px solid #fff;background:#000;color:#fff;border-radius:8px}</style>"
                                + "<h1>Daymark is offline</h1><p>Reconnect to the internet and try again.</p>"
                                + "<button onclick='location.reload()'>Retry</button>",
                        "text/html",
                        "UTF-8",
                        null);
            }
        }
    }

    private String urlForIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        String key = null;
        if (data != null && "daymark".equals(data.getScheme()) && "sync".equals(data.getHost())) {
            String candidate = data.getLastPathSegment();
            if (candidate != null && candidate.matches("[A-Za-z0-9_-]{22}")) {
                key = candidate;
                preferences.edit().putString(SYNC_KEY_PREF, key).apply();
            }
        }
        if (key == null) key = preferences.getString(SYNC_KEY_PREF, null);
        return key == null ? START_URL : START_URL + "?sync=" + Uri.encode(key);
    }

    private final class ThemeBridge {
        @JavascriptInterface
        public void setTheme(String ignoredTheme) {
            runOnUiThread(() -> {
                applyVantaBlackSystemBars();
            });
        }

        @JavascriptInterface
        public void onBackHandled(boolean atRoot) {
            runOnUiThread(() -> handleBackResult(atRoot));
        }
    }
}
