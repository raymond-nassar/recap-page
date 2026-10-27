package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

final class CloudNativeAuth implements CloudService.Auth {
    private static final Object LOCAL_LEASE = new Object();
    interface Protection { CloudSessions.Protected open() throws IOException; }
    interface Driver {
        boolean current();
        void validate(Cached cached) throws Exception;
        default Proof reuse(Cached cached) throws Exception { return null; }
        Proof connect(Request request) throws Exception;
        Proof refresh(Request request, Cached cached) throws Exception;
        void cancel(Request request);
    }
    static class Cached {
        final String id, label, material;
        Cached(String id, String label, String material) throws IOException {
            new CloudService.Account(id, label);
            if (material == null || material.isEmpty() || material.getBytes(StandardCharsets.UTF_8).length > 262144) throw failure();
            this.id = id; this.label = label; this.material = material;
        }
    }
    static final class Proof extends Cached {
        final String token;
        Proof(String id, String label, String material, String token) throws IOException {
            super(id, label, material);
            if (token == null || token.isEmpty() || token.length() > 65536 || !token.matches("[\\x21-\\x7e]+")) throw failure();
            this.token = token;
        }
    }
    final class Request {
        final String nonce = CloudJson.random();
        final String profile = CloudNativeAuth.this.profile;
        final String client = CloudNativeAuth.this.client;
        final CloudProviderHttp.Provider provider = CloudNativeAuth.this.provider;
        final long epoch = CloudNativeAuth.this.epoch;
        private final long expires;
        private final BooleanSupplier caller;
        private final AtomicBoolean consumed = new AtomicBoolean();
        private volatile boolean closed;
        Request(BooleanSupplier caller, boolean interactive) {
            this.caller = () -> caller.getAsBoolean() && driver.current();
            expires = clock.getAsLong() + (interactive ? 300000 : 30000);
        }
        boolean current() {
            if (closed || clock.getAsLong() >= expires || !caller.getAsBoolean()) return false;
            try { return locked(() -> owns(journal.inspect().state, this)); }
            catch (IOException error) { return false; }
        }
        void require() throws IOException { if (!current()) throw failure(); }
        void claim() throws IOException {
            require();
            if (!consumed.compareAndSet(false, true)) throw failure();
        }
    }
    private final String profile, client, owner = CloudJson.random();
    private final CloudProviderHttp.Provider provider;
    private final long epoch;
    private final Path root;
    private final Protection protection;
    private final Driver driver;
    private final LongSupplier clock;
    private CloudJournal journal;
    private volatile Request pending;

