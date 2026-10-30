package io.github.raymondnassar.recappage.prototype;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.regex.Pattern;

// One sign-in's secrets and the two ends of its round trip through the browser: the address that opens
// Microsoft's page, and the check of the redirect that comes back. The same PKCE S256, state and nonce the
// Windows host makes in host/cloudSignIn.mjs, with a fixed redirect in place of its loopback listener.
//
// The redirect is the one Microsoft's Android registration form makes, msauth://<package>/<signature hash>,
// built from the package name and a hash the build was given, and from nothing read off the device. So the
// key that signed the installed copy plays no part in sign-in: Play re-signs a release with its own key, and
// its hash is registered and given to the release build, while this computer's debug key's hash is given to
// a test build (#810, OD-07). No code here asks the package manager for the signer, which a test holds.
final class CloudAuthorization {
    static final String LOGIN = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
    // openid and profile give the id token whose nonce ties a sign-in to this request and whose name is
    // shown as the account; offline_access gives the refresh token; the app folder is the only storage.
    static final String SCOPE = "openid profile offline_access Files.ReadWrite.AppFolder";
    static final long SIGN_IN_MS = 5 * 60_000L;
    // The hash Microsoft's registration form asks for: the base64 SHA-1 of the signing certificate.
    private static final Pattern HASH = Pattern.compile("^[A-Za-z0-9+/]{27}=$");
    private static final Pattern CLIENT = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
    private static final Pattern PACKAGE = Pattern.compile("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$");

    final String state;
    final String nonce;
    final String verifier;
    final String challenge;

    private CloudAuthorization(String state, String nonce, String verifier) {
        this.state = state;
        this.nonce = nonce;
        this.verifier = verifier;
        this.challenge = CloudRules.base64Url(sha256(verifier.getBytes(StandardCharsets.US_ASCII)));
    }

    static CloudAuthorization create(Random random) {
        return new CloudAuthorization(secret(random), secret(random), secret(random));
    }

    private static String secret(Random random) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return CloudRules.base64Url(bytes);
    }

    static byte[] sha256(byte[] bytes) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(bytes);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    static boolean validHash(String hash) {
        return hash != null && HASH.matcher(hash).matches();
    }

    static boolean validClientId(String clientId) {
        return clientId != null && CLIENT.matcher(clientId).matches();
    }

    // Exactly the string registered for the build: the hash percent-encoded, so its + / and = cannot be read
    // as anything but the path.
    static String redirectUri(String packageName, String hash) {
        if (packageName == null || !PACKAGE.matcher(packageName).matches() || !validHash(hash)) {
            throw new IllegalArgumentException("A redirect needs the package name and a signature hash.");
        }
        return "msauth://" + packageName + "/" + hash.replace("+", "%2B").replace("/", "%2F").replace("=", "%3D");
    }

    String url(String clientId, String redirectUri) {
        String query = CloudRules.form(
                "client_id", clientId, "response_type", "code", "redirect_uri", redirectUri, "response_mode", "query",
                "scope", SCOPE, "state", state, "nonce", nonce,
                "code_challenge", challenge, "code_challenge_method", "S256", "prompt", "select_account");
        return LOGIN + "/authorize?" + query.replace("+", "%20");
    }

    // What came back to the redirect: null when it is not an answer to this sign-in, which the caller
    // counts as a stray; otherwise the code, or the reason it ended, as host/cloudSignIn.mjs names them.
    static final class Answer {
        final String code;
        final String error;

        private Answer(String code, String error) {
            this.code = code;
            this.error = error;
        }
    }

    Answer answer(String received, String redirectUri) {
        if (received == null) return null;
        int fragment = received.indexOf('#');
        if (fragment >= 0) received = received.substring(0, fragment);
        int mark = received.indexOf('?');
        String target = mark < 0 ? received : received.substring(0, mark);
        String expected = CloudRules.decode(redirectUri, false);
        String given = CloudRules.decode(target, false);
        if (given == null || !given.equals(expected)) return null;
        Map<String, String> params = new HashMap<>();
        if (mark >= 0 && mark + 1 < received.length()) {
            for (String pair : received.substring(mark + 1).split("&", -1)) {
                if (pair.isEmpty()) continue;
                int equals = pair.indexOf('=');
                String name = CloudRules.decode(equals < 0 ? pair : pair.substring(0, equals), true);
                String value = CloudRules.decode(equals < 0 ? "" : pair.substring(equals + 1), true);
                // A repeated parameter could be read two ways, so nothing carrying one is taken as an answer.
                if (name == null || value == null || params.put(name, value) != null) return null;
            }
        }
        String givenState = params.get("state");
        if (givenState == null || !MessageDigest.isEqual(
                givenState.getBytes(StandardCharsets.UTF_8), state.getBytes(StandardCharsets.UTF_8))) return null;
        String code = params.get("code");
        String error = params.get("error");
        if (error != null || code == null || code.isEmpty()) {
            return new Answer(null, "access_denied".equals(error) ? "declined" : "refused");
        }
        return new Answer(code, null);
    }
}
