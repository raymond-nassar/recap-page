package io.github.raymondnassar.recappage.prototype;

import static androidx.test.espresso.intent.Intents.intended;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasCategories;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasData;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasType;
import static org.hamcrest.Matchers.allOf;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inspector.WindowInspector;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.intent.Intents;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TestWatcher;
import org.junit.runner.Description;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

@RunWith(AndroidJUnit4.class)
@TargetApi(36)
public final class NativeIntegrationTest {
    private static final String ORIGIN = "http://127.0.0.1:8787";
    private static final String LIST_ID = "native-fixture";
    private static final String SENTINEL_KEY = "recap.native.restart-sentinel";
    private static final String SENTINEL = "native-fixture-v1";
    private static final long WAIT_MS = 15000;
    private static final String SAVE_MARKER = "NATIVE_SAVE_COMPLETION";
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final Map<String, String> originalSettings = new LinkedHashMap<>();
    private final JSONObject measurements = new JSONObject();
    private ActivityScenario<MainActivity> scenario;
    private MainActivity activity;
    private WebView web;
    private UiDevice device;
    private FixtureMetadataServer server;
    private File evidence;
    private String method;
    private boolean intentsInitialized;
    private boolean restartProbe;

    @Rule
    public final TestWatcher outcome = new TestWatcher() {
        @Override
        protected void starting(Description description) {
            method = description.getMethodName();
        }

        @Override
        protected void failed(Throwable error, Description description) {
            if (evidence == null) return;
            try {
                File finalImage = new File(evidence, evidenceName("final.png"));
                File failureImage = new File(evidence, evidenceName("failure.png"));
                if (finalImage.isFile()) {
                    Files.copy(finalImage.toPath(), failureImage.toPath(), StandardCopyOption.REPLACE_EXISTING);
                } else if (device != null) {
                    device.takeScreenshot(failureImage);
                }
                writeJson(evidenceName("failure.json"), new JSONObject()
                        .put("method", method).put("synthetic", true).put("failure", error.toString()));
            } catch (Exception captureError) {
                error.addSuppressed(captureError);
            }
        }
    };

    @Before
    public void launch() throws Exception {
        assertEquals("This bounded suite requires the full API-36 phone image", 36, Build.VERSION.SDK_INT);
        Context target = instrumentation.getTargetContext();
        evidence = new File(target.getExternalFilesDir(null), "native-test-evidence");
        assertTrue("Synthetic evidence directory is writable", evidence.isDirectory() || evidence.mkdirs());
        device = UiDevice.getInstance(instrumentation);
        restartProbe = "true".equals(InstrumentationRegistry.getArguments().getString("restartProbe"));
        for (String setting : new String[] {
                "font_scale", "accelerometer_rotation", "user_rotation", "show_ime_with_hard_keyboard" }) {
            originalSettings.put(setting, device.executeShellCommand("settings get system " + setting).trim());
        }
        device.executeShellCommand("settings put system font_scale 1.0");
        device.executeShellCommand("settings put system show_ime_with_hard_keyboard 1");
        device.setOrientationNatural();
        Intents.init();
        intentsInitialized = true;
        // No browser is allowed to leave the test, including on a failed launcher assertion.
        intending(hasAction(Intent.ACTION_VIEW))
                .respondWith(new Instrumentation.ActivityResult(Activity.RESULT_OK, null));
        scenario = ActivityScenario.launch(MainActivity.class);
        findMainWebView();
        awaitPage();
        assertEquals("Locale must be the planned en-US fixture", "en-US",
                target.getResources().getConfiguration().getLocales().get(0).toLanguageTag());
        waitFor("Normal system font scale", WAIT_MS, () -> onMain(() ->
                Math.abs(activity.getResources().getConfiguration().fontScale - 1f) < 0.01f));
    }

    @After
    public void cleanUp() throws Exception {
        try {
            if (device != null && evidence != null) {
                screenshot("final");
                measurements.put("method", method).put("synthetic", true)
                        .put("restartProbe", restartProbe).put("sdk", Build.VERSION.SDK_INT)
                        .put("buildFingerprint", Build.FINGERPRINT);
                onMain(() -> {
                    if (WebView.getCurrentWebViewPackage() != null) {
                        measurements.put("webViewPackage", WebView.getCurrentWebViewPackage().packageName);
                        measurements.put("webViewVersion", WebView.getCurrentWebViewPackage().versionName);
                    }
                    return null;
                });
                writeJson(evidenceName("measurements.json"), measurements);
            }
        } finally {
            try {
                try {
                    if (scenario != null) scenario.close();
                } finally {
                    if (server != null) server.close();
                }
            } finally {
                try {
                    if (intentsInitialized) Intents.release();
                } finally {
                    if (device != null) {
                        device.unfreezeRotation();
                        for (Map.Entry<String, String> setting : originalSettings.entrySet()) {
                            String value = setting.getValue();
                            if ("null".equals(value)) {
                                device.executeShellCommand("settings delete system " + setting.getKey());
                            } else {
                                assertTrue("Only numeric emulator settings are restored",
                                        value.matches("-?[0-9]+(?:\\.[0-9]+)?"));
                                device.executeShellCommand("settings put system " + setting.getKey() + " " + value);
                            }
                        }
                    }
                }
            }
        }
    }

