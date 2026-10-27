package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Map;

final class CloudEnvelope {
    static final class Rejected extends IOException {
        Rejected() { super("The shared codec rejected this cloud snapshot."); }
    }
    interface Codec {
        CloudEnvelope encode(Map<String, Object> components, Map<String, Object> capture) throws Exception;
        CloudEnvelope decode(byte[] bytes) throws Exception;
    }
    final byte[] bytes;
    final Map<String, Object> snapshot;
    final String byteDigest;
    final String contentDigest;
    private CloudEnvelope(byte[] bytes, Map<String, Object> snapshot) throws IOException {
        this.bytes = bytes.clone(); this.snapshot = snapshot;
        byteDigest = CloudJson.hash(bytes); contentDigest = CloudJson.string(snapshot.get("contentDigest"));
    }
    // This verifies the native envelope boundary; semantic component validation stays with the shipped shared codec.
    static CloudEnvelope verify(byte[] bytes) throws IOException {
        Map<String, Object> value = CloudJson.object(CloudJson.parse(bytes, CloudJson.MAX_BYTES));
        if (!CloudJson.exact(value, "format", "version", "captureId", "streamId", "slotId", "attemptId", "generation",
                "capturedAt", "label", "contentDigest", "componentDigests", "components")
                || !"recap-page-cloud-backup".equals(value.get("format")) || CloudJson.integer(value.get("version")) != 1
                || !CloudJson.hex(value.get("contentDigest"))) throw CloudJson.failure();
        capture(value);
        Map<String, Object> components = CloudJson.object(value.get("components"));
        Map<String, Object> digests = CloudJson.object(value.get("componentDigests"));
        if (!CloudJson.exact(components, "reader", "history", "settings", "draft")
                || !CloudJson.exact(digests, "reader", "history", "settings", "draft")) throw CloudJson.failure();
        for (String key : Arrays.asList("reader", "history", "settings", "draft")) {
            byte[] part = CloudJson.bytes(components.get(key));
            if (part.length > 8 * 1024 * 1024 || !CloudJson.hash(part).equals(digests.get(key))) throw CloudJson.failure();
        }
        if (!CloudJson.hash(CloudJson.bytes(components)).equals(value.get("contentDigest"))) throw CloudJson.failure();
        return new CloudEnvelope(bytes, value);
    }
    static void capture(Map<String, Object> value) throws IOException {
        for (String key : Arrays.asList("captureId", "streamId", "attemptId")) if (!CloudJson.hex(value.get(key))) throw CloudJson.failure();
        if (!CloudJson.id(value.get("slotId")) || CloudJson.integer(value.get("generation")) < 1) throw CloudJson.failure();
        String label = CloudJson.string(value.get("label"));
        String date = CloudJson.string(value.get("capturedAt"));
        try {
            if (label.trim().isEmpty() || label.length() > 200 || date.length() > 64
                    || !date.equals(now(Instant.parse(date)))) throw CloudJson.failure();
        } catch (RuntimeException error) { throw CloudJson.failure(); }
    }
    static String now(Instant value) {
        return new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()
                .format(value.truncatedTo(ChronoUnit.MILLIS));
    }
    static Map<String, Object> metadata(String streamId, String slotId, String attemptId, long generation, String label) {
        return CloudJson.map("captureId", CloudJson.random(), "streamId", streamId, "slotId", slotId,
                "attemptId", attemptId, "generation", generation, "capturedAt", now(Instant.now()), "label", label);
    }
    void matches(CloudOwnership.Destination destination, Map<String, Object> attempt) throws IOException {
        if (!destination.streamId.equals(snapshot.get("streamId")) || !destination.slots[(int) CloudJson.integer(attempt.get("slot"))].equals(snapshot.get("slotId"))
                || !attempt.get("id").equals(snapshot.get("attemptId")) || CloudJson.integer(attempt.get("generation")) != CloudJson.integer(snapshot.get("generation"))
                || !byteDigest.equals(attempt.get("digest")) || !contentDigest.equals(attempt.get("contentDigest"))
                || bytes.length != CloudJson.integer(attempt.get("byteLength"))) throw CloudJson.failure();
    }
    Map<String, Object> acknowledgement(long epoch, Map<String, Object> attempt) throws IOException {
        return CloudJson.map("epoch", epoch, "attemptEpoch", attempt.get("epoch"), "streamId", snapshot.get("streamId"),
                "attemptId", snapshot.get("attemptId"), "generation", snapshot.get("generation"),
                "contentDigest", contentDigest, "byteDigest", byteDigest);
    }
    Map<String, Object> summary(CloudProviderReads.File file) {
        return CloudJson.map("id", file.id, "name", file.name, "size", file.size, "modifiedAt", file.modifiedAt,
                "generation", snapshot.get("generation"), "attemptId", snapshot.get("attemptId"), "captureId", snapshot.get("captureId"),
                "capturedAt", snapshot.get("capturedAt"), "label", snapshot.get("label"), "contentDigest", contentDigest,
                "digest", byteDigest, "version", 1);
    }
}
