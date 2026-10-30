package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

// The Android account and OneDrive client on a plain JVM, against a scripted network, an in-memory vault
// and a launcher that only records the address. No JUnit: the build runs main() and fails on any throw,
// as NavigationPolicyTest does.
public final class CloudTest {
    private static int checks;
    private static final String CLIENT = "00000000-0000-0000-0000-00000000abcd";
    private static final String DEBUG_HASH = "Bb+/Bb+/Bb+/Bb+/Bb+/Bb+/Bb+=";
    private static final String DEBUG_PACKAGE = "io.github.raymondnassar.recappage.prototype";
    private static final String REDIRECT = CloudAuthorization.redirectUri(DEBUG_PACKAGE, DEBUG_HASH);
    private static final String ACCESS = "ACCESS-TOKEN-never-shown";
    private static final String REFRESH = "REFRESH-TOKEN-never-shown";
    private static final String RENEWED = "RENEWED-ACCESS-never-shown";
    private static final String NEXT_REFRESH = "NEXT-REFRESH-never-shown";
    private static final List<String> replies = new ArrayList<>();

    // A check that fails inside a scripted network step is thrown into the account, which may turn it into
    // an ordinary error reply, so the first failure is also kept and the run fails on it at the end.
    private static String firstFailure;

    private static void check(boolean condition, String label) {
        checks++;
        if (!condition) {
            if (firstFailure == null) firstFailure = label;
            throw new AssertionError(label);
        }
    }

    interface Step {
        CloudHttp.Response answer(CloudHttp.Request request) throws IOException;
    }

    static final class Script implements CloudHttp {
        final Deque<Step> steps = new ArrayDeque<>();
        final List<CloudHttp.Request> seen = Collections.synchronizedList(new ArrayList<>());

        Script then(Step step) {
            steps.add(step);
            return this;
        }

        @Override
        public synchronized CloudHttp.Response send(CloudHttp.Request request) throws IOException {
            seen.add(request);
            Step step = steps.poll();
            if (step == null) throw new AssertionError("Unscripted request: " + request.method + " " + request.url);
            return step.answer(request);
        }

        void done(String label) {
            check(steps.isEmpty(), label + ": every scripted request was made (" + steps.size() + " left)");
        }
    }

    static final class Vault implements CloudVault {
        String stored;
        boolean failProbe;
        boolean unreadable;

        @Override
        public void probe() throws CloudError {
            if (failProbe) throw new CloudError("failed", FAILED);
        }

        @Override
        public boolean exists() {
            return stored != null;
        }

        @Override
        public String load() throws CloudError {
            if (unreadable) throw new CloudError("unreadable", UNREADABLE);
            return stored;
        }

        @Override
        public void save(String record) {
            stored = record;
        }

        @Override
        public void clear() {
            stored = null;
            unreadable = false;
        }
    }

    static final class Direct extends AbstractExecutorService {
        @Override
        public void execute(Runnable command) {
            command.run();
        }

        @Override
        public void shutdown() {}

        @Override
        public List<Runnable> shutdownNow() {
            return Collections.emptyList();
        }

        @Override
        public boolean isShutdown() {
            return false;
        }

        @Override
        public boolean isTerminated() {
            return false;
        }

        @Override
        public boolean awaitTermination(long timeout, TimeUnit unit) {
            return true;
        }
    }

    static final class Harness {
        final Script http = new Script();
        final Vault vault = new Vault();
        final List<String> launched = new ArrayList<>();
        final List<Runnable> scheduled = new ArrayList<>();
        boolean launchFails;
        long now = 1_800_000_000_000L;
        final CloudAccount account;

        Harness() {
            this(new Direct(), CloudAccount.DEADLINES_MS);
        }

        Harness(ExecutorService workers, Map<String, Long> deadlines) {
            account = new CloudAccount(http, vault, url -> {
                if (launchFails) throw new IllegalStateException("no browser");
                launched.add(url);
            }, (task, delay) -> {
                scheduled.add(task);
                return () -> scheduled.remove(task);
            }, workers, () -> now, new Random(7), CLIENT, REDIRECT, deadlines);
        }

        Map<String, Object> call(String operation, String body) {
            CloudAccount.Reply reply = account.handle(operation, body);
            replies.add(reply.body);
            Map<String, Object> out = CloudJson.object(reply.body);
            out.put("_status", (double) reply.status);
            return out;
        }