    CloudNativeAuth(Path base, String profile, CloudProviderHttp.Provider provider, String client, long epoch,
            Protection protection, Driver driver, LongSupplier clock) throws IOException {
        if (base == null || !CloudJson.hex(profile) || provider == null || client == null
                || !client.matches("[A-Za-z0-9._:-]{1,256}") || epoch < 1 || epoch >= CloudJson.MAX_INTEGER
                || protection == null || driver == null || clock == null) throw failure();
        this.profile = profile; this.provider = provider; this.client = client; this.epoch = epoch;
        this.protection = protection; this.driver = driver; this.clock = clock;
        root = base.resolve("cloud-auth-owners-v1").resolve(profile).resolve(CloudOwnership.provider(provider)).resolve(CloudOwnership.hash(client));
        CloudJournal.directory(root);
        locked(() -> {
            journal = new CloudJournal(root.resolve("authority"), "recap-cloud-auth-authority",
                    CloudJson.map("epoch", 0, "owner", null, "phase", "empty", "operation", null, "digest", null),
                    CloudNativeAuth::validateState, (before, after) -> {
                        if (before != null && CloudJson.integer(after.get("epoch")) < CloudJson.integer(before.get("epoch"))) throw failure();
                    });
            Map<String, Object> state = journal.inspect().state;
            if (epoch < CloudJson.integer(state.get("epoch"))) throw failure();
            state.put("epoch", epoch); state.put("owner", owner); state.put("operation", null);
            if ("busy".equals(state.get("phase"))) state.put("phase", "suspended");
            write(state);
            return null;
        });
    }
    static IOException failure() {
        return new IOException("Native cloud authentication is unavailable, changed or requires reconnecting. Local reading data is unchanged.");
    }
    static boolean usableAccessToken(Long expiration, long now, boolean sdkNeedsRefresh) {
        return !sdkNeedsRefresh && expiration != null && now >= 0
                && expiration > now && expiration - now > 60000;
    }
    private static void validateState(Map<String, Object> state) throws IOException {
        if (!CloudJson.exact(state, "epoch", "owner", "phase", "operation", "digest")
                || CloudJson.integer(state.get("epoch")) < 0
                || state.get("owner") != null && !CloudJson.hex(state.get("owner"))
                || !Arrays.asList("empty", "active", "busy", "suspended").contains(state.get("phase"))
                || state.get("digest") != null && !CloudJson.hex(state.get("digest"))
                || ("busy".equals(state.get("phase")) ? !CloudJson.hex(state.get("operation")) : state.get("operation") != null)
                || "active".equals(state.get("phase")) && state.get("digest") == null
                || "empty".equals(state.get("phase")) && state.get("digest") != null) throw failure();
    }
    private <T> T locked(CloudJournal.Work<T> work) throws IOException {
        synchronized (LOCAL_LEASE) {
            Path lock = root.resolve("owner.lock");
            if (Files.isSymbolicLink(lock)) throw failure();
            try (FileChannel channel = FileChannel.open(lock, StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
                FileLock lease;
                try { lease = channel.tryLock(); }
                catch (OverlappingFileLockException error) { throw failure(); }
                if (lease == null) throw failure();
                try { return work.run(); } finally { lease.release(); }
            } catch (IOException error) { throw error; }
            catch (Exception error) { throw failure(); }
        }
    }
    private void write(Map<String, Object> state) throws IOException {
        CloudJournal.Head head = journal.inspect();
        if (head.maintenance || head.sequence - head.base >= CloudJournal.LIMIT - 4) {
            journal.compact((value) -> validateState(value));
            head = journal.inspect();
        }
        journal.update(head.sequence, (before) -> state);
    }
    private void owner(Map<String, Object> state) throws IOException {
        if (!owner.equals(state.get("owner")) || epoch != CloudJson.integer(state.get("epoch"))) throw failure();
    }
    private boolean owns(Map<String, Object> state, Request request) throws IOException {
        return owner.equals(state.get("owner")) && epoch == CloudJson.integer(state.get("epoch"))
                && "busy".equals(state.get("phase")) && request.nonce.equals(state.get("operation"));
    }
    private Cached cached(Map<String, Object> state) throws Exception {
        CloudSessions.Protected store = protection.open();
        String text = store.load();
        if ("empty".equals(state.get("phase"))) {
            if (text != null || store.present()) throw failure();
            return null;
        }
        if (!"active".equals(state.get("phase")) || text == null || !store.present()
                || !CloudOwnership.hash(text).equals(state.get("digest"))) throw failure();
        Map<String, Object> record = CloudJson.object(CloudJson.parse(text.getBytes(StandardCharsets.UTF_8), 524288));
        if (!CloudJson.exact(record, "format", "version", "profile", "provider", "client", "epoch", "operation", "id", "label", "material")
                || !"recap-cloud-native-association".equals(record.get("format")) || CloudJson.integer(record.get("version")) != 1
                || !profile.equals(record.get("profile")) || !client.equals(record.get("client"))
                || !CloudOwnership.provider(provider).equals(record.get("provider"))
                || !CloudJson.hex(record.get("operation")) || CloudJson.integer(record.get("epoch")) < 1
                || CloudJson.integer(record.get("epoch")) > epoch || !text.equals(CloudJson.canonical(record))) throw failure();
        Cached cached = new Cached(CloudJson.string(record.get("id")), CloudJson.string(record.get("label")), CloudJson.string(record.get("material")));
        driver.validate(cached);
        return cached;
    }
    @Override public CloudService.Account status() throws Exception {
        return locked(() -> {
            Map<String, Object> state = journal.inspect().state;
            owner(state);
            Cached cached = cached(state);
            return cached == null ? null : new CloudService.Account(cached.id, cached.label);
        });
    }
    private Proof execute(BooleanSupplier current, boolean interactive) throws Exception {
        Request request = new Request(current, interactive);
        final String[] committed = { null };
        Cached prior = locked(() -> {
            if (!request.caller.getAsBoolean()) throw failure();
            Map<String, Object> state = journal.inspect().state;
            owner(state);
            Cached value = cached(state);
            if (!interactive && value == null) throw failure();
            state.put("phase", "busy"); state.put("operation", request.nonce);
            write(state);
            pending = request;
            return value;
        });
        try {
            request.require();
            Proof proof = interactive ? driver.connect(request) : driver.refresh(request, prior);
            request.require();
            if (proof == null || !interactive && !prior.id.equals(proof.id)) throw failure();
            driver.validate(proof);
            locked(() -> {
                Map<String, Object> state = journal.inspect().state;
                if (request.closed || !request.consumed.get() || clock.getAsLong() >= request.expires
                        || !request.caller.getAsBoolean() || !owns(state, request)) throw failure();
                String text = CloudJson.canonical(CloudJson.map("format", "recap-cloud-native-association", "version", 1,
                        "profile", profile, "provider", CloudOwnership.provider(provider), "client", client,
                        "epoch", epoch, "operation", request.nonce, "id", proof.id, "label", proof.label, "material", proof.material));
                if (text.getBytes(StandardCharsets.UTF_8).length > 524288) throw failure();
                CloudSessions.Protected store = protection.open();
                String before = store.load();
                if (state.get("digest") == null ? before != null || store.present()
                        : before == null || !CloudOwnership.hash(before).equals(state.get("digest"))) throw failure();
                store.save(text);
                if (!text.equals(store.load()) || !store.present()) throw failure();
                if (request.closed || clock.getAsLong() >= request.expires || !request.caller.getAsBoolean() || !owns(journal.inspect().state, request)) throw failure();
                state.put("phase", "active"); state.put("operation", null); state.put("digest", CloudOwnership.hash(text));
                write(state);
                committed[0] = CloudOwnership.hash(text);
                return null;
            });
            locked(() -> {
                owner(journal.inspect().state);
                if (!request.caller.getAsBoolean() || clock.getAsLong() >= request.expires) throw failure();
                return null;
            });
            return proof;
        } catch (Exception error) {
            try {
                locked(() -> {
                    Map<String, Object> state = journal.inspect().state;
                    if (owns(state, request) || owner.equals(state.get("owner")) && epoch == CloudJson.integer(state.get("epoch"))
                            && committed[0] != null && committed[0].equals(state.get("digest"))) {
                        state.put("phase", "suspended"); state.put("operation", null); write(state);
                    }
                    return null;
                });
            } catch (IOException cleanup) { error.addSuppressed(cleanup); }
            throw error;
        } finally {
            request.closed = true;
            driver.cancel(request);
            if (pending == request) pending = null;
        }
    }
    @Override public CloudService.Account connect(BooleanSupplier current) throws Exception {
        Proof proof = execute(current, true);
        return new CloudService.Account(proof.id, proof.label);
    }
    private boolean tokenReadCurrent(BooleanSupplier current, long started) {
        if (current == null || !current.getAsBoolean() || !driver.current()) return false;
        long now = clock.getAsLong();
        return started >= 0 && now >= started && now - started < 30000;
    }
    @Override public String token(BooleanSupplier current) throws Exception {
        long started = clock.getAsLong();
        String reused = locked(() -> {
            if (!tokenReadCurrent(current, started)) throw failure();
            CloudJournal.Head head = journal.inspect();
            owner(head.state);
            Cached prior = cached(head.state);
            if (prior == null) throw failure();
            Proof proof = driver.reuse(prior);
            if (proof == null) return null;
            if (!prior.id.equals(proof.id) || !prior.label.equals(proof.label) || !prior.material.equals(proof.material)) throw failure();
            driver.validate(proof);
            CloudJournal.Head after = journal.inspect();
            owner(after.state);
            if (after.sequence != head.sequence || !java.util.Objects.equals(head.state.get("digest"), after.state.get("digest"))) throw failure();
            Cached latest = cached(after.state);
            if (latest == null || !prior.id.equals(latest.id) || !prior.label.equals(latest.label)
                    || !prior.material.equals(latest.material) || !tokenReadCurrent(current, started)) throw failure();
            return proof.token;
        });
        return reused == null ? execute(current, false).token : reused;
    }
    @Override public void disconnect() throws Exception {
        locked(() -> {
            Map<String, Object> state = journal.inspect().state;
            if (!owner.equals(state.get("owner")) || CloudJson.integer(state.get("epoch")) < epoch
                    || CloudJson.integer(state.get("epoch")) > epoch + 1) throw failure();
            state.put("phase", "suspended"); state.put("operation", null); state.put("epoch", epoch + 1);
            write(state);
            Request request = pending;
            if (request != null) { request.closed = true; driver.cancel(request); }
            CloudSessions.Protected store = protection.open();
            store.clear();
            if (store.present() || store.load() != null) throw failure();
            state.put("phase", "empty"); state.put("digest", null);
            write(state);
            return null;
        });
    }
}
