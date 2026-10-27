package io.github.raymondnassar.recappage.prototype;

import android.content.Context;
import java.io.IOException;
import javax.net.ssl.HttpsURLConnection;

final class CloudAndroidConfiguration {
    private CloudAndroidConfiguration() {}
    static CloudPort.Factory configured(Context context, CloudService.AuthFactory authentication) throws IOException {
        if (context == null || authentication == null) throw CloudJson.failure();
        Context application = context.getApplicationContext();
        java.nio.file.Path base = application.getNoBackupFilesDir().getCanonicalFile().toPath();
        CloudSessions.Factory protection = new CloudAndroidProtection(application);
        return (codec) -> new CloudService(base, authentication, protection, codec,
                (url) -> (HttpsURLConnection) url.openConnection());
    }
}
