package io.github.raymondnassar.recappage.prototype;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public final class CloudMicrosoftRedirectActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (CloudSdkAuthFactory.deliverMicrosoft(getIntent().getData())
                || CloudAuthQualificationActivity.deliverMicrosoft(getIntent().getData())) {
            finish();
        } else {
            startActivity(new Intent(this, CloudSdkRedirectActivity.class).setData(getIntent().getData()));
            finish();
        }
    }
}
