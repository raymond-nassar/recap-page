package io.github.raymondnassar.recappage.prototype;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

// The cloud control API on Android: the seven operations the page asks for, status, connect, disconnect,
// list, read, create and delete, answered in the same JSON the Windows host gives in host/cloudHost.mjs, so
// the page's one transport and the shared protocol run unchanged over either. This class mirrors that host
// rule for rule, and a comment there is the reason for the matching line here; what differs is said where
// it differs. The page never receives a token: the refresh token lives in the vault, encrypted under a key
// the Keystore never lets out, and the access token only in this object's memory.
//
// Each call blocks, and the caller runs it on a worker thread. Every change to the stored sign-in happens
// under one lock, in order, so a refresh that finishes after a disconnect can never write it back.
final class CloudAccount {
    static final List<String> OPERATIONS =
            Collections.unmodifiableList(java.util.Arrays.asList("status", "connect", "disconnect", "list", "read", "create", "delete"));
    static final int SMALL_BODY = 16 * 1024;
    static final int CREATE_BODY = (CloudRules.MAX_ITEM_BYTES + 2) / 3 * 4 + 16 * 1024;
    static final int MAX_IN_FLIGHT = 16;
    // The same deadlines as HOST_DEADLINES_MS, each five seconds inside the page's own for the operation.
    static final Map<String, Long> DEADLINES_MS;
    private static final int MAX_STRAY = 32;

    static {
        Map<String, Long> deadlines = new HashMap<>();
        deadlines.put("list", 115_000L);
        deadlines.put("read", 595_000L);
        deadlines.put("create", 595_000L);
        deadlines.put("delete", 25_000L);
        DEADLINES_MS = Collections.unmodifiableMap(deadlines);
    }

    static final Map<String, String> SIGN_IN_ENDED;

    static {
        Map<String, String> ended = new HashMap<>();
        ended.put("declined", "Sign-in was cancelled.");
        ended.put("refused", "Microsoft did not complete the sign-in.");
        ended.put("expired", "Sign-in did not finish within five minutes. Start it again when you are ready.");
        ended.put("cancelled", "Sign-in was cancelled.");
        ended.put("invalid", "Sign-in was stopped after answers it did not expect.");
        ended.put("failed", "Sign-in stopped unexpectedly.");
        SIGN_IN_ENDED = Collections.unmodifiableMap(ended);
    }

    static final String CONNECTED_AGAIN = "Cloud backup was connected again since this browser agreed to it, so it asks again first.";
    static final String FOLDER_GONE = folderGone("OneDrive");
    static final String UNEXPECTED = "Cloud backup stopped unexpectedly.";
    static final String LAUNCH_FAILED = "The browser could not be opened for sign-in.";
    static final String GOOGLE_LAUNCH_FAILED = "Google's sign-in could not be opened on this device.";
    static final String GOOGLE_REFUSED = "Google did not grant the access cloud backup needs.";
    static final String ONE_AT_A_TIME = "Cloud backup is already set up with another service on this device. Disconnect it first.";
    static final String NOT_OFFERED = "That cloud service is not offered by this build of Recap Page.";
    static final String ONEDRIVE = "onedrive";
    static final String GOOGLE_DRIVE = "googledrive";
    // The one scope Google Drive is asked for, the same as GOOGLE_SCOPE in host/googleDrive.mjs.
    static final String GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    // Play services does not say when a token it hands over expires, so one is used for this long at most
    // before it is asked for again, and a refusal sooner than that clears it from Play services' cache.
    static final long GOOGLE_TOKEN_MS = 10 * 60_000L;

    static String folderGone(String name) {
        return "The Recap Page folder was deleted from " + name + ", so cloud backup asks again before it makes a new one.";
    }

    private static String nameOf(String provider) {
        return GOOGLE_DRIVE.equals(provider) ? "Google Drive" : "OneDrive";
    }

    private static String companyOf(String provider) {
        return GOOGLE_DRIVE.equals(provider) ? "Google" : "Microsoft";
    }

    // Opens Microsoft's page in the browser, throwing when no browser would take it.
    interface Launcher {
        void open(String url) throws Exception;
    }

    // Google's sign-in on Android, which Play services owns, behind this so the rules here run on a JVM. Only
    // the person's Google address is stored here; Play services keeps the grant and every token. Nothing on
    // this interface revokes the grant, because revoking at Google ends it for every client of the project,
    // which would sign the person's other devices out of the Google Drive they back up to (#810, P04).
    interface Google {
        // Asks for Drive access, showing Google's account chooser and consent when Play services needs them,
        // and answers through the consent exactly once. Throws when it could not start at all.
        void authorize(String account, Consent consent) throws Exception;

