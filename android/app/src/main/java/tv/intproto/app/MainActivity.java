package tv.intproto.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * INTPROTO-TV: a thin app around the live web app.
 * It always loads the latest version from the server, so it updates by itself.
 */
public class MainActivity extends Activity {
    private WebView web;
    private FrameLayout root;
    private View fullView;
    private WebChromeClient.CustomViewCallback fullCallback;
    private final String appUrl = BuildConfig.APP_URL;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(Color.parseColor("#060a12"));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#060a12"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#060a12"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " INTPROTO-TV-App");
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return openOutside(req.getUrl());
            }
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openOutside(Uri.parse(url));
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame()) view.loadData(offlinePage(), "text/html", "UTF-8");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback cb) {
                if (fullView != null) { cb.onCustomViewHidden(); return; }
                fullView = view; fullCallback = cb;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
            @Override
            public void onHideCustomView() { exitFullscreen(); }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(appUrl);
        web.requestFocus();
    }

    private boolean openOutside(Uri uri) {
        String host = Uri.parse(appUrl).getHost();
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if ((scheme.equals("http") || scheme.equals("https")) && host != null && host.equals(uri.getHost()) && !uri.getPath().endsWith(".apk")) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
        return true;
    }

    private String offlinePage() {
        return "<html><body style='background:#060a12;color:#eaf6fb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center'>"
            + "<div><h2>INTPROTO-TV</h2><p>No internet connection / Pas de connexion / لا يوجد اتصال</p>"
            + "<button autofocus style='padding:14px 26px;font-size:18px;border-radius:12px;border:0;background:#12bfd8;color:#fff' onclick=\"location.href='" + appUrl + "'\">Retry ⟳</button></div></body></html>";
    }

    private void exitFullscreen() {
        if (fullView == null) return;
        root.removeView(fullView);
        fullView = null;
        if (fullCallback != null) fullCallback.onCustomViewHidden();
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        web.requestFocus();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (fullView != null) { exitFullscreen(); return true; }
            web.evaluateJavascript("(function(){var m=document.getElementById('modal-root');if(m&&m.innerHTML){m.querySelector('[data-act=close-modal]').click();return 'closed'}return ''})()", r -> {
                if (r == null || !r.contains("closed")) {
                    if (web.canGoBack()) web.goBack(); else finish();
                }
            });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override
    protected void onPause() { super.onPause(); web.onPause(); }
    @Override
    protected void onResume() { super.onResume(); web.onResume(); }
}
