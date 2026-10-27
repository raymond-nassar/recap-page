package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class CloudPublicationRecord {
    static final String PROTOCOL = "microsoft-publication-v1";
    static final String SEED = "{\"format\":\"recap-page-cloud-publication-slot\",\"version\":1}";
    static final int MAX_BYTES = 1024;
    private static final String FORMAT = "recap-ms-publication";
    private static final Pattern DESCRIPTION_ENTITY = Pattern.compile("&quot;|&#([0-9]{1,3});");

    private CloudPublicationRecord() {}

    private static void validate(Map<String, Object> record) throws IOException {
        if (!CloudJson.exact(record, "streamId", "slotId", "nonce", "publication")
                || !CloudJson.hex(record.get("streamId")) || !CloudJson.id(record.get("slotId"))
                || !CloudJson.hex(record.get("nonce"))) throw CloudJson.failure();
        if (record.get("publication") == null) return;
        Map<String, Object> publication = CloudJson.object(record.get("publication"));
        if (!CloudJson.exact(publication, "attemptId", "generation", "payloadId", "byteLength", "digest")
                || !CloudJson.hex(publication.get("attemptId")) || !CloudJson.hex(publication.get("digest"))
                || !CloudJson.id(publication.get("payloadId")) || record.get("slotId").equals(publication.get("payloadId"))
                || CloudJson.integer(publication.get("generation")) < 1
                || CloudJson.integer(publication.get("byteLength")) < 1
                || CloudJson.integer(publication.get("byteLength")) > CloudJson.MAX_BYTES) throw CloudJson.failure();
    }

    static String payloadName(String streamId, String attemptId) throws IOException {
        if (!CloudJson.hex(streamId) || !CloudJson.hex(attemptId)) throw CloudJson.failure();
        return "recap-payload-" + streamId + "-" + attemptId + ".json";
    }

    static String encode(Map<String, Object> record) throws IOException {
        validate(record);
        Object publication = null;
        if (record.get("publication") != null) {
            Map<String, Object> value = CloudJson.object(record.get("publication"));
            publication = CloudJson.map("a", value.get("attemptId"), "g", value.get("generation"),
                    "i", value.get("payloadId"), "z", value.get("byteLength"), "d", value.get("digest"));
        }
        String text = CloudJson.canonical(CloudJson.map("f", FORMAT, "v", 1, "s", record.get("streamId"),
                "r", record.get("slotId"), "n", record.get("nonce"), "p", publication));
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw CloudJson.failure();
        return text;
    }

    static Map<String, Object> decode(String text, String streamId, String slotId) throws IOException {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES
                || !CloudJson.hex(streamId) || !CloudJson.id(slotId)) throw CloudJson.failure();
        Map<String, Object> value = CloudJson.object(CloudJson.parse(text.getBytes(StandardCharsets.UTF_8), MAX_BYTES));
        if (!CloudJson.exact(value, "f", "v", "s", "r", "n", "p") || !FORMAT.equals(value.get("f"))
                || CloudJson.integer(value.get("v")) != 1 || !streamId.equals(value.get("s"))
                || !slotId.equals(value.get("r"))) throw CloudJson.failure();
        Object publication = null;
        if (value.get("p") != null) {
            Map<String, Object> item = CloudJson.object(value.get("p"));
            if (!CloudJson.exact(item, "a", "g", "i", "z", "d")) throw CloudJson.failure();
            publication = CloudJson.map("attemptId", item.get("a"), "generation", item.get("g"),
                    "payloadId", item.get("i"), "byteLength", item.get("z"), "digest", item.get("d"));
        }
        Map<String, Object> record = CloudJson.map("streamId", value.get("s"), "slotId", value.get("r"),
                "nonce", value.get("n"), "publication", publication);
        if (!encode(record).equals(text)) throw CloudJson.failure();
        return record;
    }

    static Map<String, Object> decodeDescription(String text, String streamId, String slotId) throws IOException {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > 6 * MAX_BYTES) throw CloudJson.failure();
        Matcher matcher = DESCRIPTION_ENTITY.matcher(text);
        StringBuffer canonical = new StringBuffer();
        while (matcher.find()) {
            int code = matcher.group(1) == null ? 34 : Integer.parseInt(matcher.group(1));
            if (code < 32 || code > 126) throw CloudJson.failure();
            matcher.appendReplacement(canonical, Matcher.quoteReplacement(String.valueOf((char) code)));
        }
        matcher.appendTail(canonical);
        return decode(canonical.toString(), streamId, slotId);
    }

    static void requireSnapshot(Map<String, Object> record, CloudEnvelope envelope) throws IOException {
        validate(record);
        Map<String, Object> publication = CloudJson.object(record.get("publication"));
        Map<String, Object> snapshot = envelope.snapshot;
        if (CloudJson.integer(snapshot.get("version")) != 1 || !record.get("streamId").equals(snapshot.get("streamId"))
                || !record.get("slotId").equals(snapshot.get("slotId"))
                || !publication.get("attemptId").equals(snapshot.get("attemptId"))
                || CloudJson.integer(publication.get("generation")) != CloudJson.integer(snapshot.get("generation"))
                || CloudJson.integer(publication.get("byteLength")) != envelope.bytes.length
                || !publication.get("digest").equals(envelope.byteDigest)) throw CloudJson.failure();
    }
}