        // A token for the account with no screen at all, or null when the person has to agree again. A stale
        // token, when given, is the one Drive just refused, cleared from Play services' cache first.
        String token(String account, String stale) throws CloudError;
    }

    // The answer to one interactive sign-in. An answer to a sign-in that has since ended is ignored.
    interface Consent {
        void granted(String token, java.util.Collection<String> scopes);

        void ended(String reason);
    }

    // Runs a task once after a delay, returning what cancels it.
    interface Scheduler {
        Runnable schedule(Runnable task, long delayMs);
    }

    static final class Reply {
        final int status;
        final String body;

        Reply(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    // One service's sign-in. The credential is OneDrive's refresh token, or for Google Drive the person's
    // Google address, which Play services needs to find its grant again; null means a sign-in is needed.
    private static final class Record {
        final String provider;
        final String connection;
        final String accountId;
        final String hint;
        // Learned in place, as learnFolder does on Windows, so a refresh under way still finds its record.
        String folder;
        final String credential;
        long savedAt;

        Record(String provider, String connection, String accountId, String hint, String folder, String credential, long savedAt) {
            this.provider = provider;
            this.connection = connection;
            this.accountId = accountId;
            this.hint = hint;
            this.folder = folder;
            this.credential = credential;
            this.savedAt = savedAt;
        }

        Record with(String nextConnection, String nextFolder, String nextCredential, long now) {
            return new Record(provider, nextConnection, accountId, hint, nextFolder, nextCredential, now);
        }

        private static String credentialKey(String provider) {
            return GOOGLE_DRIVE.equals(provider) ? "googleAccount" : "refreshToken";
        }

        String toJson() {
            Map<String, Object> account = new LinkedHashMap<>();
            account.put("id", accountId);
            account.put("hint", hint);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("version", 1L);
            out.put("provider", provider);
            out.put("connection", connection);
            out.put("account", account);
            out.put("folder", folder);
            out.put(credentialKey(provider), credential);
            out.put("savedAt", savedAt);
            return CloudJson.write(out);
        }

        static Record parse(String text) throws CloudError {
            CloudError invalid = new CloudError("invalid", CloudVault.INVALID);
            Map<String, Object> value = CloudJson.object(text);
            Object provider = value == null ? null : value.get("provider");
            if (value == null || !Double.valueOf(1).equals(value.get("version"))
                    || !(ONEDRIVE.equals(provider) || GOOGLE_DRIVE.equals(provider))) throw invalid;
            Object connection = value.get("connection");
            Object account = value.get("account");
            Object folder = value.get("folder");
            Object credential = value.get(credentialKey((String) provider));
            Object saved = value.get("savedAt");
            if (!(connection instanceof String) || !CloudRules.CONNECTION.matcher((String) connection).matches()
                    || !(account instanceof Map) || !(folder == null || (folder instanceof String
                    && CloudRules.ITEM_ID.matcher((String) folder).matches()))
                    || !(credential == null || (credential instanceof String && !((String) credential).isEmpty()))
                    || !CloudRules.safeInteger(saved)) throw invalid;
            Object id = ((Map<?, ?>) account).get("id");
            Object hint = ((Map<?, ?>) account).get("hint");
            if (!(id instanceof String) || ((String) id).isEmpty() || !(hint == null || CloudRules.displayText(hint) != null)) throw invalid;
            return new Record((String) provider, (String) connection, (String) id, (String) hint, (String) folder, (String) credential,
                    (long) (double) (Double) saved);
        }
    }

    private static final class Access {
        final String token;
        final long expiresAt;
        final String connection;

        Access(String token, long expiresAt, String connection) {
            this.token = token;
            this.expiresAt = expiresAt;
            this.connection = connection;
        }
    }

    private static final class SignIn {
        final String provider;
        // Microsoft's PKCE state; null for Google, whose sign-in Play services runs.
        final CloudAuthorization authorization;
        final long expiresAt;
        final long epoch;
        int stray;
        boolean claimed;
        Runnable cancelExpiry = () -> {};

        SignIn(String provider, CloudAuthorization authorization, long expiresAt, long epoch) {
            this.provider = provider;
            this.authorization = authorization;
            this.expiresAt = expiresAt;
            this.epoch = epoch;
        }
    }

    private static final class Refreshing {
        final String connection;
        final CompletableFuture<String> token = new CompletableFuture<>();

        Refreshing(String connection) {
            this.connection = connection;
        }
    }

    private final CloudHttp http;
    private final CloudVault vault;
    private final Launcher launcher;
    private final Scheduler scheduler;
    private final ExecutorService workers;
    private final LongSupplier clock;
    private final Random random;
    private final String clientId;
    private final String redirectUri;
    private final Map<String, Long> deadlines;
    private final Google google;
    private final CloudOneDrive.Tracker tracker = new CloudOneDrive.Tracker();
    private final CloudGoogleDrive.Tracker googleTracker = new CloudGoogleDrive.Tracker();
    private final AtomicInteger inFlight = new AtomicInteger();
    private final Object lock = new Object();

    private boolean loaded;
    private Record record;
    private String message;
    private SignIn signIn;
    private Access access;
    private Refreshing refreshing;
    private long epoch;
    private String changedConnection;
    private String changedReason;

    CloudAccount(CloudHttp http, CloudVault vault, Launcher launcher, Scheduler scheduler, ExecutorService workers,
            LongSupplier clock, Random random, String clientId, String redirectUri, Map<String, Long> deadlines) {
        this(http, vault, launcher, scheduler, workers, clock, random, clientId, redirectUri, deadlines, null);
    }

    // Google Drive is offered only when a Google sign-in is given, so a build without one offers OneDrive alone.
    CloudAccount(CloudHttp http, CloudVault vault, Launcher launcher, Scheduler scheduler, ExecutorService workers,
            LongSupplier clock, Random random, String clientId, String redirectUri, Map<String, Long> deadlines, Google google) {
        if (!CloudAuthorization.validClientId(clientId)) throw new IllegalArgumentException("A client id is required.");
        this.http = http;
        this.vault = vault;
        this.launcher = launcher;
        this.scheduler = scheduler;
        this.workers = workers;
        this.clock = clock;
        this.random = random;
        this.clientId = clientId;
        this.redirectUri = redirectUri;
        this.deadlines = deadlines;
        this.google = google;
    }

    private long now() {
        return clock.getAsLong();
    }

    private String newConnection() {
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        return CloudRules.hex(bytes);
    }

    private static String publicMessage(Throwable error, String fallback) {
        return error instanceof CloudError ? error.getMessage() : fallback;
    }

    // The stored sign-in is read once, when it is first needed. A record this device cannot read is no use
    // to anyone, so it is cleared and a new sign-in is asked for; any other failure is tried again next time.
    private void load() throws CloudError {
        synchronized (lock) {
            if (loaded) return;
            try {
                record = vault.exists() ? Record.parse(vault.load()) : null;
            } catch (CloudError error) {
                if (!"unreadable".equals(error.code) && !"invalid".equals(error.code)) throw error;
                record = null;
                message = error.getMessage();
                try {
                    vault.clear();
                } catch (CloudError ignored) {
                    // A record left behind is read and refused again next time.
                }
            }
            loaded = true;
        }
    }

    Map<String, Object> status() {
        CloudError problem = null;
        try {
            load();
        } catch (CloudError error) {
            problem = error;
        }
        synchronized (lock) {
            String state = problem != null ? "unavailable" : signIn != null ? "signing-in" : record == null ? "not-connected"
                    : record.credential != null ? "connected" : "needs-sign-in";
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("provider", record != null ? record.provider : signIn != null ? signIn.provider : ONEDRIVE);
            out.put("providers", google != null ? java.util.Arrays.asList(ONEDRIVE, GOOGLE_DRIVE) : Collections.singletonList(ONEDRIVE));
            out.put("state", state);
            out.put("connection", problem == null && record != null ? record.connection : null);
            out.put("account", problem == null && record != null ? record.hint : null);
            out.put("message", problem != null ? problem.getMessage() : message);
            out.put("reason", problem == null && record != null && record.connection.equals(changedConnection) ? changedReason : null);
            out.put("signInExpiresAt", signIn != null ? (Object) signIn.expiresAt : null);
            return out;
        }
    }

    // A browser naming a connection that is no longer the current one, told why in the words its card shows.
    private CloudError askAgain(Record current) {
        return new CloudError("needs-consent", current.connection.equals(changedConnection) ? changedReason : CONNECTED_AGAIN);
    }

    Map<String, Object> connect() throws CloudError {
        return connect(Collections.emptyMap());
    }

    Map<String, Object> connect(Map<String, Object> input) throws CloudError {
        load();
        Object named = input.containsKey("provider") ? input.get("provider") : ONEDRIVE;
        if (!ONEDRIVE.equals(named) && !(GOOGLE_DRIVE.equals(named) && google != null)) throw new CloudError("invalid", NOT_OFFERED);
        String provider = (String) named;
        boolean start;
        synchronized (lock) {
            // One service at a time: a connection to the other one is disconnected first, so nothing it agreed
            // to is carried across, as the Windows host's connect refuses it.
            if ((record != null && !record.provider.equals(provider)) || (signIn != null && !signIn.provider.equals(provider))) {
                throw new CloudError("invalid", ONE_AT_A_TIME);
            }
            start = signIn == null && (record == null || record.credential == null);
        }
        if (start) {
            boolean probe;
            synchronized (lock) {
                probe = record == null;
            }
            // With no sign-in stored, whether this device can protect one is asked before the service's page
            // opens. Asked again after it, because a second Connect may have started a sign-in meanwhile.
            if (probe) vault.probe();
            SignIn job = null;
            synchronized (lock) {
                if (signIn == null && (record == null || record.credential == null)) {
                    job = new SignIn(provider, GOOGLE_DRIVE.equals(provider) ? null : CloudAuthorization.create(random),
                            now() + CloudAuthorization.SIGN_IN_MS, epoch);
                    signIn = job;
                    message = null;
                }
            }
            if (job != null) {
                final SignIn started = job;
                job.cancelExpiry = scheduler.schedule(() -> expire(started), CloudAuthorization.SIGN_IN_MS);
                if (job.authorization == null) {
                    try {
                        google.authorize(null, consentFor(job));
                    } catch (Exception error) {
                        end(job, null, GOOGLE_LAUNCH_FAILED);
                    }
                } else {
                    try {
                        launcher.open(job.authorization.url(clientId, redirectUri));
                    } catch (Exception error) {
                        end(job, null, LAUNCH_FAILED);
                    }
                }
            }
        }
        return status();
    }

    private void expire(SignIn job) {
        synchronized (lock) {
            if (!job.claimed) end(job, "expired", null);
        }
    }

    private void end(SignIn job, String reason, String text) {
        synchronized (lock) {
            if (signIn != job) return;
            signIn = null;
            job.cancelExpiry.run();
            String said = SIGN_IN_ENDED.getOrDefault(reason, SIGN_IN_ENDED.get("failed"));
            if ("refused".equals(reason)) said = companyOf(job.provider) + " did not complete the sign-in.";
            message = text != null ? text : said;
        }
    }

    // Google's answer to one sign-in, bound to it: only the first answer is taken, and only while that sign-in
    // is still the one under way. A grant without the Drive scope is no use and is never kept, so the person
    // is simply not signed in. It is not revoked either, for the reason on Google above.
    private Consent consentFor(SignIn job) {
        return new Consent() {
            @Override
            public void granted(String token, java.util.Collection<String> scopes) {
                synchronized (lock) {
                    if (signIn != job || job.claimed) return;
                    job.claimed = true;
                    job.cancelExpiry.run();
                    if (token == null || token.isEmpty() || scopes == null || !scopes.contains(GOOGLE_SCOPE)) {
                        end(job, null, GOOGLE_REFUSED);
                        return;
                    }
                }
                try {
                    workers.execute(() -> finishGoogle(job, token));
                } catch (RuntimeException error) {
                    end(job, null, SIGN_IN_ENDED.get("failed"));
                }
            }

            @Override
            public void ended(String reason) {
                synchronized (lock) {
                    if (signIn != job || job.claimed) return;
                    job.claimed = true;
                    end(job, SIGN_IN_ENDED.containsKey(reason) ? reason : "failed", null);
                }
            }
        };
    }

    private void finishGoogle(SignIn job, String token) {
        try {
            CloudGoogleDrive.Identity found = new CloudGoogleDrive(http, renew -> token, clock, new CloudGoogleDrive.Tracker(),
                    null, id -> {}).identify();
            // The address is what Play services finds the grant by, so a sign-in that cannot name one is no use.
            if (found.hint == null || !found.hint.contains("@")) throw new CloudError("refused", "Google did not confirm which account signed in.");
            synchronized (lock) {
                if (epoch != job.epoch || signIn != job) return;
                Record previous = record;
                boolean same = previous != null && previous.provider.equals(job.provider) && previous.accountId.equals(found.account)
                        && (previous.folder == null || previous.folder.equals(found.folder));
                Record next = new Record(job.provider, same ? previous.connection : newConnection(), found.account, found.hint,
                        found.folder, found.hint, now());
                vault.save(next.toJson());
                // Sessions left from an earlier sign-in, perhaps to another account, are not this one's to ask about.
                googleTracker.unsettled.clear();
                record = next;
                access = new Access(token, now() + GOOGLE_TOKEN_MS, next.connection);
                message = null;
                signIn = null;
            }
        } catch (Throwable error) {
            end(job, null, publicMessage(error, SIGN_IN_ENDED.get("failed")));
        } finally {
            synchronized (lock) {
                if (signIn == job) signIn = null;
            }
        }
    }

    // The browser came back to the registered redirect. Anything that is not the answer to the sign-in under
    // way is ignored, and after 32 of those the sign-in ends, as the Windows callback ends it; the first
    // real answer is the only one taken.
    void redirect(String uri) {
        SignIn job;
        CloudAuthorization.Answer answer;
        synchronized (lock) {
            job = signIn;
            if (job == null || job.claimed || job.authorization == null) return;
            answer = job.authorization.answer(uri, redirectUri);
            if (answer == null) {
                job.stray += 1;
                if (job.stray > MAX_STRAY) end(job, "invalid", null);
                return;
            }
            job.claimed = true;
            job.cancelExpiry.run();
            if (answer.error != null) {
                end(job, answer.error, null);
                return;
            }
        }
        final String code = answer.code;
        workers.execute(() -> finishSignIn(job, code));
    }

    private void finishSignIn(SignIn job, String code) {
        try {
            CloudMicrosoft.Tokens tokens = CloudMicrosoft.redeem(http, clientId, clock, code, job.authorization.verifier, redirectUri);
            if (tokens.refreshToken == null || !CloudMicrosoft.grantsAppFolder(tokens.scope)) {
                throw new CloudError("refused", "Microsoft did not grant the access cloud backup needs.");
            }
            CloudMicrosoft.Claims claims = CloudMicrosoft.idTokenClaims(tokens.idToken, clientId, job.authorization.nonce, now());
            CloudOneDrive.AppFolder folder = new CloudOneDrive(http, renew -> tokens.accessToken, clock, new CloudOneDrive.Tracker(),
                    null, id -> {}).appFolder();
            // The drive names the account. If the app folder is not there to report it, the account's own id
            // stands in, which can only ever ask the browsers for their consent again, never skip it.
            String account = folder.driveId != null ? "drive:" + folder.driveId : "subject:" + claims.subject;
            synchronized (lock) {
                if (epoch != job.epoch || signIn != job) return;
                Record previous = record;
                boolean same = previous != null && previous.provider.equals(job.provider) && previous.accountId.equals(account)
                        && (previous.folder == null || previous.folder.equals(folder.id));
                Record next = new Record(job.provider, same ? previous.connection : newConnection(), account, claims.hint, folder.id,
                        tokens.refreshToken, now());
                vault.save(next.toJson());
                record = next;
                access = new Access(tokens.accessToken, now() + tokens.expiresInMs, next.connection);
                message = null;
                signIn = null;
            }
        } catch (Throwable error) {
            end(job, null, publicMessage(error, SIGN_IN_ENDED.get("failed")));
        } finally {
            synchronized (lock) {
                if (signIn == job) signIn = null;
            }
        }
    }

    // Disconnecting works even where the sign-in cannot be read, so erase can always remove it.
    Map<String, Object> disconnect() throws CloudError {
        synchronized (lock) {
            epoch += 1;
            SignIn job = signIn;
            signIn = null;
            if (job != null) job.cancelExpiry.run();
            access = null;
            vault.clear();
            record = null;
            loaded = true;
            message = null;
        }
        return status();
    }

    private String renewal(Record current, String stale) throws CloudError {
        long started;
        synchronized (lock) {
            started = epoch;
        }
        if (GOOGLE_DRIVE.equals(current.provider)) return googleRenewal(current, stale, started);
        CloudMicrosoft.Tokens tokens;
        try {
            tokens = CloudMicrosoft.refresh(http, clientId, clock, current.credential);
        } catch (CloudError error) {
            if (!"refused".equals(error.code)) throw error;
            // The refresh token is dead. The connection, the account and the folder stay, so signing in again
            // to the same account, with its folder still there, carries on without any browser agreeing again.
            synchronized (lock) {
                if (epoch == started && record == current) {
                    Record next = current.with(current.connection, current.folder, null, now());
                    record = next;
                    access = null;
                    saveQuietly(next);
                }
            }
            throw new CloudError("needs-sign-in", "Microsoft asked for the sign-in to be made again, so cloud backups have stopped until it is.");
        }
        synchronized (lock) {
            if (epoch != started || record != current) throw new CloudError("not-connected", "Cloud backup was disconnected.");
            // Every refresh returns a new refresh token, which replaces the stored one at once. Should the
            // vault fail, the old one still works, because Microsoft does not revoke one when it is used.
            Record next = current.with(current.connection, current.folder,
                    tokens.refreshToken != null ? tokens.refreshToken : current.credential, now());
            saveQuietly(next);
            record = next;
            access = new Access(tokens.accessToken, now() + tokens.expiresInMs, next.connection);
            return access.token;
        }
    }

    // Play services keeps Google's grant, so renewing asks it for a token for the stored address. A token
    // Drive refused is cleared from its cache first, so the answer is a fresh one rather than the same.
    private String googleRenewal(Record current, String stale, long started) throws CloudError {
        if (google == null) throw new CloudError("unavailable", "This build of Recap Page cannot reach the service cloud backup was set up with.");
        String token = google.token(current.credential, stale);
        if (token == null) {
            synchronized (lock) {
                if (epoch == started && record == current) {
                    Record next = current.with(current.connection, current.folder, null, now());
                    record = next;
                    access = null;
                    saveQuietly(next);
                }
            }
            throw new CloudError("needs-sign-in", "Google asked for the sign-in to be made again, so cloud backups have stopped until it is.");
        }
        synchronized (lock) {
            if (epoch != started || record != current) throw new CloudError("not-connected", "Cloud backup was disconnected.");
            access = new Access(token, now() + GOOGLE_TOKEN_MS, current.connection);
            return token;
        }
    }

    private void saveQuietly(Record next) {
        try {
            vault.save(next.toJson());
        } catch (CloudError ignored) {
            // The record in memory carries on; a restarted app finds the one saved before.
        }
    }

    private CloudOneDrive.Tokens tokenFor(String connection) {
        return renew -> {
            Refreshing pending;
            boolean mine = false;
            Record current;
            String stale;
            synchronized (lock) {
                current = record;
                if (current == null) throw new CloudError("not-connected", "Cloud backup was disconnected.");
                if (!current.connection.equals(connection)) throw askAgain(current);
                if (current.credential == null) throw new CloudError("needs-sign-in", signInAgainText(current));
                if (!renew && access != null && access.connection.equals(connection) && access.expiresAt - 60_000 > now()) {
                    return access.token;
                }
                stale = renew && access != null && access.connection.equals(connection) ? access.token : null;
                // One refresh at a time for a connection: the second caller waits for the first one's token
                // rather than spending the refresh token the first is about to replace.
                if (refreshing == null || !refreshing.connection.equals(connection)) {
                    refreshing = new Refreshing(connection);
                    mine = true;
                }
                pending = refreshing;
            }
            if (mine) {
                try {
                    pending.token.complete(renewal(current, stale));
                } catch (CloudError error) {
                    pending.token.completeExceptionally(error);
                } catch (RuntimeException error) {
                    pending.token.completeExceptionally(new CloudError("failed", UNEXPECTED));
                } finally {
                    synchronized (lock) {
                        if (refreshing == pending) refreshing = null;
                    }
                }
            }
            try {
                return pending.token.get();
            } catch (ExecutionException error) {
                throw error.getCause() instanceof CloudError ? (CloudError) error.getCause() : new CloudError("failed", UNEXPECTED);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new CloudError("failed", UNEXPECTED);
            }
        };
    }

    private interface Work {
        Object run(CloudProvider.Drive drive) throws CloudError;
    }

    private static String signInAgainText(Record current) {
        return "Sign in to " + nameOf(current.provider) + " again to keep backing up.";
    }

    private Object drive(Map<String, Object> input, Work work) throws CloudError {
        load();
        Object connection = input.get("connection");
        if (!(connection instanceof String) || !CloudRules.CONNECTION.matcher((String) connection).matches()) {
            throw new CloudError("invalid", "The request did not name a connection.");
        }
        Record current;
        synchronized (lock) {
            if (record == null) throw new CloudError("not-connected", "Cloud backup is not connected on this device.");
            // A different connection than the one this page agreed to, so it has to see what is there and
            // agree again first.
            if (!record.connection.equals(connection)) throw askAgain(record);
            if (record.credential == null) throw new CloudError("needs-sign-in", signInAgainText(record));
            current = record;
        }
        CloudProvider.Drive drive;
        if (GOOGLE_DRIVE.equals(current.provider)) {
            if (google == null) throw new CloudError("unavailable", "This build of Recap Page cannot reach the service cloud backup was set up with.");
            drive = new CloudGoogleDrive(http, tokenFor((String) connection), clock, googleTracker, current.folder,
                    id -> learnFolder(current, id));
        } else {
            drive = new CloudOneDrive(http, tokenFor((String) connection), clock, tracker, current.folder,
                    id -> learnFolder(current, id));
        }
        try {
            return work.run(drive);
        } catch (CloudError error) {
            if ("folder-gone".equals(error.code)) forgetFolder(current);
            if ("needs-sign-in".equals(error.code)) signInAgain(current);
            throw error;
        }
    }

    // OneDrive refused a token the account had just renewed, so the sign-in itself is no longer any good:
    // the record says so, status asks for a sign-in again, and Connect starts one. The connection stays.
    private void signInAgain(Record current) {
        synchronized (lock) {
            Record latest = record;
            if (latest == null || !latest.connection.equals(current.connection) || latest.credential == null) return;
            Record next = latest.with(latest.connection, latest.folder, null, now());
            saveQuietly(next);
            record = next;
            access = null;
        }
    }

    // The person deleted the backup folder in their drive, which the transport contract treats as consent
    // withdrawn: a new connection id makes every page agree again before its next backup, and the folder is
    // forgotten, so the next create makes a new one and teaches its id.
    private void forgetFolder(Record current) throws CloudError {
        String gone = folderGone(nameOf(current.provider));
        synchronized (lock) {
            Record latest = record;
            if (latest != null && latest.connection.equals(current.connection)
                    && java.util.Objects.equals(latest.folder, current.folder)) {
                Record next = latest.with(newConnection(), null, latest.credential, now());
                saveQuietly(next);
                record = next;
                access = null;
                changedConnection = next.connection;
                changedReason = gone;
            }
        }
        throw new CloudError("needs-consent", gone);
    }

    private void learnFolder(Record current, String id) {
        synchronized (lock) {
            Record latest = record;
            if (latest == null || !latest.connection.equals(current.connection) || latest.folder != null) return;
            latest.folder = id;
            latest.savedAt = now();
            saveQuietly(latest);
        }
    }

    private static String itemId(Map<String, Object> input) throws CloudError {
        Object id = input.get("id");
        if (!(id instanceof String) || !CloudRules.ITEM_ID.matcher((String) id).matches()) {
            throw new CloudError("invalid", "The request did not name an item.");
        }
        return (String) id;
    }

    // An operation that has not finished by its deadline is answered as a timeout, and its work goes on
    // behind the answer: a create keeps its place in the upload tracker, so the next list waits for it.
    private Map<String, Object> within(String operation, java.util.concurrent.Callable<Map<String, Object>> work) throws CloudError {
        long limit = deadlines.get(operation);
        String service;
        synchronized (lock) {
            service = nameOf(record != null ? record.provider : ONEDRIVE);
        }
        Future<Map<String, Object>> done = workers.submit(work);
        try {
            return done.get(limit, TimeUnit.MILLISECONDS);
        } catch (TimeoutException error) {
            throw new CloudError("timeout", service + " did not finish within " + Math.round(limit / 1000.0) + " seconds.");
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof CloudError) throw (CloudError) cause;
            throw new CloudError("failed", UNEXPECTED);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CloudError("failed", UNEXPECTED);
        }
    }

