package io.github.raymondnassar.recappage.prototype;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Build;
import android.os.Bundle;

import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;

// Shows Google's consent screen when Play services asks for one, and hands its answer to the sign-in that
// asked. It is its own activity so MainActivity's results, the file pickers', stay untouched, and it is not
// exported, so only this app can start it.
public final class GoogleConsentActivity extends Activity {
    static final String SCREEN = "recap.google.screen";
    static final String ATTEMPT = "recap.google.attempt";
    private static final int CONSENT = 1;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (!AndroidGoogle.WAITING.has(attempt())) {
            finish();
            return;
        }
        if (saved != null) return;
        PendingIntent screen = screen(getIntent());
        if (screen == null) {
            answer(null, "failed");
            return;
        }
        try {
            if (!AndroidGoogle.WAITING.runIfPending(attempt(),
                    () -> startIntentSenderForResult(screen.getIntentSender(), CONSENT, null, 0, 0, 0))) {
                finish();
            }
        } catch (IntentSender.SendIntentException | RuntimeException error) {
            answer(null, "failed");
        }
    }

    private String attempt() {
        Intent intent = getIntent();
        return intent == null ? null : intent.getStringExtra(ATTEMPT);
    }

    @SuppressWarnings("deprecation")
    private static PendingIntent screen(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return intent.getParcelableExtra(SCREEN, PendingIntent.class);
        return intent.getParcelableExtra(SCREEN);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CONSENT) return;
        answer(resultCode == RESULT_OK ? data : null, resultCode == RESULT_OK ? "failed" : "declined");
    }

    private void answer(Intent data, String missingReason) {
        CloudAccount.Consent consent = AndroidGoogle.WAITING.take(attempt());
        if (consent != null) {
            if (data == null) {
                consent.ended(missingReason);
            } else {
                try {
                    AuthorizationResult result = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
                    consent.granted(result.getAccessToken(), result.getGrantedScopes());
                } catch (ApiException | RuntimeException error) {
                    consent.ended("failed");
                }
            }
        }
        finish();
    }
}
