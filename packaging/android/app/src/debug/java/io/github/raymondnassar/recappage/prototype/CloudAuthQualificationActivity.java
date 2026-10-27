package io.github.raymondnassar.recappage.prototype;

import android.accounts.Account;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.AtomicFile;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.browser.customtabs.CustomTabsIntent;

import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import net.openid.appauth.AuthState;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Callable;


public final class CloudAuthQualificationActivity extends Activity {
    private static final int RESOLUTION = 8201;
    private static final String CLIENT = CloudGoogleAuth.CLIENT;
    private static final String DRIVE = CloudGoogleAuth.DRIVE;
    private static WeakReference<CloudAuthQualificationActivity> microsoftOwner = new WeakReference<>(null);
    private static String microsoftQualificationNonce;
    private static String microsoftQualificationPhase;
    private static long microsoftQualificationUntil;
    private static CloudReadQualification storageQualification;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean finished;
    private volatile boolean closed;
    private volatile boolean ownsNewCache;
    private volatile boolean successful;
    private boolean verificationStarted;
    private String phase;
    private String nonce;
    private String provider;
    private String clientId;
    private CloudCredentialStore cache;
    private AuthorizationClient client;
    private TextView status;
    private Button signIn;
    private String expectedId;
    private String expectedEmail;
    private String microsoftState;
    private CloudMicrosoftAuth.Pending microsoft;
    private boolean browserStarted;
    private CloudReadQualification storageRead;

    static synchronized void beginStorageQualification(String provider, String phase, String nonce,
            String accountHash, String fileId, String digest, String rootId, String driveId) {
        if (storageQualification != null && storageQualification.active()) {
            throw new IllegalStateException("A synthetic storage qualification is already active.");
        }
        storageQualification = new CloudReadQualification(provider, phase, nonce, accountHash,
                fileId, digest, rootId, driveId, SystemClock::elapsedRealtime);
    }

    static synchronized void endStorageQualification(String provider, String phase, String nonce) {
        if (storageQualification != null && storageQualification.matches(provider, phase, nonce)) {
            storageQualification.close();
            storageQualification = null;
        }
    }

    private static synchronized CloudReadQualification storageQualification(String provider, String phase, String nonce) {
        return storageQualification != null && storageQualification.current(provider, phase, nonce)
                ? storageQualification : null;
    }

    static synchronized void beginMicrosoftQualification(String phase, String nonce) {
        if (!("prepare".equals(phase) || "reopen".equals(phase))
                || nonce == null || !nonce.matches("[a-f0-9]{64}")
                || (microsoftQualificationNonce != null && SystemClock.elapsedRealtime() < microsoftQualificationUntil)) {
            throw new IllegalStateException("Microsoft qualification is invalid or already active.");
        }
        microsoftQualificationNonce = nonce;
        microsoftQualificationPhase = phase;
        microsoftQualificationUntil = SystemClock.elapsedRealtime() + 6 * 60 * 1000;
    }

    static synchronized void endMicrosoftQualification(String nonce) {
        if (nonce != null && nonce.equals(microsoftQualificationNonce)) {
            microsoftQualificationNonce = null;
            microsoftQualificationPhase = null;
            microsoftQualificationUntil = 0;
        }
    }

    static synchronized boolean microsoftQualificationActive(String phase, String nonce) {
        return phase != null && nonce != null && nonce.equals(microsoftQualificationNonce)
                && phase.equals(microsoftQualificationPhase) && SystemClock.elapsedRealtime() < microsoftQualificationUntil;
    }