        String connection() {
            return (String) status().get("connection");
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> status() {
            return (Map<String, Object>) call("status", "").get("status");
        }

        String param(String name) {
            String url = launched.get(launched.size() - 1);
            for (String pair : url.substring(url.indexOf('?') + 1).split("&")) {
                if (pair.startsWith(name + "=")) return CloudRules.decode(pair.substring(name.length() + 1), true);
            }
            return null;
        }
    }

    static CloudHttp.Response json(int status, String body, String... headers) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < headers.length; i += 2) map.put(headers[i], headers[i + 1]);
        return new CloudHttp.Response(status, map, body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8));
    }

    static String idToken(String nonce, String audience) {
        return idToken(nonce, audience, 1_900_000_000L);
    }

    static String idToken(String nonce, String audience, long expires) {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String claims = "{\"aud\":\"" + audience + "\",\"nonce\":\"" + nonce + "\",\"oid\":\"subject-1\","
                + "\"exp\":" + expires + ",\"preferred_username\":\"reader@example.com\"}";
        return encoder.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8)) + "."
                + encoder.encodeToString(claims.getBytes(StandardCharsets.UTF_8)) + ".signature";
    }

    static boolean authorized(CloudHttp.Request request) {
        return request.hasHeader("authorization");
    }

    static String error(Map<String, Object> reply) {
        Object failure = reply.get("error");
        return failure instanceof Map ? (String) ((Map<?, ?>) failure).get("code") : null;
    }

    static String errorMessage(Map<String, Object> reply) {
        return (String) ((Map<?, ?>) reply.get("error")).get("message");
    }

    // A whole sign-in through the browser and back, leaving the harness connected with the app folder known.
    static Harness connected() {
        Harness h = new Harness();
        Map<String, Object> started = h.call("connect", "");
        check("signing-in".equals(((Map<?, ?>) started.get("status")).get("state")), "Connect starts a sign-in");
        String nonce = h.param("nonce");
        String state = h.param("state");
        h.http.then(request -> json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH
                + "\",\"id_token\":\"" + idToken(nonce, CLIENT) + "\",\"scope\":\"openid Files.ReadWrite.AppFolder\",\"expires_in\":3600}"))
                .then(request -> json(200, "{\"id\":\"FOLDER1\",\"parentReference\":{\"driveId\":\"DRIVE1\"}}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + state);
        h.http.done("Sign-in");
        check("connected".equals(h.status().get("state")), "The sign-in connects");
        return h;
    }

    public static void main(String[] args) throws Exception {
        redirects();
        authorizationRequest();
        answers();
        headers();
        signIn();
        dataOperations();
        settling();
        reading();
        renewal();
        folderGone();
        requests();
        signInEndings();
        storedRecord();
        deadline();
        if (firstFailure != null) throw new AssertionError(firstFailure);
        for (String reply : replies) {
            for (String secret : new String[] {ACCESS, REFRESH, RENEWED, NEXT_REFRESH, "CODE1"}) {
                check(!reply.contains(secret), "No reply to the page carries a token or a code");
            }
        }
        System.out.println("Cloud account: " + checks + " checks passed");
    }

    static void redirects() {
        // The debug entry the owner registered on 2026-10-22, character for character.
        check(REDIRECT.equals("msauth://io.github.raymondnassar.recappage.prototype/Bb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%3D"),
                "The debug redirect is the registered string");
        check(CloudAuthorization.redirectUri("io.github.raymondnassar.recappage", "Rr0Rr0Rr0Rr0Rr0Rr0Rr0Rr0Rr0=")
                .equals("msauth://io.github.raymondnassar.recappage/Rr0Rr0Rr0Rr0Rr0Rr0Rr0Rr0Rr0%3D"),
                "The release redirect is built from the injected hash alone");
        for (String hash : new String[] {null, "", "short=", "Bb+/Bb+/Bb+/Bb+/Bb+/Bb+/Bb+", "Bb+/Bb+/Bb+/Bb+/Bb+/Bb+/Bb%3D"}) {
            boolean refused = false;
            try {
                CloudAuthorization.redirectUri(DEBUG_PACKAGE, hash);
            } catch (IllegalArgumentException error) {
                refused = true;
            }
            check(refused, "A malformed hash is refused: " + hash);
        }
    }

    static void authorizationRequest() {
        CloudAuthorization authorization = CloudAuthorization.create(new Random(1));
        String url = authorization.url(CLIENT, REDIRECT);
        check(url.startsWith("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=" + CLIENT
                + "&response_type=code&redirect_uri=msauth%3A%2F%2Fio.github.raymondnassar.recappage.prototype%2FBb%252B%252FBb%252B%252FBb%252B%252FBb%252B%252FBb%252B%252FBb%252B%252FBb%252B%253D"
                + "&response_mode=query&scope=openid%20profile%20offline_access%20Files.ReadWrite.AppFolder&state="),
                "The authorization address names the client, the redirect and the scope as Windows does");
        check(url.contains("&code_challenge=" + authorization.challenge + "&code_challenge_method=S256&prompt=select_account"),
                "PKCE S256 and the account picker are asked for");
        check(authorization.challenge.equals(CloudRules.base64Url(CloudAuthorization.sha256(
                authorization.verifier.getBytes(StandardCharsets.US_ASCII)))), "The challenge is the verifier's SHA-256");
        check(authorization.state.length() == 43 && authorization.nonce.length() == 43 && authorization.verifier.length() == 43,
                "State, nonce and verifier are each 32 random bytes");
        check(!url.contains(authorization.verifier), "The verifier never leaves the device in the address");
    }

    static void answers() {
        CloudAuthorization authorization = CloudAuthorization.create(new Random(2));
        String state = authorization.state;
        CloudAuthorization.Answer good = authorization.answer(REDIRECT + "?code=abc&state=" + state, REDIRECT);
        check(good != null && "abc".equals(good.code), "The answer to this sign-in gives its code");
        check(authorization.answer(REDIRECT + "?code=abc&state=" + state + "#frag", REDIRECT).code.equals("abc"), "A fragment is ignored");
        check(authorization.answer(REDIRECT + "?code=abc&state=other", REDIRECT) == null, "Another state is a stray");
        check(authorization.answer(REDIRECT + "?code=abc", REDIRECT) == null, "No state is a stray");
        check(authorization.answer(REDIRECT + "?code=abc&state=" + state + "&state=" + state, REDIRECT) == null,
                "A repeated parameter is not an answer");
        check(authorization.answer(REDIRECT + "?code=abc&code=def&state=" + state, REDIRECT) == null, "A repeated code is not an answer");
        check(authorization.answer("msauth://io.github.raymondnassar.recappage/Bb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%3D?code=abc&state=" + state,
                REDIRECT) == null, "Another package's redirect is not an answer");
        check(authorization.answer("https://example.com/?code=abc&state=" + state, REDIRECT) == null, "Another address is not an answer");
        check(authorization.answer(REDIRECT + "?error=access_denied&state=" + state, REDIRECT).error.equals("declined"),
                "Declining at Microsoft is declined");
        check(authorization.answer(REDIRECT + "?error=server_error&state=" + state, REDIRECT).error.equals("refused"),
                "Any other error is refused");
        check(authorization.answer(REDIRECT + "?state=" + state, REDIRECT).error.equals("refused"), "No code is refused");
    }

    static void headers() {
        for (String name : new String[] {"authorization", "Authorization", "AUTHORIZATION", "aUtHoRiZaTiOn"}) {
            boolean refused = false;
            try {
                CloudOneDrive.graphHeaders(Collections.singletonMap(name, "Bearer caller"), "token");
            } catch (IllegalArgumentException error) {
                refused = true;
            }
            check(refused, "A caller's Authorization is refused in any case: " + name);
        }
        Map<String, String> made = CloudOneDrive.graphHeaders(Collections.singletonMap("content-type", "application/json"), "token");
        check(made.size() == 2 && "Bearer token".equals(made.get("authorization")), "The client adds the one Authorization itself");
    }

    static void signIn() {
        Harness h = connected();
        CloudHttp.Request token = h.http.seen.get(0);
        String form = new String(token.body, StandardCharsets.UTF_8);
        check(token.url.equals("https://login.microsoftonline.com/consumers/oauth2/v2.0/token") && !authorized(token),
                "The code is redeemed at Microsoft's token endpoint");
        check(form.startsWith("client_id=" + CLIENT + "&grant_type=authorization_code&code=CODE1&redirect_uri=msauth%3A%2F%2F")
                && form.contains("&code_verifier="), "The redemption carries the verifier and the exact redirect");
        check(h.http.seen.get(1).url.equals(CloudOneDrive.GRAPH + "/me/drive/special/approot?$select=id,parentReference")
                && "Bearer ACCESS-TOKEN-never-shown".equals(h.http.seen.get(1).headers.get("authorization")),
                "The app folder is asked for with the new token");
        Map<String, Object> status = h.status();
        check("reader@example.com".equals(status.get("account")) && ((String) status.get("connection")).matches("[a-f0-9]{32}"),
                "Status names the account and a connection");
        check(h.vault.stored.contains(REFRESH) && !h.vault.stored.contains(ACCESS), "Only the refresh token is stored");
        check(h.vault.stored.contains("\"account\":{\"id\":\"drive:DRIVE1\""), "The drive names the account");
        // A second sign-in to the same account and folder keeps the connection.
        String before = h.connection();
        h.call("disconnect", "");
        check("not-connected".equals(h.status().get("state")) && h.vault.stored == null, "Disconnect clears the stored sign-in");
        check(before != null, "There was a connection");
    }

    static void dataOperations() {
        Harness h = connected();
        String connection = h.connection();
        h.http.then(request -> json(200, "{\"value\":[{\"id\":\"A1\",\"name\":\"recap-page-a\",\"size\":5,"
                + "\"createdDateTime\":\"2026-10-29T10:00:00Z\"},{\"id\":\"..\",\"name\":\"bad\"}],"
                + "\"@odata.nextLink\":\"https://graph.microsoft.com/v1.0/me/drive/items/FOLDER1/children?page=2\"}"))
                .then(request -> json(200, "{\"value\":[{\"id\":\"A2\",\"name\":\"recap-page-b\",\"size\":-1}]}"));
        Map<String, Object> listed = h.call("list", "{\"connection\":\"" + connection + "\"}");
        List<?> items = (List<?>) listed.get("items");
        check(Boolean.TRUE.equals(listed.get("ok")) && items.size() == 2, "Every page is listed and a malformed item dropped");
        check(Double.valueOf(1_793_268_000_000.0).equals(((Map<?, ?>) items.get(0)).get("created"))
                && ((Map<?, ?>) items.get(1)).get("size") == null, "Items carry their time and a usable size only");
        check(h.http.seen.get(2).url.equals(CloudOneDrive.GRAPH + "/me/drive/items/FOLDER1/children?$select=id,name,size,createdDateTime&$top=200"),
                "The list asks for the known folder by its id");
        h.http.done("List");

        int before = h.http.seen.size();
        h.http.then(request -> json(200, "{\"uploadUrl\":\"https://upload.example.com/session/1\"}"))
                .then(request -> json(201, "{\"id\":\"C1\",\"name\":\"recap-page-c\",\"size\":3}"));
        Map<String, Object> created = h.call("create", "{\"connection\":\"" + connection + "\",\"name\":\"recap-page-c\",\"bytes\":\"YWJj\"}");
        CloudHttp.Request session = h.http.seen.get(before);
        CloudHttp.Request put = h.http.seen.get(before + 1);
        check(Boolean.TRUE.equals(created.get("ok")) && "C1".equals(((Map<?, ?>) created.get("item")).get("id")), "A create answers its item");
        check(session.url.endsWith("/me/drive/items/FOLDER1:/recap-page-c:/createUploadSession") && authorized(session)
                && new String(session.body, StandardCharsets.UTF_8).equals("{\"item\":{\"@microsoft.graph.conflictBehavior\":\"fail\"}}"),
                "The session is opened on Graph, asking to fail on a taken name");
        check(put.method.equals("PUT") && put.url.equals("https://upload.example.com/session/1") && !authorized(put)
                && "bytes 0-2/3".equals(put.headers.get("content-range")), "The upload address never carries the token");

        h.http.then(request -> json(507, "{}"));
        Map<String, Object> full = h.call("delete", "{\"connection\":\"" + connection + "\",\"id\":\"C1\"}");
        check("quota".equals(error(full)), "507 is quota");
        h.http.then(request -> json(429, "{}", "Retry-After", "30"));
        Map<String, Object> busy = h.call("delete", "{\"connection\":\"" + connection + "\",\"id\":\"C1\"}");
        check("unavailable".equals(error(busy)) && Double.valueOf(30_000).equals(((Map<?, ?>) busy.get("error")).get("retryAfterMs")),
                "429 is unavailable with the wait");
        h.http.then(request -> json(403, "{}"));
        check("refused".equals(error(h.call("delete", "{\"connection\":\"" + connection + "\",\"id\":\"C1\"}"))), "403 is refused");
        h.http.then(request -> json(404, "{}"));
        check(Boolean.TRUE.equals(h.call("delete", "{\"connection\":\"" + connection + "\",\"id\":\"C1\"}").get("ok")),
                "An item already gone counts as deleted");
        h.http.then(request -> json(418, "{}"));
        check("invalid".equals(error(h.call("delete", "{\"connection\":\"" + connection + "\",\"id\":\"C1\"}"))), "Anything else is invalid");
        h.http.then(request -> {
            throw new CloudHttp.Timeout();
        });
        check("timeout".equals(error(h.call("delete", "{\"connection\":\"" + connection + "\",\"id\":\"C1\"}"))), "No answer in time is a timeout");
        h.http.done("Data operations");
    }

    static void settling() {
        Harness h = connected();
        String connection = h.connection();
        String body = "{\"connection\":\"" + connection + "\",\"name\":\"recap-page-d\",\"bytes\":\"YWJj\"}";
        // A gateway's 504 after every byte: cancelled, looked up, not there, so it never appears later.
        h.http.then(request -> json(200, "{\"uploadUrl\":\"https://upload.example.com/s/2\"}"))
                .then(request -> json(504, "", "retry-after", "5"))
                .then(request -> {
                    check(request.method.equals("DELETE") && !authorized(request), "The session is cancelled without the token");
                    return json(204, "");
                })
                .then(request -> json(404, "{}"));
        Map<String, Object> lost = h.call("create", body);
        check("unavailable".equals(error(lost)) && Double.valueOf(5000).equals(((Map<?, ?>) lost.get("error")).get("retryAfterMs")),
                "A create that did not land is unavailable, keeping the wait");
        // The same, but the item is there after all.
        h.http.then(request -> json(200, "{\"uploadUrl\":\"https://upload.example.com/s/3\"}"))
                .then(request -> {
                    throw new IOException("reset");
                })
                .then(request -> json(404, ""))
                .then(request -> json(200, "{\"id\":\"D1\",\"name\":\"recap-page-d\"}"));
        check("D1".equals(((Map<?, ?>) h.call("create", body).get("item")).get("id")), "A lost reply whose item landed answers the item");
        // The cancel cannot be made, so the outcome is unknown until the next list cancels it.
        h.http.then(request -> json(200, "{\"uploadUrl\":\"https://upload.example.com/s/4\"}"))
                .then(request -> json(202, ""))
                .then(request -> {
                    throw new IOException("offline");
                });
        check("timeout".equals(error(h.call("create", body))), "An unsettled create is a timeout");
        h.http.then(request -> {
            check(request.url.equals("https://upload.example.com/s/4") && request.method.equals("DELETE"), "The next list cancels it first");
            return json(404, "");
        }).then(request -> json(200, "{\"value\":[]}"));
        check(Boolean.TRUE.equals(h.call("list", "{\"connection\":\"" + connection + "\"}").get("ok")), "Then the list goes ahead");
        // A definite refusal at the last byte cancels the session and says so.
        h.http.then(request -> json(200, "{\"uploadUrl\":\"https://upload.example.com/s/5\"}"))
                .then(request -> json(409, "{}"))
                .then(request -> json(204, ""));
        check("exists".equals(error(h.call("create", body))), "A taken name is exists");
        // An upload address that is not an ordinary https host is never used.
        h.http.then(request -> json(200, "{\"uploadUrl\":\"http://upload.example.com/s/6\"}"));
        check("invalid".equals(error(h.call("create", body))), "An http upload address is refused");
        for (String address : new String[] {"https://localhost/x", "https://127.0.0.1/x", "https://user@up.example.com/x",
                "https://up.example.com:8443/x", "https://[::1]/x", "https://example./x", "https://a.localhost/x"}) {
            check(CloudRules.capabilityUrl(address) == null, "Not a capability address: " + address);
        }
        check("https://up.example.com/x?y=1".equals(CloudRules.capabilityUrl("https://up.example.com/x?y=1")), "An ordinary address is kept");
        h.http.done("Settling");
    }

    static void reading() {
        Harness h = connected();
        String connection = h.connection();
        String body = "{\"connection\":\"" + connection + "\",\"id\":\"R1\"}";
        h.http.then(request -> json(302, "", "Location", "https://download.example.com/r1"))
                .then(request -> {
                    check(!authorized(request) && request.maxBytes == CloudRules.MAX_ITEM_BYTES, "The download carries no token and a cap");
                    return json(200, "hello");
                });
        Map<String, Object> read = h.call("read", body);
        check("aGVsbG8=".equals(read.get("bytes")), "A read answers the bytes in base64");
        h.http.then(request -> json(302, "", "Location", "https://download.example.com/r1"))
                .then(request -> new CloudHttp.Response(200, Collections.emptyMap(), null, true, false));
        check("too-large".equals(error(h.call("read", body))), "An item over the cap is too large");
        h.http.then(request -> new CloudHttp.Response(200, Collections.emptyMap(), null, false, true));
        check("unavailable".equals(error(h.call("read", body))), "A download that stopped part way is unavailable");
        h.http.then(request -> json(302, "", "Location", "file:///etc/passwd"));
        check("invalid".equals(error(h.call("read", body))), "A download address that is not https is refused");
        check("invalid".equals(error(h.call("read", "{\"connection\":\"" + connection + "\",\"id\":\"..\"}"))), "A dot-segment id is refused");
        h.http.done("Reading");
    }

    static void renewal() {
        Harness h = connected();
        String connection = h.connection();
        String list = "{\"connection\":\"" + connection + "\"}";
        // The token is turned away, so it is renewed once and the request made again.
        h.http.then(request -> json(401, ""))
                .then(request -> {
                    check(new String(request.body, StandardCharsets.UTF_8).contains("grant_type=refresh_token&refresh_token=" + REFRESH),
                            "The stored refresh token is spent");
                    return json(200, "{\"access_token\":\"" + RENEWED + "\",\"refresh_token\":\"" + NEXT_REFRESH + "\",\"expires_in\":3600}");
                })
                .then(request -> {
                    check(("Bearer " + RENEWED).equals(request.headers.get("authorization")), "The request is made again with the new token");
                    return json(200, "{\"value\":[]}");
                });
        check(Boolean.TRUE.equals(h.call("list", list).get("ok")), "A renewed token carries on");
        check(h.vault.stored.contains(NEXT_REFRESH) && !h.vault.stored.contains(REFRESH), "The new refresh token replaces the old");
        // Two hours later the access token has expired; the refresh is refused, so a sign-in is asked for.
        h.now += 2 * 3600_000L;
        h.http.then(request -> json(400, "{\"error\":\"invalid_grant\"}"));
        check("needs-sign-in".equals(error(h.call("list", list))), "A dead refresh token asks for a sign-in");
        Map<String, Object> status = h.status();
        check("needs-sign-in".equals(status.get("state")) && connection.equals(status.get("connection")), "The connection stays");
        check(!h.vault.stored.contains(NEXT_REFRESH), "The dead refresh token is no longer stored");
        // Signing in again to the same account and folder keeps the connection, so no page asks again.
        h.call("connect", "");
        String nonce = h.param("nonce");
        h.http.then(request -> json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH
                + "\",\"id_token\":\"" + idToken(nonce, CLIENT) + "\",\"scope\":\"Files.ReadWrite.AppFolder\"}"))
                .then(request -> json(200, "{\"id\":\"FOLDER1\",\"parentReference\":{\"driveId\":\"DRIVE1\"}}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + h.param("state"));
        check(connection.equals(h.connection()) && "connected".equals(h.status().get("state")), "The same account keeps its connection");
        h.http.done("Renewal");
    }

    static void folderGone() {
        Harness h = connected();
        String connection = h.connection();
        h.http.then(request -> json(404, "{}"));
        Map<String, Object> gone = h.call("list", "{\"connection\":\"" + connection + "\"}");
        check("needs-consent".equals(error(gone)) && CloudAccount.FOLDER_GONE.equals(errorMessage(gone)), "A deleted folder asks again");
        Map<String, Object> status = h.status();
        check(!connection.equals(status.get("connection")) && CloudAccount.FOLDER_GONE.equals(status.get("reason")),
                "A new connection says why");
        check(h.vault.stored.contains("\"folder\":null"), "The folder is forgotten");
        Map<String, Object> old = h.call("list", "{\"connection\":\"" + connection + "\"}");
        check("needs-consent".equals(error(old)) && CloudAccount.FOLDER_GONE.equals(errorMessage(old)), "The old connection is told why");
        // The next create makes the folder again through the app root and learns its id from the answer.
        String fresh = (String) status.get("connection");
        h.http.then(request -> json(200, "{\"access_token\":\"" + RENEWED + "\",\"expires_in\":3600}")).then(request -> {
            check(request.url.contains("/me/drive/special/approot:/recap-page-e:/createUploadSession"), "A create goes through the app root");
            return json(200, "{\"uploadUrl\":\"https://upload.example.com/s/7\"}");
        }).then(request -> json(201, "{\"id\":\"E1\",\"name\":\"recap-page-e\",\"parentReference\":{\"id\":\"FOLDER2\"}}"));
        h.call("create", "{\"connection\":\"" + fresh + "\",\"name\":\"recap-page-e\",\"bytes\":\"YQ==\"}");
        check(h.vault.stored.contains("\"folder\":\"FOLDER2\""), "The new folder is learned");
        h.http.done("Folder gone");
    }

    static void requests() {
        Harness h = connected();
        String connection = h.connection();
        check(Double.valueOf(404).equals(h.call("upload", "{}").get("_status")), "An unknown operation is 404");
        check(Double.valueOf(400).equals(h.call("status", "{").get("_status")), "Unreadable JSON is 400");
        check(Double.valueOf(400).equals(h.call("status", "[]").get("_status")), "A JSON array is 400");
        StringBuilder big = new StringBuilder("{\"x\":\"");
        while (big.length() <= CloudAccount.SMALL_BODY) big.append("aaaaaaaa");
        check(Double.valueOf(413).equals(h.call("list", big.append("\"}").toString()).get("_status")), "An oversized body is 413");
        check("invalid".equals(error(h.call("list", "{}"))), "A request must name a connection");
        check("needs-consent".equals(error(h.call("list", "{\"connection\":\"" + "0".repeat(32) + "\"}"))),
                "Another connection asks again");
        check("invalid".equals(error(h.call("create", "{\"connection\":\"" + connection + "\",\"name\":\"notes.txt\",\"bytes\":\"YQ==\"}"))),
                "Only backup names are created");
        check("invalid".equals(error(h.call("create", "{\"connection\":\"" + connection + "\",\"name\":\"recap-page-f\",\"bytes\":\"\"}"))),
                "An empty backup is refused");
        h.http.done("Requests");
    }

    static void signInEndings() {
        Harness h = new Harness();
        h.call("connect", "");
        check(h.scheduled.size() == 1, "The sign-in has an expiry");
        for (int i = 0; i < 32; i++) h.account.redirect(REDIRECT + "?code=x&state=wrong");
        check("signing-in".equals(h.status().get("state")), "Strays are counted");
        h.account.redirect(REDIRECT + "?code=x&state=wrong");
        check(SIGN_IN_ENDED("invalid").equals(h.status().get("message")) && "not-connected".equals(h.status().get("state")),
                "The 33rd stray ends the sign-in");
        check(h.scheduled.isEmpty(), "Its expiry is withdrawn");

        h.call("connect", "");
        h.scheduled.get(0).run();
        check(SIGN_IN_ENDED("expired").equals(h.status().get("message")), "Five minutes end it as expired");
        h.account.redirect(REDIRECT + "?code=x&state=" + h.param("state"));
        check("not-connected".equals(h.status().get("state")), "An answer after it ended is ignored");

        h.call("connect", "");
        h.account.redirect(REDIRECT + "?error=access_denied&state=" + h.param("state"));
        check(SIGN_IN_ENDED("declined").equals(h.status().get("message")), "Declining is said as cancelled");

        h.launchFails = true;
        Map<String, Object> failed = h.call("connect", "");
        check(CloudAccount.LAUNCH_FAILED.equals(((Map<?, ?>) failed.get("status")).get("message"))
                && "not-connected".equals(((Map<?, ?>) failed.get("status")).get("state")), "No browser ends it at once");
        h.launchFails = false;

        h.vault.failProbe = true;
        check("failed".equals(error(h.call("connect", ""))) && h.launched.size() == 3, "A vault that cannot protect stops it before the browser");
        h.vault.failProbe = false;

        // An id token for another app, or a grant without the app folder, never connects.
        h.call("connect", "");
        String nonce = h.param("nonce");
        h.http.then(request -> json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH
                + "\",\"id_token\":\"" + idToken(nonce, "another-app") + "\",\"scope\":\"Files.ReadWrite.AppFolder\"}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + h.param("state"));
        check("Microsoft did not confirm which account signed in.".equals(h.status().get("message")) && h.vault.stored == null,
                "Another audience is refused");
        h.call("connect", "");
        h.http.then(request -> json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH + "\",\"scope\":\"openid\"}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + h.param("state"));
        check("Microsoft did not grant the access cloud backup needs.".equals(h.status().get("message")), "Without the app folder it is refused");
        h.call("connect", "");
        String expired = h.param("nonce");
        h.http.then(request -> json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH
                + "\",\"id_token\":\"" + idToken(expired, CLIENT, 1_700_000_000L) + "\",\"scope\":\"Files.ReadWrite.AppFolder\"}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + h.param("state"));
        check("Microsoft did not confirm which account signed in.".equals(h.status().get("message")) && h.vault.stored == null,
                "An expired id token is refused");
        // Disconnecting during the redemption wins: nothing is saved after it.
        h.call("connect", "");
        String late = h.param("nonce");
        h.http.then(request -> {
            h.call("disconnect", "");
            return json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH
                    + "\",\"id_token\":\"" + idToken(late, CLIENT) + "\",\"scope\":\"Files.ReadWrite.AppFolder\"}");
        }).then(request -> json(200, "{\"id\":\"FOLDER1\",\"parentReference\":{\"driveId\":\"DRIVE1\"}}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + h.param("state"));
        check(h.vault.stored == null && "not-connected".equals(h.status().get("state")), "A disconnect during sign-in wins");
        h.http.done("Sign-in endings");
    }

    private static String SIGN_IN_ENDED(String reason) {
        return CloudAccount.SIGN_IN_ENDED.get(reason);
    }

    static void storedRecord() {
        Harness h = connected();
        String stored = h.vault.stored;
        Harness again = new Harness();
        again.vault.stored = stored;
        check("connected".equals(again.status().get("state")), "A stored sign-in is read back");
        Harness broken = new Harness();
        broken.vault.stored = stored;
        broken.vault.unreadable = true;
        Map<String, Object> status = broken.status();
        check("not-connected".equals(status.get("state")) && CloudVault.UNREADABLE.equals(status.get("message"))
                && broken.vault.stored == null, "A record this device cannot read is cleared, and a sign-in asked for");
        Harness odd = new Harness();
        odd.vault.stored = "{\"version\":2}";
        check(CloudVault.INVALID.equals(odd.status().get("message")) && odd.vault.stored == null, "A record of another shape is cleared");
    }

    static void deadline() throws Exception {
        ExecutorService pool = Executors.newCachedThreadPool();
        Map<String, Long> deadlines = new HashMap<>(CloudAccount.DEADLINES_MS);
        deadlines.put("delete", 50L);
        Harness h = new Harness(pool, deadlines);
        h.call("connect", "");
        String nonce = h.param("nonce");
        h.http.then(request -> json(200, "{\"access_token\":\"" + ACCESS + "\",\"refresh_token\":\"" + REFRESH
                + "\",\"id_token\":\"" + idToken(nonce, CLIENT) + "\",\"scope\":\"Files.ReadWrite.AppFolder\"}"))
                .then(request -> json(200, "{\"id\":\"FOLDER1\",\"parentReference\":{\"driveId\":\"DRIVE1\"}}"));
        h.account.redirect(REDIRECT + "?code=CODE1&state=" + h.param("state"));
        for (int i = 0; i < 100 && !"connected".equals(h.status().get("state")); i++) Thread.sleep(10);
        CountDownLatch release = new CountDownLatch(1);
        Script slow = h.http;
        slow.then(request -> {
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
            return json(204, "");
        });
        Map<String, Object> late = h.call("delete", "{\"connection\":\"" + h.connection() + "\",\"id\":\"X1\"}");
        check("timeout".equals(error(late)) && "OneDrive did not finish within 0 seconds.".equals(errorMessage(late)),
                "An operation past its deadline is answered as a timeout");
        release.countDown();
        pool.shutdown();
        check(pool.awaitTermination(5, TimeUnit.SECONDS), "The work behind it finishes");
    }
}
