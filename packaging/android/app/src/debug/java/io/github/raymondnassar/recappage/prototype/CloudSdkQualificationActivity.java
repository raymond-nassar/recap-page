package io.github.raymondnassar.recappage.prototype;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

public final class CloudSdkQualificationActivity extends MainActivity {
    private static boolean used;
    private static WeakReference<CloudSdkQualificationActivity> presentation = new WeakReference<>(null);
    private static WeakReference<CloudSdkQualificationActivity> service = new WeakReference<>(null);
    private CloudSdkAuthFactory authentication;
    private CloudPort.Factory candidate;
    private CloudSdkQualificationScope serviceScope;
    private CloudProviderHttp.Provider presentationProvider;
    private String presentationNonce, presentationProfile;
    private final AtomicBoolean presentationStarted = new AtomicBoolean();
    private final AtomicBoolean presentationClosed = new AtomicBoolean();
    private final AtomicBoolean presentationShown = new AtomicBoolean();
    private final AtomicBoolean presentationAuthorized = new AtomicBoolean();
    private final AtomicBoolean presentationCancelled = new AtomicBoolean();

    @Override protected void prepareNativeCloud() throws IOException {
        if (Build.VERSION.SDK_INT < 28 || used) throw CloudNativeAuth.failure();
        String requested = getIntent().getStringExtra("recapCloudPresentationProvider");
        if (requested != null) {
            presentationNonce = getIntent().getStringExtra("recapCloudPresentationNonce");
            if (!("google".equals(requested) || "microsoft".equals(requested))
                    || presentationNonce == null || !presentationNonce.matches("[a-f0-9]{64}")) {
                throw CloudNativeAuth.failure();
            }
            presentationProvider = "google".equals(requested)
                    ? CloudProviderHttp.Provider.GOOGLE : CloudProviderHttp.Provider.MICROSOFT;
            presentationProfile = CloudJson.random();
        }
        used = true;
        String session = CloudJson.random();
        try {
            String serviceInput = getIntent().getStringExtra("recapCloudServiceInputs");
            Path fresh;
            if (serviceInput != null) {
                if (presentationProvider != null || serviceInput.length() > 8192) throw CloudNativeAuth.failure();
                Map<String, Object> input = CloudJson.object(CloudJson.parse(
                        android.util.Base64.decode(serviceInput, android.util.Base64.NO_WRAP), 8192));
                Context tests = createPackageContext(getPackageName() + ".test", 0);
                if (!packageDigest(getPackageCodePath()).equals(input.get("appSha256"))
                        || !packageDigest(tests.getPackageCodePath()).equals(input.get("testSha256"))) {
                    throw CloudNativeAuth.failure();
                }
                Map<String, Object> fixtures;
                try (InputStream asset = tests.getAssets().open("cloud-service-fixtures.json")) {
                    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = asset.read(buffer)) != -1) {
                        if (bytes.size() + count > 65536) throw CloudNativeAuth.failure();
                        bytes.write(buffer, 0, count);
                    }
                    fixtures = CloudJson.object(CloudJson.parse(bytes.toByteArray(), 65536));
                }
                if (!CloudJson.exact(fixtures, "format", "version", "providers")
                        || !"recap-native-service-fixtures".equals(fixtures.get("format"))
                        || CloudJson.integer(fixtures.get("version")) != 1) throw CloudNativeAuth.failure();
                Map<String, Object> fixture = CloudJson.object(CloudJson.object(fixtures.get("providers")).get(input.get("provider")));
                serviceScope = CloudSdkQualificationScope.open(getNoBackupFilesDir().getCanonicalFile().toPath(), input, fixture, android.os.Process.myPid());
                if (serviceScope.keepScreenOn()) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                fresh = serviceScope.nativeBase();
                WebView.setDataDirectorySuffix(serviceScope.suffix());
            } else {
                WebView.setDataDirectorySuffix("cloud-sdk-" + session);
                Path parent = getNoBackupFilesDir().toPath().resolve("cloud-sdk-qualification-v1");
                CloudJournal.directory(parent);
                fresh = parent.resolve(session);
                Files.createDirectory(fresh);
            }
            Context isolated = new ContextWrapper(getApplicationContext()) {
                @Override public Context getApplicationContext() { return this; }
                @Override public File getNoBackupFilesDir() { return fresh.toFile(); }
            };
            authentication = new CloudSdkAuthFactory(this, isolated);
            if (serviceScope == null) candidate = CloudAndroidConfiguration.configured(isolated, authentication);
            else {
                serviceScope.preserveCandidates((ordinal, bytes) -> {
                    try {
                        String profile = CloudOwnership.hash(serviceScope.runId() + ":outgoing:" + ordinal);
                        CloudProviderHttp.Provider selected = serviceScope.provider();
                        String provider = CloudOwnership.provider(selected);
                        CloudCredentialStore store = new CloudCredentialStore(isolated, profile, provider, authentication.clientId(selected));
                        store.save(CloudJson.canonical(CloudJson.map("format", "recap-native-qualification-candidate", "version", 1,
                                "sha256", CloudJson.hash(bytes), "bytes", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))));
                    } catch (IOException error) { throw new UncheckedIOException(error); }
                });
                candidate = (codec) -> {
                    try {
                        CloudService configured = new CloudService(serviceScope.nativeBase(), serviceScope.authentication(authentication),
                                new CloudAndroidProtection(isolated), serviceScope.codec(codec), serviceScope::connection, serviceScope.discoveryStreamId());
                        configured.observe(serviceScope.observer());
                        return configured;
                    } catch (IOException | RuntimeException error) {
                        try { serviceScope.refused(); } catch (IOException preservation) { error.addSuppressed(preservation); }
                        throw error;
                    }
                };
                service = new WeakReference<>(this);
            }
            if (presentationProvider != null) presentation = new WeakReference<>(this);
        } catch (Exception error) {
            if (serviceScope != null) {
                try { serviceScope.refused(); } catch (IOException preservation) { error.addSuppressed(preservation); }
            }
            if (authentication != null) authentication.close();
            throw CloudNativeAuth.failure();
        }
    }
    private static String packageDigest(String path) throws Exception {
        File file = new File(path);
        if (!file.isFile() || file.length() < 1 || file.length() > 64 * 1024 * 1024) throw CloudNativeAuth.failure();
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int count, total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 64 * 1024 * 1024) throw CloudNativeAuth.failure();
                digest.update(buffer, 0, count);
            }
        }
        StringBuilder value = new StringBuilder();
        for (byte element : digest.digest()) {
            value.append(Character.forDigit((element >>> 4) & 15, 16)).append(Character.forDigit(element & 15, 16));
        }
        return value.toString();
    }
    @Override protected CloudPort.Factory cloudFactory() { return candidate; }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (!focused || presentationProvider == null || authentication == null || presentationClosed.get()
                || !presentationStarted.compareAndSet(false, true)) return;
        new Thread(() -> {
            CloudService.Auth auth = null;
            boolean returnedAccount = false, credentialsCleared = false, emptyOwnProfileVerified = false;
            String stopped = null;
            try {
                auth = authentication.open(presentationProfile, presentationProvider, 1);
                if (auth.status() != null) throw CloudNativeAuth.failure();
                emptyOwnProfileVerified = true;
                auth.connect(() -> !presentationClosed.get() && !isFinishing() && !isDestroyed());
                returnedAccount = true;
            } catch (Exception error) {
                stopped = presentationCancelled.get() ? "native-cancel-observed" : "native-entry-refused";
            } finally {
                if (auth != null && emptyOwnProfileVerified) {
                    try { auth.disconnect(); credentialsCleared = true; }
                    catch (Exception error) { android.util.Log.e("RecapCloudUi", "Own presentation credential cleanup was not confirmed."); }
                }
                boolean ok = presentationShown.get() && presentationCancelled.get()
                        && !presentationAuthorized.get() && !returnedAccount && credentialsCleared;
                try {
                    Path results = getNoBackupFilesDir().toPath().resolve("cloud-sdk-ui-results");
                    CloudJournal.directory(results);
                    Path destination = results.resolve(presentationNonce + ".json");
                    if (Files.exists(destination)) throw CloudNativeAuth.failure();
                    Path prepared = results.resolve(presentationNonce + ".pending");
                    Files.write(prepared, CloudJson.canonical(CloudJson.map(
                            "nonce", presentationNonce, "provider", CloudOwnership.provider(presentationProvider),
                            "ok", ok, "shown", presentationShown.get(), "authorized", presentationAuthorized.get(),
                            "cancelled", presentationCancelled.get(), "credentialsCleared", credentialsCleared,
                            "returnedAccount", returnedAccount, "stopped", stopped, "process", android.os.Process.myPid()))
                            .getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
                    Files.move(prepared, destination, StandardCopyOption.ATOMIC_MOVE);
                } catch (Exception error) { android.util.Log.e("RecapCloudUi", "Presentation result was not recorded; preserve its private test directory."); }
                new Handler(Looper.getMainLooper()).post(() -> { if (!isDestroyed()) finish(); });
            }
        }, "recap-cloud-ui").start();
    }
    static void presentationEvent(String profile, CloudProviderHttp.Provider provider, String event) {
        CloudSdkQualificationActivity owner = presentation.get();
        if (owner == null || owner.presentationClosed.get() || !profile.equals(owner.presentationProfile)
                || provider != owner.presentationProvider) return;
        if ("shown".equals(event)) owner.presentationShown.set(true);
        else if ("authorize".equals(event)) owner.presentationAuthorized.set(true);
        else if ("cancel".equals(event)) owner.presentationCancelled.set(true);
    }
    public static final class ClosePresentation extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            CloudSdkQualificationActivity owner = presentation.get();
            String nonce = intent.getStringExtra("recapCloudPresentationNonce");
            if (owner != null && nonce != null && nonce.equals(owner.presentationNonce)) {
                owner.presentationClosed.set(true);
                if (owner.authentication != null) owner.authentication.close();
                owner.finish();
                return;
            }
            CloudSdkQualificationActivity active = service.get();
            String run = intent.getStringExtra("recapCloudServiceRun");
            try {
                if (active == null || active.serviceScope == null || run == null || !run.equals(active.serviceScope.runId())) return;
                if (active.authentication != null) active.authentication.close();
                active.finish();
            } catch (IOException error) { android.util.Log.e("RecapCloudSdk", "The owned SDK test could not be closed; preserve its process and private state."); }
        }
    }
    @Override protected void onDestroy() {
        presentationClosed.set(true);
        try { super.onDestroy(); }
        finally {
            if (authentication != null) authentication.close();
            if (presentation.get() == this) presentation = new WeakReference<>(null);
            if (service.get() == this) service = new WeakReference<>(null);
        }
    }
}
