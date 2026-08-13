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
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
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
    private static final String NATIVE_RELEASE = "1.4.34";
    private static final int CONTENT_READY_TIMEOUT_MS = 9000;
    private static final int RUNTIME_HEALTH_CHECK_MS = 500;
    private WebView webView;
    private SharedPreferences preferences;
    private FrameLayout root;
    private View loadingCover;
    private TextView loadingMessage;
    private String lastRequestedUrl;
    private boolean destroying;
    private boolean hasVisibleDocument;
    private boolean loadingFailed;
    private int loadGeneration;
    private int readinessCheckGeneration = -1;
    private int timeoutGeneration = -1;
    private int rootBackPresses;
    private long lastRootBackAt;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

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
        loadingMessage.setOnClickListener(view -> retryCurrentPage());
        loadingCover.setOnClickListener(view -> retryCurrentPage());
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
        nextWebView.setWebChromeClient(new DaymarkChromeClient());

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            settings.setOffscreenPreRaster(true);
        }
        return nextWebView;
    }

    private void loadDaymarkUrl(String url) {
        lastRequestedUrl = url;
        hasVisibleDocument = false;
        loadingFailed = false;
        loadGeneration += 1;
        showLoading();
        if (webView != null) {
            scheduleContentTimeout(webView, loadGeneration);
            webView.loadUrl(withLaunchMarker(url));
        }
    }

    private void showLoading() {
        if (loadingMessage != null) {
            loadingMessage.setText("Loading Daymark");
            loadingMessage.setClickable(false);
        }
        if (loadingCover != null) loadingCover.setClickable(false);
        if (loadingCover != null) loadingCover.setVisibility(View.VISIBLE);
        if (loadingMessage != null) loadingMessage.setVisibility(View.VISIBLE);
    }

    private void showOffline() {
        if (loadingMessage != null) {
            loadingMessage.setText("Daymark could not load.\nTap to retry");
            loadingMessage.setClickable(true);
        }
        if (loadingCover != null) loadingCover.setClickable(true);
        if (loadingCover != null) loadingCover.setVisibility(View.VISIBLE);
        if (loadingMessage != null) loadingMessage.setVisibility(View.VISIBLE);
    }

    private void hideLoading() {
        if (loadingCover != null) loadingCover.setVisibility(View.GONE);
        if (loadingMessage != null) loadingMessage.setVisibility(View.GONE);
    }

    private void retryCurrentPage() {
        loadDaymarkUrl(lastRequestedUrl == null ? urlForIntent(getIntent()) : lastRequestedUrl);
    }

    private String withLaunchMarker(String url) {
        return Uri.parse(url)
                .buildUpon()
                .appendQueryParameter("native", NATIVE_RELEASE)
                .build()
                .toString();
    }

    private void verifyAppRendered(WebView view, int generation) {
        if (destroying || view != webView || generation != loadGeneration || loadingFailed) {
            return;
        }
        view.evaluateJavascript(
                "(function(){var root=document.getElementById('root');"
                        + "if(!root)return false;"
                        + "if(root.getAttribute('data-daymark-ready')==='true')return true;"
                        + "var text=(root.innerText||'').trim();"
                        + "return root.children.length>0&&text.length>0;})()",
                value -> {
                    if (destroying || view != webView || generation != loadGeneration || loadingFailed) {
                        return;
                    }
                    if ("true".equals(value)) {
                        markAppReady();
                    } else {
                        mainHandler.postDelayed(
                                () -> verifyAppRendered(view, generation),
                                250);
                    }
                });
    }

    private void scheduleAppReadinessCheck(WebView view) {
        int generation = loadGeneration;
        if (readinessCheckGeneration == generation) {
            return;
        }
        readinessCheckGeneration = generation;
        verifyAppRendered(view, generation);
    }

    private void scheduleContentTimeout(WebView view, int generation) {
        if (timeoutGeneration == generation) {
            return;
        }
        timeoutGeneration = generation;
        mainHandler.postDelayed(() -> {
            if (!destroying
                    && view == webView
                    && generation == loadGeneration
                    && !hasVisibleDocument
                    && !loadingFailed) {
                loadingFailed = true;
                showOffline();
            }
        }, CONTENT_READY_TIMEOUT_MS);
    }

    private void markAppReady() {
        if (destroying || loadingFailed) {
            return;
        }
        hasVisibleDocument = true;
        hideLoading();
        monitorRenderedApp(webView, loadGeneration);
    }

    private void monitorRenderedApp(WebView view, int generation) {
        if (destroying || view != webView || generation != loadGeneration || !hasVisibleDocument) {
            return;
        }
        view.evaluateJavascript(
                "(function(){var root=document.getElementById('root');"
                        + "if(!root)return false;"
                        + "var text=(root.innerText||'').trim();"
                        + "return root.children.length>0&&text.length>0;})()",
                value -> {
                    if (destroying || view != webView || generation != loadGeneration || !hasVisibleDocument) {
                        return;
                    }
                    if ("true".equals(value)) {
                        mainHandler.postDelayed(
                                () -> monitorRenderedApp(view, generation),
                                RUNTIME_HEALTH_CHECK_MS);
                        return;
                    }
                    hasVisibleDocument = false;
                    loadingFailed = false;
                    showLoading();
                    loadDaymarkUrl(lastRequestedUrl == null ? urlForIntent(getIntent()) : lastRequestedUrl);
                });
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
            if (view == webView && !loadingFailed) {
                scheduleAppReadinessCheck(view);
            }
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (view == webView && !loadingFailed) {
                hideLoading();
                scheduleAppReadinessCheck(view);
            }
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
            if (view != webView || !request.isForMainFrame()) {
                return;
            }
            if (hasVisibleDocument) {
                hideLoading();
                return;
            }
            loadingFailed = true;
            showOffline();
        }
    }

    private static final class DaymarkChromeClient extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                Log.e(
                        "DaymarkWeb",
                        "Web error at line " + message.lineNumber() + ": " + message.message());
            }
            return super.onConsoleMessage(message);
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
        public void onAppReady() {
            runOnUiThread(() -> markAppReady());
        }

        @JavascriptInterface
        public void onAppError() {
            runOnUiThread(() -> {
                if (!destroying) {
                    loadingFailed = true;
                    showOffline();
                }
            });
        }

        @JavascriptInterface
        public void onBackHandled(boolean atRoot) {
            runOnUiThread(() -> handleBackResult(atRoot));
        }
    }
}
