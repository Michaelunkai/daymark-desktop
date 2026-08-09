package com.michaelunkai.daymark;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public final class MainActivity extends Activity {
    private static final String START_URL =
            "https://daymark-desktop.michaelovsky55555.chatgpt.site/";
    private static final String PREFS_NAME = "daymark";
    private static final String SYNC_KEY_PREF = "sync_key";
    private static final int SURFACE_COLOR = Color.BLACK;
    private WebView webView;
    private SharedPreferences preferences;
    private View loadingCover;
    private int rootBackPresses;
    private long lastRootBackAt;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        applyVantaBlackSystemBars();

        webView = new WebView(this);
        webView.setBackgroundColor(SURFACE_COLOR);
        webView.addJavascriptInterface(new ThemeBridge(), "DaymarkAndroid");
        webView.setWebViewClient(new DaymarkWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        WebSettings settings = webView.getSettings();
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

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(SURFACE_COLOR);
        root.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        loadingCover = new View(this);
        loadingCover.setBackgroundColor(SURFACE_COLOR);
        root.addView(
                loadingCover,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        if (savedInstanceState == null) {
            webView.loadUrl(urlForIntent(getIntent()));
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) webView.loadUrl(urlForIntent(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
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
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
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
            if (loadingCover != null) loadingCover.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error) {
            if (request.isForMainFrame()) {
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
