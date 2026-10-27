package io.github.raymondnassar.recappage.prototype;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.Gravity;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.browser.customtabs.CustomTabsIntent;

import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.SignInButton;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class CloudAuthActivity extends Activity {
    private static final int GOOGLE = 8202;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private CloudSdkAuthFactory.Pending pending;
    private AuthorizationClient google;
    private CloudMicrosoftAuth.Pending microsoft;
    private View connect;
    private TextView status;
    private boolean resumed, started, external, left, verifying, settled, destroyed;
    private final Runnable freshness = new Runnable() {
        @Override public void run() {
            if (!current()) { fail(); return; }
            main.postDelayed(this, 100);
        }
    };
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        pending = state == null ? CloudSdkAuthFactory.attach(this, getIntent()) : null;
        if (pending == null) { finish(); return; }
        boolean googleProvider = pending.request.provider == CloudProviderHttp.Provider.GOOGLE;
        int heading = googleProvider ? R.string.cloud_native_auth_title_google : R.string.cloud_native_auth_title_microsoft;
        setTitle(heading);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        int padding = dp(24);
        scroll.setPadding(padding, padding, padding, padding);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        ScrollView.LayoutParams column = new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL);
        scroll.addView(layout, column);
        Runnable fit = () -> {
            int width = scroll.getWidth() - scroll.getPaddingLeft() - scroll.getPaddingRight();
            if (width > 0 && column.width != Math.min(width, dp(480))) {
                column.width = Math.min(width, dp(480));
                layout.setLayoutParams(column);
            }
        };
        scroll.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> fit.run());
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                scroll.setPadding(padding + edges.left, padding + edges.top, padding + edges.right, padding + edges.bottom);
            } else {
                scroll.setPadding(padding + insets.getSystemWindowInsetLeft(), padding + insets.getSystemWindowInsetTop(),
                        padding + insets.getSystemWindowInsetRight(), padding + insets.getSystemWindowInsetBottom());
            }
            fit.run();
            return insets;
        });
        TextView title = new TextView(this);
        title.setId(R.id.cloud_native_auth_heading);
        title.setText(heading);
        title.setTextAppearance(android.R.style.TextAppearance_Material_Headline);
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        LinearLayout.LayoutParams titleLayout = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleLayout.bottomMargin = dp(16);
        layout.addView(title, titleLayout);
        status = new TextView(this);
        status.setId(R.id.cloud_native_auth_status);
        status.setText(R.string.cloud_native_auth_intro);
        status.setTextAppearance(android.R.style.TextAppearance_Material_Body1);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        layout.addView(status, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (googleProvider) {
            SignInButton button = new SignInButton(this);
            button.setSize(SignInButton.SIZE_WIDE);
            button.setColorScheme(SignInButton.COLOR_AUTO);
            connect = button;
        } else {
            Button button = new Button(this);
            button.setText(R.string.cloud_native_auth_microsoft);
            button.setAllCaps(false);
            connect = button;
        }
        connect.setId(R.id.cloud_native_continue);
        connect.setMinimumHeight(dp(48));
        connect.setOnClickListener((view) -> authorize());
        LinearLayout.LayoutParams connectLayout = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        connectLayout.topMargin = dp(24);
        layout.addView(connect, connectLayout);
        Button cancel = new Button(this, null, android.R.attr.borderlessButtonStyle);
        cancel.setId(R.id.cloud_native_cancel);
        cancel.setText(android.R.string.cancel);
        cancel.setAllCaps(false);
        cancel.setMinimumHeight(dp(48));
        cancel.setOnClickListener((view) -> {
            CloudSdkQualificationActivity.presentationEvent(pending.request.profile, pending.request.provider, "cancel");
            fail();
        });
        LinearLayout.LayoutParams cancelLayout = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cancelLayout.topMargin = dp(8);
        layout.addView(cancel, cancelLayout);
        setContentView(scroll);
        scroll.requestApplyInsets();
        CloudSdkQualificationActivity.presentationEvent(pending.request.profile, pending.request.provider, "shown");
        main.post(freshness);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private boolean current() { return !destroyed && !settled && pending != null && pending.current(); }
    private void authorize() {
        if (!current() || !resumed || !hasWindowFocus() || started) { fail(); return; }
        started = true;
        CloudSdkQualificationActivity.presentationEvent(pending.request.profile, pending.request.provider, "authorize");
        connect.setEnabled(false);
        status.setText(R.string.cloud_native_auth_waiting);
        try {
            if (pending.request.provider == CloudProviderHttp.Provider.MICROSOFT) {
                microsoft = CloudMicrosoftAuth.begin(this);
                external = true;
                new CustomTabsIntent.Builder().build().launchUrl(this, microsoft.request.toUri());
            } else {
                CloudSdkAuthFactory.googleAvailable(this);
                google = Identity.getAuthorizationClient(this);
                google.authorize(CloudSdkAuthFactory.googleRequest(null))
                        .addOnSuccessListener(main::post, this::google)
                        .addOnFailureListener(main::post, (error) -> fail());
            }
        } catch (Exception error) { fail(); }
    }
    private void google(AuthorizationResult result) {
        if (!current() || verifying) return;
        try {
            if (result.hasResolution()) {
                if (external || !resumed || !hasWindowFocus() || result.getPendingIntent() == null) { fail(); return; }
                external = true;
                startIntentSenderForResult(result.getPendingIntent().getIntentSender(), GOOGLE, null, 0, 0, 0);
                return;
            }
            pending.request.claim();
            verifying = true;
            worker.execute(() -> {
                try { complete(CloudGoogleAuth.verify(result, pending.request, null)); }
                catch (Exception error) { main.post(this::fail); }
            });
        } catch (Exception error) { fail(); }
    }
    boolean microsoft(Uri uri) {
        if (!current() || verifying || microsoft == null || !microsoft.matches(uri)) return false;
        try { pending.request.claim(); }
        catch (Exception error) { fail(); return false; }
        verifying = true;
        worker.execute(() -> {
            try { complete(CloudSdkAuthFactory.microsoft(CloudMicrosoftAuth.exchange(microsoft, uri))); }
            catch (Exception error) { main.post(this::fail); }
        });
        return true;
    }
    private void complete(CloudNativeAuth.Proof proof) throws Exception {
        pending.request.require();
        main.post(() -> {
            if (!current()) { fail(); return; }
            try {
                pending.complete(proof);
                settled = true;
                finish();
            } catch (Exception error) { fail(); }
        });
    }
    private void fail() {
        if (settled) return;
        settled = true;
        if (pending != null) pending.fail();
        finish();
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (external && left && !verifying && !settled) fail();
    }
    @Override protected void onPause() {
        resumed = false;
        if (external) left = true;
        super.onPause();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != GOOGLE || !current() || verifying) return;
        if (result != RESULT_OK || data == null || google == null) { fail(); return; }
        try {
            AuthorizationResult authorization = google.getAuthorizationResultFromIntent(data);
            if (authorization.hasResolution()) { fail(); return; }
            google(authorization);
        } catch (Exception error) { fail(); }
    }
    @Override protected void onDestroy() {
        destroyed = true;
        main.removeCallbacks(freshness);
        if (!settled) fail();
        if (microsoft != null) microsoft.consumed.set(true);
        worker.shutdown();
        super.onDestroy();
    }
}
