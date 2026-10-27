package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;

final class CloudConnection {
    final CloudJournal journal;
    private final String profile;
    CloudConnection(Path base, String profile) throws IOException {
        this.profile = profile;
        journal = new CloudJournal(base.resolve("cloud-connections").resolve(profile), "recap-cloud-connection", empty(0), (state) -> {
            if (!CloudJson.exact(state, "profileId", "epoch", "phase", "provider", "account", "client", "streamId", "discoveryId", "discoveryDigest", "acknowledgement")
                    || !profile.equals(state.get("profileId")) || !Arrays.asList("disconnected", "connecting", "discovering",
                        "awaiting-choice", "allocating", "active", "disconnecting").contains(state.get("phase"))) throw CloudJson.failure();
            long epoch = CloudJson.integer(state.get("epoch"));
            if ("disconnected".equals(state.get("phase"))) {
                if (!CloudJson.canonical(empty(epoch)).equals(CloudJson.canonical(state))) throw CloudJson.failure();
                return;
            }
            if (epoch < 1 || !Arrays.asList("google", "microsoft").contains(state.get("provider"))) throw CloudJson.failure();
            for (String key : Arrays.asList("account", "client", "streamId", "discoveryId", "discoveryDigest")) {
                if (state.get(key) != null && !CloudJson.hex(state.get(key))) throw CloudJson.failure();
            }
            if (Arrays.asList("discovering", "awaiting-choice", "allocating", "active").contains(state.get("phase"))
                    && (!CloudJson.hex(state.get("account")) || !CloudJson.hex(state.get("client")))) throw CloudJson.failure();
            if ("active".equals(state.get("phase")) && !CloudJson.hex(state.get("streamId"))) throw CloudJson.failure();
            if (Arrays.asList("awaiting-choice", "allocating").contains(state.get("phase"))
                    && (!CloudJson.hex(state.get("discoveryId")) || !CloudJson.hex(state.get("discoveryDigest")))) throw CloudJson.failure();
            if (state.get("acknowledgement") != null) {
                Map<String, Object> ack = CloudJson.object(state.get("acknowledgement"));
                if (!CloudJson.exact(ack, "epoch", "attemptEpoch", "streamId", "attemptId", "generation", "contentDigest", "byteDigest")
                        || !"active".equals(state.get("phase")) || CloudJson.integer(ack.get("epoch")) != epoch
                        || CloudJson.integer(ack.get("attemptEpoch")) < 1 || CloudJson.integer(ack.get("generation")) < 1
                        || !ack.get("streamId").equals(state.get("streamId"))) throw CloudJson.failure();
                for (String key : Arrays.asList("streamId", "attemptId", "contentDigest", "byteDigest")) if (!CloudJson.hex(ack.get(key))) throw CloudJson.failure();
            }
        }, (a, b) -> {
            if (a == null) { if (!CloudJson.canonical(b).equals(CloudJson.canonical(empty(0)))) throw CloudJson.failure(); return; }
            String from = CloudJson.string(a.get("phase"));
            String to = CloudJson.string(b.get("phase"));
            long before = CloudJson.integer(a.get("epoch"));
            long after = CloudJson.integer(b.get("epoch"));
            Map<String, Object> expected = CloudJson.object(CloudJson.copy(a));
            if (from.equals("disconnected") && to.equals("connecting")) {
                expected = empty(before + 1); expected.put("phase", to); expected.put("provider", b.get("provider"));
            } else if (!from.equals("disconnected") && !from.equals("disconnecting") && to.equals("disconnecting")) {
                expected.put("epoch", before + 1); expected.put("phase", to); expected.put("acknowledgement", null);
            } else if (from.equals("disconnecting") && to.equals("disconnected")) expected = empty(before);
            else if (from.equals("connecting") && to.equals("discovering")) {
                expected.put("phase", to); expected.put("account", b.get("account")); expected.put("client", b.get("client"));
            } else if (Arrays.asList("discovering", "awaiting-choice").contains(from) && to.equals("awaiting-choice")) {
                expected.put("phase", to); expected.put("discoveryId", b.get("discoveryId")); expected.put("discoveryDigest", b.get("discoveryDigest"));
            } else if (from.equals("awaiting-choice") && to.equals("allocating")) expected.put("phase", to);
            else if (Arrays.asList("discovering", "allocating").contains(from) && to.equals("active")) {
                expected.put("phase", to); expected.put("streamId", b.get("streamId"));
            } else if (from.equals("active") && to.equals("active")) {
                if (b.get("acknowledgement") == null) throw CloudJson.failure();
                Map<String, Object> ack = CloudJson.object(b.get("acknowledgement"));
                if (a.get("acknowledgement") != null) {
                    Map<String, Object> previous = CloudJson.object(a.get("acknowledgement"));
                    if (CloudJson.integer(ack.get("generation")) < CloudJson.integer(previous.get("generation"))
                            || CloudJson.integer(ack.get("generation")) == CloudJson.integer(previous.get("generation"))
                                && !CloudJson.canonical(ack).equals(CloudJson.canonical(previous))) throw CloudJson.failure();
                }
                expected.put("acknowledgement", ack);
            } else throw CloudJson.failure();
            if (after > CloudJson.MAX_INTEGER || !CloudJson.canonical(expected).equals(CloudJson.canonical(b))) throw CloudJson.failure();
        });
    }
    private Map<String, Object> empty(long epoch) {
        return CloudJson.map("profileId", profile, "epoch", epoch, "phase", "disconnected", "provider", null, "account", null,
                "client", null, "streamId", null, "discoveryId", null, "discoveryDigest", null, "acknowledgement", null);
    }
    // UI admission reads and worker transitions share one owner, not competing journal leases.
    synchronized Map<String, Object> inspect() throws IOException { return journal.inspect().state; }
    synchronized Map<String, Object> change(long epoch, String phases, CloudJournal.Change change) throws IOException {
        CloudJournal.Head head = journal.inspect();
        if (CloudJson.integer(head.state.get("epoch")) != epoch || !Arrays.asList(phases.split(",")).contains(head.state.get("phase"))) throw CloudJson.failure();
        return journal.update(head.sequence, change).state;
    }
    synchronized Map<String, Object> begin(CloudProviderHttp.Provider provider) throws IOException {
        Map<String, Object> prior = inspect();
        return change(CloudJson.integer(prior.get("epoch")), "disconnected", (state) -> {
            state.put("epoch", CloudJson.integer(state.get("epoch")) + 1); state.put("provider", CloudOwnership.provider(provider)); state.put("phase", "connecting"); return state;
        });
    }
    synchronized Map<String, Object> suspend() throws IOException {
        Map<String, Object> prior = inspect();
        if (Arrays.asList("disconnected", "disconnecting").contains(prior.get("phase"))) return prior;
        return change(CloudJson.integer(prior.get("epoch")), "connecting,discovering,awaiting-choice,allocating,active", (state) -> {
            state.put("phase", "disconnecting"); state.put("epoch", CloudJson.integer(state.get("epoch")) + 1); state.put("acknowledgement", null); return state;
        });
    }
    synchronized void disconnected(long epoch) throws IOException { change(epoch, "disconnecting", (state) -> empty(epoch)); }
    synchronized void compact(CloudJournal.Check safe) throws IOException { journal.compact(safe); }
}