    private boolean currentQualification() {
        return (!"microsoft".equals(provider) || microsoftQualificationActive(phase, nonce))
                && (storageRead == null || storageRead.current(provider, phase, nonce));
    }

    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        phase = getIntent().getStringExtra("phase");
        nonce = getIntent().getStringExtra("nonce");
        provider = getIntent().getStringExtra("provider");
        boolean readRequested = getIntent().getBooleanExtra("readSynthetic", false);
        if (readRequested) storageRead = storageQualification(provider, phase, nonce);
        if (!("prepare".equals(phase) || "reopen".equals(phase))
                || !("google".equals(provider) || "microsoft".equals(provider))
                || nonce == null || !nonce.matches("[a-f0-9]{64}")
                || !getPackageName().equals("io.github.raymondnassar.recappage.prototype")
                || !currentQualification() || readRequested && storageRead == null) {
            finished = true;
            finish();
            return;
        }
        clientId = "google".equals(provider) ? CLIENT : CloudMicrosoftAuth.CLIENT;
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        status = new TextView(this);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setText("google".equals(provider) ? R.string.cloud_qualification_intro : R.string.cloud_qualification_microsoft_intro);
        if (storageRead != null) status.setText(R.string.cloud_qualification_existing_read);
        layout.addView(status, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        signIn = new Button(this);
        signIn.setText("google".equals(provider) ? R.string.cloud_qualification_sign_in : R.string.cloud_qualification_microsoft_sign_in);
        signIn.setEnabled(false);
        signIn.setOnClickListener((view) -> authorize());
        layout.addView(signIn);
        Button cancel = new Button(this, null, android.R.attr.borderlessButtonStyle);
        cancel.setText(android.R.string.cancel);
        cancel.setOnClickListener((view) -> { if (finished) finish(); else fail("cancelled"); });
        layout.addView(cancel);
        setContentView(layout);
        if (savedState != null) {
            fail("interrupted");
            return;
        }
        worker.execute(() -> {
            try {
                cache = new CloudCredentialStore(this, profile(provider), provider, clientId);
                String held = cache.load();
                if ("prepare".equals(phase)) {
                    if (held != null) throw new IllegalStateException("Qualification cache already exists");
                    ownsNewCache = true;
                } else {
                    JSONObject record = new JSONObject(held);
                    if (record.length() != ("google".equals(provider) ? 5 : 6) || record.getInt("version") != 1
                            || !record.getString("provider").equals(provider)
                            || !record.getString("clientId").equals(clientId)
                            || !(record.opt("id") instanceof String)) {
                        throw new IllegalStateException("Wrong native cache");
                    }
                    expectedId = record.getString("id");
                    if ("google".equals(provider)) expectedEmail = record.getString("email");
                    else microsoftState = record.getString("state");
                }
                main.post(() -> {
                    if (finished || closed) return;
                    if ("reopen".equals(phase)) authorize();
                    else signIn.setEnabled(true);
                });
            } catch (Exception error) {
                main.post(() -> fail("protected-cache"));
            }
        });
    }

    private void authorize() {
        if (finished || closed) return;
        if (!currentQualification()) {
            fail("expired");
            return;
        }
        if ("microsoft".equals(provider)) {
            signIn.setEnabled(false);
            status.setText(R.string.cloud_qualification_microsoft_waiting);
            if ("reopen".equals(phase)) {
                verifyMicrosoft(() -> CloudMicrosoftAuth.reopen(microsoftState, expectedId));
            } else {
                try {
                    microsoft = CloudMicrosoftAuth.begin(this);
                    microsoftOwner = new WeakReference<>(this);
                    browserStarted = true;
                    new CustomTabsIntent.Builder().build().launchUrl(this, microsoft.request.toUri());
                } catch (Exception error) {
                    fail(error instanceof CloudMicrosoftAuth.Failure
                            ? "microsoft-" + ((CloudMicrosoftAuth.Failure) error).code : "microsoft-authorization-ui");
                }
            }
            return;
        }
        if (client == null) client = Identity.getAuthorizationClient(this);
        signIn.setEnabled(false);
        status.setText(R.string.cloud_qualification_waiting);
        AuthorizationRequest.Builder request = AuthorizationRequest.builder()
                .setRequestedScopes(Arrays.asList(new Scope(DRIVE), new Scope("openid"), new Scope("email")))
                .setOptOutIncludingGrantedScopes(true);
        if (expectedEmail != null) request.setAccount(new Account(expectedEmail, "com.google"));
        client.authorize(request.build()).addOnSuccessListener((result) -> accept(result))
                .addOnFailureListener((error) -> fail(error instanceof ApiException
                        ? "google-sdk-" + ((ApiException) error).getStatusCode() : "google-sdk"));
    }

    private void accept(AuthorizationResult result) {
        if (finished || closed || verificationStarted) return;
        if (result.hasResolution()) {
            if ("reopen".equals(phase)) {
                fail("reconnect-required");
                return;
            }
            try {
                startIntentSenderForResult(result.getPendingIntent().getIntentSender(), RESOLUTION, null, 0, 0, 0);
            } catch (Exception error) {
                fail("authorization-ui");
            }
            return;
        }
        verificationStarted = true;
        status.setText(R.string.cloud_qualification_verifying);
        worker.execute(() -> {
            try {
                CloudNativeAuth.Proof proof = CloudGoogleAuth.verify(result, expectedId,
                        () -> !finished && !closed && currentQualification());
                if (finished || closed) return;
                saveIdentity(new JSONObject().put("version", 1).put("provider", provider)
                        .put("clientId", clientId).put("id", proof.id).put("email", proof.material), proof.id, proof.token);
            } catch (Exception error) {
                main.post(() -> fail(error instanceof StorageReadFailure ? "synthetic-read" : "identity-or-protected-cache"));
            }
        });
    }

    static boolean deliverMicrosoft(Uri uri) {
        CloudAuthQualificationActivity owner = microsoftOwner.get();
        if (owner == null || owner.finished || owner.closed || owner.verificationStarted
                || !owner.currentQualification() || owner.microsoft == null || !owner.microsoft.matches(uri)) return false;
        owner.verifyMicrosoft(() -> CloudMicrosoftAuth.exchange(owner.microsoft, uri));
        return true;
    }