    @Test
    public void startupAndPersistence() throws Exception {
        if (!restartProbe) seed(false);
        assertEquals("Bundled assets keep the canonical storage origin", ORIGIN, text(web, "location.origin"));
        assertEquals("Persistent marker from the immediately preceding seed invocation",
                SENTINEL, text(web, "localStorage.getItem(" + quote(SENTINEL_KEY) + ")"));
        assertFixture();
        assertEquals("The page is served without a service worker", "null",
                text(web, "String(navigator.serviceWorker.controller)"));
        assertTrue("Bundled catalog remains readable with external networking disabled",
                ((Number) asyncJs(web,
                        "const r=await fetch('/data/catalog.json',{cache:'no-store'});"
                        + "if(!r.ok)throw Error('catalog '+r.status);return (await r.json()).lists.length;")).intValue() > 0);
        route("read");
        assertReadingProgress();
        String before = stateSummary();
        reload();
        assertFixture();
        assertReadingProgress();
        assertEquals("Reload must not change synthetic reading state", before, stateSummary());
        measurements.put("startupMode", restartProbe ? "after-host-force-stop" : "seed")
                .put("readCount", 1).put("listCount", 1).put("progressPercent", 50);
    }

    @Test
    public void systemPickerSaveAndCancel() throws Exception {
        seed(false);
        route("data");
        String before = stateSummary();
        String savedName = "recap-native-system-" + System.currentTimeMillis() + ".json";
        tap(web, "#btn-export-json");
        String pickerPackage = awaitDocumentsUi();
        selectDownloads(pickerPackage);
        pickerFilename().setText(savedName);
        screenshot("documentsui-save");
        UiObject2 save = device.wait(Until.findObject(By.res("android:id/button1")), WAIT_MS);
        if (save == null) save = device.wait(Until.findObject(By.text(Pattern.compile("(?i)^save$"))), 3000);
        assertNotNull("Real DocumentsUI Save control", save);
        save.click();
        waitFor("Real document save completes", WAIT_MS, () -> reportContains("File saved to the location"));
        String path = "/sdcard/Download/" + savedName;
        String bytes = device.executeShellCommand("cat " + path);
        JSONObject backup = new JSONObject(bytes);
        assertEquals("Real DocumentsUI saved one list", 1, backup.getJSONArray("listOrder").length());
        assertEquals("Real DocumentsUI saved one read issue", 1, backup.getJSONObject("read").length());
        assertEquals("Real DocumentsUI saved the fabricated identity",
                LIST_ID, backup.getJSONArray("listOrder").getString(0));
        assertTrue("Real output is nonempty UTF-8 JSON", bytes.getBytes(StandardCharsets.UTF_8).length > 100);
        assertEquals("Saving does not alter reading state", before, stateSummary());

        String cancelledName = "recap-native-cancel-" + System.currentTimeMillis() + ".json";
        tap(web, "#btn-export-json");
        awaitDocumentsUi();
        pickerFilename().setText(cancelledName);
        for (int press = 0; press < 3 && isDocumentsUi(); press++) {
            device.pressBack();
            device.wait(Until.gone(By.pkg(pickerPackage).depth(0)), 1000);
        }
        waitFor("Real DocumentsUI cancellation is acknowledged", WAIT_MS, () -> reportContains("Download cancelled"));
        assertEquals("Cancelled export leaves reading data unchanged", before, stateSummary());
        assertEquals("Cancellation must not create a file", "ABSENT",
                device.executeShellCommand("if test -e /sdcard/Download/" + cancelledName
                        + "; then echo PRESENT; else echo ABSENT; fi").trim());
        assertEquals("Both real picker launches are counted", 2, countIntents(Intent.ACTION_CREATE_DOCUMENT));
        intended(allOf(hasAction(Intent.ACTION_CREATE_DOCUMENT), hasCategories(Collections.singleton(Intent.CATEGORY_OPENABLE)),
                hasType("application/json"), hasExtra(Intent.EXTRA_LOCAL_ONLY, true)),
                androidx.test.espresso.intent.VerificationModes.times(2));
        measurements.put("realDocumentsUi", pickerPackage).put("realPickerSaves", 1)
                .put("realPickerCancellations", 1).put("savedBytes", bytes.getBytes(StandardCharsets.UTF_8).length);
        device.executeShellCommand("rm -f " + path);
    }

