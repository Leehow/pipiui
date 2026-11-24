package cn.deepwood.pipiui;

import android.app.Activity;
import android.app.AlertDialog;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import android.widget.FrameLayout;

public final class MobileActivity extends Activity {
    private static final String HOME = "https://remote.deepwood.cn/mobile/";
    private WebView browser;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        browser = new WebView(this);
        FrameLayout frame = new FrameLayout(this);
        frame.addView(browser);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            frame.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime();
                android.graphics.Insets edges = windowInsets.getInsets(types);
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(frame);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.setWebChromeClient(new android.webkit.WebChromeClient());
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !"remote.deepwood.cn".equals(uri.getHost())
                        || (uri.getPort() != -1 && uri.getPort() != 443);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !isFinishing()) {
                    new AlertDialog.Builder(MobileActivity.this).setMessage("无法连接 Deepwood，请检查网络。")
                            .setPositiveButton("重试", (dialog, which) -> browser.loadUrl(HOME))
                            .setNegativeButton("关闭", null).show();
                }
            }
        });
        if (state == null || browser.restoreState(state) == null) browser.loadUrl(HOME);
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        browser.saveState(state);
    }
    @Override public void onBackPressed() {
        if (browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }
}
