package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;

final class CloudPublicationReads {
    private static final byte[] SEED = CloudPublicationRecord.SEED.getBytes(StandardCharsets.UTF_8);
    private final CloudProviderReads reads;
    private final CloudProviderHttp http;
    private final Map<CloudProviderReads.File, Record> discovered = new IdentityHashMap<>();

    private static final class Record {
        final CloudProviderReads.Metadata metadata;
        final Map<String, Object> value;
        Record(CloudProviderReads.Metadata metadata, Map<String, Object> value) {
            this.metadata = metadata; this.value = value;
        }
    }

    CloudPublicationReads(CloudProviderReads reads, CloudProviderHttp http) {
        if (reads == null || http == null || http.provider() != CloudProviderHttp.Provider.MICROSOFT) {
            throw new IllegalArgumentException("Native OneDrive publication readers are required.");
        }
        this.reads = reads; this.http = http;
    }

    private Record record(CloudProviderReads.File file) throws IOException {
        Matcher match = CloudRemote.NAME.matcher(file.name);
        if (!match.matches() || file.size != SEED.length) return null;
        CloudProviderReads.Metadata metadata = reads.readMetadata(file.id);
        CloudProviderReads.Selected selected = reads.readConditionalFile(file.id);
        if (!file.id.equals(metadata.file.id) || !file.name.equals(metadata.file.name) || metadata.file.size != SEED.length
                || !file.id.equals(selected.file.id) || !file.name.equals(selected.file.name) || selected.file.size != SEED.length
                || !metadata.condition.equals(selected.condition)) throw CloudJson.failure();
        if (!Arrays.equals(SEED, selected.bytes)) return null;
        Map<String, Object> value = metadata.description == null || metadata.description.isEmpty() ? null
                : CloudPublicationRecord.decodeDescription(metadata.description, match.group(1), file.id);
        return new Record(metadata, value);
    }

    List<CloudProviderReads.File> listFiles() throws IOException { return listFiles(null); }

    List<CloudProviderReads.File> listFiles(String selectedStream) throws IOException {
        http.requireCurrent();
        if (selectedStream != null && !CloudJson.hex(selectedStream)) throw CloudJson.failure();
        discovered.clear();
        List<CloudProviderReads.File> result = new ArrayList<>();
        for (CloudProviderReads.File file : reads.listFiles()) {
            if (selectedStream != null) {
                Matcher match = CloudRemote.NAME.matcher(file.name);
                if (!match.matches() || !selectedStream.equals(match.group(1))) continue;
            }
            Record identified = record(file);
            CloudProviderReads.File logical = file;
            if (identified != null && identified.value != null && identified.value.get("publication") != null) {
                long length = CloudJson.integer(CloudJson.object(identified.value.get("publication")).get("byteLength"));
                logical = new CloudProviderReads.File(file.id, file.name, length, identified.metadata.file.modifiedAt);
            }
            if (identified != null) discovered.put(logical, identified);
            result.add(logical);
        }
        http.requireCurrent();
        return result;
    }

    CloudProviderReads.Selected readFile(String id) throws IOException { return selected(id, false); }
    CloudProviderReads.Selected readConditionalFile(String id) throws IOException { return selected(id, true); }

    private static boolean sameVersion(CloudProviderReads.Metadata before, CloudProviderReads.Metadata after) {
        return before.file.id.equals(after.file.id) && before.file.name.equals(after.file.name) && after.file.size == SEED.length
                && CloudProviderHttp.strongTag(after.condition) && before.condition.equals(after.condition)
                && Objects.equals(before.description, after.description);
    }
    CloudProviderReads.Selected readFile(CloudProviderReads.File file) throws IOException {
        http.requireCurrent();
        Record witness = discovered.remove(file);
        if (witness != null) {
            CloudProviderReads.Metadata metadata = reads.readMetadata(file.id);
            if (sameVersion(witness.metadata, metadata)) {
                return published(new CloudProviderReads.Selected(metadata.file, SEED.clone(), CloudJson.hash(SEED), null), witness, false);
            }
        }
        return selected(file.id, false);
    }
    private CloudProviderReads.Selected selected(String id, boolean conditional) throws IOException {
        http.requireCurrent();
        CloudProviderReads.Selected source = conditional ? reads.readConditionalFile(id) : reads.readFile(id);
        if (!Arrays.equals(source.bytes, SEED)) return source;
        return published(source, record(source.file), conditional);
    }
    private CloudProviderReads.Selected published(CloudProviderReads.Selected source, Record identified, boolean conditional) throws IOException {
        if (identified == null || identified.value == null || identified.value.get("publication") == null) return source;
        Map<String, Object> publication = CloudJson.object(identified.value.get("publication"));
        String payload = CloudJson.string(publication.get("payloadId"));
        CloudProviderReads.Selected selected = reads.readFile(payload);
        if (!payload.equals(selected.file.id) || !selected.file.name.equals(CloudPublicationRecord.payloadName(
                CloudJson.string(identified.value.get("streamId")), CloudJson.string(publication.get("attemptId"))))
                || selected.bytes.length != CloudJson.integer(publication.get("byteLength"))
                || !selected.digest.equals(publication.get("digest"))) throw CloudJson.failure();
        CloudProviderReads.Metadata after = reads.readMetadata(source.file.id);
        if (!source.file.id.equals(after.file.id) || !source.file.name.equals(after.file.name) || after.file.size != SEED.length
                || !identified.metadata.condition.equals(after.condition)
                || !Objects.equals(identified.metadata.description, after.description)) throw CloudJson.failure();
        http.requireCurrent();
        CloudProviderReads.File logical = new CloudProviderReads.File(source.file.id, source.file.name, selected.bytes.length, after.file.modifiedAt);
        return new CloudProviderReads.Selected(logical, selected.bytes.clone(), selected.digest,
                conditional ? after.condition : null, identified.value);
    }
}
