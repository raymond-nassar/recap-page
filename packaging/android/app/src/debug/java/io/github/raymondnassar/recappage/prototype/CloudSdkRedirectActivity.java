package io.github.raymondnassar.recappage.prototype;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;

public final class CloudSdkRedirectActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (CloudSdkAuthFactory.deliverMicrosoft(getIntent().getData())) {
            finish();
        } else {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.cloud_qualification_return_ended_title)
                    .setMessage(R.string.cloud_qualification_return_ended)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> finish())
                    .setOnCancelListener((dialog) -> finish())
                    .show();
        }
    }
}
