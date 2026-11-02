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
            this(workers, deadlines, null);
        }

        Harness(ExecutorService workers, Map<String, Long> deadlines, CloudAccount.Google google) {
            account = new CloudAccount(http, vault, url -> {
                if (launchFails) throw new IllegalStateException("no browser");
                launched.add(url);
            }, (task, delay) -> {
                scheduled.add(task);
                return () -> scheduled.remove(task);
            }, workers, () -> now, new Random(7), CLIENT, REDIRECT, deadlines, google);
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
        largeCreate();
        largeRead();
        GoogleDriveCases.run();
        GoogleAccountCases.run();
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

    // A create the size check lets through can still be more than the heap holds while it is read. That
    // must answer the page, not end the app.
    static void largeCreate() {
        Harness h = connected();
        String head = "{\"connection\":\"" + h.connection() + "\",\"name\":\"notes.txt\",\"bytes\":\"";
        String body = head + "A".repeat(CloudAccount.CREATE_BODY - head.length() - 2) + "\"}";
        Object status;
        try {
            status = h.call("create", body).get("_status");
        } catch (Throwable error) {
            status = error.getClass().getSimpleName();
        }
        check(Double.valueOf(413).equals(status) || Double.valueOf(200).equals(status),
                "A create at the size cap is answered on a small heap, not thrown: " + status);
    }

    // The read direction of the same: an item at the cap, made where the heap is larger, is encoded and
    // serialized for the page, and running out of memory there must also answer rather than end the app.
    static void largeRead() {
        Harness h = connected();
        String body = "{\"connection\":\"" + h.connection() + "\",\"id\":\"R1\"}";
        h.http.then(request -> json(302, "", "Location", "https://download.example.com/r1"))
                .then(request -> new CloudHttp.Response(200, Collections.emptyMap(), new byte[CloudRules.MAX_ITEM_BYTES]));
        String outcome;
        try {
            CloudAccount.Reply reply = h.account.handle("read", body);
            outcome = reply.status + " " + (reply.body.length() < 4096 ? reply.body : reply.body.length() + " characters");
        } catch (Throwable error) {
            outcome = error.getClass().getSimpleName();
        }
        check(outcome.startsWith("200 "), "A read at the size cap is answered on a small heap, not thrown: " + outcome);
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

    // Google Drive's operations on Android (#810, P04), driven directly: nothing makes one yet, because
    // Android has no Google sign-in until the owner chooses how it should work. host/googleDrive.mjs and
    // test/google-drive.test.js hold the Windows half, which these cases follow request for request.
    static final class GoogleDriveCases {
        private GoogleDriveCases() {}

        interface Operation {
            void run() throws CloudError;
        }

        static String code(Operation operation) {
            try {
                operation.run();
                return null;
            } catch (CloudError error) {
                return error.code;
            }
        }

        static final class Fixture {
            final Script http = new Script();
            final CloudGoogleDrive.Tracker tracker = new CloudGoogleDrive.Tracker();
            final List<String> learned = new ArrayList<>();
            final List<Boolean> renewals = new ArrayList<>();

            CloudGoogleDrive drive(String folder) {
                return new CloudGoogleDrive(http, renew -> {
                    renewals.add(renew);
                    return renew ? RENEWED : ACCESS;
                }, () -> 1_900_000_000_000L, tracker, folder, learned::add);
            }
        }

        static void run() {
            identify();
            dataOperations();
            settling();
            folderRace();
            folderGone();
            renewal();
        }

        static void identify() {
            Fixture f = new Fixture();
            f.http.then(request -> json(200, "{\"user\":{\"permissionId\":\"PERM1\",\"emailAddress\":\"reader@example.com\"}}"))
                    .then(request -> json(200, "{\"files\":[{\"id\":\"GFOLDER1\",\"createdTime\":\"2026-10-01T00:00:00Z\"}]}"));
            CloudGoogleDrive.Identity found;
            try {
                found = f.drive(null).identify();
            } catch (CloudError error) {
                throw new AssertionError(error.getMessage());
            }
            check("google:PERM1".equals(found.account) && "reader@example.com".equals(found.hint) && "GFOLDER1".equals(found.folder),
                    "Google: the account is Drive's permission id, shown by its address, with the oldest folder");
            CloudHttp.Request about = f.http.seen.get(0);
            check(about.url.equals(CloudGoogleDrive.DRIVE + "/about?fields=user%28emailAddress%2CdisplayName%2CpermissionId%29")
                    && ("Bearer " + ACCESS).equals(about.headers.get("authorization")), "Google: the account is asked of Drive");
            String folder = f.http.seen.get(1).url;
            check(folder.startsWith(CloudGoogleDrive.DRIVE + "/files?q=name%20%3D%20%27Recap%20Page%27%20and%20mimeType%20%3D%20")
                    && folder.contains("%27root%27%20in%20parents") && folder.contains("&spaces=drive") && folder.contains("&orderBy=createdTime"),
                    "Google: the oldest Recap Page folder at the top of the Drive is looked for");
            f.http.then(request -> json(200, "{\"user\":{\"emailAddress\":\"reader@example.com\"}}"));
            check("invalid".equals(code(() -> f.drive(null).identify())), "Google: an answer without the account is refused");
            f.http.done("Google identify");
        }

        static void dataOperations() {
            Fixture f = new Fixture();
            CloudGoogleDrive drive = f.drive("GFOLDER1");
            f.http.then(request -> json(200, "{\"id\":\"GFOLDER1\",\"trashed\":false}"))
                    .then(request -> json(200, "{\"nextPageToken\":\"P2\",\"files\":[{\"id\":\"A1\",\"name\":\"recap-page-a\",\"size\":\"5\","
                            + "\"createdTime\":\"2026-10-29T10:00:00Z\"},{\"id\":\"..\",\"name\":\"bad\"}]}"))
                    .then(request -> json(200, "{\"files\":[{\"id\":\"A2\",\"name\":\"recap-page-b\"}]}"));
            List<CloudOneDrive.Item> items = new ArrayList<>();
            check(code(() -> items.addAll(drive.list())) == null && items.size() == 2, "Google: every page is listed and a malformed item dropped");
            check(Long.valueOf(1_793_268_000_000L).equals(items.get(0).created) && Long.valueOf(5).equals(items.get(0).size),
                    "Google: a size written as a string is read");
            check(f.http.seen.get(0).url.equals(CloudGoogleDrive.DRIVE + "/files/GFOLDER1?fields=id,trashed"), "Google: the recorded folder is checked first");
            String page = f.http.seen.get(1).url;
            check(page.contains("q=%27GFOLDER1%27%20in%20parents%20and%20trashed%20%3D%20false") && !page.contains("pageToken"),
                    "Google: the list asks for the folder's files outside the trash");
            check(f.http.seen.get(2).url.endsWith("&pageToken=P2"), "Google: the next page is asked for by its token");
            f.http.done("Google list");

            int before = f.http.seen.size();
            f.http.then(request -> json(200, "{}", "Location", "https://www.googleapis.com/upload/drive/v3/files?upload_id=U1"))
                    .then(request -> json(200, "{\"id\":\"C1\",\"name\":\"recap-page-c\",\"size\":\"3\"}"));
            CloudOneDrive.Item[] created = new CloudOneDrive.Item[1];
            check(code(() -> created[0] = drive.create("recap-page-c", "abc".getBytes(StandardCharsets.UTF_8))) == null
                    && "C1".equals(created[0].id), "Google: a create answers its item");
            CloudHttp.Request open = f.http.seen.get(before);
            CloudHttp.Request put = f.http.seen.get(before + 1);
            check(open.url.startsWith(CloudGoogleDrive.DRIVE_UPLOAD + "/files?uploadType=resumable") && authorized(open)
                    && new String(open.body, StandardCharsets.UTF_8).contains("\"parents\":[\"GFOLDER1\"]")
                    && "3".equals(open.headers.get("x-upload-content-length")), "Google: the upload opens in the folder with its size");
            check(put.method.equals("PUT") && put.url.equals("https://www.googleapis.com/upload/drive/v3/files?upload_id=U1") && !authorized(put),
                    "Google: the upload address never carries the token");

            f.http.then(request -> {
                check(request.method.equals("POST") && request.url.equals(CloudGoogleDrive.DRIVE + "/files/C1?fields=id")
                        && "PATCH".equals(request.headers.get("x-http-method-override"))
                        && new String(request.body, StandardCharsets.UTF_8).equals("{\"trashed\":true}"),
                        "Google: a delete puts the item in the trash through the PATCH override");
                return json(200, "{\"id\":\"C1\"}");
            });
            check(code(() -> drive.delete("C1")) == null, "Google: a delete answers");
            f.http.then(request -> json(404, "{}"));
            check(code(() -> drive.delete("C1")) == null, "Google: an item already gone counts as deleted");
            f.http.then(request -> json(403, "{\"error\":{\"errors\":[{\"reason\":\"storageQuotaExceeded\"}]}}"));
            check("quota".equals(code(() -> drive.delete("C1"))), "Google: a full Drive is quota");
            f.http.then(request -> json(403, "{\"error\":{\"errors\":[{\"reason\":\"userRateLimitExceeded\"}]}}", "Retry-After", "30"));
            try {
                drive.delete("C1");
                check(false, "Google: a rate limit is an error");
            } catch (CloudError busy) {
                check("unavailable".equals(busy.code) && busy.retryAfterMs == 30_000, "Google: a rate limit is unavailable with the wait");
            }
            f.http.then(request -> json(403, "{}"));
            check("refused".equals(code(() -> drive.delete("C1"))), "Google: any other 403 is refused");

            f.http.then(request -> {
                check(request.url.equals(CloudGoogleDrive.DRIVE + "/files/R1?alt=media") && authorized(request)
                        && request.maxBytes == CloudRules.MAX_ITEM_BYTES, "Google: a read is one capped request to Drive");
                return json(200, "hello");
            });
            byte[][] read = new byte[1][];
            check(code(() -> read[0] = drive.read("R1")) == null && "hello".equals(new String(read[0], StandardCharsets.UTF_8)),
                    "Google: a read answers the bytes");
            f.http.done("Google data");
        }

        static void settling() {
            Fixture f = new Fixture();
            CloudGoogleDrive drive = f.drive("GFOLDER1");
            byte[] abc = "abc".getBytes(StandardCharsets.UTF_8);
            Step opened = request -> json(200, "{}", "Location", "https://www.googleapis.com/upload/drive/v3/files?upload_id=U2");
            // The reply is lost, and asking the session finds the file complete.
            f.http.then(opened).then(request -> {
                throw new IOException("reset");
            }).then(request -> {
                check(request.method.equals("PUT") && "bytes */3".equals(request.headers.get("content-range")) && !authorized(request)
                        && request.body.length == 0, "Google: the session is asked what it holds, without the token");
                return json(200, "{\"id\":\"D1\",\"name\":\"recap-page-d\"}");
            });
            CloudOneDrive.Item[] landed = new CloudOneDrive.Item[1];
            check(code(() -> landed[0] = drive.create("recap-page-d", abc)) == null && "D1".equals(landed[0].id),
                    "Google: a lost reply whose file landed answers it");
            // A server failure after the bytes, and the session still missing some: it never appears later.
            f.http.then(opened).then(request -> json(503, "", "Retry-After", "5")).then(request -> json(308, ""));
            try {
                drive.create("recap-page-d", abc);
                check(false, "Google: a create that did not land is an error");
            } catch (CloudError lost) {
                check("unavailable".equals(lost.code) && lost.retryAfterMs == 5000, "Google: a create that did not land is unavailable, keeping the wait");
            }
            // The file landed, but neither reply describes it: unknown, never refused, since it will be listed.
            f.http.then(opened).then(request -> json(200, "{\"id\":")).then(request -> json(200, "{\"name\":\"recap-page-d\"}"));
            check("timeout".equals(code(() -> drive.create("recap-page-d", abc))), "Google: a complete upload with an unreadable answer is a timeout");
            check(f.tracker.unsettled.isEmpty(), "Google: and, being complete, is not asked about again");
            // The session cannot be asked, so the outcome is unknown until the next list asks again.
            f.http.then(opened).then(request -> {
                throw new IOException("offline");
            }).then(request -> {
                throw new IOException("offline");
            });
            check("timeout".equals(code(() -> drive.create("recap-page-d", abc))), "Google: an unsettled create is a timeout");
            f.http.then(request -> {
                check(request.url.endsWith("upload_id=U2") && "bytes */3".equals(request.headers.get("content-range")),
                        "Google: the next list asks the session first");
                return json(308, "");
            }).then(request -> json(200, "{\"id\":\"GFOLDER1\"}")).then(request -> json(200, "{\"files\":[]}"));
            check(code(drive::list) == null, "Google: then the list goes ahead");
            f.http.then(request -> json(200, "{\"id\":\"GFOLDER1\"}")).then(request -> json(200, "{\"files\":[]}"));
            check(code(drive::list) == null, "Google: a settled session is not asked again");
            // Each unsettled session costs a request before every list, so only the newest are kept.
            for (int index = 0; index <= CloudGoogleDrive.MAX_UNSETTLED; index++) {
                f.http.then(opened).then(request -> {
                    throw new IOException("offline");
                }).then(request -> {
                    throw new IOException("offline");
                });
                String name = "recap-page-u" + index;
                check("timeout".equals(code(() -> drive.create(name, abc))), "Google: each is a timeout");
            }
            check(f.tracker.unsettled.size() == CloudGoogleDrive.MAX_UNSETTLED && !f.tracker.unsettled.containsKey("recap-page-u0")
                    && f.tracker.unsettled.containsKey("recap-page-u" + CloudGoogleDrive.MAX_UNSETTLED), "Google: the oldest unsettled session gives way");
            f.tracker.unsettled.clear();
            f.http.then(request -> json(200, "{}", "Location", "http://upload.example.com/g"));
            check("invalid".equals(code(() -> drive.create("recap-page-d", abc))), "Google: an http upload address is refused");
            f.http.done("Google settling");
        }

        static void folderRace() {
            // No folder yet lists as empty, and the next create makes it. Another device made one at the same
            // moment, so this one's is put in the trash and the older is used and learned.
            Fixture f = new Fixture();
            CloudGoogleDrive drive = f.drive(null);
            f.http.then(request -> json(200, "{\"files\":[]}"));
            List<CloudOneDrive.Item> empty = new ArrayList<>();
            check(code(() -> empty.addAll(drive.list())) == null && empty.isEmpty() && f.learned.isEmpty(), "Google: with no folder the list is empty");
            f.http.then(request -> json(200, "{\"files\":[]}"))
                    .then(request -> {
                        check(request.url.equals(CloudGoogleDrive.DRIVE + "/files?fields=id") && new String(request.body, StandardCharsets.UTF_8)
                                .equals("{\"name\":\"Recap Page\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"root\"]}"),
                                "Google: the folder is made at the top of the Drive");
                        return json(200, "{\"id\":\"GFOLDER3\"}");
                    })
                    .then(request -> json(200, "{\"files\":[{\"id\":\"GFOLDER2\"},{\"id\":\"GFOLDER3\"}]}"))
                    .then(request -> {
                        check(request.url.equals(CloudGoogleDrive.DRIVE + "/files/GFOLDER3?fields=id")
                                && "PATCH".equals(request.headers.get("x-http-method-override")), "Google: the folder this create made is put in the trash");
                        return json(200, "{\"id\":\"GFOLDER3\"}");
                    })
                    .then(request -> {
                        check(new String(request.body, StandardCharsets.UTF_8).contains("\"parents\":[\"GFOLDER2\"]"), "Google: the older folder is used");
                        return json(200, "{}", "Location", "https://www.googleapis.com/upload/drive/v3/files?upload_id=U3");
                    })
                    .then(request -> json(200, "{\"id\":\"E1\",\"name\":\"recap-page-e\"}"));
            check(code(() -> drive.create("recap-page-e", new byte[] {'a'})) == null, "Google: the create goes ahead");
            check(Collections.singletonList("GFOLDER2").equals(f.learned), "Google: the older folder is learned");
            f.http.done("Google folder race");
        }

        static void folderGone() {
            Fixture f = new Fixture();
            f.http.then(request -> json(200, "{\"id\":\"GFOLDER1\",\"trashed\":true}"));
            check("folder-gone".equals(code(f.drive("GFOLDER1")::list)), "Google: a folder in the trash counts as deleted");
            f.http.then(request -> json(404, "{}"));
            check("folder-gone".equals(code(f.drive("GFOLDER1")::list)), "Google: a deleted folder too");
            f.http.then(request -> json(404, "{}"));
            check("folder-gone".equals(code(() -> f.drive("GFOLDER1").create("recap-page-f", new byte[] {'a'}))),
                    "Google: an upload into a deleted folder too");
            f.http.done("Google folder gone");
        }

        static void renewal() {
            Fixture f = new Fixture();
            f.http.then(request -> json(401, ""))
                    .then(request -> {
                        check(("Bearer " + RENEWED).equals(request.headers.get("authorization")), "Google: the request is made again with a renewed token");
                        return json(200, "{\"id\":\"GFOLDER1\"}");
                    })
                    .then(request -> json(200, "{\"files\":[]}"));
            check(code(f.drive("GFOLDER1")::list) == null && java.util.Arrays.asList(false, true, false).equals(f.renewals),
                    "Google: a turned-away token is renewed once");
            f.http.then(request -> json(401, "")).then(request -> json(401, ""));
            check("needs-sign-in".equals(code(f.drive("GFOLDER1")::list)), "Google: a second 401 needs a sign-in");
            f.http.done("Google renewal");
        }
    }

    // The account with Google's sign-in, which Play services owns on a device, stood in for by a fake.
    static final class GoogleAccountCases {
        private GoogleAccountCases() {}

        static final String SCOPE = CloudAccount.GOOGLE_SCOPE;

        static final class FakeGoogle implements CloudAccount.Google {
            final List<String> asked = new ArrayList<>();
            final List<CloudAccount.Consent> consents = new ArrayList<>();
            final List<String> tokenCalls = new ArrayList<>();
            final Deque<String> tokens = new java.util.LinkedList<>();
            boolean authorizeFails;

            @Override
            public void authorize(String account, CloudAccount.Consent consent) throws Exception {
                if (authorizeFails) throw new IllegalStateException("no Play services");
                asked.add(String.valueOf(account));
                consents.add(consent);
            }

            @Override
            public String token(String account, String stale) {
                tokenCalls.add(account + "|" + stale);
                return tokens.poll();
            }

            CloudAccount.Consent last() {
                return consents.get(consents.size() - 1);
            }
        }

        static Map<?, ?> statusOf(Map<String, Object> reply) {
            return (Map<?, ?>) reply.get("status");
        }

        static void identified(Harness h) {
            h.http.then(request -> json(200, "{\"user\":{\"permissionId\":\"PERM1\",\"emailAddress\":\"reader@example.com\"}}"))
                    .then(request -> json(200, "{\"files\":[{\"id\":\"GFOLDER1\"}]}"));
        }

        static Harness signedIn(FakeGoogle google) {
            Harness h = new Harness(new Direct(), CloudAccount.DEADLINES_MS, google);
            h.call("connect", "{\"provider\":\"googledrive\"}");
            identified(h);
            google.last().granted(ACCESS, java.util.Arrays.asList(SCOPE));
            h.http.done("Google sign-in");
            return h;
        }

        static void run() {
            offered();
            refusedGrant();
            signIn();
            renewal();
            endings();
        }

        static void offered() {
            Harness plain = new Harness();
            check(java.util.Arrays.asList("onedrive").equals(plain.status().get("providers")),
                    "Google account: a build without Google's sign-in offers OneDrive alone");
            Map<String, Object> refused = plain.call("connect", "{\"provider\":\"googledrive\"}");
            check("invalid".equals(error(refused)) && CloudAccount.NOT_OFFERED.equals(errorMessage(refused)),
                    "Google account: and refuses to connect to Google Drive");
            Harness h = new Harness(new Direct(), CloudAccount.DEADLINES_MS, new FakeGoogle());
            check(java.util.Arrays.asList("onedrive", "googledrive").equals(h.status().get("providers")),
                    "Google account: a build with it offers both");
            check("onedrive".equals(h.status().get("provider")), "Google account: OneDrive is still the service named before any choice");
            List<String> methods = new ArrayList<>();
            for (java.lang.reflect.Method method : CloudAccount.Google.class.getDeclaredMethods()) methods.add(method.getName());
            Collections.sort(methods);
            check(java.util.Arrays.asList("authorize", "token").equals(methods),
                    "Google account: the sign-in can only authorize and hand out tokens, never revoke");
        }

        static void refusedGrant() {
            FakeGoogle google = new FakeGoogle();
            Harness h = new Harness(new Direct(), CloudAccount.DEADLINES_MS, google);
            Map<?, ?> started = statusOf(h.call("connect", "{\"provider\":\"googledrive\"}"));
            check("signing-in".equals(started.get("state")) && "googledrive".equals(started.get("provider")),
                    "Google account: Connect starts Google's sign-in");
            check(java.util.Arrays.asList("null").equals(google.asked) && h.launched.isEmpty(),
                    "Google account: Play services is asked, with no browser and no account chosen beforehand");
            check("invalid".equals(error(h.call("connect", ""))), "Google account: OneDrive cannot start while Google's sign-in is under way");
            google.last().granted(ACCESS, java.util.Arrays.asList("https://www.googleapis.com/auth/drive.appdata"));
            Map<String, Object> status = h.status();
            check("not-connected".equals(status.get("state")) && CloudAccount.GOOGLE_REFUSED.equals(status.get("message"))
                    && h.vault.stored == null && h.http.seen.isEmpty(),
                    "Google account: a grant without drive.file counts as not signed in, and nothing is kept or sent");
            check("signing-in".equals(statusOf(h.call("connect", "{\"provider\":\"googledrive\"}")).get("state")),
                    "Google account: Connect can start again afterwards");
            google.consents.get(0).granted(ACCESS, java.util.Arrays.asList(SCOPE));
            check("signing-in".equals(h.status().get("state")) && h.http.seen.isEmpty(), "Google account: an answer to an earlier sign-in is ignored");
            google.authorizeFails = true;
            h.call("disconnect", "");
            h.call("connect", "{\"provider\":\"googledrive\"}");
            check(CloudAccount.GOOGLE_LAUNCH_FAILED.equals(h.status().get("message")), "Google account: Play services that cannot start is said so");
        }

        static void signIn() {
            FakeGoogle google = new FakeGoogle();
            Harness h = signedIn(google);
            Map<String, Object> status = h.status();
            check("connected".equals(status.get("state")) && "googledrive".equals(status.get("provider")), "Google account: the grant connects");
            Map<String, Object> stored = CloudJson.object(h.vault.stored);
            check("googledrive".equals(stored.get("provider")) && "reader@example.com".equals(stored.get("googleAccount"))
                    && !stored.containsKey("refreshToken") && "GFOLDER1".equals(stored.get("folder"))
                    && !h.vault.stored.contains(ACCESS), "Google account: only the address is stored, never a token");
            check(("Bearer " + ACCESS).equals(h.http.seen.get(0).headers.get("authorization")), "Google account: the account is asked of Drive with the grant's token");
            google.last().granted(ACCESS, java.util.Arrays.asList(SCOPE));
            check(h.http.seen.size() == 2, "Google account: a second answer to the same sign-in is ignored");
            Map<String, Object> other = h.call("connect", "");
            check("invalid".equals(error(other)) && CloudAccount.ONE_AT_A_TIME.equals(errorMessage(other)),
                    "Google account: OneDrive is refused while Google Drive is connected");
            String connection = h.connection();
            h.http.then(request -> {
                check(("Bearer " + ACCESS).equals(request.headers.get("authorization")), "Google account: the grant's token is used while fresh");
                return json(200, "{\"id\":\"GFOLDER1\"}");
            }).then(request -> json(200, "{\"files\":[]}"));
            Map<String, Object> listed = h.call("list", "{\"connection\":\"" + connection + "\"}");
            check(listed.get("items") instanceof List && google.tokenCalls.isEmpty(), "Google account: a list goes to Google Drive");
            Map<?, ?> previous = h.status();
            h.call("disconnect", "");
            check(h.vault.stored == null && "not-connected".equals(h.status().get("state")) && google.tokenCalls.isEmpty()
                    && google.asked.size() == 1 && previous != null, "Google account: disconnecting forgets the sign-in here and asks nothing of Google");
            h.http.done("Google account list");
        }

        static void renewal() {
            FakeGoogle google = new FakeGoogle();
            Harness h = signedIn(google);
            String connection = h.connection();
            google.tokens.add(RENEWED);
            h.http.then(request -> json(401, ""))
                    .then(request -> {
                        check(("Bearer " + RENEWED).equals(request.headers.get("authorization")), "Google account: the renewed token is used");
                        return json(200, "{\"id\":\"GFOLDER1\"}");
                    })
                    .then(request -> json(200, "{\"files\":[]}"));
            h.call("list", "{\"connection\":\"" + connection + "\"}");
            check(java.util.Arrays.asList("reader@example.com|" + ACCESS).equals(google.tokenCalls),
                    "Google account: renewal asks for the stored address and clears the refused token");
            h.now += CloudAccount.GOOGLE_TOKEN_MS;
            google.tokens.add(null);
            Map<String, Object> stopped = h.call("list", "{\"connection\":\"" + connection + "\"}");
            check("needs-sign-in".equals(error(stopped)) && "needs-sign-in".equals(h.status().get("state"))
                    && "reader@example.com|null".equals(google.tokenCalls.get(1)), "Google account: an expired token is renewed without clearing, and a refusal needs a sign-in");
            check(CloudJson.object(h.vault.stored).get("googleAccount") == null && connection.equals(h.connection()),
                    "Google account: the address is forgotten and the connection kept");
            check("signing-in".equals(statusOf(h.call("connect", "{\"provider\":\"googledrive\"}")).get("state")),
                    "Google account: Connect signs in again");
            identified(h);
            google.last().granted(RENEWED, java.util.Arrays.asList(SCOPE));
            check("connected".equals(h.status().get("state")) && connection.equals(h.connection()),
                    "Google account: the same account and folder carry on the same connection");
            h.http.done("Google account renewal");
        }

        static void endings() {
            FakeGoogle google = new FakeGoogle();
            Harness h = new Harness(new Direct(), CloudAccount.DEADLINES_MS, google);
            h.call("connect", "{\"provider\":\"googledrive\"}");
            google.last().ended("declined");
            check("not-connected".equals(h.status().get("state")) && "Sign-in was cancelled.".equals(h.status().get("message")),
                    "Google account: a dismissed consent screen is a cancelled sign-in");
            h.call("connect", "{\"provider\":\"googledrive\"}");
            h.http.then(request -> json(200, "{\"user\":{\"permissionId\":\"PERM1\",\"displayName\":\"Reader\"}}"))
                    .then(request -> json(200, "{\"files\":[]}"));
            google.last().granted(ACCESS, java.util.Arrays.asList(SCOPE));
            check("not-connected".equals(h.status().get("state")) && h.vault.stored == null,
                    "Google account: a sign-in Drive cannot name an address for is not kept");
            h.call("connect", "{\"provider\":\"googledrive\"}");
            check(h.scheduled.size() == 1, "Google account: the sign-in has its five minutes");
            h.scheduled.get(0).run();
            check("not-connected".equals(h.status().get("state")) && h.status().get("message").toString().startsWith("Sign-in did not finish"),
                    "Google account: and ends when they pass");
            h.http.done("Google account endings");
        }
    }}