    @Test
    public void providerRoundTripAndWriteFailure() throws Exception {
        seed(false);
        provider("reset");
        route("data");
        String before = stateSummary();
        String backup = (String) asyncJs(web,
                "const m=await import('/js/lib/model.js');"
                + "const b=m.exportBackup(JSON.parse(localStorage.getItem('mrt.state.v2')));"
                + "b.exportedAt='2026-09-26T00:00:00.000Z';return JSON.stringify(b,null,2)+'\\n';");
        stubDocument(Intent.ACTION_CREATE_DOCUMENT, FixtureDocumentProvider.SAVED);
        startNativeSave(backup, "native-fixture-backup.json");
        // The negative control changes only the native connect marker. An unready bridge returns
        // false without opening a picker, so the aimed assertion must precede picker assertions.
        waitFor(SAVE_MARKER + ": native download did not complete", WAIT_MS,
                () -> truth(web, "window.__nativeSave && window.__nativeSave.done"));
        assertTrue(SAVE_MARKER + ": native bridge did not acknowledge a completed save: "
                        + text(web, "JSON.stringify(window.__nativeSave)") + " / " + reportText(),
                truth(web, "window.__nativeSave.saved === true"));
        waitFor("Provider stream was closed", WAIT_MS, () -> provider("stats").getInt("closedWrites") == 1);
        assertArrayEquals("Native provider output must preserve every UTF-8 byte",
                backup.getBytes(StandardCharsets.UTF_8), provider("bytes").getByteArray("bytes"));
        assertEquals("Exactly one native write", 1, provider("stats").getInt("writes"));
        assertEquals("Export left reading state intact", before, stateSummary());

        asyncJs(web, "const m=await import('/js/lib/model.js');"
                + "localStorage.setItem('mrt.state.v2',JSON.stringify(m.createEmptyState()));return true;");
        reload();
        route("data");
        assertEquals("Restore starts from an actually empty list set", 0,
                number(web, "JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length"));
        stubDocument(Intent.ACTION_OPEN_DOCUMENT, FixtureDocumentProvider.SAVED);
        tap(web, "#restore-file");
        waitFor("Real WebView file callback restores provider bytes", WAIT_MS,
                () -> truth(web, "document.querySelector('#restore-report').textContent.includes('Restored.')"));
        assertFixture();
        assertEquals("The restored fixture exactly matches its saved state", before, stateSummary());
        assertTrue("Restore reads through ContentResolver", provider("stats").getInt("reads") >= 1);
        intended(allOf(hasAction(Intent.ACTION_OPEN_DOCUMENT), hasCategories(Collections.singleton(Intent.CATEGORY_OPENABLE)),
                hasType("application/json"), hasExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)));
        route("read");
        assertReadingProgress();
        route("data");

