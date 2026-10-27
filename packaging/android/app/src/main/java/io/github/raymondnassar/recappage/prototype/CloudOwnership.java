package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

final class CloudOwnership {
    private CloudOwnership() {}
    static String hash(String value) { return CloudJson.hash(value.getBytes(StandardCharsets.UTF_8)); }
    static String provider(CloudProviderHttp.Provider provider) { return provider == CloudProviderHttp.Provider.GOOGLE ? "google" : "microsoft"; }
    static String installation(Path base) throws IOException {
        Path root = base.resolve("cloud-installation-v1");
        boolean existing = Files.exists(root, LinkOption.NOFOLLOW_LINKS);
        CloudJournal.directory(root);
        Path record = root.resolve("installation.json");
        if (!existing) CloudJournal.exclusive(record, CloudJson.bytes(CloudJson.map("format", "recap-cloud-installation", "version", 1, "profileId", CloudJson.random())));
        Map<String, Object> value = CloudJson.object(CloudJson.parse(CloudJournal.read(record, 1024), 1024));
        if (!CloudJson.exact(value, "format", "version", "profileId") || !"recap-cloud-installation".equals(value.get("format"))
                || CloudJson.integer(value.get("version")) != 1 || !CloudJson.hex(value.get("profileId"))) throw CloudJson.failure();
        return CloudJson.string(value.get("profileId"));
    }
    static final class Binding {
        final String profileId;
        final CloudProviderHttp.Provider provider;
        final String accountId;
        final String clientId;
        final String account;
        final String client;
        Binding(String profileId, CloudProviderHttp.Provider provider, String accountId, String clientId) throws IOException {
            if (!CloudJson.hex(profileId) || provider == null || accountId == null || accountId.isEmpty()
                    || clientId == null || clientId.isEmpty() || accountId.getBytes(StandardCharsets.UTF_8).length > 1024
                    || clientId.getBytes(StandardCharsets.UTF_8).length > 1024) throw CloudJson.failure();
            this.profileId = profileId; this.provider = provider; this.accountId = accountId; this.clientId = clientId;
            account = hash(accountId); client = hash(clientId);
        }
        Map<String, Object> identity() { return CloudJson.map("profileId", profileId, "provider", provider(provider), "account", account, "client", client); }
        Path path(Path base, String kind) { return base.resolve(kind).resolve(profileId).resolve(provider(provider)).resolve(account); }
    }
    static final class Destination {
        final Binding binding;
        final String streamId;
        final String rootId;
        final String driveId;
        final String[] slots;
        final String protocol;
        Destination(Binding binding, String streamId, String rootId, String driveId, String[] slots) throws IOException {
            this(binding, streamId, rootId, driveId, slots, null);
        }
        Destination(Binding binding, String streamId, String rootId, String driveId, String[] slots, String protocol) throws IOException {
            if (!CloudJson.hex(streamId) || slots == null || slots.length != 2 || !CloudJson.id(slots[0])
                    || !CloudJson.id(slots[1]) || slots[0].equals(slots[1])
                    || protocol != null && (binding.provider != CloudProviderHttp.Provider.MICROSOFT || !CloudPublicationRecord.PROTOCOL.equals(protocol))
                    || (binding.provider == CloudProviderHttp.Provider.GOOGLE ? !"appDataFolder".equals(rootId) || driveId != null
                        : !CloudJson.id(rootId) || !CloudJson.id(driveId))) throw CloudJson.failure();
            this.binding = binding; this.streamId = streamId; this.rootId = rootId; this.driveId = driveId; this.slots = slots.clone();
            this.protocol = protocol;
        }
        String name(int slot) { return "recap-backup-" + streamId + "-" + slot + ".json"; }
        static String namespace(String protocol) { return protocol == null ? "cloud-destinations" : "cloud-publication-destinations"; }
        Map<String, Object> data() {
            Map<String, Object> result = CloudJson.map("format", "recap-cloud-destination", "version", protocol == null ? 1 : 2, "binding", binding.identity(),
                    "streamId", streamId, "appRootId", rootId, "driveId", driveId, "fixedSlots", Arrays.asList(slots));
            if (protocol != null) result.put("protocol", protocol);
            return result;
        }
        void publish(Path base) throws IOException {
            Path directory = binding.path(base, namespace(protocol));
            if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
                if (!CloudJson.canonical(load(base, binding, protocol).data()).equals(CloudJson.canonical(data()))) throw CloudJson.failure();
                return;
            }
            CloudJournal.directory(directory.getParent());
            Files.createDirectory(directory);
            CloudJournal.exclusive(directory.resolve("destination.json"), CloudJson.bytes(data()));
            CloudJournal.exclusive(directory.resolve("ready"), ("recap-cloud-destination-v" + (protocol == null ? 1 : 2) + "\n").getBytes(StandardCharsets.UTF_8));
            if (!CloudJson.canonical(load(base, binding, protocol).data()).equals(CloudJson.canonical(data()))) throw CloudJson.failure();
        }
        static Destination load(Path base, Binding binding) throws IOException {
            String protocol = binding.provider == CloudProviderHttp.Provider.MICROSOFT
                    && Files.exists(binding.path(base, namespace(CloudPublicationRecord.PROTOCOL)), LinkOption.NOFOLLOW_LINKS)
                    ? CloudPublicationRecord.PROTOCOL : null;
            return load(base, binding, protocol);
        }
        static Destination load(Path base, Binding binding, String protocol) throws IOException {
            if (protocol != null && (binding.provider != CloudProviderHttp.Provider.MICROSOFT
                    || !CloudPublicationRecord.PROTOCOL.equals(protocol))) throw CloudJson.failure();
            Path root = binding.path(base, namespace(protocol));
            if (Files.isSymbolicLink(root) || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            try (java.util.stream.Stream<Path> files = Files.list(root)) {
                if (files.anyMatch((path) -> !Arrays.asList("ready", "destination.json").contains(path.getFileName().toString()))) throw CloudJson.failure();
            }
            if (!("recap-cloud-destination-v" + (protocol == null ? 1 : 2) + "\n").equals(
                    new String(CloudJournal.read(root.resolve("ready"), 128), StandardCharsets.UTF_8))) throw CloudJson.failure();
            Map<String, Object> value = CloudJson.object(CloudJson.parse(CloudJournal.read(root.resolve("destination.json"), 8192), 8192));
            String[] keys = protocol == null ? new String[] { "format", "version", "binding", "streamId", "appRootId", "driveId", "fixedSlots" }
                    : new String[] { "format", "version", "protocol", "binding", "streamId", "appRootId", "driveId", "fixedSlots" };
            if (!CloudJson.exact(value, keys)
                    || !"recap-cloud-destination".equals(value.get("format")) || CloudJson.integer(value.get("version")) != (protocol == null ? 1 : 2)
                    || protocol != null && !protocol.equals(value.get("protocol"))
                    || !CloudJson.canonical(binding.identity()).equals(CloudJson.canonical(value.get("binding")))) throw CloudJson.failure();
            List<Object> slots = CloudJson.array(value.get("fixedSlots"));
            if (slots.size() != 2) throw CloudJson.failure();
            return new Destination(binding, CloudJson.string(value.get("streamId")), CloudJson.string(value.get("appRootId")),
                    value.get("driveId") == null ? null : CloudJson.string(value.get("driveId")),
                    new String[] { CloudJson.string(slots.get(0)), CloudJson.string(slots.get(1)) }, protocol);
        }
    }
}
