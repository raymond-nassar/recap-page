package io.github.raymondnassar.recappage.prototype;

import android.accounts.Account;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;

import java.util.Collections;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

// Google's sign-in on Android, through Play services' AuthorizationClient (#810, P04, option B). Google refuses
// a custom-scheme redirect from an Android app, so the browser route OneDrive takes is not open here; Play
// services holds the grant instead and hands out short-lived tokens for the address the account stored. No
// client id is in the app: Google matches the package name and signing certificate to the project's Android
// client. Nothing here revokes access, because a revocation reaches every device in the project.
final class AndroidGoogle implements CloudAccount.Google {
    static final CloudGoogleConsent WAITING = new CloudGoogleConsent();

    private final Context app;
    private final AuthorizationClient client;

    private AndroidGoogle(Context app) {
        this.app = app;
        this.client = Identity.getAuthorizationClient(app);
    }

    // Null where Play services is missing or unusable, so the account offers OneDrive alone.
    static AndroidGoogle create(Context app) {
        try {
            if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(app) != ConnectionResult.SUCCESS) return null;
            return new AndroidGoogle(app);
        } catch (RuntimeException | LinkageError error) {
            Log.w("RecapCloud", "Google Drive sign-in could not be initialized.");
            return null;
        }
    }

    private static AuthorizationRequest request(String account) {
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope(CloudAccount.GOOGLE_SCOPE)));
        if (account != null) builder.setAccount(new Account(account, "com.google"));
        return builder.build();
    }

    @Override
    public CloudAccount.GoogleAttempt authorize(String account, CloudAccount.Consent consent) {
        String id = WAITING.add(consent);
        return new CloudAccount.GoogleAttempt() {
            private final AtomicBoolean started = new AtomicBoolean();

            @Override
            public void start() {
                if (!started.compareAndSet(false, true) || !WAITING.has(id)) return;
                client.authorize(request(account))
                        .addOnSuccessListener(result -> {
                            if (result.hasResolution()) {
                                show(result.getPendingIntent(), id);
                            } else {
                                CloudAccount.Consent pending = WAITING.take(id);
                                if (pending != null) pending.granted(result.getAccessToken(), result.getGrantedScopes());
                            }
                        })
                        .addOnFailureListener(error -> failed(id));
            }

            @Override
            public void cancel() {
                WAITING.cancel(id);
            }
        };
    }

    private void failed(String id) {
        CloudAccount.Consent pending = WAITING.take(id);
        if (pending != null) pending.ended("failed");
    }

    private void show(PendingIntent screen, String id) {
        if (screen == null) {
            failed(id);
            return;
        }
        if (!WAITING.has(id)) return;
        Intent intent = new Intent(app, GoogleConsentActivity.class);
        intent.putExtra(GoogleConsentActivity.SCREEN, screen);
        intent.putExtra(GoogleConsentActivity.ATTEMPT, id);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            WAITING.runIfPending(id, () -> app.startActivity(intent));
        } catch (RuntimeException error) {
            failed(id);
        }
    }

    // Run on the account's worker, never the main thread. Null means Google wants the person to agree again,
    // which only a sign-in started from the page can show.
    @Override
    public String token(String account, String stale) throws CloudError {
        try {
            if (stale != null) {
                try {
                    Tasks.await(client.clearToken(ClearTokenRequest.builder().setToken(stale).build()), 30, TimeUnit.SECONDS);
                } catch (InterruptedException error) {
                    throw error;
                } catch (Exception ignored) {
                    // A token that cannot be cleared from the cache is only asked about again; Drive refuses it.
                }
            }
            AuthorizationResult result = Tasks.await(client.authorize(request(account)), 30, TimeUnit.SECONDS);
            if (result.hasResolution()) return null;
            if (result.getGrantedScopes() == null || !result.getGrantedScopes().contains(CloudAccount.GOOGLE_SCOPE)) return null;
            String token = result.getAccessToken();
            return token == null || token.isEmpty() ? null : token;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CloudError("unavailable", "Google did not answer in time.");
        } catch (Exception error) {
            throw new CloudError("unavailable", "Google could not be reached.");
        }
    }
}
