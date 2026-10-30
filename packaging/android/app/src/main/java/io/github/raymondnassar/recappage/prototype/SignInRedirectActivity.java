package io.github.raymondnassar.recappage.prototype;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

// Where the browser returns after Microsoft's page, at the one registered msauth address. It is declared only
// in a build given a client configuration (src/cloud/AndroidManifest.xml), and it must be exported for the
// browser to reach it, so any app can send it an address too. The account takes only the answer to the
// sign-in under way, checked by its state and finished with its PKCE verifier, so a forged one is ignored.
public final class SignInRedirectActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri answer = getIntent() == null ? null : getIntent().getData();
        AndroidCloud cloud = AndroidCloud.get(this);
        if (cloud != null && answer != null) cloud.account.redirect(answer.toString());
        Intent back = new Intent(this, MainActivity.class);
        back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            startActivity(back);
        } catch (ActivityNotFoundException | SecurityException ignored) {
            // The person can return to the app themselves; the sign-in already has its answer.
        }
        finish();
    }
}
