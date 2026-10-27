package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

final class CloudPort implements CloudEnvelope.Codec {
    interface Factory { CloudService create(CloudEnvelope.Codec codec) throws IOException; }
    interface Sender { void send(String message) throws IOException; }
    private static final int CHUNK = 32768;
    private static final int CODEC_LIMIT = 2 * CloudJson.MAX_BYTES + 8192;
    private final Sender sender;
    private final BooleanSupplier trusted;
    private final int generation;
    private final String capability = CloudJson.random();
    private final CloudService service;
    private final Set<String> seen = new HashSet<>();
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(8), (work) -> { Thread thread = new Thread(work, "recap-cloud-native"); thread.setDaemon(true); return thread; });
    private volatile boolean active = true;
    private volatile CodecJob codecJob;
    private volatile String pendingConnect;
    private volatile long pendingConnectEpoch = -1;
    private volatile CloudProviderHttp.Provider pendingConnectProvider;
    private static final class CodecJob {
        final String id = "codec-" + CloudJson.random();
        final String nonce = CloudJson.random();
        final long epoch;
        final CompletableFuture<Map<String, Object>> result = new CompletableFuture<>();
        final StringBuilder parts = new StringBuilder();
        int next;
        int total = -1;
        int bytes;
        CodecJob(long epoch) { this.epoch = epoch; }
    }
    CloudPort(Factory factory, Sender sender, BooleanSupplier trusted, int generation) throws IOException {
        if (sender == null || trusted == null || generation < 0) throw CloudJson.failure();
        this.sender = sender; this.trusted = trusted; this.generation = generation;
        CloudService configured = null;
        if (factory != null) {
            try { configured = factory.create(this); }
            catch (IOException | RuntimeException error) { /* Cloud configuration failure cannot disable local exports or reading. */ }
        }
        service = configured;
    }
    private boolean current() {
        try { return active && trusted.getAsBoolean(); } catch (RuntimeException error) { return false; }
    }
    void ready() throws IOException {
        send(CloudJson.map("v", 1, "kind", "cloud-ready", "generation", generation, "capability", capability,
                "configured", service != null, "epoch", service == null ? 0 : service.epoch()));
    }
    private void send(Map<String, Object> value) throws IOException {
        if (!current()) throw CloudJson.failure();
        sender.send(CloudJson.canonical(value));
    }
    private void failure(String id, String code) {
        failure(id, code, null);
    }
    private void failure(String id, String code, Exception cause) {
        try {
            Map<String, Object> reply = CloudJson.map("v", 1, "kind", "cloud-result", "id", id, "generation", generation,
                    "capability", capability, "status", "error", "code", code,
                    "message", "Native cloud work was not confirmed. Local data is unchanged; reconnect or retry when ready.");
            if (cause instanceof CloudProviderHttp.Failure) {
                CloudProviderHttp.Failure provider = (CloudProviderHttp.Failure) cause;
                reply.put("outcome", provider.outcome == CloudProviderHttp.Outcome.UNKNOWN ? "unknown"
                        : provider.outcome == CloudProviderHttp.Outcome.READ_ONLY ? "read-only" : "not-sent");
                if (provider.status >= 100 && provider.status <= 599) reply.put("providerStatus", provider.status);
                if (provider.retryAfterMs != null && provider.retryAfterMs >= 0 && provider.retryAfterMs <= CloudJson.MAX_INTEGER) reply.put("retryAfterMs", provider.retryAfterMs);
            }
            try { if (service != null) reply.put("epoch", service.epoch()); } catch (IOException error) { /* No epoch is safer than an invented one. */ }
            send(reply);
        } catch (IOException error) { invalidate(); }
    }
    void receive(String raw) {
        String id = null;
        try {
            if (!current()) return;
            Map<String, Object> request = CloudJson.object(CloudJson.parse(raw.getBytes(StandardCharsets.UTF_8), CloudJson.MAX_BYTES));
            id = CloudJson.string(request.get("id"));
            if (!id.matches("[A-Za-z0-9_.:-]{1,96}") || CloudJson.integer(request.get("v")) != 1
                    || CloudJson.integer(request.get("generation")) != generation || !capability.equals(request.get("capability"))) throw CloudJson.failure();
            if ("cloud-codec-result".equals(request.get("kind"))) { codecResult(request); return; }
            if ("cloud-cancel".equals(request.get("kind"))) {
                if (!CloudJson.exact(request, "v", "kind", "id", "generation", "capability", "epoch", "provider")) throw CloudJson.failure();
                if (service != null && pendingConnectProvider != null && id.equals(pendingConnect) && pendingConnectEpoch == CloudJson.integer(request.get("epoch"))
                        && CloudOwnership.provider(pendingConnectProvider).equals(request.get("provider"))) service.invalidate();
                return;
            }
            if (!"cloud".equals(request.get("kind")) || !CloudJson.exact(request, "v", "kind", "id", "generation", "capability", "epoch", "operation", "provider", "input")
                    || !seen.add(id) || seen.size() > 4096) throw CloudJson.failure();
            if (service == null) { failure(id, "unsupported"); return; }
            String operation = CloudJson.string(request.get("operation"));
            if (!Arrays.asList("status", "connect", "discover", "choose", "read", "write", "reconcile", "maintain", "disconnect").contains(operation)) throw CloudJson.failure();
            String provider = CloudJson.string(request.get("provider"));
            CloudProviderHttp.Provider selected = "google".equals(provider) ? CloudProviderHttp.Provider.GOOGLE
                    : "microsoft".equals(provider) ? CloudProviderHttp.Provider.MICROSOFT : null;
            if (selected == null) throw CloudJson.failure();
            Map<String, Object> input = CloudJson.object(request.get("input"));
            String[] fields = operation.equals("write") ? new String[] { "components", "label" }
                    : operation.equals("read") ? new String[] { "streamId", "selection" }
                    : operation.equals("choose") ? new String[] { "discoveryId" } : new String[0];
            if (!CloudJson.exact(input, fields)) throw CloudJson.failure();
            long epoch = CloudJson.integer(request.get("epoch"));
            long currentEpoch = service.epoch();
            boolean cancellingConnect = operation.equals("disconnect") && pendingConnect != null
                    && pendingConnectEpoch == epoch && pendingConnectProvider == selected;
            if (epoch != currentEpoch && !cancellingConnect) throw CloudJson.failure();
            if (operation.equals("write") && (!CloudJson.exact(CloudJson.object(input.get("components")), "reader", "history", "settings", "draft")
                    || CloudJson.string(input.get("label")).trim().isEmpty() || CloudJson.string(input.get("label")).length() > 200)
                    || operation.equals("choose") && !CloudJson.hex(input.get("discoveryId"))) throw CloudJson.failure();
            if (operation.equals("disconnect")) service.invalidate();
            final String requestId = id;
            final long admitted = service.revision();
            final long requestEpoch = operation.equals("disconnect") ? currentEpoch : epoch;
            if (operation.equals("connect")) {
                if (pendingConnect != null) { failure(id, "busy"); return; }
                pendingConnect = id; pendingConnectEpoch = epoch; pendingConnectProvider = selected;
            }
            try {
                worker.execute(() -> {
                    try {
                        Map<String, Object> result = service.invoke(operation, selected, input, requestEpoch,
                                () -> current() && service.revision() == admitted);
                        if (!Arrays.asList("connect", "disconnect").contains(operation) && service.epoch() != requestEpoch) throw CloudJson.failure();
                        send(CloudJson.map("v", 1, "kind", "cloud-result", "id", requestId, "generation", generation,
                                "capability", capability, "status", "ok", "epoch", service.epoch(), "result", result));
                    } catch (Exception error) { failure(requestId, "failed", error); }
                    finally {
                        if (requestId.equals(pendingConnect)) { pendingConnect = null; pendingConnectEpoch = -1; pendingConnectProvider = null; }
                    }
                });
            } catch (java.util.concurrent.RejectedExecutionException error) {
                if (requestId.equals(pendingConnect)) pendingConnect = null;
                failure(id, "busy");
            }
        } catch (Exception error) { if (id != null && id.matches("[A-Za-z0-9_.:-]{1,96}")) failure(id, "invalid"); }
    }
    private void codecResult(Map<String, Object> value) throws IOException {
        CodecJob job = codecJob;
        if (job == null || !job.id.equals(value.get("id")) || !job.nonce.equals(value.get("nonce"))
                || CloudJson.integer(value.get("epoch")) != job.epoch || !current() || service == null || service.epoch() != job.epoch) return;
        if (!CloudJson.exact(value, "v", "kind", "id", "nonce", "generation", "capability", "epoch", "part", "total", "text")) throw CloudJson.failure();
        long rawPart = CloudJson.integer(value.get("part"));
        long rawTotal = CloudJson.integer(value.get("total"));
        if (rawTotal < 1 || rawTotal > 4096 || rawPart >= rawTotal) throw CloudJson.failure();
        int part = (int) rawPart;
        int total = (int) rawTotal;
        String text = CloudJson.string(value.get("text"));
        int bytes = text.getBytes(StandardCharsets.UTF_8).length;
        if (total < 1 || total > 4096 || part != job.next || text.length() > CHUNK
                || job.total != -1 && job.total != total || job.parts.length() + text.length() > CODEC_LIMIT || job.bytes + bytes > CODEC_LIMIT) {
            job.result.completeExceptionally(CloudJson.failure()); return;
        }
        job.total = total; job.next++; job.bytes += bytes; job.parts.append(text);
        if (job.next == total) job.result.complete(CloudJson.object(CloudJson.parse(job.parts.toString().getBytes(StandardCharsets.UTF_8), CODEC_LIMIT)));
    }
    private CloudEnvelope exchange(Map<String, Object> payload) throws Exception {
        if (service == null || !current() || codecJob != null) throw CloudJson.failure();
        CodecJob job = new CodecJob(service.epoch());
        codecJob = job;
        try {
            String raw = CloudJson.canonical(payload);
            if (raw.getBytes(StandardCharsets.UTF_8).length > CODEC_LIMIT) throw CloudJson.failure();
            int total = Math.max(1, (raw.length() + CHUNK - 1) / CHUNK);
            for (int part = 0; part < total; part++) send(CloudJson.map("v", 1, "kind", "cloud-codec",
                    "id", job.id, "nonce", job.nonce, "generation", generation, "capability", capability, "epoch", job.epoch,
                    "part", part, "total", total, "text", raw.substring(part * CHUNK, Math.min(raw.length(), (part + 1) * CHUNK))));
            Map<String, Object> result = job.result.get(30, TimeUnit.SECONDS);
            if (!current() || service.epoch() != job.epoch) throw CloudJson.failure();
            if (!Boolean.TRUE.equals(result.get("ok"))) {
                if ("invalid".equals(result.get("code"))) throw new CloudEnvelope.Rejected();
                throw CloudJson.failure();
            }
            try { return CloudEnvelope.verify(CloudJson.string(result.get("text")).getBytes(StandardCharsets.UTF_8)); }
            catch (IOException error) { throw new CloudEnvelope.Rejected(); }
        } finally { codecJob = null; }
    }
    @Override public CloudEnvelope encode(Map<String, Object> components, Map<String, Object> capture) throws Exception {
        return exchange(CloudJson.map("mode", "encode", "components", components, "capture", capture));
    }
    @Override public CloudEnvelope decode(byte[] bytes) throws Exception {
        if (bytes.length > CloudJson.MAX_BYTES) throw CloudJson.failure();
        try { CloudEnvelope.verify(bytes); } catch (IOException error) { throw new CloudEnvelope.Rejected(); }
        CloudEnvelope result = exchange(CloudJson.map("mode", "decode", "text", new String(bytes, StandardCharsets.UTF_8)));
        if (!Arrays.equals(bytes, result.bytes)) throw CloudJson.failure();
        return result;
    }
    void invalidate() {
        active = false;
        if (service != null) service.invalidate();
        CodecJob job = codecJob;
        if (job != null) job.result.completeExceptionally(CloudJson.failure());
        worker.shutdownNow();
    }
}
