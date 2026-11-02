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
    private static final int CONSENT = 1;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (saved != null) return;
        PendingIntent screen = screen(getIntent());
        if (screen == null) {
            answer(null);
            return;
        }
        try {
            startIntentSenderForResult(screen.getIntentSender(), CONSENT, null, 0, 0, 0);
        } catch (IntentSender.SendIntentException | RuntimeException error) {
            answer(null);
        }
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
        answer(resultCode == RESULT_OK ? data : null);
    }

    private void answer(Intent data) {
        CloudAccount.Consent consent = AndroidGoogle.WAITING.getAndSet(null);
        if (consent != null) {
            if (data == null) {
                consent.ended("declined");
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
