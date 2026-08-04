package com.michaelunkai.daymark;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private static final String START_URL =
            "https://daymark-desktop.michaelovsky55555.chatgpt.site/";
    private static final String PREFS_NAME = "daymark";
    private static final String SYNC_KEY_PREF = "sync_key";
    private WebView webView;
    private SharedPreferences preferences;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        getWindow().setStatusBarColor(Color.rgb(247, 249, 247));
        getWindow().setNavigationBarColor(Color.rgb(247, 249, 247));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 249, 247));
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

        setContentView(webView);
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
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }

    private static final class DaymarkWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
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
                                + "<style>body{font:16px sans-serif;padding:24px;color:#26312b;background:#f7f9f7}"
                                + "button{padding:12px 16px;border:0;background:#267553;color:white;border-radius:8px}</style>"
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
        public void setTheme(String theme) {
            final boolean dark = "dark".equals(theme);
            runOnUiThread(() -> {
                getWindow().setStatusBarColor(dark ? Color.rgb(25, 34, 30) : Color.rgb(247, 249, 247));
                getWindow().setNavigationBarColor(dark ? Color.rgb(25, 34, 30) : Color.rgb(247, 249, 247));
                int flags = dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && !dark) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                getWindow().getDecorView().setSystemUiVisibility(flags);
            });
        }
    }
}
