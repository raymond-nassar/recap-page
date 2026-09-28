package io.github.raymondnassar.recappage.prototype;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final Set<String> seenRequests = new HashSet<>();
    private final ArrayList<Dialog> popups = new ArrayList<>();
    private final ArrayList<WebView> popupViews = new ArrayList<>();
    private LocalAssets local;
    private WebView web;
    private FrameLayout root;
    private WebMessagePort port;
    private int generation;
    private boolean destroyed;
    private boolean writing;
    private int nextPickerCode = 1000;
    private int activePickerCode = -1;
    private PendingSave pendingSave;
    private ValueCallback<Uri[]> fileCallback;
    private int fileGeneration;
    private String backId;
    private int backSequence;
    private Runnable backTimeout;
    private String lastRoute;
    private Runnable unregisterBack;

    private static final class Api33Back {
        static Runnable register(Activity activity, Runnable action) {
            if (Build.VERSION.SDK_INT < 33) throw new IllegalStateException("Predictive Back requires Android 13.");
            android.window.OnBackInvokedDispatcher dispatcher = activity.getOnBackInvokedDispatcher();
            android.window.OnBackInvokedCallback callback = action::run;
            dispatcher.registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            return () -> dispatcher.unregisterOnBackInvokedCallback(callback);
        }
    }

    private static final class PendingSave {
        final String id;
        final WebMessagePort port;
        final int generation;
        byte[] bytes;
        volatile boolean cancelled;

        PendingSave(String id, WebMessagePort port, int generation, byte[] bytes) {
            this.id = id;
            this.port = port;
            this.generation = generation;
            this.bytes = bytes;
        }
    }

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            local = new LocalAssets(getAssets());
        } catch (IOException | JSONException | IllegalArgumentException error) {
            showFatal("The bundled app could not be loaded. Rebuild and reinstall the prototype.");
            return;
        }
        if (WebView.getCurrentWebViewPackage() == null) {
            showFatal("Install or enable an up-to-date Android System WebView, then reopen Recap Page.");
            return;
        }
        root = new FrameLayout(this);
        setContentView(root);
        configureInsets(getWindow(), root);
        web = createWebView(false);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 33) {
            unregisterBack = Api33Back.register(this, this::requestBack);
        }
        lastRoute = local.policy.restoredRoute(state == null ? null : state.getString("route"));
        web.loadUrl(lastRoute);
    }

    private void showFatal(String message) {
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextSize(18);
        text.setPadding(32, 64, 32, 32);
        setContentView(text);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView(boolean popup) {
        WebView view = new WebView(this);
        view.setSaveEnabled(false);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(!popup);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSupportMultipleWindows(!popup);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setWebViewClient(new AssetClient(popup));
        view.setWebChromeClient(new Chrome(popup));
        view.setDownloadListener((url, userAgent, disposition, type, size) ->
                notice("This download was not saved. Use the app's text export controls."));
        return view;
    }

    @SuppressWarnings("deprecation")
    private void configureInsets(Window window, View content) {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(window.getDecorView().getSystemUiVisibility()
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                int left = insets.getSystemWindowInsetLeft();
                int top = insets.getSystemWindowInsetTop();
                int right = insets.getSystemWindowInsetRight();
                int bottom = insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                    left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                    top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                    right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                    bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                }
                view.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        content.requestApplyInsets();
    }

    private final class AssetClient extends WebViewClient {
        private final boolean popup;

        AssetClient(boolean popup) {
            this.popup = popup;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                return local.intercept(request.getUrl().toString(), request.getMethod(),
                        request.isForMainFrame(), popup);
            } catch (RuntimeException error) {
                return local.error(500, "Local Asset Error");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!request.isForMainFrame()) return true;
            if (popup ? local.policy.isPopupPage(url) : local.policy.isAppPage(url)) return false;
            if (popup && local.policy.isPopupPage(view.getUrl()) && local.policy.isMarvelIssue(url)) {
                boolean opened = openExternal(url);
                view.evaluateJavascript("window.dispatchEvent(new CustomEvent('recap:reader-result', {detail:"
                        + opened + "}));", null);
                return true;
            }
            if (popup && local.policy.isPopupPage(view.getUrl()) && local.policy.isOfficialReader(url)) {
                openReaderBrowser(url, view);
                return true;
            }
            boolean allowedExternal = !popup && request.hasGesture() && local.policy.isHttps(url);
            if (allowedExternal) {
                openExternal(url);
            } else {
                notice("This address is not supported in Recap Page.");
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (!popup) invalidatePage();
            if (!(popup ? local.policy.isPopupPage(url) : local.policy.isAppPage(url))) {
                view.stopLoading();
                notice("An unsupported page was blocked.");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!popup && local.policy.isAppPage(url) && local.policy.isAppPage(view.getUrl()) && port == null) {
                connect();
            }
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
            if (!popup && local.policy.isAppPage(url)) lastRoute = local.policy.restoredRoute(url);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (popup) {
                closePopup(view);
            } else {
                invalidatePage();
                root.removeView(view);
                view.destroy();
                web = null;
                showFatal("Android System WebView stopped. Close and reopen Recap Page. Saved reading progress is retained.");
            }
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        private final boolean popup;

        Chrome(boolean popup) {
            this.popup = popup;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public boolean onCreateWindow(WebView opener, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (popup || !isUserGesture || !local.policy.isAppPage(opener.getUrl())
                    || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
            WebView.HitTestResult hit = opener.getHitTestResult();
            if (hit != null && (hit.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE
                    || hit.getType() == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE)
                    && local.policy.isHttps(hit.getExtra())) {
                openExternal(hit.getExtra());
                return false;
            }
            WebView child = createWebView(true);
            Dialog dialog = new Dialog(MainActivity.this);
            LinearLayout panel = new LinearLayout(MainActivity.this);
            panel.setOrientation(LinearLayout.VERTICAL);
            Button close = new Button(MainActivity.this);
            close.setText(R.string.close);
            close.setOnClickListener(view -> dialog.dismiss());
            panel.addView(close, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            panel.addView(child, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            dialog.setContentView(panel);
            child.setTag(dialog);
            dialog.setOnDismissListener(ignored -> {
                popups.remove(dialog);
                popupViews.remove(child);
                panel.removeView(child);
                child.stopLoading();
                child.destroy();
            });
            popups.add(dialog);
            popupViews.add(child);
            dialog.show();
            Window window = dialog.getWindow();
            if (window != null) {
                window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
                configureInsets(window, panel);
            }
            // Completing the transport in this callback preserves the reader's synchronous popup.
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(child);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onCloseWindow(WebView window) {
            if (popup) closePopup(window);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (popup || !local.policy.isAppPage(view.getUrl()) || params.getMode() != FileChooserParams.MODE_OPEN
                    || !acceptsJson(params.getAcceptTypes()) || activePickerCode != -1
                    || pendingSave != null || writing) {
                callback.onReceiveValue(null);
                notice("A JSON restore file could not be selected. Finish any open file operation first.");
                return true;
            }
            cancelFileChooser();
            fileCallback = callback;
            fileGeneration = generation;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
            try {
                activePickerCode = pickerCode();
                startActivityForResult(intent, activePickerCode);
            } catch (ActivityNotFoundException | SecurityException error) {
                activePickerCode = -1;
                cancelFileChooser();
                notice("No document picker is available. Nothing was restored.");
            }
            return true;
        }
    }

    private static boolean acceptsJson(String[] types) {
        if (types == null || types.length == 0) return false;
        for (String type : types) {
            if ("application/json".equals(type) || ".json".equals(type)
                    || "application/json,.json".equals(type) || ".json,application/json".equals(type)) return true;
        }
        return false;
    }

    private int pickerCode() {
        int code = nextPickerCode;
        nextPickerCode = nextPickerCode == 64999 ? 1000 : nextPickerCode + 1;
        return code;
    }

    private void closePopup(WebView child) {
        Object tag = child.getTag();
        if (tag instanceof Dialog dialog) dialog.dismiss();
    }

    private boolean openExternal(String url) {
        boolean marvel = local.policy.isMarvelIssue(url);
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            if (marvel) intent.setPackage("com.marvel.unlimited");
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            notice(marvel ? "Marvel Unlimited could not be opened. Use Open in browser."
                    : "No browser could open this link. Install or enable a browser and try again.");
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    static ArrayList<ResolveInfo> readerBrowsers(PackageManager manager) {
        // No host means no domain preference; MATCH_ALL also prevents default-browser narrowing.
        Intent discovery = new Intent(Intent.ACTION_VIEW, Uri.parse("https:"));
        discovery.addCategory(Intent.CATEGORY_BROWSABLE);
        discovery.addCategory(Intent.CATEGORY_DEFAULT);
        LinkedHashMap<String, ResolveInfo> browsers = new LinkedHashMap<>();
        for (ResolveInfo match : manager.queryIntentActivities(discovery,
                PackageManager.MATCH_ALL | PackageManager.GET_RESOLVED_FILTER)) {
            if (match.filter != null && match.filter.countDataAuthorities() == 0
                    && match.filter.hasDataScheme("https") && match.activityInfo != null
                    && match.activityInfo.enabled && match.activityInfo.exported) {
                browsers.putIfAbsent(match.activityInfo.packageName, match);
            }
        }
        return new ArrayList<>(browsers.values());
    }

    private void openReaderBrowser(String url, WebView popup) {
        ArrayList<ResolveInfo> choices = readerBrowsers(getPackageManager());
        if (choices.isEmpty()) {
            notice("No browser is available. Install or enable a browser and try again.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        if (choices.size() == 1) {
            openReaderBrowser(intent, choices.get(0), popup);
            return;
        }
        CharSequence[] labels = new CharSequence[choices.size()];
        for (int index = 0; index < choices.size(); index++) {
            labels[index] = choices.get(index).loadLabel(getPackageManager());
        }
        Dialog chooser = new AlertDialog.Builder(this).setTitle("Open in browser")
                .setItems(labels, (dialog, selected) -> openReaderBrowser(intent, choices.get(selected), popup))
                .setNegativeButton(android.R.string.cancel, null).create();
        chooser.setOnDismissListener(ignored -> popups.remove(chooser));
        popups.add(chooser);
        chooser.show();
    }

    private void openReaderBrowser(Intent intent, ResolveInfo browser, WebView popup) {
        if (!popupViews.contains(popup) || !local.policy.isPopupPage(popup.getUrl())) return;
        try {
            intent.setPackage(browser.activityInfo.packageName);
            startActivity(intent);
            closePopup(popup);
        } catch (ActivityNotFoundException | SecurityException error) {
            notice("The selected browser could not open this link. Try another browser.");
        }
    }

    private void connect() {
        final int page = generation;
        WebMessagePort[] channel = web.createWebMessageChannel();
        port = channel[0];
        WebMessagePort connectedPort = port;
        connectedPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override
            public void onMessage(WebMessagePort source, WebMessage message) {
                receive(connectedPort, page, message);
            }
        }, handler);
        try {
            web.postWebMessage(new WebMessage("recap:connect:v1",
                    new WebMessagePort[] { channel[1] }), Uri.parse(local.origin));
        } catch (RuntimeException error) {
            channel[1].close();
            invalidatePage();
            notice("Android file integration is unavailable. Update Android System WebView and reopen the app.");
        }
    }

    private void receive(WebMessagePort source, int page, WebMessage message) {
        String raw = message.getData();
        if (message.getPorts() != null) {
            for (WebMessagePort unwanted : message.getPorts()) unwanted.close();
            if (message.getPorts().length != 0) {
                notice("An unsupported native message was rejected.");
                return;
            }
        }
        if (!NavigationPolicy.boundedText(raw)) {
            // The adapter puts its identity before the payload, so oversize text can fail without parsing it.
            String id = NavigationPolicy.requestIdFromPrefix(raw);
            if (id != null) {
                saveResult(source, id, "failed", "The native message exceeds the defensive text transport limit.");
            } else {
                notice("The native message exceeds the defensive text transport limit. Nothing was saved.");
            }
            return;
        }
        String id = "";
        try {
            JSONObject request = new JSONObject(raw);
            id = request.getString("id");
            if (!NavigationPolicy.validRequestId(id) || request.getInt("v") != 1) {
                throw new JSONException("Invalid message identity");
            }
            String kind = request.getString("kind");
            if (source != port || page != generation || destroyed) {
                saveResult(source, id, "failed", "The page changed. Start the export again.");
                return;
            }
            if (kind.equals("back-result")) {
                if (id.equals(backId) && request.get("handled") instanceof Boolean) {
                    boolean handled = request.getBoolean("handled");
                    clearBack();
                    if (!handled) nativeBack();
                }
                return;
            }
            if (!kind.equals("save")) throw new JSONException("Unsupported message kind");
            if (seenRequests.size() >= 4096 || !seenRequests.add(id)) {
                if (pendingSave != null && pendingSave.id.equals(id)) {
                    pendingSave.cancelled = true;
                    finishSave(pendingSave, "failed", "The export was cancelled after a duplicate request.");
                    return;
                }
                saveResult(source, id, "failed", "Duplicate or exhausted request identity. Reopen the app before retrying.");
                return;
            }
            if (pendingSave != null || activePickerCode != -1 || writing) {
                saveResult(source, id, "failed", "Finish the current file operation before starting another.");
                return;
            }
            String filename = request.getString("filename");
            String type = request.getString("type");
            String text = request.getString("text");
            if (!NavigationPolicy.validSaveName(filename, type) || !NavigationPolicy.boundedText(text)) {
                saveResult(source, id, "failed", "The text export name, type or size is not supported.");
                return;
            }
            pendingSave = new PendingSave(id, source, page, NavigationPolicy.utf8Bytes(text));
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(type);
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
            try {
                activePickerCode = pickerCode();
                startActivityForResult(intent, activePickerCode);
            } catch (ActivityNotFoundException | SecurityException error) {
                activePickerCode = -1;
                finishSave(pendingSave, "failed", "No document picker is available. Nothing was saved.");
            }
        } catch (JSONException | RuntimeException error) {
            if (pendingSave != null && pendingSave.id.equals(id)) {
                activePickerCode = -1;
                pendingSave.cancelled = true;
                finishSave(pendingSave, "failed", "The native export request could not be completed.");
                return;
            }
            if (NavigationPolicy.validRequestId(id)) {
                saveResult(source, id, "failed", "The native export request was invalid.");
            } else {
                notice("An invalid native message was rejected. Nothing was saved.");
            }
        }
    }

    private void saveResult(WebMessagePort destination, String id, String status, String message) {
        try {
            JSONObject reply = new JSONObject();
            reply.put("v", 1).put("kind", "save-result").put("id", id)
                    .put("status", status).put("message", message);
            destination.postMessage(new WebMessage(reply.toString()));
        } catch (JSONException | RuntimeException ignored) {
            if (!destroyed) notice("The export page is no longer available. Check the selected file before retrying.");
        }
    }

    private void finishSave(PendingSave request, String status, String message) {
        if (request == null) return;
        request.bytes = null;
        if (request == pendingSave) pendingSave = null;
        saveResult(request.port, request.id, status, message);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != activePickerCode || activePickerCode == -1) {
            notice("The original file request is no longer active. Nothing was confirmed saved or restored.");
            return;
        }
        activePickerCode = -1;
        Uri uri = data == null ? null : data.getData();
        boolean contentUri = uri != null && "content".equals(uri.getScheme())
                && uri.getAuthority() != null && data.getClipData() == null;
        if (fileCallback != null) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            boolean valid = resultCode == RESULT_OK && contentUri && fileGeneration == generation && !destroyed;
            callback.onReceiveValue(valid ? new Uri[] { uri } : null);
            if (resultCode == RESULT_OK && !valid) notice("The selected restore file was rejected.");
            return;
        }
        PendingSave request = pendingSave;
        if (request == null || request.generation != generation || request.cancelled || destroyed) {
            if (request != null) finishSave(request, "cancelled", "The original export page is no longer active.");
            notice("The original export request is no longer active. Nothing was saved.");
            return;
        }
        if (resultCode != RESULT_OK) {
            finishSave(request, "cancelled", "Save cancelled. Nothing was saved.");
            return;
        }
        if (!contentUri) {
            finishSave(request, "failed", "The document picker did not return one content document.");
            return;
        }
        writing = true;
        byte[] bytes = request.bytes;
        request.bytes = null;
        writer.execute(() -> {
            String status = "saved";
            String message = "File saved.";
            try {
                if (request.cancelled) throw new IOException("Page changed");
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("No output stream");
                    for (int offset = 0; offset < bytes.length; offset += 65536) {
                        if (request.cancelled) throw new IOException("Page changed");
                        output.write(bytes, offset, Math.min(65536, bytes.length - offset));
                    }
                    output.flush();
                }
                if (request.cancelled) throw new IOException("Page changed");
            } catch (IOException | RuntimeException error) {
                status = "failed";
                message = "The file could not be fully saved. The selected document may be incomplete.";
            }
            String finalStatus = status;
            String finalMessage = message;
            handler.post(() -> {
                writing = false;
                if (!request.cancelled && request.generation == generation && !destroyed) {
                    finishSave(request, finalStatus, finalMessage);
                }
            });
        });
    }

    private void cancelFileChooser() {
        if (fileCallback != null) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            callback.onReceiveValue(null);
        }
    }

    private void invalidatePage() {
        clearBack();
        cancelFileChooser();
        if (pendingSave != null) {
            pendingSave.cancelled = true;
            finishSave(pendingSave, "cancelled", "The export page changed. Any selected file may be incomplete.");
        }
        if (port != null) {
            port.close();
            port = null;
        }
        generation++;
        seenRequests.clear();
    }

    private void requestBack() {
        if (backId != null) return;
        if (web == null || port == null) {
            nativeBack();
            return;
        }
        backId = "native-back:" + (++backSequence);
        try {
            JSONObject request = new JSONObject();
            request.put("v", 1).put("kind", "back").put("id", backId);
            port.postMessage(new WebMessage(request.toString()));
            backTimeout = () -> {
                clearBack();
                notice("The page did not respond to Back. Returning without changing saved progress.");
                nativeBack();
            };
            handler.postDelayed(backTimeout, 750);
        } catch (JSONException | RuntimeException error) {
            clearBack();
            nativeBack();
        }
    }

    private void clearBack() {
        if (backTimeout != null) handler.removeCallbacks(backTimeout);
        backTimeout = null;
        backId = null;
    }

    private void nativeBack() {
        if (web != null && web.canGoBack()) web.goBack();
        else finish();
    }

    // Android 13+ registers OnBackInvokedDispatcher above; this callback only supports older releases.
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        requestBack();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        getTheme().applyStyle(R.style.AppTheme, true);
        if (web != null) web.getSettings().setTextZoom(Math.round(configuration.fontScale * 100));
        for (WebView popup : popupViews) {
            popup.getSettings().setTextZoom(Math.round(configuration.fontScale * 100));
            popup.requestApplyInsets();
        }
        if (root != null) root.requestApplyInsets();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        if (local != null) state.putString("route", local.policy.restoredRoute(lastRoute));
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        invalidatePage();
        for (Dialog popup : new ArrayList<>(popups)) popup.dismiss();
        if (unregisterBack != null) unregisterBack.run();
        if (web != null) {
            root.removeView(web);
            web.stopLoading();
            web.destroy();
            web = null;
        }
        writer.shutdown();
        super.onDestroy();
    }

    private void notice(String text) {
        if (!destroyed) Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }
}
