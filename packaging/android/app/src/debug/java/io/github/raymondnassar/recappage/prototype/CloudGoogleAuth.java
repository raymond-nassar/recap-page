package io.github.raymondnassar.recappage.prototype;

import com.google.android.gms.auth.api.identity.AuthorizationResult;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import javax.net.ssl.HttpsURLConnection;

final class CloudGoogleAuth {
    static final String CLIENT = "1009735496089-k5nhrrnhcdpagr7e15fktrs1r2pshq85.apps.googleusercontent.com";
    static final String DRIVE = "https://www.googleapis.com/auth/drive.appdata";
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor((work) -> {
        Thread thread = new Thread(work, "recap-google-auth-deadline");
        thread.setDaemon(true);
        return thread;
    });
    private CloudGoogleAuth() {}

    static CloudNativeAuth.Proof verify(AuthorizationResult result, CloudNativeAuth.Request request,
            CloudNativeAuth.Cached expected) throws Exception {
        return verify(result, expected == null ? null : expected.id, request::current);
    }
    static CloudNativeAuth.Proof verify(AuthorizationResult result, String expectedId, BooleanSupplier current) throws Exception {
        if (!current.getAsBoolean()) throw CloudNativeAuth.failure();
        if (result == null || result.hasResolution() || !scopes(result.getGrantedScopes())) throw CloudNativeAuth.failure();
        String token = result.getAccessToken();
        if (token == null || token.isEmpty() || token.length() > 65536 || !token.matches("[\\x21-\\x7e]+")) throw CloudNativeAuth.failure();
        JSONObject info = tokenInfo(token);
        if (!current.getAsBoolean()) throw CloudNativeAuth.failure();
        if (!(info.opt("sub") instanceof String) || !(info.opt("email") instanceof String)
                || !(info.opt("aud") instanceof String) || !(info.opt("scope") instanceof String)) throw CloudNativeAuth.failure();
        String id = info.getString("sub"), email = info.getString("email");
        if (!CLIENT.equals(info.getString("aud")) || info.has("azp") && !CLIENT.equals(info.getString("azp"))
                || id.isEmpty() || id.length() > 1024 || email.isEmpty() || email.length() > 1024
                || !"true".equals(info.optString("email_verified")) || Long.parseLong(info.optString("expires_in", "0")) <= 0
                || !scopes(Arrays.asList(info.getString("scope").split(" ")))
                || expectedId != null && !expectedId.equals(id)) throw CloudNativeAuth.failure();
        return new CloudNativeAuth.Proof(id, email, email, token);
    }
    private static boolean scopes(List<String> scopes) {
        return scopes != null && scopes.contains(DRIVE) && scopes.contains("openid")
                && (scopes.contains("email") || scopes.contains("https://www.googleapis.com/auth/userinfo.email"));
    }
    private static JSONObject tokenInfo(String token) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL("https://oauth2.googleapis.com/tokeninfo").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(30000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(0);
        ScheduledFuture<?> timeout = DEADLINES.schedule(connection::disconnect, 30, TimeUnit.SECONDS);
        try {
            connection.getOutputStream().close();
            if (connection.getResponseCode() != 200) throw CloudNativeAuth.failure();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (body.size() + count > 65536) throw CloudNativeAuth.failure();
                    body.write(buffer, 0, count);
                }
            }
            byte[] bytes = body.toByteArray();
            String text = new String(bytes, StandardCharsets.UTF_8);
            if (!Arrays.equals(bytes, text.getBytes(StandardCharsets.UTF_8))) throw CloudNativeAuth.failure();
            return new JSONObject(text);
        } finally {
            timeout.cancel(false);
            connection.disconnect();
        }
    }
}
