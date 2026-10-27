package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

class CloudLedger {
    interface Verifier { Proof verify(Map<String, Object> attempt) throws Exception; }
    static final class Proof {
        final String attemptId;
        final long generation;
        final String digest;
        final String slotId;
        final boolean completed;
        final boolean terminal;
        final boolean exactReadback;
        Proof(String attemptId, long generation, String digest, String slotId, boolean completed, boolean terminal, boolean exactReadback) {
            this.attemptId = attemptId; this.generation = generation; this.digest = digest; this.slotId = slotId;
            this.completed = completed; this.terminal = terminal; this.exactReadback = exactReadback;
        }
    }
    final CloudOwnership.Destination destination;
    final CloudJournal journal;
    CloudLedger(CloudOwnership.Destination destination, CloudJournal journal) {
        this.destination = destination;
        this.journal = journal;
    }
    CloudLedger(Path base, CloudOwnership.Destination destination, boolean initialize) throws IOException {
        if (destination.protocol != null) throw CloudJson.failure();
        this.destination = destination;
        Path root = destination.binding.path(base, "cloud-streams").resolve(destination.streamId);
        if (!initialize && !java.nio.file.Files.exists(root)) throw CloudJson.failure();
        Map<String, Object> initial = CloudJson.map("binding", destination.data(), "maxGeneration", 0,
                "snapshots", new ArrayList<>(Arrays.asList(null, null)), "attempt", null);
        journal = new CloudJournal(root, "recap-cloud-stream-intent", initial, this::validate, this::transition);
    }
    static boolean terminal(Map<String, Object> attempt) { return Arrays.asList("acknowledged", "failed").contains(attempt.get("phase")); }
    private void validate(Map<String, Object> state) throws IOException {
        if (!CloudJson.exact(state, "binding", "maxGeneration", "snapshots", "attempt")
                || !CloudJson.canonical(state.get("binding")).equals(CloudJson.canonical(destination.data()))) throw CloudJson.failure();
        long maximum = CloudJson.integer(state.get("maxGeneration"));
        List<Object> snapshots = CloudJson.array(state.get("snapshots"));
        if (snapshots.size() != 2) throw CloudJson.failure();
        for (Object entry : snapshots) {
            if (entry == null) continue;
            Map<String, Object> value = CloudJson.object(entry);
            if (!CloudJson.exact(value, "id", "generation", "digest", "contentDigest", "epoch", "byteLength")
                    || !CloudJson.hex(value.get("id")) || !CloudJson.hex(value.get("digest")) || !CloudJson.hex(value.get("contentDigest"))
                    || CloudJson.integer(value.get("generation")) < 1 || CloudJson.integer(value.get("generation")) > maximum
                    || CloudJson.integer(value.get("epoch")) < 1 || CloudJson.integer(value.get("byteLength")) < 1
                    || CloudJson.integer(value.get("byteLength")) > CloudJson.MAX_BYTES) throw CloudJson.failure();
        }
        if (snapshots.get(0) != null && snapshots.get(1) != null
                && CloudJson.integer(CloudJson.object(snapshots.get(0)).get("generation")) == CloudJson.integer(CloudJson.object(snapshots.get(1)).get("generation"))) throw CloudJson.failure();
        if (state.get("attempt") != null) {
            Map<String, Object> a = CloudJson.object(state.get("attempt"));
            if (!CloudJson.exact(a, "id", "generation", "digest", "contentDigest", "epoch", "byteLength", "slot", "phase", "session", "condition")
                    || !CloudJson.hex(a.get("id")) || !CloudJson.hex(a.get("digest")) || !CloudJson.hex(a.get("contentDigest"))
                    || CloudJson.integer(a.get("generation")) != maximum || maximum < 1 || CloudJson.integer(a.get("epoch")) < 1
                    || CloudJson.integer(a.get("byteLength")) < 1 || CloudJson.integer(a.get("byteLength")) > CloudJson.MAX_BYTES
                    || CloudJson.integer(a.get("slot")) > 1 || !Arrays.asList("prepared", "in-flight", "unknown", "acknowledged", "failed").contains(a.get("phase"))
                    || a.get("session") != null && !CloudJson.hex(a.get("session"))
                    || a.get("condition") != null && (destination.binding.provider != CloudProviderHttp.Provider.MICROSOFT
                        || !CloudProviderHttp.strongTag(CloudJson.string(a.get("condition"))))) throw CloudJson.failure();
        }
    }
    static int slot(Map<String, Object> state) throws IOException {
        List<Object> snapshots = CloudJson.array(state.get("snapshots"));
        if (snapshots.get(0) == null) return 0;
        if (snapshots.get(1) == null) return 1;
        return CloudJson.integer(CloudJson.object(snapshots.get(0)).get("generation"))
                < CloudJson.integer(CloudJson.object(snapshots.get(1)).get("generation")) ? 0 : 1;
    }
    private Map<String, Object> snapshot(Map<String, Object> attempt) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String key : Arrays.asList("id", "generation", "digest", "contentDigest", "epoch", "byteLength")) result.put(key, attempt.get(key));
        return result;
    }
    private void transition(Map<String, Object> before, Map<String, Object> after) throws IOException {
        if (before == null) {
            if (CloudJson.integer(after.get("maxGeneration")) != 0 || after.get("attempt") != null
                    || CloudJson.array(after.get("snapshots")).stream().anyMatch((value) -> value != null)) throw CloudJson.failure();
            return;
        }
        Map<String, Object> a = before.get("attempt") == null ? null : CloudJson.object(before.get("attempt"));
        Map<String, Object> b = CloudJson.object(after.get("attempt"));
        if ("prepared".equals(b.get("phase"))) {
            if (a != null && !terminal(a) || CloudJson.integer(b.get("generation")) <= CloudJson.integer(before.get("maxGeneration"))
                    || CloudJson.integer(b.get("slot")) != slot(before) || b.get("session") != null
                    || !CloudJson.canonical(before.get("snapshots")).equals(CloudJson.canonical(after.get("snapshots")))
                    || a != null && a.get("id").equals(b.get("id"))) throw CloudJson.failure();
            return;
        }
        if (a == null || !a.get("id").equals(b.get("id")) || !before.get("maxGeneration").equals(after.get("maxGeneration"))) throw CloudJson.failure();
        Map<String, Object> expected = new LinkedHashMap<>(a);
        expected.put("phase", b.get("phase"));
        expected.put("session", b.get("session"));
        if (!CloudJson.canonical(expected).equals(CloudJson.canonical(b))) throw CloudJson.failure();
        boolean attach = "in-flight".equals(a.get("phase")) && "in-flight".equals(b.get("phase"))
                && a.get("session") == null && CloudJson.hex(b.get("session"));
        if (!attach && !java.util.Objects.equals(a.get("session"), b.get("session"))) throw CloudJson.failure();
        if ("in-flight".equals(b.get("phase")) && !"prepared".equals(a.get("phase")) && !attach
                || "unknown".equals(b.get("phase")) && !"in-flight".equals(a.get("phase"))
                || terminal(b) && !Arrays.asList("in-flight", "unknown").contains(a.get("phase"))
                    && !("prepared".equals(a.get("phase")) && "failed".equals(b.get("phase")) && a.get("session") == null)) throw CloudJson.failure();
        List<Object> snapshots = new ArrayList<>(CloudJson.array(before.get("snapshots")));
        if ("acknowledged".equals(b.get("phase"))) snapshots.set((int) CloudJson.integer(b.get("slot")), snapshot(b));
        if (!CloudJson.canonical(snapshots).equals(CloudJson.canonical(after.get("snapshots")))) throw CloudJson.failure();
    }
    CloudJournal.Head inspect() throws IOException { return journal.inspect(); }
    boolean canPrepare() throws IOException {
        CloudJournal.Head head = inspect();
        return CloudJournal.LIMIT - (head.sequence - head.base) >= 5
                && (head.state.get("attempt") == null || terminal(CloudJson.object(head.state.get("attempt"))));
    }
    Map<String, Object> prepare(long sequence, String attemptId, String digest, String contentDigest, long byteLength,
            long epoch, String condition) throws IOException {
        return journal.update(sequence, (state) -> {
            CloudJournal.Head head = journal.load(null);
            if (CloudJournal.LIMIT - (head.sequence - head.base) < 5 || state.get("attempt") != null && !terminal(CloudJson.object(state.get("attempt")))) throw CloudJson.failure();
            long generation = CloudJson.integer(state.get("maxGeneration")) + 1;
            state.put("maxGeneration", generation);
            state.put("attempt", CloudJson.map("id", attemptId, "generation", generation, "digest", digest, "contentDigest", contentDigest,
                    "byteLength", byteLength, "epoch", epoch, "slot", slot(state), "phase", "prepared", "session", null, "condition", condition));
            return state;
        }).state;
    }
    private Map<String, Object> change(String id, List<String> phases, CloudJournal.Change change) throws IOException {
        CloudJournal.Head head = inspect();
        return journal.update(head.sequence, (state) -> {
            Map<String, Object> a = CloudJson.object(state.get("attempt"));
            if (!a.get("id").equals(id) || !phases.contains(a.get("phase"))) throw CloudJson.failure();
            return change.apply(state);
        }).state;
    }
    Map<String, Object> phase(String id, String phase) throws IOException {
        List<String> allowed = "in-flight".equals(phase) || "failed".equals(phase) ? Arrays.asList("prepared") : Arrays.asList("in-flight");
        if (!Arrays.asList("in-flight", "unknown", "failed").contains(phase)) throw CloudJson.failure();
        return change(id, allowed, (state) -> { CloudJson.object(state.get("attempt")).put("phase", phase); return state; });
    }
    void session(String id, String reference) throws IOException {
        change(id, Arrays.asList("in-flight"), (state) -> {
            Map<String, Object> attempt = CloudJson.object(state.get("attempt"));
            if (attempt.get("session") != null || !CloudJson.hex(reference)) throw CloudJson.failure();
            attempt.put("session", reference);
            return state;
        });
    }
    Map<String, Object> settle(String id, Verifier verifier) throws IOException {
        return change(id, Arrays.asList("in-flight", "unknown"), (state) -> {
            Map<String, Object> attempt = CloudJson.object(state.get("attempt"));
            Proof proof = verifier.verify(CloudJson.object(CloudJson.copy(attempt)));
            int slot = (int) CloudJson.integer(attempt.get("slot"));
            if (proof == null || !proof.terminal || !proof.attemptId.equals(id)
                    || proof.generation != CloudJson.integer(attempt.get("generation")) || !proof.digest.equals(attempt.get("digest"))
                    || !proof.slotId.equals(destination.slots[slot]) || proof.completed && !proof.exactReadback) throw CloudJson.failure();
            attempt.put("phase", proof.completed ? "acknowledged" : "failed");
            if (proof.completed) CloudJson.array(state.get("snapshots")).set(slot, snapshot(attempt));
            return state;
        });
    }
    Map<String, Object> terminal(String id) throws IOException {
        if (!CloudJson.hex(id)) throw CloudJson.failure();
        Map<String, Object> result = new LinkedHashMap<>();
        journal.scan((state, checkpoint) -> {
            if (state.get("attempt") != null) {
                Map<String, Object> attempt = CloudJson.object(state.get("attempt"));
                if (id.equals(attempt.get("id")) && terminal(attempt)) {
                    result.clear();
                    result.putAll(attempt);
                }
            }
        });
        return result.isEmpty() ? null : CloudJson.map("binding", destination.binding.identity(), "streamId", destination.streamId,
                "slotId", destination.slots[(int) CloudJson.integer(result.get("slot"))], "attempt", result);
    }
    Map<String, Object> compact(CloudSessions sessions) throws IOException {
        Map<String, Map<String, Object>> terminals = new LinkedHashMap<>();
        final Object[] base = { null };
        CloudJournal.Head original = journal.scan((state, checkpoint) -> {
            if (state.get("attempt") == null) return;
            Map<String, Object> attempt = CloudJson.object(state.get("attempt"));
            if (checkpoint) base[0] = attempt.get("id");
            if (terminal(attempt) && attempt.get("session") != null && !attempt.get("id").equals(base[0])) terminals.put((String) attempt.get("id"), attempt);
        });
        if (original.state.get("attempt") != null && !terminal(CloudJson.object(original.state.get("attempt")))) throw CloudJson.failure();
        for (Map<String, Object> attempt : terminals.values()) {
            sessions.retire(destination, attempt, CloudJson.string(attempt.get("session")));
        }
        return journal.compact((state) -> {
            if (!CloudJson.canonical(state).equals(CloudJson.canonical(original.state))
                    || state.get("attempt") != null && !terminal(CloudJson.object(state.get("attempt")))) throw CloudJson.failure();
        }).state;
    }
}
