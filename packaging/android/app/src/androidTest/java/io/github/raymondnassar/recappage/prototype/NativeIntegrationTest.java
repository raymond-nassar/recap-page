package io.github.raymondnassar.recappage.prototype;

import static androidx.test.espresso.intent.Intents.intended;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasCategories;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasData;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasPackage;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasType;
import static org.hamcrest.Matchers.allOf;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.content.pm.Signature;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inspector.WindowInspector;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebViewClient;

import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.intent.Intents;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.BySelector;
import androidx.test.uiautomator.StaleObjectException;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.json.JSONArray;
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
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
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
    private final JSONArray tapDiagnostics = new JSONArray();
    private ActivityScenario<MainActivity> scenario;
    private MainActivity activity;
    private WebView web;
    private UiDevice device;
    private FixtureMetadataServer server;
    private File evidence;
    private String method;
    private boolean intentsInitialized;
    private boolean restartProbe;
    private String candidatePhase = "";
    private String installationPhase = "";
    private boolean storageCleared;
    private boolean stateMatched;
    private boolean settingsMatched;
    private JSONObject installationEvidence;
    private JSONObject candidateReceipt;
    private WebView lastTapTarget;
    private JSONObject lastTapRecord;
    private List<String> originalBrowserRole;

    public static final class BrowserFixture extends Activity {}
    public static final class DomainFixture extends Activity {}

    @Rule
    public final TestWatcher outcome = new TestWatcher() {
        @Override
        protected void starting(Description description) {
            method = description.getMethodName();
        }

        @Override
        protected void succeeded(Description description) {
            if (candidatePhase.isEmpty()) return;
            try {
                assertNotNull("A successful native method has observed package evidence", candidateReceipt);
                candidateReceipt.getJSONObject("execution").put("status", "passed").put("tests", 1).put("skipped", 0);
                writeJson(candidateEvidenceName(), candidateReceipt);
            } catch (Exception error) {
                throw new AssertionError("Could not retain successful native package evidence", error);
            }
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
        assertEquals("Test metadata selects this installed target",
                FixtureDocumentProvider.targetPackage(instrumentation.getContext()), target.getPackageName());
        evidence = new File(target.getExternalFilesDir(null), "native-test-evidence");
        assertTrue("Synthetic evidence directory is writable", evidence.isDirectory() || evidence.mkdirs());
        device = UiDevice.getInstance(instrumentation);
        Bundle arguments = InstrumentationRegistry.getArguments();
        String restart = arguments.getString("restartProbe", "false");
        assertTrue("restartProbe must be boolean", "true".equals(restart) || "false".equals(restart));
        restartProbe = "true".equals(restart);
        String requestedPhase = arguments.getString("candidatePhase", "");
        assertTrue("Known candidate evidence phase", requestedPhase.isEmpty()
                || List.of("suite", "restart-seed", "restart-probe", "official-seed",
                        "prototype-seed", "official-probe", "prototype-probe").contains(requestedPhase));
        candidatePhase = requestedPhase;
        installationPhase = arguments.getString("installationPhase", "");
        if (!candidatePhase.isEmpty()) {
            assertEquals("Only restart-probe sets restartProbe", "restart-probe".equals(candidatePhase), restartProbe);
            if (!"suite".equals(candidatePhase)) assertEquals("Only startup handles selected phases", "startupAndPersistence", method);
        }
        if (!installationPhase.isEmpty()) {
            assertTrue("Known installation phase", List.of("official-seed", "prototype-seed",
                    "official-probe", "prototype-probe").contains(installationPhase));
            assertEquals("Installation and evidence phase agree", installationPhase, candidatePhase);
            assertFalse("Installation probes cannot request ordinary restart seeding", restartProbe);
            String expectedTarget = installationPhase.startsWith("prototype")
                    ? "io.github.raymondnassar.recappage.prototype" : "io.github.raymondnassar.recappage";
            assertEquals("Installation phase targets the matching package", expectedTarget, target.getPackageName());
        } else {
            assertFalse("Installation evidence cannot use the ordinary seeding path",
                    candidatePhase.startsWith("official-") || candidatePhase.startsWith("prototype-"));
        }
        if (!candidatePhase.isEmpty()) Files.deleteIfExists(new File(evidence, candidateEvidenceName()).toPath());
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
        waitFor("Portrait orientation is restored between scenarios", WAIT_MS, () ->
                device.getDisplayHeight() > device.getDisplayWidth()
                        && onMain(() -> activity.getResources().getConfiguration().orientation
                                == Configuration.ORIENTATION_PORTRAIT)
                        && truth(web, "innerHeight > innerWidth"));
    }

    @After
    public void cleanUp() throws Exception {
        try {
            if (device != null && evidence != null) {
                captureTapDiagnostics();
                screenshot("final");
                measurements.put("method", method).put("synthetic", true)
                        .put("restartProbe", restartProbe).put("sdk", Build.VERSION.SDK_INT)
                        .put("buildFingerprint", Build.FINGERPRINT).put("taps", tapDiagnostics);
                onMain(() -> {
                    if (WebView.getCurrentWebViewPackage() != null) {
                        measurements.put("webViewPackage", WebView.getCurrentWebViewPackage().packageName);
                        measurements.put("webViewVersion", WebView.getCurrentWebViewPackage().versionName);
                    }
                    return null;
                });
                writeJson(evidenceName("measurements.json"), measurements);
                if (!candidatePhase.isEmpty()) candidateReceipt = observedCandidateReceipt();
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
                        try {
                            restoreBrowserPreferences();
                        } finally {
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
    }

    @Test
    public void cloudUploadPermitsRevokeAndRegrantAfterReload() throws Exception {
        for (String phase : new String[] { "launch", "reload" }) {
            if (phase.equals("reload")) {
                assertEquals(true, asyncJs(web, "return !!globalThis.recapPermitProbe"
                        + " && sessionStorage.getItem('recap.test.upload-permit')===globalThis.recapPermitProbe.name"
                        + " && await globalThis.recapPermitProbe.allowed();"));
                reload();
            }
            JSONObject result = (JSONObject) asyncJs(web,
                    "const {CloudUploadPermit}=await import(location.origin+'/js/lib/cloudUploadPermit.js');"
                    + "const previous=sessionStorage.getItem('recap.test.upload-permit'),state=await navigator.locks.query();"
                    + "const fresh=![...state.held,...state.pending].some(l=>l.name===previous);"
                    + "let lost=0,keep=false;"
                    + "const older=new CloudUploadPermit({onLost:()=>{lost+=1;}}),checking=new CloudUploadPermit();"
                    + "try {"
                    + "await older.grant();const held=await older.allowed();"
                    + "await checking.revokeAll();const revoked=!await older.allowed();"
                    + "const deadline=Date.now()+2000;"
                    + "while(lost===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));"
                    + "const absent=!(await navigator.locks.query()).held.some(l=>l.name===older.name);"
                    + "checking.release();await older.grant();"
                    + "globalThis.recapPermitProbe=older;sessionStorage.setItem('recap.test.upload-permit',older.name);keep=true;"
                    + "return {hadPrevious:previous!==null,fresh,held,revoked,rejected:lost===1,absent,regranted:await older.allowed(),userAgent:navigator.userAgent};"
                    + "}finally{if(!keep)older.release();checking.release();}");
            measurements.put("cloudUploadPermit-" + phase, result);
            assertEquals(phase.equals("reload"), result.getBoolean("hadPrevious"));
            for (String key : new String[] { "fresh", "held", "revoked", "rejected", "absent", "regranted" }) {
                assertTrue(phase + ": " + key, result.getBoolean(key));
            }
        }
        asyncJs(web, "globalThis.recapPermitProbe.release();sessionStorage.removeItem('recap.test.upload-permit');return true;");
    }

    @Test
    public void startupAndPersistence() throws Exception {
        if (!installationPhase.isEmpty()) {
            String role = installationPhase.startsWith("prototype") ? "prototype" : "official";
            if (installationPhase.endsWith("-seed")) seedInstallation(role);
            assertInstallation(role);
            return;
        }
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
        if (!candidatePhase.isEmpty()) {
            stateMatched = true;
            settingsMatched = truth(web, "(() => {const s=JSON.parse(localStorage.getItem('mrt.settings'));"
                    + "return s.covers===false && s.theme==='dark'"
                    // #1061: the retired hiding choice is ignored, including after a settings save.
                    + " && s.apiBase==='http://127.0.0.1:9/v1';"
                    + "})()");
            assertTrue("Restart preserves the seeded device settings", settingsMatched);
        }
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
        setPickerFilename(pickerPackage, savedName);
        screenshot("documentsui-save");
        clickPickerControl("Real document save completes",
                By.pkg(pickerPackage).text(Pattern.compile("(?i)^save$")),
                () -> reportContains("File saved to the location"));
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
        setPickerFilename(pickerPackage, cancelledName);
        for (int press = 0; press < 3 && isDocumentsUi(); press++) {
            device.pressBack();
            device.wait(Until.gone(By.pkg(pickerPackage).depth(0)), 1000);
        }
        waitFor("Real DocumentsUI cancellation is acknowledged", WAIT_MS, () -> reportContains("Download cancelled"));
        assertEquals("Cancelled export leaves reading data unchanged", before, stateSummary());
        String downloads = device.executeShellCommand("ls -1 /sdcard/Download");
        assertTrue("The real saved file proves the Downloads listing succeeded",
                java.util.Arrays.asList(downloads.split("\\r?\\n")).contains(savedName));
        assertFalse("Cancellation must not create a file",
                java.util.Arrays.asList(downloads.split("\\r?\\n")).contains(cancelledName));
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
                "const m=await import(location.origin+'/js/lib/model.js');"
                + "const b=m.exportBackup(JSON.parse(localStorage.getItem('mrt.state.v2')));"
                + "b.exportedAt='2026-09-26T00:00:00.000Z';return JSON.stringify(b,null,2)+'\\n';");
        stubDocument(Intent.ACTION_CREATE_DOCUMENT, FixtureDocumentProvider.saved(instrumentation.getContext()));
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

        asyncJs(web, "const m=await import(location.origin+'/js/lib/model.js');"
                + "localStorage.setItem('mrt.state.v2',JSON.stringify(m.createEmptyState()));return true;");
        reload();
        route("data");
        assertEquals("Restore starts from an actually empty list set", 0,
                number(web, "JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length"));
        stubDocument(Intent.ACTION_OPEN_DOCUMENT, FixtureDocumentProvider.saved(instrumentation.getContext()));
        tap(web, "#restore-file");
        waitFor("Reading-data replacement requires confirmation", WAIT_MS,
                () -> truth(web, "!!document.querySelector('#ask[open]')"
                        + " && document.querySelector('#ask-title').textContent === 'Replace reading data with this backup?'"));
        assertEquals("Selecting a backup does not replace reading data before confirmation", 0,
                number(web, "JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length"));
        tap(web, "#ask-ok");
        waitFor("Real WebView file callback restores provider bytes", WAIT_MS,
                () -> truth(web, "document.querySelector('#restore-report').textContent.includes('Reading data restored.')"));
        assertFixture();
        assertEquals("The restored fixture exactly matches its saved state", before, stateSummary());
        assertTrue("Restore reads through ContentResolver", provider("stats").getInt("reads") >= 1);
        intended(allOf(hasAction(Intent.ACTION_OPEN_DOCUMENT), hasCategories(Collections.singleton(Intent.CATEGORY_OPENABLE)),
                hasType("application/json"), hasExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)));
        route("read");
        assertReadingProgress();
        route("data");

        stubDocument(Intent.ACTION_CREATE_DOCUMENT, FixtureDocumentProvider.refused(instrumentation.getContext()));
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

        provider("reset");
        stubDocument(Intent.ACTION_CREATE_DOCUMENT, FixtureDocumentProvider.saved(instrumentation.getContext()));
        String large = "{\"probe\":\"" + "x".repeat(2 * 1024 * 1024) + "\"}";
        startNativeSave(large, "native-large-transport.json");
        waitFor("A multi-megabyte message reaches native document completion", WAIT_MS,
                () -> truth(web, "window.__nativeSave && window.__nativeSave.done"));
        assertTrue("A message above Binder's transaction size must cross the actual WebView port",
                truth(web, "window.__nativeSave.saved === true"));
        waitFor("Large provider output stream is closed", WAIT_MS, () -> provider("stats").getInt("closedWrites") == 1);
        // Read the document stream, not a large Bundle, which would introduce Binder into this probe.
        try (InputStream input = instrumentation.getTargetContext().getContentResolver()
                .openInputStream(FixtureDocumentProvider.saved(instrumentation.getContext()))) {
            assertNotNull("The large synthetic document can be read", input);
            assertArrayEquals("Large native export preserves exact UTF-8 bytes",
                    large.getBytes(StandardCharsets.UTF_8), input.readAllBytes());
        }
        assertEquals("Large export preserves reading data", before, stateSummary());
        measurements.put("largeExportBytes", large.getBytes(StandardCharsets.UTF_8).length);
    }

    @Test
    public void readerPopupAndExternalIntent() throws Exception {
        configureBrowserPreferences();
        server = new FixtureMetadataServer();
        // The comic up next has no saved digital ID. Before #1601 the launcher looked one up in the
        // popup; now nothing may ask the metadata server, so a lookup here is a regression.
        seed(true);
        route("read");
        assertReadingProgress();
        Object nativeEndpoint = nativePort();
        assertNotNull("The main document has its native endpoint", nativeEndpoint);
        String website = "https://marvel.webtoon.com/";
        waitFor("A comic with no verified viewer offers the Marvel Comics website", WAIT_MS,
                () -> "Find on Marvel Comics".equals(text(web, "document.querySelector('#btn-hero-read').textContent")));
        assertTrue("An idle launcher is opened by a real tap",
                (Boolean) asyncJs(web,
                        "const b=document.createElement('button');b.id='native-idle-launcher';b.textContent='Launcher';"
                        + "Object.assign(b.style,{position:'fixed',top:'20px',left:'20px',zIndex:'10000'});"
                        + "b.onclick=()=>window.open('/open.html','_blank','noopener');"
                        + "document.body.append(b);return true;"));
        tap(web, "#native-idle-launcher");
        waitFor("A real user gesture creates one child WebView", 5000, () -> popupViews().size() == 1);
        WebView idle = popupViews().get(0);
        waitFor("The real launcher executes with its opener severed", 4000,
                () -> truth(idle, "location.pathname === '/open.html' && window.opener === null"
                        + " && document.querySelector('#p')?.textContent.includes('missing a valid issue reference')"));
        assertEquals("An idle launcher dispatches nothing", 0, countIntents(Intent.ACTION_VIEW));
        assertSame("Creating the child must not replace the main native endpoint", nativeEndpoint, nativePort());
        assertTrue("Launcher loads only its isolated Android entry, not the app or native bridge",
                truth(idle, "[...document.scripts].some(s => s.src.endsWith('/android/launcher.js'))"
                        + " && [...document.scripts].every(s => !/\\/android\\/(app|bridge)\\.js$/.test(s.src))"
                        + " && !document.querySelector('#android-report')"));
        assertTrue("Popup cannot fetch the native bridge from the local asset boundary",
                (Boolean) asyncJs(idle, "const r=await fetch('/android/bridge.js');return r.status===403;"));
        screenshot("isolated-popup");
        // #1601 retired every Marvel Unlimited destination. None may leave the app from any caller,
        // including a popup on the launcher page, where an official reader would be handed off.
        String unlimited = "marvelunlimited://issue/drn:src:marvel:unison::prod:"
                + "00000000-0000-4000-8000-000000000099";
        String[] retired = {
                unlimited,
                "https://read.marvel.com/#/book/900000099",
                "https://www.marvelcomicsapp.com/mu/issues/900000002",
        };
        onMain(() -> {
            WebViewClient delegate = idle.getWebViewClient();
            assertTrue(web.getWebViewClient().shouldOverrideUrlLoading(web, readerRequest(unlimited, true)));
            assertTrue(delegate.shouldOverrideUrlLoading(web, readerRequest(unlimited, true)));
            for (String address : retired) {
                assertTrue(delegate.shouldOverrideUrlLoading(idle, readerRequest(address, false)));
                assertTrue(delegate.shouldOverrideUrlLoading(idle, readerRequest(address, true)));
            }
            return null;
        });
        assertEquals("Retired addresses are refused from every caller context", 0, countIntents(Intent.ACTION_VIEW));
        onMain(() -> {
            ((android.app.Dialog) idle.getTag()).dismiss();
            return null;
        });
        waitFor("The idle launcher closes without a handoff", WAIT_MS, () -> popupViews().isEmpty());
        asyncJs(web, "document.querySelector('#native-idle-launcher').remove();return true;");
        device.executeShellCommand("cmd role clear-role-holders --user 0 android.app.role.BROWSER");
        // The role controller re-adds a fallback holder when exactly one browser, or exactly one
        // system browser, qualifies (BrowserRoleBehavior.getFallbackHolderAsUser, AOSP Permission
        // module main, read 2026-11-10). On a google_apis image Chrome is the only system browser,
        // so the cleared role is expected back at once and the no-default picker cannot be reached.
        List<String> afterClear = browserRoleHolders();
        assertTrue("Clearing leaves at most one browser holder", afterClear.size() <= 1);
        boolean pickerReachable = afterClear.isEmpty();
        intending(allOf(hasAction(Intent.ACTION_VIEW), hasData(website)))
                .respondWith(new Instrumentation.ActivityResult(Activity.RESULT_OK, null));
        String defaultBrowser;
        if (pickerReachable) {
            assertNull("A resolver is not a vetted browser default", onMain(() ->
                    MainActivity.defaultReaderBrowser(activity.getPackageManager(),
                            MainActivity.readerBrowsers(activity.getPackageManager()))));
            tap(web, "#btn-hero-read");
            waitFor("Find on Marvel Comics opens one launcher", 5000, () -> popupViews().size() == 1);
            WebView popup = popupViews().get(0);
            UiObject2 firstChoices = device.wait(Until.findObject(By.clazz("android.widget.ListView")), 5000);
            assertNotNull("Without a default, the website handoff asks for an installed browser", firstChoices);
            assertNotNull("The second browser is present", firstChoices.findObject(By.text("Recap browser fixture")));
            assertEquals("No outgoing intent before the browser choice", 0, countIntents(Intent.ACTION_VIEW));
            device.pressBack();
            waitFor("Cancel returns a visible browser failure and usable fallback", WAIT_MS,
                    () -> truth(popup, "document.querySelector('#p').textContent.includes('browser was not opened')"));
            assertEquals("Cancelled browser choice retains popup", 1, popupViews().size());
            device.executeShellCommand("cmd role add-role-holder --user 0 android.app.role.BROWSER com.android.chrome");
            assertEquals("Chrome is restored as the default browser",
                    Collections.singletonList("com.android.chrome"), browserRoleHolders());
            defaultBrowser = "com.android.chrome";
            tapClosingPopup(popup, "#fallback", "https://marvel.webtoon.com/", defaultBrowser);
        } else {
            defaultBrowser = afterClear.get(0);
            ResolveInfo restored = onMain(() -> MainActivity.defaultReaderBrowser(activity.getPackageManager(),
                    MainActivity.readerBrowsers(activity.getPackageManager())));
            assertNotNull("The restored fallback holder is a vetted browser default", restored);
            assertEquals("The vetted default is the restored role holder",
                    defaultBrowser, restored.activityInfo.packageName);
            tap(web, "#btn-hero-read");
        }
        waitFor("Find on Marvel Comics dispatches the website", WAIT_MS, () ->
                Intents.getIntents().stream().anyMatch(intent -> website.equals(intent.getDataString())));
        waitFor("Default browser handoff closes popup without another choice", WAIT_MS, () -> popupViews().isEmpty());
        assertNull("The app does not show a browser picker for a verified default",
                device.findObject(By.text("Open in browser")));
        List<Intent> websiteIntents = Intents.getIntents().stream()
                .filter(intent -> website.equals(intent.getDataString()))
                .collect(java.util.stream.Collectors.toList());
        assertEquals("The website is handed off exactly once", 1, websiteIntents.size());
        Intent browserIntent = websiteIntents.get(0);
        assertNotNull("The website handoff explicitly targets a browser package", browserIntent.getPackage());
        assertEquals("The website goes to the default browser, not its domain handler",
                defaultBrowser, browserIntent.getPackage());
        assertTrue("Selected package is a general web browser", onMain(() ->
                MainActivity.readerBrowsers(activity.getPackageManager()).stream()
                        .anyMatch(info -> info.filter != null && info.filter.countDataAuthorities() == 0
                                && info.activityInfo.packageName.equals(browserIntent.getPackage()))));
        assertEquals("A comic with no verified viewer never tries the Marvel Comics app", 0L,
                Intents.getIntents().stream().filter(intent ->
                        "com.webtoon.marvelcomics".equals(intent.getPackage())).count());
        assertEquals("No Marvel Unlimited destination is ever dispatched", 0L,
                Intents.getIntents().stream().filter(intent -> {
                    String data = String.valueOf(intent.getDataString());
                    return data.startsWith("marvelunlimited:") || data.contains("read.marvel.com")
                            || data.contains("/mu/issues/") || data.contains("bifrost.marvel.com");
                }).count());
        assertEquals("Read makes no metadata lookup", 0, server.issueRequests.get());
        assertSame("Main native endpoint survives the child lifecycle", nativeEndpoint, nativePort());
        assertFixture();
        assertNotNull("Main WebView remains attached", onMain(() -> web.getParent()));
        assertTrue("Loopback fixture server completed cleanly", server.failure == null);
        assertMarvelComicsHandoffs();
        String[] providers = {
                "https://www.hoopladigital.com/title/123456789",
                "https://share.libbyapp.com/title/123456",
        };
        assertTrue("The real collected-edition renderer exposes both synthetic provider links",
                (Boolean) asyncJs(web,
                        "const {collectedEditionLabels}=await import(location.origin+'/js/views/shared/collected-editions.js');"
                        + "const make=(tag,props,children=[])=>{const e=document.createElement(tag);"
                        + "for(const [k,v] of Object.entries(props)){"
                        + "if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else e.setAttribute(k,v);}"
                        + "e.append(...children);return e;};"
                        + "const item={issueId:7,seriesId:8,number:'1'};"
                        + "const evidence={relations:[{...item,catalogId:'native',editionId:'book',"
                        + "status:'verified',portion:'full',conflicts:[],source:'fixture',checkedAt:'2026-11-12'}]};"
                        + "const basis={basis:'owner-approval',basisEvidence:"
                        + "'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560'};"
                        + "const catalog={providers:{hoopla:{...basis,name:'Hoopla'},libby:{...basis,name:'Libby'}},"
                        + "editions:{book:{title:'Stand-in book',destinations:["
                        + "{provider:'hoopla',url:" + quote(providers[0]) + ",confirmedBy:'owner',checkedAt:'2026-11-12'},"
                        + "{provider:'libby',url:" + quote(providers[1]) + ",confirmedBy:'owner',checkedAt:'2026-11-12'}]}}};"
                        + "const fixture=collectedEditionLabels(make,'native',item,catalog,evidence);"
                        + "if(!fixture)return false;fixture.id='native-book-link-fixture';"
                        + "Object.assign(fixture.style,{position:'fixed',top:'20px',left:'20px',right:'20px',"
                        + "padding:'8px',background:'white',zIndex:'10000'});"
                        + "document.body.append(fixture);return fixture.querySelectorAll('a').length===2;"));
        onMain(() -> {
            WebChromeClient delegate = web.getWebChromeClient();
            assertNotNull("Provider gestures use the app's original window policy", delegate);
            web.getSettings().setBlockNetworkLoads(true);
            web.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onCreateWindow(WebView opener, boolean isDialog, boolean isUserGesture, Message result) {
                    boolean created = delegate.onCreateWindow(opener, isDialog, isUserGesture, result);
                    if (created) {
                        assertTrue("A new window supplies a WebView transport", result.obj instanceof WebView.WebViewTransport);
                        WebView child = ((WebView.WebViewTransport) result.obj).getWebView();
                        assertNotNull("The app attaches its child WebView", child);
                        child.getSettings().setBlockNetworkLoads(true);
                    }
                    return created;
                }
            });
            return null;
        });
        for (int index = 0; index < providers.length; index++) {
            String destination = providers[index];
            tap(web, "#native-book-link-fixture a:nth-of-type(" + (index + 1) + ")");
            waitFor("Provider link dispatches its exact external destination", WAIT_MS, () ->
                    Intents.getIntents().stream().anyMatch(intent ->
                            Intent.ACTION_VIEW.equals(intent.getAction())
                                    && destination.equals(intent.getDataString())));
            intended(allOf(hasAction(Intent.ACTION_VIEW), hasData(destination)));
            assertEquals("Each provider gesture dispatches exactly one intent", 1L,
                    Intents.getIntents().stream().filter(intent -> Intent.ACTION_VIEW.equals(intent.getAction())
                            && destination.equals(intent.getDataString())).count());
        }
        assertSame("Provider handoffs preserve the main native endpoint", nativeEndpoint, nativePort());
        assertFixture();
        measurements.put("popupCount", 2).put("syntheticMetadataLookups", server.issueRequests.get())
                .put("appDispatchAttempts", 0).put("websiteHandoffs", websiteIntents.size())
                .put("externalBrowserRendered", false).put("pickerReachable", pickerReachable)
                .put("refusedRetiredAddresses", retired.length)
                .put("destination", browserIntent.getDataString())
                .put("browserPackage", browserIntent.getPackage())
                .put("providerHandoffs", providers.length)
                .put("popupOpenerNull", true).put("nativeEndpointUnchanged", true)
                .put("popupBridgeAssetStatus", 403);
    }

    // Read on a /viewer/ comic first asks the Marvel Comics app, by package, for its own reader address.
    // An explicit Open in browser tap never tries the app, and a missing app falls back to the same
    // vetted browser path. An old Marvel Unlimited launch link (#1601) opens the website instead.
    private void assertMarvelComicsHandoffs() throws Exception {
        String[] links = {
                "https://www.marvelcomicsapp.com/viewer/900000001",
                "https://marvel.webtoon.com/",
                "https://www.marvelcomicsapp.com/viewer/900000003"
        };
        String[] appAddresses = {
                "marvelcomicsapp://viewer?issueId=900000001", null, "marvelcomicsapp://viewer?issueId=900000003"
        };
        String before = stateSummary();
        intending(hasData(appAddresses[2])).respondWithFunction(intent -> {
            throw new ActivityNotFoundException("Synthetic missing Marvel Comics app");
        });
        for (int index = 0; index < links.length; index++) {
            String destination = links[index];
            String appAddress = appAddresses[index];
            String parameter = index == 1 ? "i=900000002&m=900000002" : "i=900000099&a=" + (900000001 + index);
            int earlier = Intents.getIntents().size();
            assertTrue("A real tap opens the isolated launcher with a synthetic app link",
                    (Boolean) asyncJs(web,
                            "const b=document.createElement('button');b.id='native-app-read';b.textContent='Read';"
                            + "Object.assign(b.style,{position:'fixed',top:'20px',left:'20px',zIndex:'10000'});"
                            + "b.onclick=()=>window.open('/open.html?" + parameter
                            + "','_blank','noopener');document.body.append(b);return true;"));
            tap(web, "#native-app-read");
            waitFor("Launcher hands the comic off", WAIT_MS, () -> Intents.getIntents().stream().skip(earlier)
                    .anyMatch(intent -> destination.equals(intent.getDataString())
                            || appAddress != null && appAddress.equals(intent.getDataString())));
            waitFor("Accepted app or browser handoff closes its popup", WAIT_MS, () -> popupViews().isEmpty());
            List<Intent> handed = Intents.getIntents().subList(earlier, Intents.getIntents().size());
            List<Intent> appAttempts = handed.stream()
                    .filter(intent -> appAddress != null && appAddress.equals(intent.getDataString()))
                    .collect(java.util.stream.Collectors.toList());
            List<Intent> browserAttempts = handed.stream()
                    .filter(intent -> destination.equals(intent.getDataString()))
                    .collect(java.util.stream.Collectors.toList());
            assertEquals("Only a viewer link tries the app, once", appAddress == null ? 0 : 1, appAttempts.size());
            assertEquals("Only a link with no app attempt or a missing app reaches the browser",
                    index == 0 ? 0 : 1, browserAttempts.size());
            assertEquals("Each launch hands off only its own destinations",
                    appAttempts.size() + browserAttempts.size(), handed.size());
            if (appAddress != null) {
                Intent app = appAttempts.get(0);
                assertEquals("App attempt is a view intent", Intent.ACTION_VIEW, app.getAction());
                assertEquals("Only the Marvel Comics app may take the comic number",
                        "com.webtoon.marvelcomics", app.getPackage());
                assertNull("No explicit activity bypasses the app's own filters", app.getComponent());
                assertTrue("App attempt is browsable", app.hasCategory(Intent.CATEGORY_BROWSABLE));
            }
            if (!browserAttempts.isEmpty()) {
                assertEquals("The browser path keeps the vetted default browser", "com.android.chrome",
                        browserAttempts.get(0).getPackage());
            }
            asyncJs(web, "document.querySelector('#native-app-read').remove();return true;");
        }
        assertTrue("The browser escape starts with a local, idle launcher",
                (Boolean) asyncJs(web,
                        "const b=document.createElement('button');b.id='native-app-read';b.textContent='Read';"
                        + "Object.assign(b.style,{position:'fixed',top:'20px',left:'20px',zIndex:'10000'});"
                        + "b.onclick=()=>window.open('/open.html','_blank','noopener');"
                        + "document.body.append(b);return true;"));
        tap(web, "#native-app-read");
        waitFor("Idle launcher remains available", WAIT_MS, () -> popupViews().size() == 1);
        WebView popup = popupViews().get(0);
        waitFor("Idle launcher loads its fallback", WAIT_MS,
                () -> truth(popup, "location.pathname==='/open.html' && !!document.querySelector('#fallback')"));
        String escape = "https://www.marvelcomicsapp.com/viewer/900000004";
        asyncJs(popup, "const a=document.querySelector('#fallback');a.href=" + quote(escape)
                + ";a.hidden=false;return true;");
        tapClosingPopup(popup, "#fallback", escape, "com.android.chrome");
        waitFor("Explicit browser escape closes the popup", WAIT_MS, () -> popupViews().isEmpty());
        assertEquals("Open in browser never tries the app", 0L, Intents.getIntents().stream()
                .filter(intent -> "marvelcomicsapp://viewer?issueId=900000004".equals(intent.getDataString())).count());
        List<Intent> escaped = Intents.getIntents().stream()
                .filter(intent -> escape.equals(intent.getDataString())).collect(java.util.stream.Collectors.toList());
        assertEquals("Open in browser opens the browser once", 1, escaped.size());
        assertEquals("The browser escape remains pinned to the vetted browser", "com.android.chrome",
                escaped.get(0).getPackage());
        asyncJs(web, "document.querySelector('#native-app-read').remove();return true;");
        assertEquals("App and browser handoffs do not change saved reading data", before, stateSummary());
        measurements.put("marvelComicsAppAttempts", 2).put("marvelComicsAppFallbacks", 1)
                .put("marvelComicsExplicitBrowserEscapes", 1).put("retiredLaunchLinksToWebsite", 1);
    }

    @SuppressWarnings("deprecation")
    private void configureBrowserPreferences() throws Exception {
        String fixturePackage = instrumentation.getContext().getPackageName();
        originalBrowserRole = browserRoleHolders();
        device.executeShellCommand("cmd role add-role-holder --user 0 android.app.role.BROWSER com.android.chrome");
        assertEquals("Chrome is the synthetic default browser",
                Collections.singletonList("com.android.chrome"), browserRoleHolders());
        assertTrue("Discovery retains the test browser alongside the default browser", onMain(() -> {
            List<ResolveInfo> browsers = MainActivity.readerBrowsers(activity.getPackageManager());
            return browsers.stream().anyMatch(info -> info.activityInfo.packageName.equals(fixturePackage))
                    && browsers.stream().anyMatch(info -> info.activityInfo.packageName.equals("com.android.chrome"));
        }));
        // Find on Marvel Comics hands this website to an explicit browser package (#1601), so a verified
        // handler for its host is the one that could take it from the browser. A viewer link tries the
        // Marvel Comics app first by design, which makes its host the weaker proof.
        device.executeShellCommand("pm set-app-links --package " + fixturePackage + " 2 marvel.webtoon.com");
        assertTrue("Domain approval was set locally without contacting Marvel",
                device.executeShellCommand("pm get-app-links " + fixturePackage)
                        .contains("marvel.webtoon.com: approved"));
        List<ResolveInfo> domainResults = onMain(() -> activity.getPackageManager().queryIntentActivities(
                new Intent(Intent.ACTION_VIEW, Uri.parse("https://marvel.webtoon.com/"))
                        .addCategory(Intent.CATEGORY_BROWSABLE),
                PackageManager.MATCH_DEFAULT_ONLY | PackageManager.GET_RESOLVED_FILTER));
        assertTrue("The destination-bound query reproduces browser suppression",
                domainResults.stream().anyMatch(info -> info.activityInfo.packageName.equals(fixturePackage)
                        && info.activityInfo.name.equals(DomainFixture.class.getName()))
                        && domainResults.stream().noneMatch(info -> info.filter != null
                                && info.filter.countDataAuthorities() == 0));
        List<ResolveInfo> browsers = onMain(() -> MainActivity.readerBrowsers(activity.getPackageManager()));
        assertTrue("Hostless discovery still returns both browser packages",
                browsers.stream().anyMatch(info -> info.activityInfo.packageName.equals(fixturePackage))
                        && browsers.stream().anyMatch(info -> info.activityInfo.packageName.equals("com.android.chrome")));
        assertTrue("Domain-only activity is never a browser choice",
                browsers.stream().noneMatch(info -> info.activityInfo.name.equals(DomainFixture.class.getName())));
        assertEquals("Hostless default resolution selects Chrome despite domain approval", "com.android.chrome",
                onMain(() -> MainActivity.defaultReaderBrowser(activity.getPackageManager(),
                        MainActivity.readerBrowsers(activity.getPackageManager())).activityInfo.packageName));
        assertNull("An empty vetted list cannot select a default", onMain(() ->
                MainActivity.defaultReaderBrowser(activity.getPackageManager(), new ArrayList<>())));
        ArrayList<ResolveInfo> withoutDefault = new ArrayList<>(browsers);
        withoutDefault.removeIf(info -> info.activityInfo.packageName.equals("com.android.chrome"));
        assertNull("A preferred package missing from the vetted list is never selected", onMain(() ->
                MainActivity.defaultReaderBrowser(activity.getPackageManager(), withoutDefault)));
        measurements.put("browserDefault", "com.android.chrome").put("approvedDomainFixture", true)
                .put("browserChoicesDespitePreferences", browsers.size());
    }

    private List<String> browserRoleHolders() throws Exception {
        List<String> result = new ArrayList<>();
        for (String line : device.executeShellCommand(
                "cmd role get-role-holders --user 0 android.app.role.BROWSER").split("\\R")) {
            if (line.isBlank()) continue;
            assertTrue("Only package names enter browser-role commands", line.matches("[A-Za-z0-9_.]+"));
            result.add(line);
        }
        return result;
    }

    private void restoreBrowserPreferences() throws Exception {
        if (originalBrowserRole == null) return;
        String fixturePackage = instrumentation.getContext().getPackageName();
        try {
            device.executeShellCommand("pm set-app-links --package " + fixturePackage + " 0 all");
        } finally {
            device.executeShellCommand("cmd role clear-role-holders --user 0 android.app.role.BROWSER");
            for (String holder : originalBrowserRole) {
                device.executeShellCommand("cmd role add-role-holder --user 0 android.app.role.BROWSER " + holder);
            }
            assertEquals("Browser role is restored after the regression scenario",
                    originalBrowserRole, browserRoleHolders());
            originalBrowserRole = null;
        }
    }

    private static WebResourceRequest readerRequest(String url, boolean mainFrame) {
        return new WebResourceRequest() {
            @Override public Uri getUrl() { return Uri.parse(url); }
            @Override public boolean isForMainFrame() { return mainFrame; }
            @Override public boolean isRedirect() { return false; }
            @Override public boolean hasGesture() { return true; }
            @Override public String getMethod() { return "GET"; }
            @Override public Map<String, String> getRequestHeaders() { return Collections.emptyMap(); }
        };
    }

    @Test
    public void backAndRecreation() throws Exception {
        seed(false);
        route("read");
        String readingRoute = normalizedRoute();
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
        evaluate(web, "window.scrollTo(0, 0)");
        waitFor("Scrolling to the top reveals bottom navigation", WAIT_MS,
                () -> truth(web, "!document.querySelector('.rail-header').classList.contains('mobile-nav-hidden')"));
        tap(web, "#btn-rail-toggle");
        waitFor("Navigation opened", WAIT_MS, () -> truth(web,
                "document.querySelector('#btn-rail-toggle').getAttribute('aria-expanded') === 'true'"));
        device.pressBack();
        waitFor("Android Back closes navigation", WAIT_MS, () -> truth(web,
                "document.querySelector('#btn-rail-toggle').getAttribute('aria-expanded') === 'false'"));
        assertEquals("Navigation dismissal does not consume history", dataRoute, text(web, "location.hash"));
        device.pressBack();
        waitFor("Next Android Back reaches the prior WebView history entry", WAIT_MS,
                () -> readingRoute.equals(normalizedRoute())
                        && truth(web, "document.querySelector('#view-read').hidden === false"));
        assertFixture();

        route("data");
        String recreationRoute = normalizedRoute();
        MainActivity oldActivity = activity;
        WebView oldWeb = web;
        scenario.recreate();
        findMainWebView();
        awaitPage();
        assertNotSame("ActivityScenario.recreate makes a new Activity", oldActivity, activity);
        assertNotSame("Recreation makes a new WebView", oldWeb, web);
        assertEquals("Validated view and list context survive Activity recreation", recreationRoute, normalizedRoute());
        assertTrue("Recreation displays the restored data view", truth(web,
                "document.querySelector('#view-data').hidden === false"));
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
        storageCleared = true;
        String base = server == null ? "http://127.0.0.1:9/v1" : server.baseUrl();
        asyncJs(web, "const m=await import(location.origin+'/js/lib/model.js');"
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

    private String installationFixture(String role) {
        assertTrue("Fixed synthetic role", "official".equals(role) || "prototype".equals(role));
        return "const m=await import(location.origin+'/js/lib/model.js');"
                + "const {KEY}=await import(location.origin+'/js/storage.js');"
                + "let s=m.createList(m.createEmptyState(),{id:'native-fixture',name:" + quote(role + " installation fixture")
                + ",description:'Synthetic installation only',note:" + quote(role + " list note") + "});"
                + "s=m.addIssuesToList(s,'native-fixture',["
                + "{issueId:900000001,title:'Synthetic #1',number:1,seriesId:900000010,seriesName:'Synthetic only',hydrated:true},"
                + "{issueId:900000002,title:'Synthetic #2',number:2,seriesId:900000010,seriesName:'Synthetic only',hydrated:true}]).state;"
                + "s.lists['native-fixture'].created=1750000000000;"
                + "s=m.markRead(s,900000001,true,1750000000000);"
                + "s=m.setOverride(s,900000001,'available');s=m.setOverride(s,900000002,'unavailable');"
                + "s=m.setDeferred(s,'native-fixture',900000002,true);"
                + "s.notes['900000001']=" + quote(role + " note one") + ";"
                + "s.notes['900000002']=" + quote(role + " note two") + ";"
                + "const settings={covers:false,theme:" + quote("official".equals(role) ? "dark" : "light")
                + ",hideDescriptions:true,apiBase:'http://127.0.0.1:9/v1'};"
                + "const stable=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):"
                + "x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));";
    }

    private void seedInstallation(String role) throws Exception {
        assertTrue("Only explicit seed phases clear synthetic storage", installationPhase.endsWith("-seed"));
        storageCleared = true;
        asyncJs(web, installationFixture(role)
                + "localStorage.clear();sessionStorage.clear();"
                + "localStorage.setItem(KEY,JSON.stringify(s));"
                + "localStorage.setItem('mrt.settings',JSON.stringify(settings));"
                + "history.replaceState(null,'','/#/library');return true;");
        reload();
    }

    private void assertInstallation(String role) throws Exception {
        JSONObject snapshot = (JSONObject) asyncJs(web, installationFixture(role)
                + "const actual=JSON.parse(localStorage.getItem(KEY));"
                + "if(!actual)throw Error('Missing installation state');delete actual.writeToken;"
                + "const actualSettings=JSON.parse(localStorage.getItem('mrt.settings'));"
                + "if(!actualSettings)throw Error('Missing installation settings');"
                + "return {stateMatched:stable(actual)===stable(s),"
                + "settingsMatched:Object.keys(settings).every(k=>actualSettings[k]===settings[k]),"
                + "state:stable(actual),settings:stable(actualSettings)};");
        stateMatched = snapshot.getBoolean("stateMatched");
        settingsMatched = snapshot.getBoolean("settingsMatched");
        assertTrue("Independent expected installation state matches retained data", stateMatched);
        assertTrue("Independent expected device settings match retained data", settingsMatched);
        if (installationPhase.endsWith("-probe")) assertFalse("A probe cannot clear or reseed storage", storageCleared);
        installationEvidence = new JSONObject().put("role", role)
                .put("stateSha256", sha256(snapshot.getString("state").getBytes(StandardCharsets.UTF_8)))
                .put("settingsSha256", sha256(snapshot.getString("settings").getBytes(StandardCharsets.UTF_8)));
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

    private String normalizedRoute() throws Exception {
        return (String) asyncJs(web, "const {parseRoute,formatRoute}=await import(location.origin+'/js/lib/route.js');"
                + "const r=parseRoute(location.hash);if(!r)throw Error('Unrecognized current route');"
                + "const s=JSON.parse(localStorage.getItem('mrt.state.v2'));"
                + "return formatRoute({...r,listId:r.listId ?? s.active});");
    }

    private Object evaluateRequiredValue(WebView target, String expression) throws Exception {
        Object value = evaluate(target, expression);
        assertNotNull("Clock injection must return its observed local date", value);
        return value;
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

    private static final class DeliveredTap {
        private long down = -1;
        private long up = -1;
        private int downs;
        private int ups;
        private boolean cancelled;
        private boolean nonTouchscreen;

        synchronized void down(long time, boolean touchscreen) {
            if (++downs == 1) down = time;
            nonTouchscreen |= !touchscreen;
        }

        synchronized void up(long time, boolean touchscreen) {
            if (++ups == 1) up = time;
            nonTouchscreen |= !touchscreen;
        }

        synchronized void cancel() {
            cancelled = true;
        }

        synchronized boolean complete() {
            return downs == 1 && ups == 1 && down >= 0 && up >= down && !cancelled && !nonTouchscreen;
        }

        synchronized boolean shorterThan(long threshold) {
            return complete() && up - down < threshold;
        }

        synchronized long[] snapshot() {
            return new long[] { down, up, downs, ups, cancelled ? 1 : 0, nonTouchscreen ? 1 : 0, complete() ? 1 : 0 };
        }
    }

    private static final class PopupNavigation {
        final String url;
        final boolean gesture;
        final boolean mainFrame;
        final long at;

        PopupNavigation(WebResourceRequest request) {
            url = request.getUrl().toString();
            gesture = request.hasGesture();
            mainFrame = request.isForMainFrame();
            at = SystemClock.uptimeMillis();
        }

        JSONObject json() throws Exception {
            return new JSONObject().put("url", url).put("gesture", gesture).put("mainFrame", mainFrame).put("at", at);
        }
    }

    private static final class PopupHandoff {
        final String url;
        final String browserPackage;
        final List<PopupNavigation> navigations = Collections.synchronizedList(new ArrayList<>());
        int intentsBefore;
        String stateBefore;

        PopupHandoff(String url, String browserPackage) {
            this.url = url;
            this.browserPackage = browserPackage;
        }
    }

    private void tap(WebView target, String selector) throws Exception {
        tap(target, selector, null);
    }

    // Only a tap whose own handler hands the comic to a browser may close the WebView it lands on.
    // The production client dismisses the popup as part of that handoff, so the page cannot be asked
    // afterwards whether it saw a trusted click: a closed WebView never answers. The gesture is
    // proved natively instead, by the navigation request the click itself produces.
    private void tapClosingPopup(WebView popup, String selector, String url, String browserPackage) throws Exception {
        PopupHandoff handoff = new PopupHandoff(url, browserPackage);
        assertTrue("A closing tap starts on a live popup", popupViews().contains(popup));
        observePopupNavigations(popup, handoff.navigations);
        handoff.intentsBefore = Intents.getIntents().size();
        handoff.stateBefore = stateSummary();
        tap(popup, selector, handoff);
    }

    private void observePopupNavigations(WebView popup, List<PopupNavigation> seen) throws Exception {
        onMain(() -> {
            WebViewClient delegate = popup.getWebViewClient();
            popup.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return delegate.shouldInterceptRequest(view, request);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    seen.add(new PopupNavigation(request));
                    return delegate.shouldOverrideUrlLoading(view, request);
                }

                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                    delegate.onPageStarted(view, url, icon);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    delegate.onPageFinished(view, url);
                }

                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                    delegate.doUpdateVisitedHistory(view, url, reload);
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    return delegate.onRenderProcessGone(view, detail);
                }
            });
            return null;
        });
    }

    private void verifyPopupHandoff(WebView popup, PopupHandoff handoff, DeliveredTap delivered) throws Exception {
        JSONArray navigations = new JSONArray();
        List<PopupNavigation> seen;
        synchronized (handoff.navigations) {
            seen = new ArrayList<>(handoff.navigations);
        }
        for (PopupNavigation navigation : seen) navigations.put(navigation.json());
        lastTapRecord.put("navigations", navigations);
        assertEquals("The tap produces exactly one popup navigation: " + navigations, 1, seen.size());
        PopupNavigation navigation = seen.get(0);
        assertEquals("The tap navigates to its exact destination", handoff.url, navigation.url);
        assertTrue("The navigation is the popup's main frame", navigation.mainFrame);
        assertTrue("The navigation carries the user gesture of a trusted tap", navigation.gesture);
        assertTrue("The navigation follows the delivered touchscreen UP: " + lastTapRecord,
                navigation.at >= delivered.snapshot()[1]);
        List<Intent> all = Intents.getIntents();
        List<Intent> added = new ArrayList<>(all.subList(handoff.intentsBefore, all.size()));
        List<String> addedData = new ArrayList<>();
        for (Intent intent : added) addedData.add(intent.getAction() + " " + intent.getDataString() + " " + intent.getPackage());
        lastTapRecord.put("handoffIntents", new JSONArray(addedData));
        assertEquals("The tap dispatches exactly one intent, to the browser and never to an app: " + addedData,
                1, added.size());
        Intent intent = added.get(0);
        assertEquals("The handoff is a view intent", Intent.ACTION_VIEW, intent.getAction());
        assertEquals("The handoff carries the exact destination", handoff.url, intent.getDataString());
        assertEquals("The handoff is pinned to the expected browser", handoff.browserPackage, intent.getPackage());
        assertNull("No explicit activity bypasses the browser's own filters", intent.getComponent());
        assertTrue("The handoff is browsable", intent.hasCategory(Intent.CATEGORY_BROWSABLE));
        assertFalse("The handed-off popup is closed", popupViews().contains(popup));
        assertFalse("The handed-off popup is detached", onMain(() -> popup.isAttachedToWindow()));
        assertNotNull("The main WebView stays attached", onMain(() -> web.getParent()));
        assertEquals("The handoff does not change saved reading data", handoff.stateBefore, stateSummary());
    }

    private void tap(WebView target, String selector, PopupHandoff handoff) throws Exception {
        long preparationStarted = SystemClock.uptimeMillis();
        waitFor("Touchable DOM control " + selector, WAIT_MS, () -> truth(target,
                "(() => {const e=document.querySelector(" + quote(selector) + ");"
                        + "return !!e && !e.disabled && e.getBoundingClientRect().width>0;})()"));
        evaluate(target, "(() => {window.__nativeTap={selector:" + quote(selector) + ",events:[]};"
                + "if(!window.__nativeTapObserver){window.__nativeTapObserver=true;"
                + "for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend',"
                + "'touchcancel','mousedown','mouseup','click','contextmenu']){"
                + "document.addEventListener(type,e=>{const s=window.__nativeTap;if(!s || s.events.length>=24)return;"
                + "const expected=document.querySelector(s.selector);const t=e.target;"
                + "const p=e.changedTouches?.[0] ?? e;"
                + "s.events.push({type:e.type,trusted:e.isTrusted,time:e.timeStamp,"
                + "onTarget:!!expected && (t===expected || expected.contains(t)),"
                + "id:t.id ?? '',classes:String(t.className ?? ''),"
                + "text:(t.textContent ?? '').trim().slice(0,80),"
                + "pointerType:e.pointerType ?? '',x:p.clientX,y:p.clientY,"
                + "activation:navigator.userActivation.isActive});},{capture:true,passive:true});}}"
                + "document.querySelector(" + quote(selector)
                + ").scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});return true;})()");
        lastTapTarget = target;
        lastTapRecord = new JSONObject().put("selector", selector).put("preparationStarted", preparationStarted);
        if (handoff != null) lastTapRecord.put("closesPopupTo", handoff.url);
        tapDiagnostics.put(lastTapRecord);
        DeliveredTap delivered = new DeliveredTap();
        boolean observing = false;
        Throwable failure = null;
        try {
            AtomicReference<JSONObject> previous = new AtomicReference<>();
            int[] stable = { 0 };
            waitFor("DOM hit target and native geometry settle after scrolling " + selector, WAIT_MS, () -> {
                JSONObject current = tapGeometry(target, selector);
                lastTapRecord.put("geometry", current);
                boolean ready = current.getBoolean("hitTarget") && current.getBoolean("windowFocused")
                        && current.getDouble("x") >= 0 && current.getDouble("x") < current.getDouble("viewport")
                        && current.getDouble("y") >= 0 && current.getDouble("y") < current.getDouble("height");
                if (ready && previous.get() != null && previous.get().toString().equals(current.toString())) {
                    stable[0]++;
                } else {
                    stable[0] = 0;
                }
                previous.set(current);
                return stable[0] >= 2;
            });
            JSONObject box = previous.get();
            double ratio = box.getDouble("nativeWidth") / box.getDouble("viewport");
            float x = (float) (box.getDouble("nativeX") + box.getDouble("x") * ratio);
            float y = (float) (box.getDouble("nativeY") + box.getDouble("y") * ratio);
            onMain(() -> {
                // Injection can wait before DOWN dispatch; observe delivery without consuming input.
                target.setOnTouchListener((view, event) -> {
                    long received = SystemClock.uptimeMillis();
                    boolean touchscreen = event.isFromSource(InputDevice.SOURCE_TOUCHSCREEN);
                    switch (event.getActionMasked()) {
                        case MotionEvent.ACTION_DOWN -> delivered.down(received, touchscreen);
                        case MotionEvent.ACTION_UP -> delivered.up(received, touchscreen);
                        case MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> delivered.cancel();
                        default -> { }
                    }
                    return false;
                });
                return null;
            });
            observing = true;
            android.app.UiAutomation automation = instrumentation.getUiAutomation();
            long downTime = SystemClock.uptimeMillis();
            lastTapRecord.put("preparationMs", downTime - preparationStarted);
            long upTime;
            MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            try {
                assertTrue("Touchscreen DOWN is accepted", automation.injectInputEvent(down, false));
            } finally {
                upTime = SystemClock.uptimeMillis();
                MotionEvent up = MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, x, y, 0);
                up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                try {
                    assertTrue("Touchscreen UP is accepted", automation.injectInputEvent(up, false));
                } finally {
                    down.recycle();
                    up.recycle();
                    lastTapRecord.put("downTime", downTime).put("upTime", upTime)
                            .put("createdEventIntervalMs", upTime - downTime)
                            .put("injectionCallSpanMs", SystemClock.uptimeMillis() - downTime)
                            .put("screenX", x).put("screenY", y);
                }
            }
            long longPressThreshold = ViewConfiguration.getLongPressTimeout();
            lastTapRecord.put("longPressThresholdMs", longPressThreshold);
            waitFor(handoff == null ? "Trusted click reaches " + selector
                    : "Trusted tap on " + selector + " hands off and closes its popup", WAIT_MS, () -> {
                recordDeliveredTap(delivered);
                if (!delivered.complete()) return false;
                assertTrue("Delivered touchscreen interval must stay shorter than a long press: " + lastTapRecord,
                        delivered.shorterThan(longPressThreshold));
                if (handoff != null) return !popupViews().contains(target);
                return truth(target, "window.__nativeTap.events.some(e=>e.type==='click' && e.trusted && e.onTarget)");
            });
            if (handoff == null) {
                assertTrue("Real pointer DOWN and UP reach " + selector, truth(target,
                        "['pointerdown','pointerup'].every(type=>window.__nativeTap.events.some("
                                + "e=>e.type===type && e.trusted && e.onTarget))"));
                assertFalse("A short tap must not open text selection", truth(target,
                        "window.__nativeTap.events.some(e=>e.type==='contextmenu')"));
            } else {
                verifyPopupHandoff(target, handoff, delivered);
            }
        } catch (Exception | Error error) {
            failure = error;
            throw error;
        } finally {
            try {
                if (observing) onMain(() -> { target.setOnTouchListener(null); return null; });
                recordDeliveredTap(delivered);
                captureTapDiagnostics();
            } catch (Exception | Error cleanupError) {
                if (failure != null) failure.addSuppressed(cleanupError);
                else throw cleanupError;
            }
        }
    }

    private void recordDeliveredTap(DeliveredTap delivered) throws Exception {
        long[] sample = delivered.snapshot();
        lastTapRecord.put("deliveredDownTime", sample[0] < 0 ? JSONObject.NULL : sample[0])
                .put("deliveredUpTime", sample[1] < 0 ? JSONObject.NULL : sample[1])
                .put("deliveredDownCount", sample[2]).put("deliveredUpCount", sample[3])
                .put("deliveredCancelled", sample[4] == 1).put("deliveredNonTouchscreen", sample[5] == 1)
                .put("deliveredHeldMs", sample[6] == 1 ? sample[1] - sample[0] : JSONObject.NULL);
    }

    private JSONObject tapGeometry(WebView target, String selector) throws Exception {
        JSONObject box = (JSONObject) evaluate(target, "(() => {const e=document.querySelector("
                + quote(selector) + ");const r=e.getBoundingClientRect();"
                + "const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);"
                + "return {x,y,w:r.width,h:r.height,viewport:innerWidth,height:innerHeight,"
                + "scrollX,scrollY,visualScale:visualViewport.scale,visualX:visualViewport.offsetLeft,"
                + "visualY:visualViewport.offsetTop,hitTarget:hit===e || e.contains(hit)};})()");
        int[] nativeBox = onMain(() -> {
            int[] position = new int[2];
            target.getLocationOnScreen(position);
            return new int[] { position[0], position[1], target.getWidth(), target.getHeight(),
                    target.hasWindowFocus() ? 1 : 0 };
        });
        return box.put("nativeX", nativeBox[0]).put("nativeY", nativeBox[1])
                .put("nativeWidth", nativeBox[2]).put("nativeHeight", nativeBox[3])
                .put("windowFocused", nativeBox[4] == 1);
    }

    private void captureTapDiagnostics() throws Exception {
        if (lastTapTarget == null || lastTapRecord == null) return;
        if (lastTapRecord.has("closesPopupTo")) {
            // Asking a popup that may be mid-dismissal would hang on a callback that never comes.
            lastTapRecord.put("targetAttached", onMain(() -> lastTapTarget.isAttachedToWindow()));
        } else if (onMain(() -> lastTapTarget.isAttachedToWindow())) {
            lastTapRecord.put("observed", evaluate(lastTapTarget,
                    "({events:window.__nativeTap?.events ?? [],selection:String(window.getSelection()).slice(0,80),"
                            + "activation:navigator.userActivation.isActive})"));
        } else {
            lastTapRecord.put("targetDetached", true);
        }
        writeJson(evidenceName("tap-diagnostics.json"), new JSONObject().put("taps", tapDiagnostics));
    }

    private String awaitDocumentsUi() throws Exception {
        waitFor("The actual Android DocumentsUI is foreground", WAIT_MS, this::isDocumentsUi);
        return device.getCurrentPackageName();
    }

    private boolean isDocumentsUi() {
        String current = device.getCurrentPackageName();
        return current != null && current.endsWith(".documentsui");
    }

    private void selectDownloads(String pickerPackage) throws Exception {
        BySelector drawerTitle = By.pkg(pickerPackage).text("Save to");
        clickPickerControl("DocumentsUI storage roots are open",
                By.pkg(pickerPackage).desc("Show roots"), () -> device.hasObject(drawerTitle));
        clickPickerControl("Downloads root is selected and its drawer is closed",
                By.pkg(pickerPackage).text("Downloads"),
                () -> !device.hasObject(drawerTitle)
                        && device.hasObject(By.pkg(pickerPackage).text("Downloads"))
                        && device.hasObject(By.pkg(pickerPackage).clazz("android.widget.EditText")));
    }

    private void setPickerFilename(String pickerPackage, String filename) throws Exception {
        waitFor("DocumentsUI filename is " + filename, WAIT_MS, () -> {
            try {
                UiObject2 field = device.findObject(By.pkg(pickerPackage).clazz("android.widget.EditText"));
                if (field == null) return false;
                if (filename.equals(field.getText())) return true;
                field.setText(filename);
            } catch (StaleObjectException replaced) {
                // Re-query the editor after DocumentsUI rebuilds the selected location.
            }
            return false;
        });
    }

    private void clickPickerControl(String message, BySelector selector, Checked<Boolean> transitioned)
            throws Exception {
        boolean[] clicked = { false };
        waitFor(message, WAIT_MS, () -> {
            if (Boolean.TRUE.equals(transitioned.get())) return true;
            if (!clicked[0]) {
                try {
                    UiObject2 control = device.findObject(selector);
                    if (control != null && control.isEnabled()) {
                        control.click();
                        clicked[0] = true;
                    }
                } catch (StaleObjectException replaced) {
                    // Roots are asynchronously replaced; never retain a node across that transition.
                }
            }
            return false;
        });
    }

    private void stubDocument(String action, Uri uri) {
        Intent result = new Intent().setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intending(hasAction(action)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_OK, result));
    }

    private Bundle provider(String operation) {
        Bundle result = instrumentation.getTargetContext().getContentResolver()
                .call(FixtureDocumentProvider.saved(instrumentation.getContext()), operation, null, null);
        assertNotNull("Test-only provider responds to " + operation, result);
        return result;
    }

    private void startNativeSave(String content, String filename) throws Exception {
        evaluate(web, "(() => {window.__nativeSave={done:false};"
                + "(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));"
                + "const {saveDownload}=await import(location.origin+'/js/lib/download.js');"
                + "return saveDownload(" + quote(filename) + "," + quote(content) + ",'application/json');})()"
                + ".then(saved=>window.__nativeSave={done:true,saved},"
                + "error=>window.__nativeSave={done:true,saved:false,error:String(error)});return true;})()");
    }

    private int countIntents(String action) {
        int count = 0;
        for (Intent intent : Intents.getIntents()) if (action.equals(intent.getAction())) count++;
        return count;
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
                + "small:controls.map(e=>{const r=e.getBoundingClientRect();return {id:e.id,"
                + "classes:String(e.className),text:e.textContent.trim().slice(0,80),w:r.width,h:r.height};})"
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
        return method + (candidatePhase.isEmpty() ? (restartProbe ? "-restart-probe" : "")
                : "-" + candidatePhase + "-" + instrumentation.getTargetContext().getPackageName()) + "-" + suffix;
    }

    private String candidateEvidenceName() {
        return "candidate-" + candidatePhase + "-" + method + ".json";
    }

    private static String sha256(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static String fileSha256(String path) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream stream = Files.newInputStream(new File(path).toPath())) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = stream.read(buffer)) != -1) hash.update(buffer, 0, count);
        }
        return hex(hash.digest());
    }

    private JSONObject observedCandidateReceipt() throws Exception {
        Context target = instrumentation.getTargetContext();
        PackageInfo info = target.getPackageManager().getPackageInfo(target.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        assertNotNull("Installed target exposes its signing identity", info.signingInfo);
        Signature[] certificates = info.signingInfo.getApkContentsSigners();
        assertEquals("Exactly one installed APK signer", 1, certificates.length);
        List<String> hashes = new ArrayList<>();
        hashes.add(fileSha256(target.getApplicationInfo().sourceDir));
        if (target.getApplicationInfo().splitSourceDirs != null) {
            for (String split : target.getApplicationInfo().splitSourceDirs) hashes.add(fileSha256(split));
        }
        Collections.sort(hashes);
        JSONObject execution = new JSONObject().put("phase", candidatePhase).put("method", method)
                .put("packageName", target.getPackageName()).put("uid", target.getApplicationInfo().uid)
                .put("appHashes", new JSONArray(hashes))
                .put("harnessHash", fileSha256(instrumentation.getContext().getApplicationInfo().sourceDir))
                .put("signerSha256", sha256(certificates[0].toByteArray()))
                .put("stateMatched", stateMatched).put("settingsMatched", settingsMatched).put("storageCleared", storageCleared);
        String webView = onMain(() -> {
            assertNotNull("Actual WebView package is available", WebView.getCurrentWebViewPackage());
            return WebView.getCurrentWebViewPackage().versionName;
        });
        JSONObject deviceInfo = new JSONObject().put("sdk", Build.VERSION.SDK_INT).put("abi", Build.SUPPORTED_ABIS[0])
                .put("width", device.getDisplayWidth()).put("height", device.getDisplayHeight())
                .put("density", target.getResources().getDisplayMetrics().densityDpi).put("webViewVersion", webView);
        return new JSONObject().put("execution", execution).put("device", deviceInfo)
                .put("installation", installationEvidence == null ? JSONObject.NULL : installationEvidence);
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
