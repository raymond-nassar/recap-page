package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

final class CloudSessions {
    interface Protected {
        String load() throws IOException;
        void save(String value) throws IOException;
        void clear() throws IOException;
        boolean present() throws IOException;
    }
    interface Factory { Protected open(CloudOwnership.Binding binding, String reference) throws IOException; }
    interface Terminal { Map<String, Object> read(String attemptId) throws IOException; }
    private final Path base;
    private final CloudOwnership.Binding binding;
    private final CloudProviderHttp http;
    private final Factory factory;
    private final Terminal terminal;
    CloudSessions(Path base, CloudOwnership.Binding binding, CloudProviderHttp http, Factory factory, Terminal terminal) {
        if (base == null || binding == null || http == null || factory == null || terminal == null) throw new IllegalArgumentException("Native protected session configuration is required.");
        this.base = base; this.binding = binding; this.http = http; this.factory = factory; this.terminal = terminal;
    }
    private Path parent(String streamId) throws IOException {
        if (!CloudJson.hex(streamId)) throw CloudJson.failure();
        return binding.path(base, "cloud-upload-sessions").resolve(streamId);
    }
    private Path root(String streamId, String reference) throws IOException {
        if (!CloudJson.hex(reference)) throw CloudJson.failure();
        return parent(streamId).resolve(reference);
    }
    private Map<String, Object> identity(String streamId, Map<String, Object> attempt, String slotId) throws IOException {
        if (!CloudJson.hex(streamId) || !CloudJson.hex(attempt.get("id")) || !CloudJson.id(slotId)
                || CloudJson.integer(attempt.get("epoch")) < 1) throw CloudJson.failure();
        Map<String, Object> result = binding.identity();
        result.putAll(CloudJson.map("streamId", streamId, "attemptId", attempt.get("id"), "epoch", attempt.get("epoch"), "slotId", slotId));
        return result;
    }
    private Map<String, Object> ready(Path root, Map<String, Object> identity, String reference) throws IOException {
        if (Files.exists(root.resolve("retired.json"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        Map<String, Object> record = CloudJson.object(CloudJson.parse(CloudJournal.read(root.resolve("ready.json"), 8192), 8192));
        if (!CloudJson.exact(record, "format", "version", "identity", "reference") || !"recap-cloud-session".equals(record.get("format"))
                || CloudJson.integer(record.get("version")) != 1 || !reference.equals(record.get("reference"))
                || !CloudJson.canonical(identity).equals(CloudJson.canonical(record.get("identity")))) throw CloudJson.failure();
        return record;
    }
    String save(String streamId, Map<String, Object> attempt, String slotId, String target) throws IOException {
        String validated = http.uploadSession(target);
        String reference = CloudJson.random();
        Path root = root(streamId, reference);
        CloudJournal.directory(root.getParent());
        Files.createDirectory(root);
        Map<String, Object> identity = identity(streamId, attempt, slotId);
        Map<String, Object> record = CloudJson.map("format", "recap-cloud-session", "version", 1, "identity", identity, "reference", reference);
        Map<String, Object> protectedRecord = new java.util.LinkedHashMap<>(record);
        protectedRecord.put("target", validated);
        String text = CloudJson.canonical(protectedRecord);
        if (text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 32768) throw CloudJson.failure();
        Protected store = factory.open(binding, reference);
        if (store.present()) throw CloudJson.failure();
        store.save(text);
        if (!text.equals(store.load())) throw CloudJson.failure();
        CloudJournal.exclusive(root.resolve("ready.json"), CloudJson.bytes(record));
        if (!validated.equals(load(streamId, attempt, slotId, reference))) throw CloudJson.failure();
        return reference;
    }
    String load(String streamId, Map<String, Object> attempt, String slotId, String reference) throws IOException {
        Path root = root(streamId, reference);
        Map<String, Object> identity = identity(streamId, attempt, slotId);
        ready(root, identity, reference);
        Protected store = factory.open(binding, reference);
        if (!store.present()) throw CloudJson.failure();
        String text = store.load();
        if (text == null || text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 32768) throw CloudJson.failure();
        Map<String, Object> record = CloudJson.object(CloudJson.parse(text.getBytes(java.nio.charset.StandardCharsets.UTF_8), 32768));
        if (!CloudJson.exact(record, "format", "version", "identity", "reference", "target")
                || !"recap-cloud-session".equals(record.get("format")) || CloudJson.integer(record.get("version")) != 1
                || !reference.equals(record.get("reference")) || !CloudJson.canonical(identity).equals(CloudJson.canonical(record.get("identity")))) throw CloudJson.failure();
        String target = http.uploadSession(CloudJson.string(record.get("target")));
        ready(root, identity, reference);
        return target;
    }
    void retire(CloudOwnership.Destination destination, Map<String, Object> attempt, String reference) throws IOException {
        int slot = (int) CloudJson.integer(attempt.get("slot"));
        if (slot > 1) throw CloudJson.failure();
        retire(destination.streamId, destination.slots[slot], attempt, reference);
    }
    void retire(String streamId, String slotId, Map<String, Object> attempt, String reference) throws IOException {
        Path root = root(streamId, reference);
        Map<String, Object> identity = identity(streamId, attempt, slotId);
        Path path = root.resolve("retired.json");
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            Map<String, Object> proof = terminal.read(CloudJson.string(attempt.get("id")));
            if (proof == null || !CloudJson.canonical(binding.identity()).equals(CloudJson.canonical(proof.get("binding")))
                    || !streamId.equals(proof.get("streamId")) || !slotId.equals(proof.get("slotId"))
                    || !CloudLedger.terminal(CloudJson.object(proof.get("attempt")))
                    || !CloudJson.canonical(proof.get("attempt")).equals(CloudJson.canonical(attempt))
                    || !reference.equals(attempt.get("session"))) throw CloudJson.failure();
            load(streamId, attempt, slotId, reference);
            CloudJournal.exclusive(path, CloudJson.bytes(CloudJson.map("format", "recap-cloud-session-retirement", "version", 1,
                    "identity", identity, "reference", reference, "terminal", attempt)));
        }
        Map<String, Object> marker = retired(path, reference);
        if (!CloudJson.canonical(marker.get("identity")).equals(CloudJson.canonical(identity))) throw CloudJson.failure();
        Protected store = factory.open(binding, reference);
        store.clear();
        if (store.present()) throw CloudJson.failure();
        byte[] cleared = CloudJson.bytes(CloudJson.map("format", "recap-cloud-session-cleared", "reference", reference,
                "retirementDigest", CloudJson.hash(CloudJournal.read(path, 8192))));
        if (!Files.exists(root.resolve("cleared.json"), LinkOption.NOFOLLOW_LINKS)) CloudJournal.exclusive(root.resolve("cleared.json"), cleared);
        if (!Arrays.equals(cleared, CloudJournal.read(root.resolve("cleared.json"), 1024))) throw CloudJson.failure();
    }
    private Map<String, Object> retired(Path path, String reference) throws IOException {
        Map<String, Object> value = CloudJson.object(CloudJson.parse(CloudJournal.read(path, 8192), 8192));
        if (!CloudJson.exact(value, "format", "version", "identity", "reference", "terminal")
                || !"recap-cloud-session-retirement".equals(value.get("format")) || CloudJson.integer(value.get("version")) != 1
                || !reference.equals(value.get("reference"))) throw CloudJson.failure();
        Map<String, Object> identity = CloudJson.object(value.get("identity"));
        if (!CloudJson.exact(identity, "profileId", "provider", "account", "client", "streamId", "attemptId", "epoch", "slotId")) throw CloudJson.failure();
        for (Map.Entry<String, Object> expected : binding.identity().entrySet()) if (!expected.getValue().equals(identity.get(expected.getKey()))) throw CloudJson.failure();
        Map<String, Object> attempt = CloudJson.object(value.get("terminal"));
        if (!CloudJson.exact(attempt, "id", "generation", "digest", "contentDigest", "epoch", "byteLength", "slot", "phase", "session", "condition")
                || !CloudLedger.terminal(attempt) || !CloudJson.hex(attempt.get("id")) || !CloudJson.hex(attempt.get("digest"))
                || !CloudJson.hex(attempt.get("contentDigest")) || CloudJson.integer(attempt.get("generation")) < 1
                || CloudJson.integer(attempt.get("byteLength")) < 1 || CloudJson.integer(attempt.get("byteLength")) > CloudJson.MAX_BYTES
                || CloudJson.integer(attempt.get("slot")) > 1
                || !reference.equals(attempt.get("session")) || !attempt.get("id").equals(identity.get("attemptId"))
                || CloudJson.integer(attempt.get("epoch")) != CloudJson.integer(identity.get("epoch"))
                || !CloudJson.id(identity.get("slotId")) || !CloudJson.hex(identity.get("streamId"))) throw CloudJson.failure();
        return value;
    }
    Map<String, Object> sweep(String streamId) throws IOException {
        Path parent = parent(streamId);
        if (!Files.exists(parent, LinkOption.NOFOLLOW_LINKS)) return CloudJson.map("removed", 0, "retained", 0);
        if (Files.isSymbolicLink(parent)) throw CloudJson.failure();
        List<Path> files = new ArrayList<>();
        try (java.util.stream.Stream<Path> list = Files.list(parent)) { list.forEach(files::add); }
        if (files.size() > 8192) throw CloudJson.failure();
        int removed = 0;
        int retained = 0;
        for (Path entry : files) {
            String name = entry.getFileName().toString();
            boolean moved = name.startsWith("swept-");
            String reference = moved ? name.substring(6) : name;
            if (!CloudJson.hex(reference) || Files.isSymbolicLink(entry) || !Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            Path root = entry;
            List<Path> names = new ArrayList<>();
            try (java.util.stream.Stream<Path> list = Files.list(root)) { list.forEach(names::add); }
            if (moved && names.isEmpty()) { Files.delete(root); removed++; continue; }
            if (!Files.exists(root.resolve("retired.json"), LinkOption.NOFOLLOW_LINKS)) { retained++; continue; }
            Map<String, Object> record = retired(root.resolve("retired.json"), reference);
            if (!moved) {
                if (!Files.exists(root.resolve("cleared.json"), LinkOption.NOFOLLOW_LINKS)) { retained++; continue; }
                Map<String, Object> cleared = CloudJson.object(CloudJson.parse(CloudJournal.read(root.resolve("cleared.json"), 1024), 1024));
                if (!CloudJson.exact(cleared, "format", "reference", "retirementDigest")
                        || !"recap-cloud-session-cleared".equals(cleared.get("format")) || !reference.equals(cleared.get("reference"))
                        || !CloudJson.hash(CloudJournal.read(root.resolve("retired.json"), 8192)).equals(cleared.get("retirementDigest"))) throw CloudJson.failure();
            }
            if (!streamId.equals(CloudJson.object(record.get("identity")).get("streamId"))
                    || names.stream().anyMatch((path) -> !Arrays.asList("ready.json", "retired.json", "cleared.json").contains(path.getFileName().toString()))) throw CloudJson.failure();
            // Retirement already verified native ciphertext/key deletion; sweeping never opens that store.
            if (!moved) {
                Path target = parent.resolve("swept-" + reference);
                Files.move(root, target, StandardCopyOption.ATOMIC_MOVE);
                root = target;
            }
            for (String file : Arrays.asList("ready.json", "cleared.json", "retired.json")) {
                Path path = root.resolve(file);
                if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) { CloudJournal.read(path, 8192); Files.delete(path); }
            }
            Files.delete(root);
            removed++;
        }
        return CloudJson.map("removed", removed, "retained", retained);
    }
}
