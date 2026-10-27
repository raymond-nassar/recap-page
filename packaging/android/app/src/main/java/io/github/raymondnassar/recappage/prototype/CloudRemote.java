package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class CloudRemote {
    static final Pattern NAME = Pattern.compile("recap-backup-([a-f0-9]{64})-([01])\\.json");
    final CloudProviderHttp http;
    final CloudProviderReads reads;
    final CloudEnvelope.Codec codec;
    final CloudPublicationReads publication;
    CloudRemote(CloudProviderHttp http, CloudProviderReads reads, CloudEnvelope.Codec codec) {
        this.http = http; this.reads = reads; this.codec = codec;
        publication = http.provider() == CloudProviderHttp.Provider.MICROSOFT ? new CloudPublicationReads(reads, http) : null;
    }
    private CloudProviderReads.Selected read(String id) throws IOException { return publication == null ? reads.readFile(id) : publication.readFile(id); }
    static String id(String value) throws IOException {
        if (!CloudJson.id(value)) throw CloudJson.failure();
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("%21", "!");
    }
    static CloudProviderHttp.Request request(String target, String method, byte[] body, String condition) {
        return new CloudProviderHttp.Request(CloudProviderHttp.Kind.API, target, method, body, null, null, condition, 1024 * 1024);
    }
    static Map<String, Object> metadata(CloudProviderHttp.Response value) throws IOException {
        if (value.status != 200 && value.status != 201) throw CloudJson.failure();
        return CloudJson.object(CloudJson.parse(value.bytes, 1024 * 1024));
    }
    Map<String, Object> discover() throws Exception { return discover(null); }

    Map<String, Object> discover(String selectedStream) throws Exception {
        if (selectedStream != null && !CloudJson.hex(selectedStream)) throw CloudJson.failure();
        List<CloudProviderReads.File> files = publication == null ? reads.listFiles() : publication.listFiles(selectedStream);
        Map<String, List<Map<String, Object>>> groups = new java.util.TreeMap<>();
        java.util.Set<String> invalid = new java.util.HashSet<>();
        java.util.Set<String> positions = new java.util.HashSet<>();
        List<Object> rejected = new ArrayList<>();
        long bytes = 0;
        int count = 0;
        for (CloudProviderReads.File file : files) {
            Matcher match = NAME.matcher(file.name);
            if (!match.matches()) continue;
            if (selectedStream != null && !selectedStream.equals(match.group(1))) continue;
            if (++count > 128 || file.size < 1 || file.size > CloudJson.MAX_BYTES || (bytes += file.size) > 64L * 1024 * 1024) throw CloudJson.failure();
            String stream = match.group(1);
            if (!positions.add(stream + ":" + match.group(2))) invalid.add(stream);
            CloudProviderReads.Selected selected = publication == null ? reads.readFile(file.id) : publication.readFile(file);
            if (!selected.file.name.equals(file.name) || selected.bytes.length != file.size) throw CloudJson.failure();
            if (Arrays.equals(selected.bytes, CloudAllocation.SEED.getBytes(StandardCharsets.UTF_8))
                    || Arrays.equals(selected.bytes, CloudPublicationRecord.SEED.getBytes(StandardCharsets.UTF_8))) continue;
            try {
                CloudEnvelope envelope = codec.decode(selected.bytes);
                if (selected.publication != null) {
                    try { CloudPublicationRecord.requireSnapshot(selected.publication, envelope); }
                    catch (IOException error) { throw new CloudEnvelope.Rejected(); }
                }
                if (!stream.equals(envelope.snapshot.get("streamId")) || !file.id.equals(envelope.snapshot.get("slotId"))) throw CloudJson.failure();
                groups.computeIfAbsent(stream, (key) -> new ArrayList<>()).add(envelope.summary(file));
            } catch (CloudEnvelope.Rejected error) {
                http.requireCurrent();
                invalid.add(stream);
                rejected.add(CloudJson.map("id", file.id, "reason", "invalid-snapshot"));
            }
        }
        List<Object> streams = new ArrayList<>();
        for (Map.Entry<String, List<Map<String, Object>>> entry : groups.entrySet()) {
            List<Map<String, Object>> slots = entry.getValue();
            slots.sort(Comparator.comparingLong((Map<String, Object> value) -> ((Number) value.get("generation")).longValue()).reversed());
            if (slots.size() > 2 || slots.size() == 2 && (slots.get(0).get("generation").equals(slots.get(1).get("generation"))
                    || slots.get(0).get("attemptId").equals(slots.get(1).get("attemptId")))) invalid.add(entry.getKey());
            if (invalid.contains(entry.getKey())) for (Map<String, Object> file : slots) rejected.add(CloudJson.map("id", file.get("id"), "reason", "ambiguous-stream"));
            else streams.add(CloudJson.map("streamId", entry.getKey(), "current", slots.get(0), "previous", slots.size() == 2 ? slots.get(1) : null));
        }
        http.requireCurrent();
        return CloudJson.map("streams", streams, "rejected", rejected);
    }
    CloudEnvelope selected(String stream, Map<String, Object> selection) throws Exception {
        if (!CloudJson.hex(stream) || !CloudJson.id(selection.get("id"))) throw CloudJson.failure();
        CloudProviderReads.Selected selected = read(CloudJson.string(selection.get("id")));
        if (!selected.file.name.equals(selection.get("name")) || selected.bytes.length != CloudJson.integer(selection.get("size"))
                || !selected.digest.equals(selection.get("digest"))) throw CloudJson.failure();
        CloudEnvelope envelope = codec.decode(selected.bytes);
        if (selected.publication != null) CloudPublicationRecord.requireSnapshot(selected.publication, envelope);
        if (!stream.equals(envelope.snapshot.get("streamId")) || !selected.file.id.equals(envelope.snapshot.get("slotId"))
                || !selection.get("attemptId").equals(envelope.snapshot.get("attemptId"))
                || CloudJson.integer(selection.get("generation")) != CloudJson.integer(envelope.snapshot.get("generation"))) throw CloudJson.failure();
        http.requireCurrent();
        return envelope;
    }
    Map<String, Object> write(CloudOwnership.Destination destination, CloudLedger ledger, CloudSessions sessions,
            Map<String, Object> components, String label, long epoch) throws Exception {
        Map<String, Object> copy = CloudJson.object(CloudJson.copy(components));
        http.requireCurrent();
        CloudJournal.Head previous = ledger.inspect();
        if (previous.state.get("attempt") != null && !CloudLedger.terminal(CloudJson.object(previous.state.get("attempt")))) throw CloudJson.failure();
        List<CloudProviderReads.File> files = reads.listFiles();
        List<Object> committed = CloudJson.array(previous.state.get("snapshots"));
        String[] conditions = new String[2];
        for (int slot = 0; slot < 2; slot++) {
            final int index = slot;
            long matches = files.stream().filter((file) -> file.id.equals(destination.slots[index])
                    || file.name.equals(destination.name(index))).count();
            boolean google = destination.binding.provider == CloudProviderHttp.Provider.GOOGLE;
            if (matches != (google && committed.get(slot) == null ? 0 : 1)) throw CloudJson.failure();
            if (matches == 1) {
                CloudProviderReads.Selected read = google ? reads.readFile(destination.slots[slot]) : reads.readConditionalFile(destination.slots[slot]);
                if (!read.file.name.equals(destination.name(slot)) || !read.digest.equals(committed.get(slot) == null
                        ? CloudOwnership.hash(CloudAllocation.SEED) : CloudJson.object(committed.get(slot)).get("digest"))) throw CloudJson.failure();
                conditions[slot] = read.condition;
            }
        }
        int slot = CloudLedger.slot(previous.state);
        String attemptId = CloudJson.random();
        long generation = CloudJson.integer(previous.state.get("maxGeneration")) + 1;
        Map<String, Object> capture = CloudEnvelope.metadata(destination.streamId, destination.slots[slot], attemptId, generation, label);
        CloudEnvelope candidate = codec.encode(copy, capture);
        for (String key : capture.keySet()) if (!CloudJson.canonical(capture.get(key)).equals(CloudJson.canonical(candidate.snapshot.get(key)))) throw CloudJson.failure();
        if (!CloudJson.canonical(copy).equals(CloudJson.canonical(candidate.snapshot.get("components")))) throw CloudJson.failure();
        http.requireCurrent();
        Map<String, Object> prepared = ledger.prepare(previous.sequence, attemptId, candidate.byteDigest, candidate.contentDigest,
                candidate.bytes.length, epoch, conditions[slot]);
        Map<String, Object> attempt = CloudJson.object(prepared.get("attempt"));
        candidate.matches(destination, attempt);
        http.requireCurrent();
        ledger.phase(attemptId, "in-flight");
        try {
            if (destination.binding.provider == CloudProviderHttp.Provider.GOOGLE) {
                boolean update = committed.get(slot) != null;
                String target = update ? "/upload/drive/v3/files/" + id(destination.slots[slot]) + "?uploadType=resumable&fields=id,size"
                        : "/upload/drive/v3/files?uploadType=resumable&fields=id,size";
                byte[] metadata = CloudJson.bytes(update ? CloudJson.map() : CloudJson.map("id", destination.slots[slot],
                        "name", destination.name(slot), "parents", Arrays.asList("appDataFolder"), "mimeType", "application/json"));
                CloudProviderHttp.Response started = http.request(new CloudProviderHttp.Request(CloudProviderHttp.Kind.API,
                        target, update ? "PATCH" : "POST", metadata, null, candidate.bytes.length, null, 1024 * 1024));
                if (started.status != 200) throw CloudJson.failure();
                String session = http.uploadSession(started.location);
                String reference = sessions.save(destination.streamId, attempt, destination.slots[slot], session);
                ledger.session(attemptId, reference);
                CloudProviderHttp.Response uploaded = http.request(new CloudProviderHttp.Request(CloudProviderHttp.Kind.SESSION,
                        session, "PUT", candidate.bytes, "bytes 0-" + (candidate.bytes.length - 1) + "/" + candidate.bytes.length, null, null, 1024 * 1024));
                if (uploaded.status != 200 && uploaded.status != 201) throw CloudJson.failure();
            } else {
                CloudProviderHttp.Response uploaded = http.request(request("/v1.0/me/drive/items/" + id(destination.slots[slot]) + "/content",
                        "PUT", candidate.bytes, conditions[slot]));
                if (uploaded.status != 200 && uploaded.status != 201) throw CloudJson.failure();
            }
            return ledger.settle(attemptId, (pending) -> verify(destination, sessions, pending));
        } catch (Exception error) {
            Map<String, Object> state = ledger.inspect().state;
            Map<String, Object> pending = CloudJson.object(state.get("attempt"));
            if (attemptId.equals(pending.get("id")) && "in-flight".equals(pending.get("phase"))) ledger.phase(attemptId, "unknown");
            throw error;
        }
    }
    CloudLedger.Proof verify(CloudOwnership.Destination destination, CloudSessions sessions, Map<String, Object> attempt) throws Exception {
        http.requireCurrent();
        int slot = (int) CloudJson.integer(attempt.get("slot"));
        String slotId = destination.slots[slot];
        String attemptId = CloudJson.string(attempt.get("id"));
        if (!Arrays.asList("in-flight", "unknown").contains(attempt.get("phase"))) throw CloudJson.failure();
        CloudProviderReads.Selected selected;
        if (destination.binding.provider == CloudProviderHttp.Provider.GOOGLE) {
            String target = sessions.load(destination.streamId, attempt, slotId, CloudJson.string(attempt.get("session")));
            long length = CloudJson.integer(attempt.get("byteLength"));
            Map<String, Object> completed = metadata(http.request(new CloudProviderHttp.Request(CloudProviderHttp.Kind.SESSION,
                    target, "PUT", new byte[0], "bytes */" + length, null, null, 1024 * 1024)));
            if (!slotId.equals(completed.get("id")) || !String.valueOf(length).equals(completed.get("size"))) throw CloudJson.failure();
            selected = reads.readFile(slotId);
            if (selected.bytes.length != length || !selected.digest.equals(attempt.get("digest"))) throw CloudJson.failure();
        } else {
            if (attempt.get("session") != null || !CloudProviderHttp.strongTag(CloudJson.string(attempt.get("condition")))) throw CloudJson.failure();
            selected = reads.readConditionalFile(slotId);
            if (attempt.get("condition").equals(selected.condition)) {
                try {
                    http.request(request("/v1.0/me/drive/items/" + id(slotId) + "?$select=id,eTag", "PATCH",
                            CloudJson.bytes(CloudJson.map("description", "Recap backup conditional fence " + attemptId)),
                            CloudJson.string(attempt.get("condition"))));
                } catch (CloudProviderHttp.Failure error) {
                    // A refused/lost fence response still requires a fresh changed tag; it is not terminal evidence.
                }
                selected = reads.readConditionalFile(slotId);
            }
            if (attempt.get("condition").equals(selected.condition)) throw CloudJson.failure();
        }
        http.requireCurrent();
        boolean exact = selected.digest.equals(attempt.get("digest"));
        return new CloudLedger.Proof(attemptId, CloudJson.integer(attempt.get("generation")), CloudJson.string(attempt.get("digest")),
                slotId, exact, true, exact);
    }
    Map<String, Object> acknowledge(CloudOwnership.Destination destination, Map<String, Object> state, long epoch) throws Exception {
        Map<String, Object> attempt = CloudJson.object(state.get("attempt"));
        if (!"acknowledged".equals(attempt.get("phase"))) throw CloudJson.failure();
        CloudProviderReads.Selected selected = read(destination.slots[(int) CloudJson.integer(attempt.get("slot"))]);
        CloudEnvelope envelope = codec.decode(selected.bytes);
        if (selected.publication != null) CloudPublicationRecord.requireSnapshot(selected.publication, envelope);
        envelope.matches(destination, attempt);
        http.requireCurrent();
        return envelope.acknowledgement(epoch, attempt);
    }
}