    private Map<String, Object> run(String operation, Map<String, Object> input) throws CloudError {
        Map<String, Object> out = new LinkedHashMap<>();
        switch (operation) {
            case "status":
                out.put("status", status());
                return out;
            case "connect":
                out.put("status", connect(input));
                return out;
            case "disconnect":
                out.put("status", disconnect());
                return out;
            case "list":
                return within("list", () -> {
                    List<Object> items = new ArrayList<>();
                    drive(input, service -> {
                        for (CloudOneDrive.Item item : service.list()) items.add(item.toJson());
                        return null;
                    });
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("items", items);
                    return result;
                });
            case "read":
                return within("read", () -> {
                    Object bytes = drive(input, service -> service.read(itemId(input)));
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("bytes", Base64.getEncoder().encodeToString((byte[]) bytes));
                    return result;
                });
            case "create":
                return within("create", () -> {
                    Object item = drive(input, service -> {
                        Object name = input.get("name");
                        Object text = input.get("bytes");
                        if (!(name instanceof String) || !CloudRules.ITEM_NAME.matcher((String) name).matches()
                                || !(text instanceof String) || !CloudRules.BASE64.matcher((String) text).matches()) {
                            throw new CloudError("invalid", "The request did not hold a backup to create.");
                        }
                        byte[] bytes;
                        try {
                            bytes = Base64.getDecoder().decode((String) text);
                        } catch (IllegalArgumentException error) {
                            throw new CloudError("invalid", "The request did not hold a backup to create.");
                        }
                        if (bytes.length == 0) throw new CloudError("invalid", "That backup is empty.");
                        if (bytes.length > CloudRules.MAX_ITEM_BYTES) {
                            throw new CloudError("too-large", "That backup is larger than a cloud backup can be.");
                        }
                        return service.create((String) name, bytes);
                    });
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("item", ((CloudOneDrive.Item) item).toJson());
                    return result;
                });
            default:
                return within("delete", () -> {
                    drive(input, service -> {
                        service.delete(itemId(input));
                        return null;
                    });
                    return new LinkedHashMap<>();
                });
        }
    }

