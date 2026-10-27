package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

final class CloudAllocation {
    static final String SEED = "{\"format\":\"recap-page-reserved-cloud-slot\",\"version\":1}";
    final CloudJournal journal;
    final CloudOwnership.Binding binding;
    final String rootId;
    final String driveId;
    private final Path base;
    private final CloudProviderHttp http;
    private final CloudProviderReads reads;
    private final CloudSessions sessions;
    private final String protocol;
    private final String seed;
    CloudAllocation(Path base, CloudOwnership.Binding binding, CloudProviderReads.Root root,
            CloudProviderHttp http, CloudProviderReads reads, CloudSessions sessions) throws IOException {
        this(base, binding, root, http, reads, sessions, null);
    }
    CloudAllocation(Path base, CloudOwnership.Binding binding, CloudProviderReads.Root root,
            CloudProviderHttp http, CloudProviderReads reads, CloudSessions sessions, String protocol) throws IOException {
        if (protocol != null && (binding.provider != CloudProviderHttp.Provider.MICROSOFT
                || !CloudPublicationRecord.PROTOCOL.equals(protocol))) throw CloudJson.failure();
        this.base = base; this.binding = binding; this.rootId = root.id; this.driveId = root.driveId;
        this.http = http; this.reads = reads; this.sessions = sessions;
        this.protocol = protocol;
        seed = protocol == null ? SEED : CloudPublicationRecord.SEED;
        Map<String, Object> identity = binding.identity();
        identity.putAll(CloudJson.map("appRootId", rootId, "driveId", driveId));
        if (protocol != null) identity.put("protocol", protocol);
        Map<String, Object> initial = CloudJson.map("binding", identity, "streamId", CloudJson.random(),
                "slots", new ArrayList<>(Arrays.asList(null, null)), "step", null);
        journal = new CloudJournal(binding.path(base, namespace(protocol)),
                protocol == null ? "recap-cloud-allocation" : "recap-cloud-publication-allocation", initial, (state) -> {
            if (!CloudJson.exact(state, "binding", "streamId", "slots", "step") || !CloudJson.hex(state.get("streamId"))
                    || !CloudJson.canonical(identity).equals(CloudJson.canonical(state.get("binding")))) throw CloudJson.failure();
            List<Object> slots = CloudJson.array(state.get("slots"));
            if (slots.size() != 2 || slots.stream().anyMatch((id) -> id != null && !CloudJson.id(id))
                    || slots.get(0) != null && slots.get(0).equals(slots.get(1))) throw CloudJson.failure();
            if (state.get("step") != null) {
                Map<String, Object> step = CloudJson.object(state.get("step"));
                if (!CloudJson.exact(step, "id", "generation", "digest", "contentDigest", "byteLength", "epoch", "slot", "phase", "session", "condition")
                        || !CloudJson.hex(step.get("id")) || !CloudOwnership.hash(seed).equals(step.get("digest"))
                        || !CloudOwnership.hash(seed).equals(step.get("contentDigest")) || CloudJson.integer(step.get("byteLength")) != seed.length()
                        || CloudJson.integer(step.get("generation")) != CloudJson.integer(step.get("slot")) + 1
                        || step.get("condition") != null || CloudJson.integer(step.get("epoch")) < 1
                        || CloudJson.integer(step.get("slot")) > 1 || !Arrays.asList("in-flight", "acknowledged").contains(step.get("phase"))
                        || step.get("session") != null && !CloudJson.hex(step.get("session"))) throw CloudJson.failure();
            }
        }, (a, b) -> {
            if (a == null) {
                if (b.get("step") != null || CloudJson.array(b.get("slots")).stream().anyMatch((id) -> id != null)) throw CloudJson.failure();
                return;
            }
            if (!a.get("streamId").equals(b.get("streamId"))) throw CloudJson.failure();
            List<Object> before = CloudJson.array(a.get("slots"));
            List<Object> after = CloudJson.array(b.get("slots"));
            for (int i = 0; i < 2; i++) if (before.get(i) != null && !before.get(i).equals(after.get(i))) throw CloudJson.failure();
            if (binding.provider == CloudProviderHttp.Provider.GOOGLE) {
                if (a.get("step") != null || b.get("step") != null || before.stream().anyMatch((id) -> id != null)
                        || after.stream().anyMatch((id) -> !CloudJson.id(id))) throw CloudJson.failure();
                return;
            }
            Map<String, Object> next = CloudJson.object(b.get("step"));
            Map<String, Object> prior = a.get("step") == null ? null : CloudJson.object(a.get("step"));
            if (prior == null || "acknowledged".equals(prior.get("phase"))) {
                if (!"in-flight".equals(next.get("phase")) || next.get("session") != null
                        || CloudJson.integer(next.get("slot")) != before.indexOf(null)
                        || !CloudJson.canonical(before).equals(CloudJson.canonical(after))) throw CloudJson.failure();
            } else {
                Map<String, Object> expected = CloudJson.object(CloudJson.copy(prior));
                expected.put("phase", next.get("phase"));
                expected.put("session", next.get("session"));
                if (!CloudJson.canonical(expected).equals(CloudJson.canonical(next))
                        || prior.get("session") != null && !prior.get("session").equals(next.get("session"))) throw CloudJson.failure();
                int slot = (int) CloudJson.integer(next.get("slot"));
                if ("acknowledged".equals(next.get("phase"))) {
                    List<Object> expectedSlots = new ArrayList<>(before);
                    expectedSlots.set(slot, after.get(slot));
                    if (!CloudJson.id(after.get(slot)) || !CloudJson.hex(prior.get("session"))
                            || !CloudJson.canonical(expectedSlots).equals(CloudJson.canonical(after))) throw CloudJson.failure();
                } else if (!CloudJson.canonical(before).equals(CloudJson.canonical(after))) throw CloudJson.failure();
            }
        });
    }
    static String namespace(String protocol) { return protocol == null ? "cloud-allocations" : "cloud-publication-allocations"; }
    static CloudProviderReads.Root recordedRoot(Path base, CloudOwnership.Binding binding) throws IOException {
        return recordedRoot(base, binding, null);
    }
    static CloudProviderReads.Root recordedRoot(Path base, CloudOwnership.Binding binding, String protocol) throws IOException {
        if (protocol != null && (binding.provider != CloudProviderHttp.Provider.MICROSOFT
                || !CloudPublicationRecord.PROTOCOL.equals(protocol))) throw CloudJson.failure();
        Map<String, Object> record = CloudJson.object(CloudJson.parse(CloudJournal.read(
                binding.path(base, namespace(protocol)).resolve("0000000000000000.json"), 32768), 32768));
        Map<String, Object> identity = CloudJson.object(CloudJson.object(record.get("state")).get("binding"));
        for (Map.Entry<String, Object> entry : binding.identity().entrySet()) if (!entry.getValue().equals(identity.get(entry.getKey()))) throw CloudJson.failure();
        if (protocol != null && !protocol.equals(identity.get("protocol"))) throw CloudJson.failure();
        String root = CloudJson.string(identity.get("appRootId"));
        String drive = identity.get("driveId") == null ? null : CloudJson.string(identity.get("driveId"));
        if (binding.provider == CloudProviderHttp.Provider.GOOGLE ? !"appDataFolder".equals(root) || drive != null
                : !CloudJson.id(root) || !CloudJson.id(drive)) throw CloudJson.failure();
        return new CloudProviderReads.Root(root, drive);
    }
    private String name(Map<String, Object> state, int slot) { return "recap-backup-" + state.get("streamId") + "-" + slot + ".json"; }
    Map<String, Object> terminal(String id) throws IOException {
        final Map<String, Object> result = new java.util.LinkedHashMap<>();
        journal.scan((state, checkpoint) -> {
            if (state.get("step") != null) {
                Map<String, Object> step = CloudJson.object(state.get("step"));
                if (id.equals(step.get("id")) && CloudLedger.terminal(step)) result.putAll(step);
            }
        });
        if (result.isEmpty()) return null;
        Map<String, Object> state = journal.inspect().state;
        return CloudJson.map("binding", binding.identity(), "streamId", state.get("streamId"),
                "slotId", name(state, (int) CloudJson.integer(result.get("slot"))), "attempt", result);
    }
    private void retire(Map<String, Object> state) throws IOException {
        if (state.get("step") == null) return;
        Map<String, Object> step = CloudJson.object(state.get("step"));
        if ("acknowledged".equals(step.get("phase"))) sessions.retire(CloudJson.string(state.get("streamId")),
                name(state, (int) CloudJson.integer(step.get("slot"))), step, CloudJson.string(step.get("session")));
    }
    CloudOwnership.Destination allocate(long epoch) throws IOException {
        CloudJournal.Head head = journal.inspect();
        if (head.state.get("step") != null && !CloudLedger.terminal(CloudJson.object(head.state.get("step")))) throw CloudJson.failure();
        http.requireCurrent();
        CloudProviderReads.Root root = reads.discoverRoot();
        if (!rootId.equals(root.id) || !java.util.Objects.equals(driveId, root.driveId)) throw CloudJson.failure();
        List<Object> slots = CloudJson.array(head.state.get("slots"));
        if (slots.stream().allMatch(CloudJson::id) && java.nio.file.Files.exists(binding.path(base, CloudOwnership.Destination.namespace(protocol)))) {
            CloudOwnership.Destination prior = CloudOwnership.Destination.load(base, binding, protocol);
            if (!prior.streamId.equals(head.state.get("streamId")) || !Arrays.asList(prior.slots).equals(slots)) throw CloudJson.failure();
            return prior;
        }
        retire(head.state);
        if (binding.provider == CloudProviderHttp.Provider.GOOGLE && slots.contains(null)) {
            Map<String, Object> ids = CloudRemote.metadata(http.request(CloudRemote.request(
                    "/drive/v3/files/generateIds?count=2&space=appDataFolder&type=files", "GET", null, null)));
            List<Object> reserved = CloudJson.array(ids.get("ids"));
            if (reserved.size() != 2 || reserved.stream().anyMatch((id) -> !CloudJson.id(id)) || reserved.get(0).equals(reserved.get(1))) throw CloudJson.failure();
            head = journal.update(head.sequence, (state) -> { state.put("slots", new ArrayList<>(reserved)); return state; });
        }
        while (binding.provider == CloudProviderHttp.Provider.MICROSOFT && CloudJson.array(head.state.get("slots")).contains(null)) {
            int slot = CloudJson.array(head.state.get("slots")).indexOf(null);
            String fileName = name(head.state, slot);
            for (CloudProviderReads.File file : reads.listFiles()) if (fileName.equals(file.name)) throw CloudJson.failure();
            head = journal.update(head.sequence, (state) -> {
                state.put("step", CloudJson.map("id", CloudJson.random(), "generation", slot + 1, "digest", CloudOwnership.hash(seed),
                        "contentDigest", CloudOwnership.hash(seed), "byteLength", seed.length(), "epoch", epoch, "slot", slot,
                        "phase", "in-flight", "session", null, "condition", null));
                return state;
            });
            Map<String, Object> begun = CloudRemote.metadata(http.request(CloudRemote.request(
                    "/v1.0/me/drive/items/" + CloudRemote.id(rootId) + ":/" + fileName
                            + ":/createUploadSession?@microsoft.graph.conflictBehavior=fail", "POST", null, null)));
            String target = http.uploadSession(CloudJson.string(begun.get("uploadUrl")));
            Map<String, Object> attempt = CloudJson.object(head.state.get("step"));
            String stream = CloudJson.string(head.state.get("streamId"));
            String reference = sessions.save(stream, attempt, fileName, target);
            head = journal.update(head.sequence, (state) -> { CloudJson.object(state.get("step")).put("session", reference); return state; });
            byte[] seedBytes = seed.getBytes(StandardCharsets.UTF_8);
            Map<String, Object> created = CloudRemote.metadata(http.request(new CloudProviderHttp.Request(
                    CloudProviderHttp.Kind.SESSION, target, "PUT", seedBytes, "bytes 0-" + (seedBytes.length - 1) + "/" + seedBytes.length, null, null, 1024 * 1024)));
            String id = CloudJson.string(created.get("id"));
            Map<String, Object> parent = CloudJson.object(created.get("parentReference"));
            if (!CloudJson.id(id) || !fileName.equals(created.get("name")) || !rootId.equals(parent.get("id")) || !driveId.equals(parent.get("driveId"))) throw CloudJson.failure();
            CloudProviderReads.Selected selected = reads.readConditionalFile(id);
            if (!fileName.equals(selected.file.name) || !Arrays.equals(seedBytes, selected.bytes)) throw CloudJson.failure();
            head = journal.update(head.sequence, (state) -> {
                CloudJson.array(state.get("slots")).set(slot, id);
                CloudJson.object(state.get("step")).put("phase", "acknowledged");
                return state;
            });
            retire(head.state);
        }
        http.requireCurrent();
        slots = CloudJson.array(head.state.get("slots"));
        CloudOwnership.Destination destination = new CloudOwnership.Destination(binding, CloudJson.string(head.state.get("streamId")),
                rootId, driveId, new String[] { CloudJson.string(slots.get(0)), CloudJson.string(slots.get(1)) }, protocol);
        destination.publish(base);
        return destination;
    }
}
