package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;

final class CloudService {
    static final class Account {
        final String id;
        final String label;
        Account(String id, String label) throws IOException {
            if (id == null || id.isEmpty() || id.length() > 1024 || label == null || label.isEmpty() || label.length() > 8192) throw CloudJson.failure();
            this.id = id; this.label = label;
        }
        Map<String, Object> data() { return CloudJson.map("id", id, "label", label); }
    }
    interface Auth {
        Account status() throws Exception;
        Account connect(BooleanSupplier current) throws Exception;
        String token(BooleanSupplier current) throws Exception;
        void disconnect() throws Exception;
    }
    interface AuthFactory {
        String clientId(CloudProviderHttp.Provider provider) throws Exception;
        Auth open(String profileId, CloudProviderHttp.Provider provider, long epoch) throws Exception;
    }
    interface Observer {
        void settled(Map<String, Object> state) throws IOException;
        default void failed(String operation, Exception error) throws IOException {}
    }
    private final Path base;
    private final String profile;
    private final CloudConnection connection;
    private final AuthFactory authFactory;
    private final CloudSessions.Factory protectedStore;
    private final CloudProviderHttp.Connections network;
    private final CloudEnvelope.Codec codec;
    private final String discoveryStreamId;
    private final AtomicLong invalidation = new AtomicLong();
    private final ThreadLocal<Invocation> invocation = new ThreadLocal<>();
    private Observer observer;
    private Runtime active;
    private final class Invocation {
        final BooleanSupplier page;
        final long version;
        long epoch;
        Invocation(BooleanSupplier page, long epoch) { this.page = page; this.epoch = epoch; version = invalidation.get(); }
        // SDK callbacks and the worker must not contend on their own nonblocking journal lease.
        synchronized boolean current() {
            try { return page.getAsBoolean() && version == invalidation.get() && CloudJson.integer(connection.inspect().get("epoch")) == epoch; }
            catch (Exception error) { return false; }
        }
        synchronized Map<String, Object> snapshot() throws IOException { return connection.inspect(); }
        void require() throws IOException { if (!current()) throw CloudJson.failure(); }
    }
    private static final class Runtime {
        CloudProviderHttp.Provider provider;
        CloudOwnership.Binding binding;
        Auth auth;
        Account account;
        CloudProviderHttp http;
        CloudProviderReads reads;
        CloudRemote remote;
        CloudSessions sessions;
        CloudAllocation allocation;
        CloudOwnership.Destination destination;
        CloudLedger ledger;
        CloudPublication publication;
    }
    CloudService(Path base, AuthFactory authFactory, CloudSessions.Factory protectedStore,
            CloudEnvelope.Codec codec, CloudProviderHttp.Connections network) throws IOException {
        this(base, authFactory, protectedStore, codec, network, null);
    }
    CloudService(Path base, AuthFactory authFactory, CloudSessions.Factory protectedStore,
            CloudEnvelope.Codec codec, CloudProviderHttp.Connections network, String discoveryStreamId) throws IOException {
        if (base == null || authFactory == null || protectedStore == null || codec == null || network == null
                || discoveryStreamId != null && !CloudJson.hex(discoveryStreamId)) throw new IllegalArgumentException("Native cloud configuration is required.");
        this.base = base; this.authFactory = authFactory; this.protectedStore = protectedStore; this.codec = codec; this.network = network;
        this.discoveryStreamId = discoveryStreamId;
        profile = CloudOwnership.installation(base);
        connection = new CloudConnection(base, profile);
    }
    void observe(Observer value) {
        if (value == null || observer != null) throw new IllegalArgumentException("Native observation requires one owner.");
        observer = value;
    }
    long epoch() throws IOException { return CloudJson.integer(connection.inspect().get("epoch")); }
    long revision() { return invalidation.get(); }
    void invalidate() { invalidation.incrementAndGet(); }
    private void current() throws IOException {
        Invocation scope = invocation.get();
        if (scope == null) throw CloudJson.failure();
        scope.require();
    }
    private boolean isCurrent() { try { current(); return true; } catch (IOException error) { return false; } }
    private Runtime runtime(CloudProviderHttp.Provider provider) throws Exception {
        current();
        Map<String, Object> state = connection.inspect();
        if (!CloudOwnership.provider(provider).equals(state.get("provider"))) throw CloudJson.failure();
        if (active == null) {
            Runtime value = new Runtime();
            value.provider = provider;
            value.auth = authFactory.open(profile, provider, epoch());
            if (value.auth == null) throw CloudJson.failure();
            current();
            active = value;
        }
        if (active.provider != provider) throw CloudJson.failure();
        return active;
    }
    private Runtime authenticated(CloudProviderHttp.Provider provider) throws Exception {
        Runtime value = runtime(provider);
        Account identity = value.auth.status();
        current();
        if (identity == null || value.account != null && !value.account.id.equals(identity.id)) throw CloudJson.failure();
        value.account = identity;
        if (value.binding == null) value.binding = new CloudOwnership.Binding(profile, provider, value.account.id, authFactory.clientId(provider));
        Map<String, Object> state = connection.inspect();
        if (!value.binding.account.equals(state.get("account")) || !value.binding.client.equals(state.get("client"))) throw CloudJson.failure();
        if (value.http == null) {
            value.http = new CloudProviderHttp(provider, () -> {
                current();
                Account tokenIdentity = value.auth.status();
                if (tokenIdentity == null || !tokenIdentity.id.equals(value.binding.accountId)) throw CloudJson.failure();
                String token = value.auth.token(invocation.get()::current);
                current();
                return token;
            }, this::isCurrent, network);
            value.sessions = new CloudSessions(base, value.binding, value.http, protectedStore, (id) -> {
                Map<String, Object> proof = value.ledger == null ? null : value.ledger.terminal(id);
                return proof != null ? proof : value.allocation == null ? null : value.allocation.terminal(id);
            });
            reads(value, null);
        }
        return value;
    }
    private void reads(Runtime value, CloudProviderReads.Root root) {
        value.reads = root == null || value.provider == CloudProviderHttp.Provider.GOOGLE ? new CloudProviderReads(value.http)
                : new CloudProviderReads(value.http, root.id, root.driveId);
        value.remote = new CloudRemote(value.http, value.reads, codec);
    }
    private void bind(Runtime value, CloudOwnership.Destination destination, boolean initialize) throws IOException {
        reads(value, new CloudProviderReads.Root(destination.rootId, destination.driveId));
        if (value.provider == CloudProviderHttp.Provider.MICROSOFT) {
            if (!CloudPublicationRecord.PROTOCOL.equals(destination.protocol)) throw CloudJson.failure();
            CloudPublicationLedger ledger = new CloudPublicationLedger(base, destination, initialize);
            value.ledger = ledger;
            value.publication = new CloudPublication(destination, ledger, value.http, value.reads, value.sessions, codec);
        } else value.ledger = new CloudLedger(base, destination, initialize);
        value.destination = destination;
    }
    private Runtime selected(CloudProviderHttp.Provider provider) throws Exception {
        Runtime value = authenticated(provider);
        Map<String, Object> state = connection.inspect();
        if (!"active".equals(state.get("phase"))) throw CloudJson.failure();
        if (value.destination == null) {
            CloudOwnership.Destination destination = CloudOwnership.Destination.load(base, value.binding);
            if (!destination.streamId.equals(state.get("streamId"))) throw CloudJson.failure();
            bind(value, destination, false);
        }
        return value;
    }
    private Map<String, Object> acknowledged(Runtime value, Map<String, Object> state) throws Exception {
        Map<String, Object> ack = value.remote.acknowledge(value.destination, state, epoch());
        current();
        connection.change(epoch(), "active", (prior) -> { prior.put("acknowledgement", ack); return prior; });
        Map<String, Object> result = CloudJson.object(CloudJson.copy(ack));
        result.put("provider", CloudOwnership.provider(value.provider)); result.put("phase", "acknowledged");
        return result;
    }
    private Map<String, Object> maintenance(Runtime selected, long expectedEpoch) throws Exception {
        if (selected.publication != null) selected.publication.cleanup();
        selected.ledger.compact(selected.sessions);
        Map<String, Object> pruned = selected.sessions.sweep(selected.destination.streamId);
        current();
        connection.compact((prior) -> {
            if (!"active".equals(prior.get("phase")) || CloudJson.integer(prior.get("epoch")) != expectedEpoch) throw CloudJson.failure();
        });
        CloudJournal.Head head = selected.ledger.inspect();
        return CloudJson.map("provider", CloudOwnership.provider(selected.provider), "epoch", epoch(), "sequence", head.sequence,
                "capacity", CloudJson.map("maximumRecords", 8192, "remainingTransitions", 8192 - (head.sequence - head.base),
                        "canPrepare", selected.ledger.canPrepare()),
                "sessionsPruned", pruned);
    }
    Map<String, Object> invoke(String operation, CloudProviderHttp.Provider provider, Map<String, Object> input,
            long expectedEpoch, BooleanSupplier page) throws Exception {
        Invocation scope = new Invocation(page, expectedEpoch);
        invocation.set(scope);
        Exception primary = null;
        try {
            current();
            Map<String, Object> state = connection.inspect();
            if (state.get("provider") != null && !CloudOwnership.provider(provider).equals(state.get("provider"))) throw CloudJson.failure();
            if ("status".equals(operation)) {
                String phase = CloudJson.string(state.get("phase"));
                Account account = null;
                boolean reconnect = false;
                if (!Arrays.asList("disconnected", "connecting", "disconnecting").contains(phase)) {
                    try { account = authenticated(provider).account; }
                    catch (Exception error) { current(); reconnect = true; }
                }
                current();
                String status = phase.equals("active") ? "connected" : phase.equals("disconnected") ? "disconnected"
                        : Arrays.asList("connecting", "disconnecting").contains(phase) ? "reconnect-required" : "pending-choice";
                if (reconnect) status = "reconnect-required";
                return CloudJson.map("provider", CloudOwnership.provider(provider), "epoch", epoch(), "phase", phase,
                        "state", status, "account", account == null ? null : account.data(), "acknowledgement", state.get("acknowledgement"));
            }
            if ("connect".equals(operation)) {
                String clientId = authFactory.clientId(provider);
                if (clientId == null || !clientId.matches("[A-Za-z0-9._:-]{1,256}")) throw CloudJson.failure();
                state = connection.begin(provider);
                scope.epoch = CloudJson.integer(state.get("epoch"));
                Runtime value = runtime(provider);
                value.account = value.auth.connect(scope::current);
                current();
                if (value.account == null) throw CloudJson.failure();
                value.binding = new CloudOwnership.Binding(profile, provider, value.account.id, clientId);
                connection.change(epoch(), "connecting", (prior) -> {
                    prior.put("phase", "discovering"); prior.put("account", value.binding.account); prior.put("client", value.binding.client); return prior;
                });
                return CloudJson.map("provider", CloudOwnership.provider(provider), "state", "discovering", "epoch", epoch(), "account", value.account.data());
            }
            if ("disconnect".equals(operation)) {
                state = connection.suspend();
                scope.epoch = CloudJson.integer(state.get("epoch"));
                if (!"disconnected".equals(state.get("phase"))) {
                    Auth auth = active == null ? authFactory.open(profile, provider, epoch()) : active.auth;
                    if (auth == null) throw CloudJson.failure();
                    auth.disconnect();
                    connection.disconnected(epoch());
                }
                active = null;
                return CloudJson.map("provider", CloudOwnership.provider(provider), "state", "disconnected", "epoch", epoch(), "account", null);
            }
            Runtime value = authenticated(provider);
            if ("discover".equals(operation)) {
                if (!Arrays.asList("discovering", "awaiting-choice", "active").contains(state.get("phase"))) throw CloudJson.failure();
                if (discoveryStreamId != null && (!"active".equals(state.get("phase"))
                        || !discoveryStreamId.equals(state.get("streamId")))) throw CloudJson.failure();
                boolean owned = Files.exists(value.binding.path(base, "cloud-destinations"))
                        || provider == CloudProviderHttp.Provider.MICROSOFT
                            && Files.exists(value.binding.path(base, CloudOwnership.Destination.namespace(CloudPublicationRecord.PROTOCOL)));
                boolean resumable = owned;
                if (owned && value.destination == null) {
                    CloudOwnership.Destination destination = CloudOwnership.Destination.load(base, value.binding);
                    resumable = provider != CloudProviderHttp.Provider.MICROSOFT || CloudPublicationRecord.PROTOCOL.equals(destination.protocol);
                    if (resumable) bind(value, destination, false);
                    else reads(value, new CloudProviderReads.Root(destination.rootId, destination.driveId));
                }
                boolean publicationAllocation = provider == CloudProviderHttp.Provider.MICROSOFT
                        && Files.exists(value.binding.path(base, CloudAllocation.namespace(CloudPublicationRecord.PROTOCOL)));
                if (!owned && !publicationAllocation && Files.exists(value.binding.path(base, "cloud-allocations"))) {
                    reads(value, CloudAllocation.recordedRoot(base, value.binding));
                }
                if (publicationAllocation) reads(value, CloudAllocation.recordedRoot(base, value.binding, CloudPublicationRecord.PROTOCOL));
                if (value.destination == null) reads(value, value.reads.discoverRoot());
                Map<String, Object> found = value.remote.discover(discoveryStreamId);
                current();
                if ("discovering".equals(state.get("phase")) && resumable) {
                    connection.change(epoch(), "discovering", (prior) -> { prior.put("phase", "active"); prior.put("streamId", value.destination.streamId); return prior; });
                } else if (!"active".equals(state.get("phase"))) connection.change(epoch(), "discovering,awaiting-choice", (prior) -> {
                    prior.put("phase", "awaiting-choice"); prior.put("discoveryId", CloudJson.random()); prior.put("discoveryDigest", CloudJson.hash(CloudJson.bytes(found))); return prior;
                });
                Map<String, Object> now = connection.inspect();
                found.putAll(CloudJson.map("provider", CloudOwnership.provider(provider), "state", now.get("phase"), "epoch", epoch()));
                if ("awaiting-choice".equals(now.get("phase"))) found.put("discoveryId", now.get("discoveryId"));
                return found;
            }
            if ("choose".equals(operation)) {
                if (!java.util.Objects.equals(state.get("discoveryId"), input.get("discoveryId"))) throw CloudJson.failure();
                if (!Arrays.asList("awaiting-choice", "allocating").contains(state.get("phase"))) throw CloudJson.failure();
                String protocol = provider == CloudProviderHttp.Provider.MICROSOFT ? CloudPublicationRecord.PROTOCOL : null;
                boolean pendingAllocation = Files.exists(value.binding.path(base, CloudAllocation.namespace(protocol)));
                if (protocol != null && "allocating".equals(state.get("phase")) && !pendingAllocation) throw CloudJson.failure();
                CloudProviderReads.Root root = pendingAllocation
                        ? CloudAllocation.recordedRoot(base, value.binding, protocol) : value.reads.discoverRoot();
                reads(value, root);
                value.allocation = new CloudAllocation(base, value.binding, root, value.http, value.reads, value.sessions, protocol);
                if ("awaiting-choice".equals(state.get("phase"))) connection.change(epoch(), "awaiting-choice", (prior) -> { prior.put("phase", "allocating"); return prior; });
                CloudOwnership.Destination destination = value.allocation.allocate(epoch());
                current();
                bind(value, destination, !Files.exists(value.binding.path(base,
                        protocol == null ? "cloud-streams" : "cloud-publication-streams").resolve(destination.streamId)));
                connection.change(epoch(), "allocating", (prior) -> { prior.put("phase", "active"); prior.put("streamId", destination.streamId); return prior; });
                return CloudJson.map("provider", CloudOwnership.provider(provider), "state", "active", "epoch", epoch(), "streamId", destination.streamId);
            }
            if ("read".equals(operation)) {
                if (!Arrays.asList("awaiting-choice", "active").contains(state.get("phase"))) throw CloudJson.failure();
                return value.remote.selected(CloudJson.string(input.get("streamId")), CloudJson.object(input.get("selection"))).snapshot;
            }
            final Runtime selected = selected(provider);
            if ("write".equals(operation)) {
                CloudJournal.Head head = selected.ledger.inspect();
                if (CloudJournal.LIMIT - (head.sequence - head.base) < 5) maintenance(selected, scope.epoch);
                Map<String, Object> written = selected.publication == null
                        ? selected.remote.write(selected.destination, selected.ledger, selected.sessions,
                            CloudJson.object(input.get("components")), CloudJson.string(input.get("label")), epoch())
                        : selected.publication.write(CloudJson.object(input.get("components")), CloudJson.string(input.get("label")), epoch());
                return acknowledged(selected, written);
            }
            if ("reconcile".equals(operation)) {
                Map<String, Object> latest = selected.publication == null ? selected.ledger.inspect().state : selected.publication.reconcile();
                if (latest.get("attempt") != null) {
                    Map<String, Object> attempt = CloudJson.object(latest.get("attempt"));
                    String id = CloudJson.string(attempt.get("id"));
                    if (selected.publication == null && "prepared".equals(attempt.get("phase"))) latest = selected.ledger.phase(id, "failed");
                    else if (selected.publication == null && Arrays.asList("in-flight", "unknown").contains(attempt.get("phase"))) latest = selected.ledger.settle(id, (pending) -> selected.remote.verify(selected.destination, selected.sessions, pending));
                    if ("acknowledged".equals(CloudJson.object(latest.get("attempt")).get("phase"))) return acknowledged(selected, latest);
                }
                return CloudJson.map("provider", CloudOwnership.provider(provider), "epoch", epoch(),
                        "phase", latest.get("attempt") == null ? "empty" : "failed", "acknowledgement", null);
            }
            if ("maintain".equals(operation)) {
                return maintenance(selected, scope.epoch);
            }
            throw CloudJson.failure();
        } catch (Exception error) {
            primary = error;
            try {
                if (observer != null) observer.failed(operation, error);
            } catch (Exception observation) { if (observation != error) error.addSuppressed(observation); }
            throw error;
        } finally {
            try {
                if (observer != null) observer.settled(scope.snapshot());
            } catch (Exception observation) {
                if (primary == null) throw observation;
                if (observation != primary) primary.addSuppressed(observation);
            } finally { invocation.remove(); }
        }
    }
}