    static Reply refuse(int status, String code, String text) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("message", text);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", false);
        out.put("error", error);
        return new Reply(status, CloudJson.write(out));
    }

    // One request from the page: the operation's name and its JSON body as text. The answer is the status
    // and body the Windows host would send, every failure inside an operation answered 200 with ok false.
    Reply handle(String operation, String text) {
        if (!OPERATIONS.contains(operation)) return refuse(404, "operation", "There is no such cloud operation.");
        if (inFlight.incrementAndGet() > MAX_IN_FLIGHT) {
            inFlight.decrementAndGet();
            return refuse(429, "unavailable", "Too many cloud requests at once.");
        }
        try {
            String body = text == null ? "" : text;
            int limit = operation.equals("create") ? CREATE_BODY : SMALL_BODY;
            if (utf8Length(body) > limit) {
                return refuse(413, "size", "That request is larger than this operation accepts.");
            }
            Object parsed;
            try {
                parsed = body.isEmpty() ? new LinkedHashMap<String, Object>() : CloudJson.parse(body);
            } catch (CloudJson.Invalid error) {
                return refuse(400, "json", "That request is not readable JSON.");
            } catch (OutOfMemoryError error) {
                // The cap is the Windows host's, and a phone's heap can be smaller than reading a body at it
                // takes. Failing this one request is recoverable; the error escaping would end the app.
                return refuse(413, "size", TOO_LARGE_HERE);
            }
            if (!(parsed instanceof Map)) return refuse(400, "json", "That request is not a JSON object.");
            @SuppressWarnings("unchecked")
            Map<String, Object> input = (Map<String, Object>) parsed;
            Map<String, Object> out = new LinkedHashMap<>();
            try {
                Map<String, Object> result = run(operation, input);
                out.put("ok", true);
                out.putAll(result);
            } catch (Throwable error) {
                boolean known = error instanceof CloudError;
                Map<String, Object> failure = new LinkedHashMap<>();
                failure.put("code", known ? ((CloudError) error).code : "failed");
                failure.put("message", publicMessage(error, UNEXPECTED));
                if (known && ((CloudError) error).retryAfterMs > 0) failure.put("retryAfterMs", ((CloudError) error).retryAfterMs);
                out.clear();
                out.put("ok", false);
                out.put("error", failure);
            }
            try {
                return new Reply(200, CloudJson.write(out));
            } catch (OutOfMemoryError error) {
                // A read at the cap is held as bytes, as base64 and as the reply around it at once, which a
                // phone's heap may not fit. Measured at a 128 MB heap, a 32 MB item ends here.
                out.clear();
                return refuse(200, "too-large", TOO_LARGE_TO_READ);
            }
        } finally {
            inFlight.decrementAndGet();
        }
    }

    static final String TOO_LARGE_HERE = "That request is too large for this device to read.";
    static final String TOO_LARGE_TO_READ = "That backup is too large for this device to read.";

    // The body's size in UTF-8 without encoding a copy of it, which at the create cap is tens of megabytes.
    // An unpaired surrogate counts as three bytes, never fewer than the encoder would write.
    static long utf8Length(String text) {
        long length = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 0x80) {
                length += 1;
            } else if (c < 0x800) {
                length += 2;
            } else if (Character.isHighSurrogate(c) && i + 1 < text.length() && Character.isLowSurrogate(text.charAt(i + 1))) {
                length += 4;
                i += 1;
            } else {
                length += 3;
            }
        }
        return length;
    }

    // The app is going away: a sign-in under way ends, and nothing it would have saved is saved.
    void close() {
        synchronized (lock) {
            epoch += 1;
            SignIn job = signIn;
            signIn = null;
            if (job != null) job.cancelExpiry.run();
        }
    }
}