    private void verifyMicrosoft(Callable<CloudMicrosoftAuth.Identity> operation) {
        if (finished || closed || verificationStarted || !currentQualification()) return;
        verificationStarted = true;
        status.setText(R.string.cloud_qualification_verifying);
        worker.execute(() -> {
            try {
                CloudMicrosoftAuth.Identity identity = operation.call();
                saveIdentity(new JSONObject().put("version", 1).put("provider", provider)
                        .put("clientId", clientId).put("id", identity.id)
                        .put("label", identity.label).put("state", identity.state), identity.id,
                        AuthState.jsonDeserialize(identity.state).getAccessToken());
            } catch (Exception error) {
                main.post(() -> fail(error instanceof StorageReadFailure ? "synthetic-read" : error instanceof CloudMicrosoftAuth.Failure
                        ? "microsoft-" + ((CloudMicrosoftAuth.Failure) error).code : "microsoft-identity-or-cache"));
            }
        });
    }

    private static final class StorageReadFailure extends Exception {}

    private void saveIdentity(JSONObject record, String id, String token) throws Exception {
        if (finished || closed || !currentQualification()) return;
        cache.save(record.toString());
        if (finished || closed || !currentQualification()) {
            if (ownsNewCache || "microsoft".equals(provider)) cache.clear();
            return;
        }
        JSONObject output = new JSONObject().put("ok", true).put("accountHash", hash(id))
                .put("clientMatches", true).put("requiredScope", true).put("protectedCache", true)
                .put("silentReopen", "reopen".equals(phase));
        if (storageRead != null) {
            try {
                CloudProviderReads.Selected selected = storageRead.read(provider, phase, nonce, hash(id), token,
                        () -> !finished && !closed && currentQualification());
                output.put("storageRead", true).put("fixtureSha256", selected.digest)
                        .put("fixtureBytes", selected.bytes.length);
            } catch (Exception error) {
                throw new StorageReadFailure();
            }
        }
        main.post(() -> complete(output));
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (browserStarted && !verificationStarted && !finished && !closed) fail("cancelled");
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != RESOLUTION || finished) return;
        if (result != RESULT_OK || data == null) {
            fail("cancelled");
            return;
        }
        try {
            accept(client.getAuthorizationResultFromIntent(data));
        } catch (ApiException error) {
            fail("google-result-" + error.getStatusCode());
        }
    }

    private void fail(String code) {
        if (finished) return;
        try { complete(new JSONObject().put("ok", false).put("error", code)); }
        catch (Exception error) { persistenceFailed(); }
    }

    private void complete(JSONObject output) {
        if (finished) return;
        if (output.optBoolean("ok") && !currentQualification()) {
            fail("expired");
            return;
        }
        try {
            output.put("version", 1).put("provider", provider).put("phase", phase).put("nonce", nonce)
                    .put("process", android.os.Process.myPid());
            AtomicFile record = new AtomicFile(new File(getNoBackupFilesDir(), "cloud-" + provider + "-qualification-result.json"));
            byte[] bytes = output.toString().getBytes(StandardCharsets.UTF_8);
            FileOutputStream stream = record.startWrite();
            try {
                stream.write(bytes);
                stream.getFD().sync();
                record.finishWrite(stream);
            } catch (Exception error) {
                record.failWrite(stream);
                throw error;
            }
            if (record.getBaseFile().length() > 8192
                    || !Arrays.equals(bytes, java.nio.file.Files.readAllBytes(record.getBaseFile().toPath()))) {
                throw new IllegalStateException("Result readback");
            }
            successful = output.getBoolean("ok");
            finished = true;
            status.setText(successful ? R.string.cloud_qualification_success : R.string.cloud_qualification_stopped);
            finish();
        } catch (Exception error) {
            persistenceFailed();
        }
    }

    private void persistenceFailed() {
        finished = true;
        successful = false;
        status.setText(R.string.cloud_qualification_result_failure);
        android.util.Log.e("RecapCloudQualification", "Result persistence failed; private details omitted.");
    }

    @Override
    public void finish() {
        closed = true;
        super.finish();
    }

    @Override
    protected void onDestroy() {
        if (microsoftOwner.get() == this) microsoftOwner.clear();
        if (!finished) fail("interrupted");
        if ("microsoft".equals(provider)) endMicrosoftQualification(nonce);
        endStorageQualification(provider, phase, nonce);
        if (ownsNewCache && !successful && !worker.isShutdown()) worker.execute(() -> {
            try {
                cache.clear();
            } catch (Exception error) {
                android.util.Log.e("RecapCloudQualification", "Qualification cache cleanup was not verified; private details omitted.");
            }
        });
        worker.shutdown();
        super.onDestroy();
    }

    private static String profile(String provider) throws Exception { return hash("recap-" + provider + "-native-qualification-v1"); }

    private static String hash(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(64);
        for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }
}
