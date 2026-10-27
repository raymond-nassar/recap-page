package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class CloudPublication {
    private static final byte[] SEED = CloudPublicationRecord.SEED.getBytes(StandardCharsets.UTF_8);
    private final CloudOwnership.Destination destination;
    private final CloudPublicationLedger ledger;
    private final CloudProviderHttp http;
    private final CloudProviderReads raw;
    private final CloudPublicationReads reads;
    private final CloudSessions sessions;
    private final CloudEnvelope.Codec codec;

    private static final class Record {
        final CloudProviderReads.Metadata metadata;
        final Map<String, Object> value;
        final String text;
        Record(CloudProviderReads.Metadata metadata, Map<String, Object> value) throws IOException {
            this.metadata = metadata; this.value = value;
            text = value == null ? metadata.description : CloudPublicationRecord.encode(value);
        }
    }

    CloudPublication(CloudOwnership.Destination destination, CloudPublicationLedger ledger, CloudProviderHttp http,
            CloudProviderReads raw, CloudSessions sessions, CloudEnvelope.Codec codec) throws IOException {
        if (destination == null || !CloudPublicationRecord.PROTOCOL.equals(destination.protocol)
                || destination.binding.provider != CloudProviderHttp.Provider.MICROSOFT
                || ledger == null || http == null || http.provider() != CloudProviderHttp.Provider.MICROSOFT
                || raw == null || sessions == null || codec == null) throw CloudJson.failure();
        this.destination = destination; this.ledger = ledger; this.http = http; this.raw = raw;
        this.sessions = sessions; this.codec = codec;
        reads = new CloudPublicationReads(raw, http);
    }

    private Map<String, Object> state() throws IOException {
        http.requireCurrent();
        Map<String, Object> state = ledger.inspect().state;
        if (!CloudPublicationRecord.PROTOCOL.equals(state.get("protocol"))
                || !CloudJson.canonical(destination.data()).equals(CloudJson.canonical(state.get("binding")))) throw CloudJson.failure();
        return state;
    }
    private void root() throws IOException {
        CloudProviderReads.Root root = raw.discoverRoot();
        if (!destination.rootId.equals(root.id) || !destination.driveId.equals(root.driveId)) throw CloudJson.failure();
        http.requireCurrent();
    }
    private static boolean referenced(Map<String, Object> state, Object id) throws IOException {
        for (Object entry : CloudJson.array(state.get("snapshots"))) {
            if (entry != null && id.equals(CloudJson.object(entry).get("id"))) return true;
        }
        return false;
    }
    private static Map<String, Object> payload(Map<String, Object> state, Object id) throws IOException {
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            Map<String, Object> value = CloudJson.object(entry);
            if (id.equals(value.get("attemptId"))) return value;
        }
        throw CloudJson.failure();
    }
    private static boolean matches(Object pointer, Map<String, Object> attempt, Map<String, Object> data) throws IOException {
        if (pointer == null || attempt == null || data == null) return false;
        Map<String, Object> value = CloudJson.object(pointer);
        return attempt.get("id").equals(value.get("attemptId"))
                && CloudJson.integer(attempt.get("generation")) == CloudJson.integer(value.get("generation"))
                && attempt.get("digest").equals(value.get("digest")) && Objects.equals(data.get("id"), value.get("payloadId"))
                && CloudJson.integer(data.get("byteLength")) == CloudJson.integer(value.get("byteLength"));
    }
    private Record record(int slot) throws IOException {
        String id = destination.slots[slot], name = destination.name(slot);
        CloudProviderReads.Metadata before = raw.readMetadata(id);
        CloudProviderReads.Selected selected = raw.readConditionalFile(id);
        CloudProviderReads.Metadata after = raw.readMetadata(id);
        if (!id.equals(before.file.id) || !name.equals(before.file.name) || before.file.size != SEED.length
                || !id.equals(selected.file.id) || !name.equals(selected.file.name) || !Arrays.equals(SEED, selected.bytes)
                || !id.equals(after.file.id) || !name.equals(after.file.name) || after.file.size != SEED.length
                || !before.condition.equals(selected.condition) || !before.condition.equals(after.condition)
                || !Objects.equals(before.description, after.description)) throw CloudJson.failure();
        Map<String, Object> value = before.description == null || before.description.isEmpty() ? null
                : CloudPublicationRecord.decodeDescription(before.description, destination.streamId, id);
        http.requireCurrent();
        return new Record(before, value);
    }
    private Record refreshRecord(int slot, Record checked) throws IOException {
        CloudProviderReads.Metadata latest = raw.readMetadata(destination.slots[slot]);
        http.requireCurrent();
        if (!destination.slots[slot].equals(latest.file.id) || !destination.name(slot).equals(latest.file.name)
                || latest.file.size != SEED.length || !CloudProviderHttp.strongTag(latest.condition)) throw CloudJson.failure();
        if (!checked.metadata.condition.equals(latest.condition)
                || !Objects.equals(checked.metadata.description, latest.description)) return record(slot);
        return checked;
    }
    private void ownedPointer(Map<String, Object> record, Map<String, Object> state, int slot, boolean pending) throws IOException {
        Object pointer = record == null ? null : record.get("publication");
        Object prior = CloudJson.array(state.get("snapshots")).get(slot);
        if (pointer == null) {
            if (prior != null) throw CloudJson.failure();
            return;
        }
        if (prior != null) {
            Map<String, Object> acknowledged = CloudJson.object(prior);
            if (matches(pointer, acknowledged, payload(state, acknowledged.get("id")))) return;
        }
        if (pending && state.get("attempt") != null) {
            Map<String, Object> attempt = CloudJson.object(state.get("attempt")), data = payload(state, attempt.get("id"));
            if (CloudJson.integer(attempt.get("slot")) == slot && Boolean.TRUE.equals(data.get("terminal"))
                    && Boolean.TRUE.equals(data.get("retired")) && matches(pointer, attempt, data)) return;
        }
        throw CloudJson.failure();
    }
    private CloudProviderReads.Selected complete(int slot) throws Exception {
        CloudProviderReads.Selected selected = reads.readConditionalFile(destination.slots[slot]);
        if (selected.publication == null) throw CloudJson.failure();
        CloudPublicationRecord.requireSnapshot(selected.publication, codec.decode(selected.bytes));
        http.requireCurrent();
        return selected;
    }
    private void retire(Map<String, Object> data) throws IOException {
        if (!Boolean.TRUE.equals(data.get("terminal")) || Boolean.TRUE.equals(data.get("retired"))) return;
        Map<String, Object> proof = ledger.terminal(CloudJson.string(data.get("attemptId")));
        if (proof == null) throw CloudJson.failure();
        sessions.retire(destination.streamId, CloudJson.string(data.get("name")),
                CloudJson.object(proof.get("attempt")), CloudJson.string(data.get("session")));
        http.requireCurrent();
        ledger.payloadSessionRetired(CloudJson.string(data.get("attemptId")), CloudJson.string(data.get("session")));
    }
    private long remaining() throws IOException {
        CloudJournal.Head head = ledger.inspect();
        return CloudJournal.LIMIT - (head.sequence - head.base);
    }

    Map<String, Object> cleanup() throws Exception {
        return cleanup(null);
    }
    private Map<String, Object> cleanup(Record[] checked) throws Exception {
        Map<String, Object> state = state();
        if (state.get("attempt") != null && !CloudLedger.terminal(CloudJson.object(state.get("attempt")))) throw CloudJson.failure();
        boolean pendingCleanup = false;
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            if (CloudJson.object(entry).get("cleanup") != null) pendingCleanup = true;
        }
        if (!pendingCleanup && remaining() < CloudPublicationLedger.RESERVE) {
            ledger.compact(sessions);
            state = state();
        }
        root();
        for (int slot = 0; slot < 2; slot++) {
            Record selected = record(slot);
            ownedPointer(selected.value, state, slot, false);
            if (checked != null) checked[slot] = selected;
        }
        int removed = 0;
        for (Object entry : CloudJson.array(state.get("payloads"))) {
            Map<String, Object> candidate = CloudJson.object(entry);
            if (referenced(state, candidate.get("attemptId")) || !Boolean.TRUE.equals(candidate.get("terminal"))) continue;
            retire(candidate);
            Map<String, Object> data = ledger.payload(CloudJson.string(candidate.get("attemptId")));
            String id = CloudJson.string(data.get("id"));
            CloudProviderReads.Selected selected;
            try { selected = raw.readConditionalFile(id); }
            catch (CloudProviderHttp.Failure error) {
                if (error.status != 404 || data.get("cleanup") == null) throw error;
                root();
                boolean missing = false;
                try {
                    Map<String, Object> present = CloudRemote.metadata(http.request(CloudRemote.request(
                            "/v1.0/me/drive/items/" + CloudRemote.id(id) + "?$select=id", "GET", null, null)));
                    if (!id.equals(present.get("id"))) throw CloudJson.failure();
                } catch (CloudProviderHttp.Failure probe) {
                    if (probe.status != 404 || probe.outcome != CloudProviderHttp.Outcome.READ_ONLY) throw probe;
                    missing = true;
                }
                if (!missing) throw error;
                ledger.finishCleanup(CloudJson.string(data.get("attemptId")));
                removed++;
                continue;
            }
            if (!id.equals(selected.file.id) || !data.get("name").equals(selected.file.name)
                    || selected.bytes.length != CloudJson.integer(data.get("byteLength"))
                    || !selected.digest.equals(data.get("digest")) || data.get("cleanup") != null
                        && !data.get("cleanup").equals(selected.condition)) throw CloudJson.failure();
            if (data.get("cleanup") == null) ledger.beginCleanup(CloudJson.string(data.get("attemptId")), selected.condition);
            CloudProviderHttp.Response deleted = http.request(CloudRemote.request(
                    "/v1.0/me/drive/items/" + CloudRemote.id(id), "DELETE", null, selected.condition));
            if (deleted.status != 204 || deleted.bytes.length != 0) throw CloudJson.failure();
            ledger.finishCleanup(CloudJson.string(data.get("attemptId")));
            removed++;
            state = state();
        }
        return CloudJson.map("removed", removed);
    }

    private CloudLedger.Proof verify(Map<String, Object> attempt) throws Exception {
        int slot = (int) CloudJson.integer(attempt.get("slot"));
        Map<String, Object> state = state(), data = payload(state, attempt.get("id"));
        Record remote = record(slot);
        ownedPointer(remote.value, state, slot, true);
        if ("published".equals(attempt.get("step"))) {
            if (!remote.metadata.condition.equals(attempt.get("publicationTag")) || remote.value == null
                    || !attempt.get("id").equals(remote.value.get("nonce")) || !matches(remote.value.get("publication"), attempt, data)) throw CloudJson.failure();
        } else {
            Map<String, Object> fence = CloudJson.object(attempt.get("fence"));
            if (!"fenced".equals(attempt.get("step")) || !remote.metadata.condition.equals(fence.get("tag"))
                    || !Objects.equals(remote.text, fence.get("text"))) throw CloudJson.failure();
        }
        boolean completed = remote.value != null && matches(remote.value.get("publication"), attempt, data);
        if (remote.value != null && remote.value.get("publication") != null) {
            CloudProviderReads.Selected selected = complete(slot);
            if (!selected.condition.equals(remote.metadata.condition)
                    || !CloudPublicationRecord.encode(selected.publication).equals(remote.text)
                    || completed && (!selected.digest.equals(attempt.get("digest"))
                        || selected.bytes.length != CloudJson.integer(attempt.get("byteLength")))) throw CloudJson.failure();
        }
        return new CloudLedger.Proof(CloudJson.string(attempt.get("id")), CloudJson.integer(attempt.get("generation")),
                CloudJson.string(attempt.get("digest")), destination.slots[slot], completed, true, completed);
    }

    Map<String, Object> reconcile() throws Exception {
        Map<String, Object> state = state();
        if (state.get("attempt") == null || CloudLedger.terminal(CloudJson.object(state.get("attempt")))) return state;
        Map<String, Object> pending = CloudJson.object(state.get("attempt"));
        String id = CloudJson.string(pending.get("id"));
        if ("prepared".equals(pending.get("phase"))) return ledger.phase(id, "failed");
        root();
        retire(payload(state, id));
        state = state();
        int slot = (int) CloudJson.integer(pending.get("slot"));
        Record remote = record(slot);
        ownedPointer(remote.value, state, slot, true);
        String text = CloudPublicationRecord.encode(CloudJson.map("streamId", destination.streamId, "slotId", destination.slots[slot],
                "nonce", CloudJson.random(), "publication", remote.value == null ? null : remote.value.get("publication")));
        ledger.beginFence(id, text, remote.metadata.condition);
        try {
            Map<String, Object> fenced = CloudRemote.metadata(http.request(CloudRemote.request(
                    "/v1.0/me/drive/items/" + CloudRemote.id(destination.slots[slot]) + "?$select=id,eTag",
                    "PATCH", CloudJson.bytes(CloudJson.map("description", text)), remote.metadata.condition)));
            if (!destination.slots[slot].equals(fenced.get("id"))) throw CloudJson.failure();
            ledger.fenceAcknowledged(id, CloudJson.string(fenced.get("eTag")));
            return ledger.settle(id, this::verify);
        } catch (Exception error) {
            Map<String, Object> observed = CloudJson.object(ledger.inspect().state.get("attempt"));
            if (id.equals(observed.get("id")) && "in-flight".equals(observed.get("phase"))) ledger.phase(id, "unknown");
            throw error;
        }
    }

    Map<String, Object> write(Map<String, Object> components, String label, long epoch) throws Exception {
        if (epoch < 1 || label == null || label.trim().isEmpty() || label.length() > 200) throw CloudJson.failure();
        Map<String, Object> copy = CloudJson.object(CloudJson.copy(components));
        Record[] checked = new Record[2];
        cleanup(checked);
        if (remaining() < CloudPublicationLedger.RESERVE) ledger.compact(sessions);
        CloudJournal.Head head = ledger.inspect();
        Map<String, Object> before = head.state;
        if (before.get("attempt") != null && !CloudLedger.terminal(CloudJson.object(before.get("attempt")))) throw CloudJson.failure();
        String[] conditions = new String[2];
        List<Object> snapshots = CloudJson.array(before.get("snapshots"));
        for (int slot = 0; slot < 2; slot++) {
            Record selected = refreshRecord(slot, checked[slot]);
            ownedPointer(selected.value, before, slot, false);
            if (snapshots.get(slot) != null) {
                CloudProviderReads.Selected validated = complete(slot);
                if (!validated.digest.equals(CloudJson.object(snapshots.get(slot)).get("digest"))
                        || !validated.condition.equals(selected.metadata.condition)) throw CloudJson.failure();
            }
            conditions[slot] = selected.metadata.condition;
        }
        int slot = CloudLedger.slot(before);
        String id = CloudJson.random();
        Map<String, Object> capture = CloudEnvelope.metadata(destination.streamId, destination.slots[slot], id,
                CloudJson.integer(before.get("maxGeneration")) + 1, label);
        CloudEnvelope candidate = codec.encode(copy, capture);
        for (String key : capture.keySet()) if (!CloudJson.canonical(capture.get(key)).equals(CloudJson.canonical(candidate.snapshot.get(key)))) throw CloudJson.failure();
        if (!CloudJson.canonical(copy).equals(CloudJson.canonical(candidate.snapshot.get("components")))) throw CloudJson.failure();
        http.requireCurrent();
        Map<String, Object> prepared = ledger.prepare(head.sequence, id, candidate.byteDigest, candidate.contentDigest,
                candidate.bytes.length, epoch, conditions[slot]);
        Map<String, Object> attempt = CloudJson.object(prepared.get("attempt"));
        candidate.matches(destination, attempt);
        ledger.phase(id, "in-flight");
        try {
            String name = CloudPublicationRecord.payloadName(destination.streamId, id);
            for (CloudProviderReads.File file : raw.listFiles()) if (name.equals(file.name)) throw CloudJson.failure();
            Map<String, Object> begun = CloudRemote.metadata(http.request(CloudRemote.request(
                    "/v1.0/me/drive/items/" + CloudRemote.id(destination.rootId) + ":/" + name
                            + ":/createUploadSession?@microsoft.graph.conflictBehavior=fail", "POST", null, null)));
            String target = http.uploadSession(CloudJson.string(begun.get("uploadUrl")));
            String reference = sessions.save(destination.streamId, attempt, name, target);
            http.requireCurrent();
            ledger.session(id, reference);
            ledger.dispatchPayload(id);
            Map<String, Object> created = CloudRemote.metadata(http.request(new CloudProviderHttp.Request(
                    CloudProviderHttp.Kind.SESSION, target, "PUT", candidate.bytes,
                    "bytes 0-" + (candidate.bytes.length - 1) + "/" + candidate.bytes.length, null, null, 1024 * 1024)));
            String payloadId = CloudJson.string(created.get("id"));
            Map<String, Object> parent = CloudJson.object(created.get("parentReference"));
            if (!CloudJson.id(payloadId) || !name.equals(created.get("name")) || CloudJson.integer(created.get("size")) != candidate.bytes.length
                    || !destination.rootId.equals(parent.get("id")) || !destination.driveId.equals(parent.get("driveId"))) throw CloudJson.failure();
            ledger.payloadAcknowledged(id, payloadId);
            CloudProviderReads.Selected selected = raw.readFile(payloadId);
            if (!name.equals(selected.file.name) || !Arrays.equals(selected.bytes, candidate.bytes)) throw CloudJson.failure();
            retire(ledger.payload(id));
            String text = CloudPublicationRecord.encode(CloudJson.map("streamId", destination.streamId, "slotId", destination.slots[slot],
                    "nonce", id, "publication", CloudJson.map("attemptId", id, "generation", attempt.get("generation"),
                            "payloadId", payloadId, "byteLength", candidate.bytes.length, "digest", candidate.byteDigest)));
            ledger.dispatchPublication(id);
            Map<String, Object> published = CloudRemote.metadata(http.request(CloudRemote.request(
                    "/v1.0/me/drive/items/" + CloudRemote.id(destination.slots[slot]) + "?$select=id,eTag",
                    "PATCH", CloudJson.bytes(CloudJson.map("description", text)), conditions[slot])));
            if (!destination.slots[slot].equals(published.get("id"))) throw CloudJson.failure();
            ledger.publicationAcknowledged(id, CloudJson.string(published.get("eTag")));
            return ledger.settle(id, this::verify);
        } catch (Exception error) {
            Map<String, Object> observed = CloudJson.object(ledger.inspect().state.get("attempt"));
            if (id.equals(observed.get("id")) && "in-flight".equals(observed.get("phase"))) ledger.phase(id, "unknown");
            throw error;
        }
    }
}
