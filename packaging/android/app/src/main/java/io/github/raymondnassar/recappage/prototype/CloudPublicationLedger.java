package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class CloudPublicationLedger extends CloudLedger {
    static final int RESERVE = 32;
    private static final int MAX_FENCES = 8;
    private static final List<String> STEPS = Arrays.asList("reserved", "creating", "session", "uploading",
            "uploaded", "publishing", "published", "fencing", "fenced", "abandoned");

    CloudPublicationLedger(Path base, CloudOwnership.Destination destination, boolean initialize) throws IOException {
        super(destination, open(base, destination, initialize));
    }

    private static Map<String, Object> initial(CloudOwnership.Destination destination) {
        return CloudJson.map("protocol", CloudPublicationRecord.PROTOCOL, "binding", destination.data(), "maxGeneration", 0,
                "snapshots", new ArrayList<>(Arrays.asList(null, null)), "payloads", new ArrayList<>(),
                "attempt", null, "event", CloudJson.map("type", "initialize"));
    }

    private static CloudJournal open(Path base, CloudOwnership.Destination destination, boolean initialize) throws IOException {
        if (base == null || destination.binding.provider != CloudProviderHttp.Provider.MICROSOFT
                || !CloudPublicationRecord.PROTOCOL.equals(destination.protocol)) throw CloudJson.failure();
        Path root = destination.binding.path(base, "cloud-publication-streams").resolve(destination.streamId);
        if (!initialize && !Files.exists(root, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        Map<String, Object> empty = initial(destination);
        return new CloudJournal(root, "recap-cloud-publication-intent", empty,
                (state) -> validate(state, destination),
                (before, after) -> {
                    Map<String, Object> expected = before == null ? empty
                            : reduce(before, CloudJson.object(after.get("event")), destination);
                    if (!CloudJson.canonical(expected).equals(CloudJson.canonical(after))) throw CloudJson.failure();
                });
    }

    private static boolean referenced(Map<String, Object> state, Object id) throws IOException {
        for (Object entry : CloudJson.array(state.get("snapshots"))) {
            if (entry != null && id.equals(CloudJson.object(entry).get("id"))) return true;
        }
        return false;
    }
    private static int staging(Map<String, Object> state) throws IOException {
        int count = 0;
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            if (!referenced(state, CloudJson.object(entry).get("attemptId"))) count++;
        }
        return count;
    }
    private static Map<String, Object> payload(Map<String, Object> state, Object id) throws IOException {
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            Map<String, Object> value = CloudJson.object(entry);
            if (id.equals(value.get("attemptId"))) return value;
        }
        throw CloudJson.failure();
    }
    private static boolean quiescent(Map<String, Object> state) throws IOException {
        if (state.get("attempt") != null && !terminal(CloudJson.object(state.get("attempt")))) return false;
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            if (CloudJson.object(entry).get("cleanup") != null) return false;
        }
        return true;
    }
    private static Map<String, Object> attempt(Map<String, Object> state, Object id, String... phases) throws IOException {
        Map<String, Object> value = CloudJson.object(state.get("attempt"));
        if (!id.equals(value.get("id")) || !Arrays.asList(phases).contains(value.get("phase"))) throw CloudJson.failure();
        return value;
    }
    private static boolean matches(Object pointer, Map<String, Object> entry, Map<String, Object> data) throws IOException {
        if (pointer == null || entry == null || data == null) return false;
        Map<String, Object> value = CloudJson.object(pointer);
        return entry.get("id").equals(value.get("attemptId"))
                && CloudJson.integer(entry.get("generation")) == CloudJson.integer(value.get("generation"))
                && entry.get("digest").equals(value.get("digest")) && java.util.Objects.equals(data.get("id"), value.get("payloadId"))
                && CloudJson.integer(data.get("byteLength")) == CloudJson.integer(value.get("byteLength"));
    }
    private static String[] keys(String type) throws IOException {
        switch (type) {
            case "initialize": return new String[] { "type" };
            case "prepare": return new String[] { "type", "id", "digest", "contentDigest", "byteLength", "epoch", "condition" };
            case "session": case "retired": return new String[] { "type", "id", "reference" };
            case "payload": return new String[] { "type", "id", "payloadId" };
            case "published": case "fenced": case "cleanup": return new String[] { "type", "id", "condition" };
            case "fence": return new String[] { "type", "id", "text", "condition" };
            case "settle": return new String[] { "type", "id", "completed" };
            case "dispatch": case "upload": case "publish": case "unknown": case "abandon": case "cleaned":
                return new String[] { "type", "id" };
            default: throw CloudJson.failure();
        }
    }

    private static void validate(Map<String, Object> state, CloudOwnership.Destination destination) throws IOException {
        if (!CloudJson.exact(state, "protocol", "binding", "maxGeneration", "snapshots", "payloads", "attempt", "event")
                || !CloudPublicationRecord.PROTOCOL.equals(state.get("protocol"))
                || !CloudJson.canonical(state.get("binding")).equals(CloudJson.canonical(destination.data()))) throw CloudJson.failure();
        Map<String, Object> event = CloudJson.object(state.get("event"));
        if (!CloudJson.exact(event, keys(CloudJson.string(event.get("type"))))) throw CloudJson.failure();
        long maximum = CloudJson.integer(state.get("maxGeneration"));
        List<Object> snapshots = CloudJson.array(state.get("snapshots"));
        List<Object> payloads = CloudJson.array(state.get("payloads"));
        if (snapshots.size() != 2 || payloads.size() > 4 || staging(state) > 2) throw CloudJson.failure();
        Set<Object> attempts = new HashSet<>(), files = new HashSet<>();
        for (Object entry : payloads) {
            Map<String, Object> value = CloudJson.object(entry);
            if (!CloudJson.exact(value, "attemptId", "generation", "digest", "contentDigest", "byteLength", "epoch", "name",
                    "id", "session", "terminal", "retired", "cleanup")
                    || !CloudJson.hex(value.get("attemptId")) || !attempts.add(value.get("attemptId"))
                    || !CloudJson.hex(value.get("digest")) || !CloudJson.hex(value.get("contentDigest"))
                    || CloudJson.integer(value.get("generation")) < 1 || CloudJson.integer(value.get("generation")) > maximum
                    || CloudJson.integer(value.get("byteLength")) < 1 || CloudJson.integer(value.get("byteLength")) > CloudJson.MAX_BYTES
                    || CloudJson.integer(value.get("epoch")) < 1
                    || !CloudPublicationRecord.payloadName(destination.streamId, CloudJson.string(value.get("attemptId"))).equals(value.get("name"))
                    || value.get("id") != null && (!CloudJson.id(value.get("id")) || !files.add(value.get("id"))
                        || Arrays.asList(destination.slots).contains(value.get("id")))
                    || value.get("session") != null && !CloudJson.hex(value.get("session"))
                    || !(value.get("terminal") instanceof Boolean) || !(value.get("retired") instanceof Boolean)
                    || Boolean.TRUE.equals(value.get("terminal")) && (value.get("id") == null || value.get("session") == null)
                    || Boolean.TRUE.equals(value.get("retired")) && !Boolean.TRUE.equals(value.get("terminal"))
                    || value.get("cleanup") != null && (!CloudProviderHttp.strongTag(CloudJson.string(value.get("cleanup")))
                        || !Boolean.TRUE.equals(value.get("terminal")) || !Boolean.TRUE.equals(value.get("retired"))
                        || referenced(state, value.get("attemptId")))) throw CloudJson.failure();
        }
        for (Object entry : snapshots) {
            if (entry == null) continue;
            Map<String, Object> value = CloudJson.object(entry);
            if (!CloudJson.exact(value, "id", "generation", "digest", "contentDigest", "epoch", "byteLength")
                    || !CloudJson.hex(value.get("id"))) throw CloudJson.failure();
            Map<String, Object> data = payload(state, value.get("id"));
            if (!Boolean.TRUE.equals(data.get("terminal")) || !Boolean.TRUE.equals(data.get("retired"))
                    || !value.get("digest").equals(data.get("digest")) || !value.get("contentDigest").equals(data.get("contentDigest"))
                    || CloudJson.integer(value.get("generation")) != CloudJson.integer(data.get("generation"))
                    || CloudJson.integer(value.get("byteLength")) != CloudJson.integer(data.get("byteLength"))
                    || CloudJson.integer(value.get("epoch")) != CloudJson.integer(data.get("epoch"))) throw CloudJson.failure();
        }
        if (snapshots.get(0) != null && snapshots.get(1) != null
                && CloudJson.integer(CloudJson.object(snapshots.get(0)).get("generation"))
                    == CloudJson.integer(CloudJson.object(snapshots.get(1)).get("generation"))) throw CloudJson.failure();
        if (state.get("attempt") == null) {
            if (maximum != 0 || !payloads.isEmpty()) throw CloudJson.failure();
            return;
        }
        Map<String, Object> value = CloudJson.object(state.get("attempt"));
        if (!CloudJson.exact(value, "id", "generation", "digest", "contentDigest", "byteLength", "epoch", "slot", "phase",
                "step", "condition", "publicationTag", "fence", "fences")
                || !CloudJson.hex(value.get("id")) || !CloudJson.hex(value.get("digest")) || !CloudJson.hex(value.get("contentDigest"))
                || maximum < 1 || CloudJson.integer(value.get("generation")) != maximum
                || CloudJson.integer(value.get("byteLength")) < 1 || CloudJson.integer(value.get("byteLength")) > CloudJson.MAX_BYTES
                || CloudJson.integer(value.get("epoch")) < 1 || CloudJson.integer(value.get("slot")) > 1
                || !Arrays.asList("prepared", "in-flight", "unknown", "acknowledged", "failed").contains(value.get("phase"))
                || !STEPS.contains(value.get("step")) || !CloudProviderHttp.strongTag(CloudJson.string(value.get("condition")))
                || value.get("publicationTag") != null && !CloudProviderHttp.strongTag(CloudJson.string(value.get("publicationTag")))
                || CloudJson.integer(value.get("fences")) > MAX_FENCES
                || "prepared".equals(value.get("phase")) && !"reserved".equals(value.get("step"))
                || "acknowledged".equals(value.get("phase")) && !Arrays.asList("published", "fenced").contains(value.get("step"))
                || "failed".equals(value.get("phase")) && !Arrays.asList("abandoned", "fenced").contains(value.get("step"))
                || Arrays.asList("in-flight", "unknown").contains(value.get("phase")) && Arrays.asList("reserved", "abandoned").contains(value.get("step"))
                || !terminal(value) && !attempts.contains(value.get("id"))
                || (CloudJson.integer(value.get("fences")) == 0) != (value.get("fence") == null)) throw CloudJson.failure();
        if (value.get("fence") != null) {
            Map<String, Object> fence = CloudJson.object(value.get("fence"));
            if (!CloudJson.exact(fence, "text", "condition", "tag") || !CloudProviderHttp.strongTag(CloudJson.string(fence.get("condition")))
                    || fence.get("tag") != null && !CloudProviderHttp.strongTag(CloudJson.string(fence.get("tag")))) throw CloudJson.failure();
            CloudPublicationRecord.decode(CloudJson.string(fence.get("text")), destination.streamId,
                    destination.slots[(int) CloudJson.integer(value.get("slot"))]);
        }
    }

    private static Map<String, Object> reduce(Map<String, Object> before, Map<String, Object> event,
            CloudOwnership.Destination destination) throws IOException {
        String type = CloudJson.string(event.get("type"));
        if (!CloudJson.exact(event, keys(type)) || "initialize".equals(type)) throw CloudJson.failure();
        if (!CloudJson.hex(event.get("id"))) throw CloudJson.failure();
        Map<String, Object> next = CloudJson.object(CloudJson.copy(before));
        next.put("event", CloudJson.copy(event));
        if ("prepare".equals(type)) {
            if (!quiescent(next) || staging(next) >= 2 || !CloudJson.hex(event.get("id")) || !CloudJson.hex(event.get("digest"))
                    || !CloudJson.hex(event.get("contentDigest")) || CloudJson.integer(event.get("byteLength")) < 1
                    || CloudJson.integer(event.get("byteLength")) > CloudJson.MAX_BYTES || CloudJson.integer(event.get("epoch")) < 1
                    || !CloudProviderHttp.strongTag(CloudJson.string(event.get("condition")))) throw CloudJson.failure();
            for (Object entry : CloudJson.array(next.get("payloads"))) {
                if (event.get("id").equals(CloudJson.object(entry).get("attemptId"))) throw CloudJson.failure();
            }
            if (next.get("attempt") != null && event.get("id").equals(CloudJson.object(next.get("attempt")).get("id"))) throw CloudJson.failure();
            long generation = CloudJson.integer(next.get("maxGeneration")) + 1;
            if (generation > CloudJson.MAX_INTEGER) throw CloudJson.failure();
            next.put("maxGeneration", generation);
            next.put("attempt", CloudJson.map("id", event.get("id"), "generation", generation, "digest", event.get("digest"),
                    "contentDigest", event.get("contentDigest"), "byteLength", event.get("byteLength"), "epoch", event.get("epoch"),
                    "slot", slot(next), "phase", "prepared", "step", "reserved", "condition", event.get("condition"),
                    "publicationTag", null, "fence", null, "fences", 0));
            CloudJson.array(next.get("payloads")).add(CloudJson.map("attemptId", event.get("id"), "generation", generation,
                    "digest", event.get("digest"), "contentDigest", event.get("contentDigest"), "byteLength", event.get("byteLength"),
                    "epoch", event.get("epoch"), "name", CloudPublicationRecord.payloadName(destination.streamId, CloudJson.string(event.get("id"))),
                    "id", null, "session", null, "terminal", false, "retired", false, "cleanup", null));
            return next;
        }
        Object id = event.get("id");
        Map<String, Object> data = payload(next, id);
        if (Arrays.asList("retired", "cleanup", "cleaned").contains(type)) {
            if (!Boolean.TRUE.equals(data.get("terminal"))) throw CloudJson.failure();
            if ("retired".equals(type)) {
                if (Boolean.TRUE.equals(data.get("retired")) || !event.get("reference").equals(data.get("session"))) throw CloudJson.failure();
                data.put("retired", true);
            } else {
                boolean finishing = "cleaned".equals(type) && next.get("attempt") != null && terminal(CloudJson.object(next.get("attempt")));
                if (!quiescent(next) && !finishing || referenced(next, id) || !Boolean.TRUE.equals(data.get("retired"))) throw CloudJson.failure();
                if ("cleanup".equals(type)) {
                    if (data.get("cleanup") != null || !CloudProviderHttp.strongTag(CloudJson.string(event.get("condition")))) throw CloudJson.failure();
                    data.put("cleanup", event.get("condition"));
                } else {
                    if (data.get("cleanup") == null) throw CloudJson.failure();
                    CloudJson.array(next.get("payloads")).remove(data);
                }
            }
            return next;
        }
        Map<String, Object> value = attempt(next, id, "dispatch".equals(type) || "abandon".equals(type)
                ? new String[] { "prepared" } : "unknown".equals(type) ? new String[] { "in-flight" } : new String[] { "in-flight", "unknown" });
        switch (type) {
            case "dispatch":
                if (!"reserved".equals(value.get("step"))) throw CloudJson.failure();
                value.put("phase", "in-flight"); value.put("step", "creating"); break;
            case "abandon":
                if (!"reserved".equals(value.get("step")) || data.get("session") != null || data.get("id") != null) throw CloudJson.failure();
                value.put("phase", "failed"); value.put("step", "abandoned");
                CloudJson.array(next.get("payloads")).remove(data); break;
            case "session":
                if (!"in-flight".equals(value.get("phase")) || !"creating".equals(value.get("step"))
                        || data.get("session") != null || !CloudJson.hex(event.get("reference"))) throw CloudJson.failure();
                data.put("session", event.get("reference")); value.put("step", "session"); break;
            case "upload":
                if (!"in-flight".equals(value.get("phase")) || !"session".equals(value.get("step")) || data.get("session") == null) throw CloudJson.failure();
                value.put("step", "uploading"); break;
            case "payload":
                if (!"in-flight".equals(value.get("phase")) || !"uploading".equals(value.get("step"))
                        || !CloudJson.id(event.get("payloadId")) || Arrays.asList(destination.slots).contains(event.get("payloadId"))) throw CloudJson.failure();
                for (Object entry : CloudJson.array(next.get("payloads"))) {
                    if (event.get("payloadId").equals(CloudJson.object(entry).get("id"))) throw CloudJson.failure();
                }
                data.put("id", event.get("payloadId")); data.put("terminal", true); value.put("step", "uploaded"); break;
            case "publish":
                if (!"in-flight".equals(value.get("phase")) || !"uploaded".equals(value.get("step"))
                        || !Boolean.TRUE.equals(data.get("terminal")) || !Boolean.TRUE.equals(data.get("retired"))) throw CloudJson.failure();
                value.put("step", "publishing"); break;
            case "published":
                if (!"in-flight".equals(value.get("phase")) || !"publishing".equals(value.get("step"))
                        || !CloudProviderHttp.strongTag(CloudJson.string(event.get("condition"))) || event.get("condition").equals(value.get("condition"))) throw CloudJson.failure();
                value.put("publicationTag", event.get("condition")); value.put("step", "published"); break;
            case "unknown": value.put("phase", "unknown"); break;
            case "fence": {
                if (!CloudProviderHttp.strongTag(CloudJson.string(event.get("condition"))) || CloudJson.integer(value.get("fences")) >= MAX_FENCES) throw CloudJson.failure();
                int index = (int) CloudJson.integer(value.get("slot"));
                Map<String, Object> record = CloudPublicationRecord.decode(CloudJson.string(event.get("text")), destination.streamId, destination.slots[index]);
                Map<String, Object> prior = CloudJson.array(next.get("snapshots")).get(index) == null ? null
                        : CloudJson.object(CloudJson.array(next.get("snapshots")).get(index));
                boolean pending = matches(record.get("publication"), value, data);
                Map<String, Object> priorData = prior == null ? null : payload(next, prior.get("id"));
                if (record.get("publication") != null && !pending && !matches(record.get("publication"), prior, priorData)
                        || pending && !Boolean.TRUE.equals(data.get("terminal"))) throw CloudJson.failure();
                value.put("fence", CloudJson.map("text", event.get("text"), "condition", event.get("condition"), "tag", null));
                value.put("fences", CloudJson.integer(value.get("fences")) + 1); value.put("step", "fencing"); break;
            }
            case "fenced": {
                Map<String, Object> fence = CloudJson.object(value.get("fence"));
                if (!"fencing".equals(value.get("step")) || !CloudProviderHttp.strongTag(CloudJson.string(event.get("condition")))
                        || event.get("condition").equals(fence.get("condition")) || event.get("condition").equals(value.get("condition"))) throw CloudJson.failure();
                fence.put("tag", event.get("condition")); value.put("step", "fenced"); break;
            }
            case "settle": {
                if (!Arrays.asList("published", "fenced").contains(value.get("step")) || !(event.get("completed") instanceof Boolean)) throw CloudJson.failure();
                boolean completed = true;
                if ("fenced".equals(value.get("step"))) {
                    Map<String, Object> record = CloudPublicationRecord.decode(CloudJson.string(CloudJson.object(value.get("fence")).get("text")),
                            destination.streamId, destination.slots[(int) CloudJson.integer(value.get("slot"))]);
                    completed = matches(record.get("publication"), value, data);
                }
                if (completed != Boolean.TRUE.equals(event.get("completed"))
                        || completed && (!Boolean.TRUE.equals(data.get("terminal")) || !Boolean.TRUE.equals(data.get("retired")))) throw CloudJson.failure();
                value.put("phase", completed ? "acknowledged" : "failed");
                if (completed) {
                    Map<String, Object> snapshot = CloudJson.map();
                    for (String key : Arrays.asList("id", "generation", "digest", "contentDigest", "epoch", "byteLength")) snapshot.put(key, value.get(key));
                    CloudJson.array(next.get("snapshots")).set((int) CloudJson.integer(value.get("slot")), snapshot);
                }
                break;
            }
            default: throw CloudJson.failure();
        }
        return next;
    }

    private Map<String, Object> change(Map<String, Object> event) throws IOException {
        CloudJournal.Head head = inspect();
        return journal.update(head.sequence, (state) -> reduce(state, event, destination)).state;
    }
    private long remaining() throws IOException {
        CloudJournal.Head head = inspect();
        return CloudJournal.LIMIT - (head.sequence - head.base);
    }
    @Override boolean canPrepare() throws IOException {
        Map<String, Object> state = inspect().state;
        return remaining() >= RESERVE && quiescent(state) && staging(state) < 2;
    }
    @Override Map<String, Object> prepare(long sequence, String id, String digest, String contentDigest, long length,
            long epoch, String condition) throws IOException {
        if (remaining() < RESERVE) throw CloudJson.failure();
        return journal.update(sequence, (state) -> reduce(state, CloudJson.map("type", "prepare", "id", id,
                "digest", digest, "contentDigest", contentDigest, "byteLength", length, "epoch", epoch, "condition", condition), destination)).state;
    }
    @Override Map<String, Object> phase(String id, String phase) throws IOException {
        String type = "in-flight".equals(phase) ? "dispatch" : "unknown".equals(phase) ? "unknown" : "failed".equals(phase) ? "abandon" : null;
        if (type == null) throw CloudJson.failure();
        return change(CloudJson.map("type", type, "id", id));
    }
    @Override void session(String id, String reference) throws IOException { change(CloudJson.map("type", "session", "id", id, "reference", reference)); }
    void dispatchPayload(String id) throws IOException { change(CloudJson.map("type", "upload", "id", id)); }
    void payloadAcknowledged(String id, String payloadId) throws IOException { change(CloudJson.map("type", "payload", "id", id, "payloadId", payloadId)); }
    void payloadSessionRetired(String id, String reference) throws IOException { change(CloudJson.map("type", "retired", "id", id, "reference", reference)); }
    void dispatchPublication(String id) throws IOException { change(CloudJson.map("type", "publish", "id", id)); }
    void publicationAcknowledged(String id, String condition) throws IOException { change(CloudJson.map("type", "published", "id", id, "condition", condition)); }
    void beginFence(String id, String text, String condition) throws IOException { change(CloudJson.map("type", "fence", "id", id, "text", text, "condition", condition)); }
    void fenceAcknowledged(String id, String condition) throws IOException { change(CloudJson.map("type", "fenced", "id", id, "condition", condition)); }
    void beginCleanup(String id, String condition) throws IOException {
        if (remaining() < 8) throw CloudJson.failure();
        change(CloudJson.map("type", "cleanup", "id", id, "condition", condition));
    }
    void finishCleanup(String id) throws IOException { change(CloudJson.map("type", "cleaned", "id", id)); }
    Map<String, Object> payload(String id) throws IOException { return payload(inspect().state, id); }
    @Override Map<String, Object> settle(String id, Verifier verifier) throws IOException {
        CloudJournal.Head head = inspect();
        Map<String, Object> attempt = attempt(head.state, id, "in-flight", "unknown");
        if (!Arrays.asList("published", "fenced").contains(attempt.get("step"))) throw CloudJson.failure();
        try {
            Proof proof = verifier.verify(CloudJson.object(CloudJson.copy(attempt)));
            if (proof == null || !proof.terminal || !id.equals(proof.attemptId)
                    || proof.generation != CloudJson.integer(attempt.get("generation")) || !proof.digest.equals(attempt.get("digest"))
                    || !proof.slotId.equals(destination.slots[(int) CloudJson.integer(attempt.get("slot"))])
                    || proof.completed && !proof.exactReadback) throw CloudJson.failure();
            return journal.update(head.sequence, (state) -> reduce(state,
                    CloudJson.map("type", "settle", "id", id, "completed", proof.completed), destination)).state;
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw CloudJson.failure(); }
    }
    @Override Map<String, Object> terminal(String id) throws IOException {
        if (!CloudJson.hex(id)) throw CloudJson.failure();
        Map<String, Object> state = inspect().state;
        Map<String, Object> data = null;
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            if (id.equals(CloudJson.object(entry).get("attemptId"))) data = CloudJson.object(entry);
        }
        if (data == null || !Boolean.TRUE.equals(data.get("terminal")) || data.get("session") == null) return null;
        Map<String, Object> attempt = CloudJson.map("id", id, "phase", "acknowledged", "session", data.get("session"), "condition", null, "slot", 0);
        for (String key : Arrays.asList("generation", "digest", "contentDigest", "epoch", "byteLength")) attempt.put(key, data.get(key));
        return CloudJson.map("binding", destination.binding.identity(), "streamId", destination.streamId, "slotId", data.get("name"), "attempt", attempt);
    }
    @Override Map<String, Object> compact(CloudSessions sessions) throws IOException {
        Map<String, Object> state = inspect().state;
        if (!quiescent(state)) throw CloudJson.failure();
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            Map<String, Object> data = CloudJson.object(entry);
            if (!Boolean.TRUE.equals(data.get("terminal")) || Boolean.TRUE.equals(data.get("retired")) || data.get("session") == null) continue;
            if (sessions == null) throw CloudJson.failure();
            Map<String, Object> proof = terminal(CloudJson.string(data.get("attemptId")));
            sessions.retire(destination.streamId, CloudJson.string(data.get("name")),
                    CloudJson.object(proof.get("attempt")), CloudJson.string(data.get("session")));
            payloadSessionRetired(CloudJson.string(data.get("attemptId")), CloudJson.string(data.get("session")));
        }
        return journal.compact((value) -> { if (!quiescent(value)) throw CloudJson.failure(); }).state;
    }
}
