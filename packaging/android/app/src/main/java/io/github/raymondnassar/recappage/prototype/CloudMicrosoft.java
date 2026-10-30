package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.LongSupplier;

// Microsoft's token endpoint for personal accounts, as host/oneDrive.mjs uses it on Windows: redeeming a
// sign-in's code, refreshing, and reading which account the id token names.
final class CloudMicrosoft {
    private CloudMicrosoft() {}

    static final long METADATA_MS = 30_000;
    private static final int JSON_LIMIT = 1024 * 1024;
    private static final String FOLDER_SCOPE = "files.readwrite.appfolder";

    static final class Tokens {
        final String accessToken;
        final String refreshToken;
        final String idToken;
        final String scope;
        final long expiresInMs;

        Tokens(String accessToken, String refreshToken, String idToken, String scope, long expiresInMs) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.idToken = idToken;
            this.scope = scope;
            this.expiresInMs = expiresInMs;
        }
    }

    static final class Claims {
        final String subject;
        final String hint;

        Claims(String subject, String hint) {
            this.subject = subject;
            this.hint = hint;
        }
    }

    // The response's JSON object, or null for a body that is too large, broken off, or not an object.
    static Map<String, Object> json(CloudHttp.Response response) {
        if (response.body == null) return null;
        return CloudJson.object(new String(response.body, StandardCharsets.UTF_8));
    }

    static CloudError networkFailure(IOException error, String what) {
        return error instanceof CloudHttp.Timeout
                ? new CloudError("timeout", what + " did not answer in time.")
                : new CloudError("unavailable", what + " could not be reached.");
    }

    static Tokens redeem(CloudHttp http, String clientId, LongSupplier clock, String code, String verifier, String redirectUri) throws CloudError {
        return request(http, clock, CloudRules.form("client_id", clientId, "grant_type", "authorization_code", "code", code,
                "redirect_uri", redirectUri, "code_verifier", verifier, "scope", CloudAuthorization.SCOPE));
    }

    static Tokens refresh(CloudHttp http, String clientId, LongSupplier clock, String refreshToken) throws CloudError {
        return request(http, clock, CloudRules.form("client_id", clientId, "grant_type", "refresh_token",
                "refresh_token", refreshToken, "scope", CloudAuthorization.SCOPE));
    }

    private static Tokens request(CloudHttp http, LongSupplier clock, String form) throws CloudError {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("content-type", "application/x-www-form-urlencoded");
        CloudHttp.Response response;
        try {
            response = http.send(new CloudHttp.Request("POST", CloudAuthorization.LOGIN + "/token", headers,
                    form.getBytes(StandardCharsets.UTF_8), METADATA_MS, JSON_LIMIT));
        } catch (IOException error) {
            throw networkFailure(error, "Microsoft sign-in");
        }
        long wait = CloudRules.retryAfterMs(response.header("retry-after"), clock.getAsLong());
        Map<String, Object> body = json(response);
        if (response.ok()) {
            String access = body == null ? null : CloudJson.string(body.get("access_token"));
            if (access == null || access.isEmpty()) {
                throw new CloudError("invalid", "Microsoft answered the sign-in without an access token.");
            }
            String refresh = CloudJson.string(body.get("refresh_token"));
            String scope = CloudJson.string(body.get("scope"));
            Object seconds = body.get("expires_in");
            double value = seconds instanceof Double ? (Double) seconds
                    : seconds instanceof String ? parse((String) seconds) : Double.NaN;
            long expires = Double.isNaN(value) || Double.isInfinite(value) ? 3600_000L
                    : (long) (Math.min(Math.max(value, 60), 24 * 3600) * 1000);
            return new Tokens(access, refresh == null || refresh.isEmpty() ? null : refresh,
                    CloudJson.string(body.get("id_token")), scope == null ? "" : scope, expires);
        }
        if (response.status == 429 || response.status == 503
                || (body != null && "temporarily_unavailable".equals(body.get("error")))) {
            throw new CloudError("unavailable", "Microsoft sign-in asked to wait before trying again.", wait);
        }
        if (response.status >= 500) throw new CloudError("unavailable", "Microsoft sign-in did not answer this time.");
        // invalid_grant, interaction_required and every other refusal: only a new sign-in can follow.
        throw new CloudError("refused", "Microsoft refused the sign-in.");
    }

    // Number(text) for the expiry, which some services send as a string.
    private static double parse(String text) {
        try {
            return text.trim().isEmpty() ? 0 : Double.parseDouble(text.trim());
        } catch (NumberFormatException error) {
            return Double.NaN;
        }
    }

    static boolean grantsAppFolder(String scope) {
        for (String part : String.valueOf(scope).toLowerCase(Locale.ROOT).split("\\s+")) {
            if (part.equals(FOLDER_SCOPE)) return true;
        }
        return false;
    }

    // The id token comes straight from the token endpoint over TLS, which OpenID Connect accepts in place of
    // checking its signature (Core 1.0, section 3.1.3.7). Its audience, nonce and expiry are still checked,
    // so a token made for another app or another sign-in is never taken for this one.
    static Claims idTokenClaims(String idToken, String clientId, String nonce, long now) throws CloudError {
        CloudError invalid = new CloudError("invalid", "Microsoft did not confirm which account signed in.");
        String[] parts = idToken == null ? new String[0] : idToken.split("\\.", -1);
        if (parts.length != 3) throw invalid;
        Map<String, Object> claims;
        try {
            claims = CloudJson.object(new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
        } catch (IllegalArgumentException error) {
            throw invalid;
        }
        if (claims == null) throw invalid;
        Object aud = claims.get("aud");
        boolean audience = aud instanceof List ? ((List<?>) aud).contains(clientId) : clientId.equals(aud);
        String subject = CloudRules.displayText(claims.get("oid"));
        if (subject == null) subject = CloudRules.displayText(claims.get("sub"));
        Object exp = claims.get("exp");
        if (!audience || !nonce.equals(claims.get("nonce")) || subject == null || !(exp instanceof Double)
                || ((Double) exp).isInfinite() || (Double) exp * 1000 < now - 5 * 60_000) throw invalid;
        String hint = CloudRules.displayText(claims.get("preferred_username"));
        if (hint == null) hint = CloudRules.displayText(claims.get("email"));
        if (hint == null) hint = CloudRules.displayText(claims.get("name"));
        return new Claims(subject, hint);
    }
}
