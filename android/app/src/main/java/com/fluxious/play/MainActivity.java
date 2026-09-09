package com.fluxious.play;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** The whole app: one WebView showing the play page. */
public class MainActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // The page sets its own viewport and scaling; the WebView must not add any.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        web.setWebViewClient(new ExternalLinkClient());
        // Without a chrome client the page cannot go fullscreen or report console output.
        web.setWebChromeClient(new WebChromeClient());

        web.setBackgroundColor(0xFF000000);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        setContentView(web);

        // Restored rather than reloaded: a reload would drop the player's session.
        if (savedInstanceState == null) {
            web.loadUrl(BuildConfig.START_URL);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    /**
     * Keeps the game in the app and everything else out of it.
     *
     * Loading the Discord here instead would leave a player inside the game window with no way
     * back: back leaves the app, and there is no address bar.
     */
    private final class ExternalLinkClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handle(request.getUrl());
        }

        /** Still the form called on the oldest devices supported. */
        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handle(Uri.parse(url));
        }

        private boolean handle(Uri uri) {
            if (isGameHost(uri)) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                // Nothing installed can open it. Staying put beats crashing.
                return true;
            }
            return true;
        }
    }

    /** By host rather than prefix, so a build pointed at a dev server behaves the same way. */
    private static boolean isGameHost(Uri uri) {
        Uri start = Uri.parse(BuildConfig.START_URL);
        String host = uri.getHost();

        return host != null && host.equalsIgnoreCase(start.getHost());
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            goImmersive();
        }
    }

    /** Sticky, so a mistimed swipe during combat does not permanently give up a strip of screen. */
    private void goImmersive() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
            return;
        }
        web.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    /**
     * Back leaves the app rather than unloading the page.
     *
     * The page has no history to go back through, and backgrounding keeps the session alive.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            moveTaskToBack(true);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
