package io.github.raymondnassar.recappage.prototype;

import android.accounts.Account;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

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
import java.util.concurrent.atomic.AtomicReference;

// Google's sign-in on Android, through Play services' AuthorizationClient (#810, P04, option B). Google refuses
// a custom-scheme redirect from an Android app, so the browser route OneDrive takes is not open here; Play
// services holds the grant instead and hands out short-lived tokens for the address the account stored. No
// client id is in the app: Google matches the package name and signing certificate to the project's Android
// client. Nothing here revokes access, because a revocation reaches every device in the project.
final class AndroidGoogle implements CloudAccount.Google {
    // The consent waiting for the screen Play services asked to show, read once by GoogleConsentActivity.
    static final AtomicReference<CloudAccount.Consent> WAITING = new AtomicReference<>();

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
    public void authorize(String account, CloudAccount.Consent consent) {
        client.authorize(request(account))
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        show(result.getPendingIntent(), consent);
                    } else {
                        consent.granted(result.getAccessToken(), result.getGrantedScopes());
                    }
                })
                .addOnFailureListener(error -> consent.ended("failed"));
    }

    private void show(PendingIntent screen, CloudAccount.Consent consent) {
        if (screen == null) {
            consent.ended("failed");
            return;
        }
        CloudAccount.Consent earlier = WAITING.getAndSet(consent);
        if (earlier != null && earlier != consent) earlier.ended("failed");
        Intent intent = new Intent(app, GoogleConsentActivity.class);
        intent.putExtra(GoogleConsentActivity.SCREEN, screen);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            app.startActivity(intent);
        } catch (RuntimeException error) {
            if (WAITING.compareAndSet(consent, null)) consent.ended("failed");
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