        stubDocument(Intent.ACTION_CREATE_DOCUMENT, FixtureDocumentProvider.REFUSED);
        startNativeSave(backup, "native-refused-backup.json");
        waitFor("Provider refusal reaches the live JavaScript bridge", WAIT_MS,
                () -> truth(web, "window.__nativeSave && window.__nativeSave.done"));
        assertFalse("A provider write refusal must not be reported saved",
                truth(web, "window.__nativeSave.saved === true"));
        assertTrue("The failure is visible rather than a success-shaped callback",
                reportContains("File was not confirmed saved"));
        assertEquals("The failing URI was really opened for writing", 1,
                provider("stats").getInt("refusedWrites"));
        assertArrayEquals("Refused write does not damage the successful document",
                backup.getBytes(StandardCharsets.UTF_8), provider("bytes").getByteArray("bytes"));
        assertEquals("Provider failure does not alter restored data", before, stateSummary());
        assertEquals("Two save requests reached Android", 2, countIntents(Intent.ACTION_CREATE_DOCUMENT));
        assertEquals("One restore request reached Android", 1, countIntents(Intent.ACTION_OPEN_DOCUMENT));
        measurements.put("nativeSaveMarker", SAVE_MARKER).put("exactUtf8Bytes", backup.getBytes(StandardCharsets.UTF_8).length)
                .put("providerSaves", 1).put("providerRestores", 1).put("providerRefusals", 1);
    }

    @Test
    public void readerPopupAndExternalIntent() throws Exception {
        server = new FixtureMetadataServer();
        seed(true);
        route("read");
        assertReadingProgress();
        Object nativeEndpoint = nativePort();
        assertNotNull("The main document has its native endpoint", nativeEndpoint);
        tap(web, "#btn-hero-read");
        waitFor("A real user gesture creates one child WebView", 5000, () -> popupViews().size() == 1);
        WebView popup = popupViews().get(0);
        waitFor("The real launcher executes with its opener severed", 4000,
                () -> truth(popup, "location.pathname === '/open.html' && window.opener === null"
                        + " && document.querySelector('#p')?.textContent.includes('Looking up')"));
        assertTrue("Unknown digital ID is resolved in the popup, not before opening it",
                server.lookupStarted.await(1, TimeUnit.SECONDS));
        assertEquals("Exactly one synthetic lookup", 1, server.issueRequests.get());
        assertEquals("No outgoing intent precedes the completed lookup", 0, countIntents(Intent.ACTION_VIEW));
        assertSame("Creating the child must not replace the main native endpoint", nativeEndpoint, nativePort());
        assertTrue("Launcher never loads the Android entry or bridge module",
                truth(popup, "[...document.scripts].every(s => !s.src.includes('/android/'))"
                        + " && !document.querySelector('#android-report')"));
        assertTrue("Popup cannot fetch the native bridge from the local asset boundary",
                (Boolean) asyncJs(popup, "const r=await fetch('/android/bridge.js');return r.status===403;"));
        screenshot("isolated-popup");
        server.releaseLookup.countDown();
        waitFor("Official reader navigation becomes an intercepted ACTION_VIEW", WAIT_MS,
                () -> countIntents(Intent.ACTION_VIEW) == 1);
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasCategories(Collections.singleton(Intent.CATEGORY_BROWSABLE)),
                hasData("https://read.marvel.com/#/book/900000099")));
        waitFor("A successful handoff closes the native popup", WAIT_MS, () -> popupViews().isEmpty());
        assertSame("Main native endpoint survives the child lifecycle", nativeEndpoint, nativePort());
        assertFixture();
        assertNotNull("Main WebView remains attached", onMain(() -> web.getParent()));
        assertTrue("Loopback fixture server completed cleanly", server.failure == null);
        measurements.put("popupCount", 1).put("syntheticMetadataLookups", server.issueRequests.get())
                .put("outgoingViewIntents", 1).put("externalBrowserRendered", false)
                .put("destination", "https://read.marvel.com/#/book/900000099")
                .put("popupOpenerNull", true).put("nativeEndpointUnchanged", true)
                .put("popupBridgeAssetStatus", 403);
    }

    @Test
    public void backAndRecreation() throws Exception {
        seed(false);
        route("read");
        String readingRoute = text(web, "location.hash");
        String before = stateSummary();
        route("data");
        String dataRoute = text(web, "location.hash");
        tap(web, "#btn-wipe");
        waitFor("Destructive HTML dialog is actually open", WAIT_MS,
                () -> truth(web, "!!document.querySelector('dialog[open]')"));
        device.pressBack();
        waitFor("Android Back cancels the HTML dialog", WAIT_MS,
                () -> truth(web, "!document.querySelector('dialog[open]')"));
        assertEquals("Dialog cancellation does not navigate", dataRoute, text(web, "location.hash"));
        assertEquals("Dialog cancellation preserves progress", before, stateSummary());

        assertTrue("Phone layout exercises the collapsible navigation", number(web, "innerWidth") <= 880);
        tap(web, "#btn-rail-toggle");
        waitFor("Navigation opened", WAIT_MS, () -> truth(web,
                "document.querySelector('#btn-rail-toggle').getAttribute('aria-expanded') === 'true'"));
        device.pressBack();
        waitFor("Android Back closes navigation", WAIT_MS, () -> truth(web,
                "document.querySelector('#btn-rail-toggle').getAttribute('aria-expanded') === 'false'"));
        assertEquals("Navigation dismissal does not consume history", dataRoute, text(web, "location.hash"));
        device.pressBack();
        waitFor("Next Android Back reaches the prior WebView history entry", WAIT_MS,
                () -> readingRoute.equals(text(web, "location.hash")));
        assertFixture();

        route("data");
        String recreationRoute = text(web, "location.hash");
        MainActivity oldActivity = activity;
        WebView oldWeb = web;
        scenario.recreate();
        findMainWebView();
        awaitPage();
        assertNotSame("ActivityScenario.recreate makes a new Activity", oldActivity, activity);
        assertNotSame("Recreation makes a new WebView", oldWeb, web);
        assertEquals("Validated local route survives Activity recreation", recreationRoute, text(web, "location.hash"));
        assertEquals("Reading state survives Activity recreation", before, stateSummary());
        assertFixture();
        route("read");
        assertReadingProgress();
        measurements.put("nativeBackPresses", 3).put("activityRecreations", 1)
                .put("processDeathExercisedHere", false).put("routeRestored", recreationRoute);
    }

    @Test
    public void fontRotationAndKeyboard() throws Exception {
        seed(false);
        route("read");
        measureLayout("normal");
        assertEquals("Normal system font maps to WebView textZoom", 100,
                (int) onMain(() -> web.getSettings().getTextZoom()));
        device.executeShellCommand("settings put system font_scale 1.3");
        waitFor("System font change reaches the live Activity and WebView", WAIT_MS, () -> onMain(() -> {
            float scale = activity.getResources().getConfiguration().fontScale;
            return scale >= 1.3f && web.getSettings().getTextZoom() == Math.round(scale * 100);
        }));
        measureLayout("font130");
        screenshot("font130-portrait");
        device.setOrientationLeft();
        waitFor("The device and Activity really rotate to landscape", WAIT_MS, () -> onMain(() ->
                device.getDisplayWidth() > device.getDisplayHeight()
                        && activity.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE));
        waitFor("WebView layout follows the real landscape rotation", WAIT_MS,
                () -> truth(web, "innerWidth > innerHeight"));
        measureLayout("font130-landscape");
        assertFixture();
        screenshot("font130-landscape");

        device.setOrientationNatural();
        waitFor("Device returns to portrait before keyboard geometry check", WAIT_MS,
                () -> device.getDisplayHeight() > device.getDisplayWidth()
                        && truth(web, "innerHeight > innerWidth"));
        route("add-manual");
        tap(web, "#manual-title");
        waitFor("Real Android IME becomes visible", WAIT_MS, () -> onMain(() -> {
            WindowInsets insets = web.getRootWindowInsets();
            return insets != null && insets.isVisible(WindowInsets.Type.ime())
                    && insets.getInsets(WindowInsets.Type.ime()).bottom > 0;
        }));
        device.pressKeyCode(KeyEvent.KEYCODE_N);
        waitFor("The real focused input accepts a key", WAIT_MS,
                () -> truth(web, "document.activeElement === document.querySelector('#manual-title')"
                        + " && document.querySelector('#manual-title').value.length > 0"));
        evaluate(web, "document.querySelector('#manual-title').scrollIntoView({block:'center'})");
        waitFor("Input fits above IME and below bars", WAIT_MS, this::inputFitsNativeInsets);
        measureLayout("font130-ime");
        screenshot("font130-ime");
        JSONObject geometry = nativeGeometry();
        measurements.put("ime", geometry).put("requestedFontScale", 1.3)
                .put("observedFontScale", onMain(() -> activity.getResources().getConfiguration().fontScale))
                .put("observedTextZoom", onMain(() -> web.getSettings().getTextZoom()))
                .put("rotations", 2);
        device.pressBack();
        waitFor("Back dismisses the real IME", WAIT_MS,
                () -> onMain(() -> !web.getRootWindowInsets().isVisible(WindowInsets.Type.ime())));
        assertFixture();
    }

    private void seed(boolean unknownDigitalId) throws Exception {
        String base = server == null ? "http://127.0.0.1:9/v1" : server.baseUrl();
        asyncJs(web, "const m=await import('/js/lib/model.js');"
                + "localStorage.clear();sessionStorage.clear();"
                + "localStorage.setItem('mrt.settings',JSON.stringify({covers:false,theme:'dark',"
                + "hideDescriptions:true,apiBase:" + quote(base) + "}));"
                + "let s=m.createList(m.createEmptyState(),{id:'native-fixture',name:'Native instrumentation fixture'});"
                + "s=m.addIssuesToList(s,'native-fixture',["
                + "{issueId:900000001,title:'Native fixture #1',number:1,seriesId:900000010,"
                + "seriesName:'Synthetic only',digitalId:900000011,hydrated:true},"
                + "{issueId:900000002,title:'Native fixture #2',number:2,seriesId:900000010,"
                + "seriesName:'Synthetic only',digitalId:" + (unknownDigitalId ? "null" : "900000012")
                + ",hydrated:true}]).state;"
                + "s=m.markRead(s,900000001,true,1750000000000);"
                + "s.notes['900000001']='Synthetic only: caf\\u00e9 \\ud83d\\udcda\\nsecond line';"
                + "localStorage.setItem('mrt.state.v2',JSON.stringify(s));"
                + "localStorage.setItem(" + quote(SENTINEL_KEY) + "," + quote(SENTINEL) + ");"
                + "history.replaceState(null,'','/#/read/native-fixture');return true;");
        reload();
        assertFixture();
    }

    private void assertFixture() throws Exception {
        JSONObject summary = new JSONObject(stateSummary());
        assertEquals("Exactly one synthetic reading list", 1, summary.getInt("lists"));
        assertEquals("Exactly two synthetic issues", 2, summary.getInt("issues"));
        assertEquals("Exactly one read issue", 1, summary.getInt("read"));
        assertEquals("The first fabricated issue remains read", 1750000000000L, summary.getLong("readAt"));
        assertEquals("The active list is the fabricated list", LIST_ID, summary.getString("active"));
        assertEquals("The synthetic list name survives", "Native instrumentation fixture", summary.getString("name"));
        assertEquals("The list retains both positions", "[900000001,900000002]", summary.getJSONArray("ids").toString());
        assertEquals("The multi-byte fixture note survives", "Synthetic only: caf\u00e9 \ud83d\udcda\nsecond line",
                summary.getString("note"));
    }

    private String stateSummary() throws Exception {
        return text(web, "(() => {const s=JSON.parse(localStorage.getItem('mrt.state.v2'));"
                + "const l=s.lists['native-fixture'];return JSON.stringify({"
                + "lists:s.listOrder.length,issues:Object.keys(s.issues).length,read:Object.keys(s.read).length,"
                + "readAt:s.read['900000001'],active:s.active,name:l?.name,ids:l?.itemIds,"
                + "note:s.notes['900000001']});})()");
    }

    private void assertReadingProgress() throws Exception {
        waitFor("The real reading view displays its next issue", WAIT_MS,
                () -> truth(web, "!document.querySelector('#view-read').hidden"
                        + " && document.querySelector('#hero-title').textContent.includes('#2')"));
        assertEquals("Visible progress is numerically 50 percent", "50%", text(web,
                "document.querySelector('#ring-label').textContent.trim()"));
    }

    private void findMainWebView() {
        scenario.onActivity(current -> {
            activity = current;
            List<WebView> found = new ArrayList<>();
            collectWebViews(current.getWindow().getDecorView(), found);
            assertEquals("Activity owns exactly one main WebView", 1, found.size());
            web = found.get(0);
        });
    }

    private static void collectWebViews(View root, List<WebView> found) {
        if (root instanceof WebView view) {
            if (!found.contains(view)) found.add(view);
        } else if (root instanceof ViewGroup group) {
            for (int i = 0; i < group.getChildCount(); i++) collectWebViews(group.getChildAt(i), found);
        }
    }

    private List<WebView> popupViews() throws Exception {
        return onMain(() -> {
            List<WebView> found = new ArrayList<>();
            for (View root : WindowInspector.getGlobalWindowViews()) collectWebViews(root, found);
            found.remove(web);
            return found;
        });
    }

    private Object nativePort() throws Exception {
        // Observe endpoint ownership only. Clients, callbacks and bridge objects stay untouched.
        return onMain(() -> {
            Field field = MainActivity.class.getDeclaredField("port");
            field.setAccessible(true);
            return field.get(activity);
        });
    }

    private void awaitPage() throws Exception {
        waitFor("Bundled document and app entry load", WAIT_MS, () -> truth(web,
                "document.readyState==='complete' && !!document.querySelector('#android-report')"
                        + " && !!document.querySelector('main')"));
        instrumentation.waitForIdleSync();
    }

    private void reload() throws Exception {
        evaluate(web, "window.__nativeOldDocument=true");
        onMain(() -> { web.reload(); return null; });
        waitFor("A new document replaces the seeded document", WAIT_MS,
                () -> truth(web, "window.__nativeOldDocument !== true"));
        awaitPage();
    }

    private void route(String name) throws Exception {
        evaluate(web, "location.hash=" + quote("#/" + name));
        waitFor("Visible route " + name, WAIT_MS, () -> truth(web,
                "location.hash.startsWith(" + quote("#/" + name) + ")"
                        + " && document.querySelector(" + quote("#view-" + name) + ")?.hidden===false"));
    }

    private Object evaluate(WebView target, String expression) throws Exception {
        CountDownLatch callback = new CountDownLatch(1);
        AtomicReference<String> raw = new AtomicReference<>();
        onMain(() -> {
            target.evaluateJavascript("(() => {try {return {ok:true,value:(" + expression
                    + ")};} catch(e) {return {ok:false,error:String(e)};}})()", value -> {
                        raw.set(value);
                        callback.countDown();
                    });
            return null;
        });
        assertTrue("WebView JavaScript callback within five seconds", callback.await(5, TimeUnit.SECONDS));
        assertNotNull("WebView returned a JavaScript value", raw.get());
        if ("null".equals(raw.get())) return null;
        JSONObject result = new JSONObject(raw.get());
        assertTrue("JavaScript evaluation: " + result.optString("error"), result.getBoolean("ok"));
        Object value = result.opt("value");
        return value == JSONObject.NULL ? null : value;
    }

    private boolean truth(WebView target, String expression) throws Exception {
        return Boolean.TRUE.equals(evaluate(target, expression));
    }

    private String text(WebView target, String expression) throws Exception {
        Object value = evaluate(target, expression);
        return value == null ? "null" : String.valueOf(value);
    }

    private int number(WebView target, String expression) throws Exception {
        Object value = evaluate(target, expression);
        assertTrue("Expected a numeric DOM measurement", value instanceof Number);
        return ((Number) value).intValue();
    }

    private Object asyncJs(WebView target, String body) throws Exception {
        evaluate(target, "(() => {window.__nativeAsync={done:false};"
                + "(async()=>{" + body + "})().then(value=>window.__nativeAsync={done:true,value},"
                + "error=>window.__nativeAsync={done:true,error:String(error)});return true;})()");
        waitFor("Asynchronous fixture code completes", WAIT_MS,
                () -> truth(target, "window.__nativeAsync && window.__nativeAsync.done"));
        assertFalse("Asynchronous fixture code: " + text(target, "window.__nativeAsync.error"),
                truth(target, "!!window.__nativeAsync.error"));
        return evaluate(target, "window.__nativeAsync.value");
    }

    private void tap(WebView target, String selector) throws Exception {
        waitFor("Touchable DOM control " + selector, WAIT_MS, () -> truth(target,
                "(() => {const e=document.querySelector(" + quote(selector) + ");"
                        + "return !!e && !e.disabled && e.getBoundingClientRect().width>0;})()"));
        evaluate(target, "document.querySelector(" + quote(selector) + ").scrollIntoView({block:'center'})");
        JSONObject box = (JSONObject) evaluate(target, "(() => {const r=document.querySelector("
                + quote(selector) + ").getBoundingClientRect();return {x:r.x+r.width/2,"
                + "y:r.y+r.height/2,viewport:innerWidth,height:innerHeight};})()");
        int[] nativeBox = onMain(() -> {
            int[] position = new int[2];
            target.getLocationOnScreen(position);
            return new int[] { position[0], position[1], target.getWidth(), target.getHeight() };
        });
        double ratio = nativeBox[2] / box.getDouble("viewport");
        assertTrue("Touch target is inside the visible DOM viewport",
                box.getDouble("y") >= 0 && box.getDouble("y") < box.getDouble("height"));
        int x = nativeBox[0] + (int) Math.round(box.getDouble("x") * ratio);
        int y = nativeBox[1] + (int) Math.round(box.getDouble("y") * ratio);
        assertTrue("Real input injection reaches " + selector, device.click(x, y));
    }

    private String awaitDocumentsUi() throws Exception {
        waitFor("The actual Android DocumentsUI is foreground", WAIT_MS, this::isDocumentsUi);
        return device.getCurrentPackageName();
    }

    private boolean isDocumentsUi() {
        String current = device.getCurrentPackageName();
        return current != null && current.endsWith(".documentsui");
    }

    private void selectDownloads(String pickerPackage) {
        UiObject2 roots = device.wait(Until.findObject(By.desc("Show roots")), 3000);
        if (roots != null) {
            roots.click();
            UiObject2 downloads = device.wait(Until.findObject(
                    By.pkg(pickerPackage).text("Downloads")), WAIT_MS);
            assertNotNull("Downloads is a real DocumentsUI storage root", downloads);
            downloads.click();
        }
        assertNotNull("DocumentsUI displays its filename editor", pickerFilename());
    }

    private UiObject2 pickerFilename() {
        UiObject2 field = device.wait(Until.findObject(By.clazz("android.widget.EditText")), WAIT_MS);
        assertNotNull("Real DocumentsUI filename editor", field);
        return field;
    }

    private void stubDocument(String action, Uri uri) {
        Intent result = new Intent().setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intending(hasAction(action)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_OK, result));
    }

    private Bundle provider(String operation) {
        Bundle result = instrumentation.getTargetContext().getContentResolver()
                .call(FixtureDocumentProvider.SAVED, operation, null, null);
        assertNotNull("Test-only provider responds to " + operation, result);
        return result;
    }

    private void startNativeSave(String content, String filename) throws Exception {
        evaluate(web, "(() => {window.__nativeSave={done:false};"
                + "(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));"
                + "const {saveDownload}=await import('/js/lib/download.js');"
                + "return saveDownload(" + quote(filename) + "," + quote(content) + ",'application/json');})()"
                + ".then(saved=>window.__nativeSave={done:true,saved},"
                + "error=>window.__nativeSave={done:true,saved:false,error:String(error)});return true;})()");
    }

    private int countIntents(String action) throws Exception {
        return onMain(() -> {
            int count = 0;
            for (Intent intent : Intents.getIntents()) if (action.equals(intent.getAction())) count++;
            return count;
        });
    }

    private String reportText() throws Exception {
        return text(web, "document.querySelector('#android-report')?.textContent || ''");
    }

    private boolean reportContains(String text) throws Exception {
        return reportText().contains(text);
    }

    private void measureLayout(String label) throws Exception {
        JSONObject result = (JSONObject) evaluate(web, "(() => {"
                + "const visible=e=>{const r=e.getBoundingClientRect();return r.width>0 && r.height>0"
                + " && !e.closest('[hidden]') && !e.closest('dialog:not([open])')"
                + " && getComputedStyle(e).visibility!=='hidden';};"
                + "const controls=[...document.querySelectorAll('button,.btn,select,summary,.checkbox,.fp > span')]"
                + ".filter(visible);return {body:parseFloat(getComputedStyle(document.body).fontSize),"
                + "width:innerWidth,scrollWidth:document.documentElement.scrollWidth,count:controls.length,"
                + "small:controls.map(e=>{const r=e.getBoundingClientRect();return {id:e.id,w:r.width,h:r.height};})"
                + ".filter(r=>r.w<47.5 || r.h<47.5)};})()");
        assertTrue(label + ": body text is at least 16 CSS pixels", result.getDouble("body") >= 16);
        assertTrue(label + ": page has no horizontal overflow",
                result.getDouble("scrollWidth") <= result.getDouble("width") + 1);
        assertTrue(label + ": target checks must not be vacuous", result.getInt("count") > 0);
        assertEquals(label + ": standalone targets are at least 48 CSS pixels: " + result.getJSONArray("small"),
                0, result.getJSONArray("small").length());
        measurements.put(label, result);
    }

    private JSONObject nativeGeometry() throws Exception {
        return onMain(() -> {
            WindowInsets insets = web.getRootWindowInsets();
            assertNotNull("The real window reports insets", insets);
            Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            int[] at = new int[2];
            web.getLocationOnScreen(at);
            return new JSONObject().put("x", at[0]).put("y", at[1])
                    .put("width", web.getWidth()).put("height", web.getHeight())
                    .put("screenWidth", device.getDisplayWidth()).put("screenHeight", device.getDisplayHeight())
                    .put("safeTop", safe.top).put("safeBottom", safe.bottom)
                    .put("safeLeft", safe.left).put("safeRight", safe.right)
                    .put("imeBottom", insets.getInsets(WindowInsets.Type.ime()).bottom);
        });
    }

    private boolean inputFitsNativeInsets() throws Exception {
        JSONObject nativeBox = nativeGeometry();
        JSONObject input = (JSONObject) evaluate(web, "(() => {const r=document.querySelector('#manual-title')"
                + ".getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,"
                + "width:innerWidth,height:innerHeight};})()");
        double scale = nativeBox.getDouble("width") / input.getDouble("width");
        double inputTop = nativeBox.getDouble("y") + input.getDouble("top") * scale;
        double inputBottom = nativeBox.getDouble("y") + input.getDouble("bottom") * scale;
        return nativeBox.getInt("imeBottom") > 0
                && nativeBox.getInt("y") >= nativeBox.getInt("safeTop")
                && nativeBox.getInt("x") >= nativeBox.getInt("safeLeft")
                && nativeBox.getInt("x") + nativeBox.getInt("width")
                        <= nativeBox.getInt("screenWidth") - nativeBox.getInt("safeRight") + 1
                && nativeBox.getInt("y") + nativeBox.getInt("height")
                        <= nativeBox.getInt("screenHeight") - nativeBox.getInt("safeBottom") + 1
                && inputTop >= nativeBox.getInt("safeTop")
                && inputBottom <= nativeBox.getInt("screenHeight") - nativeBox.getInt("safeBottom") + 1
                && input.getDouble("top") >= 0 && input.getDouble("bottom") <= input.getDouble("height")
                && input.getDouble("left") >= 0 && input.getDouble("right") <= input.getDouble("width");
    }

    private void screenshot(String label) {
        assertTrue("Capture synthetic screenshot " + label,
                device.takeScreenshot(new File(evidence, evidenceName(label + ".png"))));
    }

    private String evidenceName(String suffix) {
        return method + (restartProbe ? "-restart-probe" : "") + "-" + suffix;
    }

    private void writeJson(String name, JSONObject value) throws Exception {
        try (FileOutputStream stream = new FileOutputStream(new File(evidence, name))) {
            stream.write((value.toString(2) + "\n").getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String quote(String text) {
        return JSONObject.quote(text);
    }

    @FunctionalInterface
    private interface Checked<T> {
        T get() throws Exception;
    }

    private <T> T onMain(Checked<T> operation) throws Exception {
        AtomicReference<T> result = new AtomicReference<>();
        AtomicReference<Throwable> error = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            try { result.set(operation.get()); }
            catch (Throwable failure) { error.set(failure); }
        });
        if (error.get() instanceof Exception exception) throw exception;
        if (error.get() instanceof Error failure) throw failure;
        return result.get();
    }

    private static void waitFor(String message, long timeout, Checked<Boolean> condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeout;
        do {
            if (Boolean.TRUE.equals(condition.get())) return;
            SystemClock.sleep(80);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError(message + " (condition not met within " + timeout + " ms)");
    }
}
