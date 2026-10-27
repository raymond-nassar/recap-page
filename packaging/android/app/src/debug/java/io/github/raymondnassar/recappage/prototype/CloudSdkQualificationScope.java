package io.github.raymondnassar.recappage.prototype;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.ProtocolException;
import java.net.URL;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.Principal;
import java.security.cert.Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLPeerUnverifiedException;

final class CloudSdkQualificationScope {
    private static final String FORMAT = "recap-cloud-sdk-service-qualification";
    private static final int BODY_LIMIT = 32768;
    private static final int REQUEST_LIMIT = 600;
    private static final Pattern NEW_NAME = Pattern.compile("recap-(backup|payload)-([a-f0-9]{64})-([01]|[a-f0-9]{64})\\.json");
    private final Path root;
    private final Path nativeRoot;
    private final Map<String, Object> input;
    private final Map<String, Object> fixture;
    private final CloudProviderHttp.Provider provider;
    private volatile CloudOwnership.Binding binding;
    private volatile BiConsumer<Integer, byte[]> evidence;

    interface Work<T> { T apply(Map<String, Object> state) throws IOException; }

    private CloudSdkQualificationScope(Path root, Map<String, Object> input, Map<String, Object> fixture) throws IOException {
        this.root = root;
        this.input = CloudJson.object(CloudJson.copy(input));
        this.fixture = CloudJson.object(CloudJson.copy(fixture));
        provider = "google".equals(input.get("provider")) ? CloudProviderHttp.Provider.GOOGLE : CloudProviderHttp.Provider.MICROSOFT;
        nativeRoot = nativeRoot(root, input, identity(input, fixture));
    }

    private static String identity(Map<String, Object> input, Map<String, Object> fixture) throws IOException {
        boolean readOnly = Boolean.TRUE.equals(input.get("readOnly"));
        boolean readback = input.containsKey("readbackFrom");
        boolean continuation = input.containsKey("continueFrom");
        boolean keys = readback
                ? CloudJson.exact(input, "runId", "provider", "phase", "accountHash", "sourceStreamId", "appSha256", "testSha256", "readbackFrom")
                : continuation
                ? CloudJson.exact(input, "runId", "provider", "phase", "accountHash", "sourceStreamId", "appSha256", "testSha256", "continueFrom")
                : readOnly
                ? input.containsKey("readOnlyCopies")
                    ? CloudJson.exact(input, "runId", "provider", "phase", "accountHash", "sourceStreamId", "appSha256", "testSha256", "readOnly", "readOnlyCopies")
                    : CloudJson.exact(input, "runId", "provider", "phase", "accountHash", "sourceStreamId", "appSha256", "testSha256", "readOnly")
                : CloudJson.exact(input, "runId", "provider", "phase", "accountHash", "sourceStreamId", "appSha256", "testSha256");
        if (!keys || readOnly && !"prepare".equals(input.get("phase")) || readback && !"reopen".equals(input.get("phase"))
                || !CloudJson.hex(input.get("runId")) || !CloudJson.hex(input.get("accountHash"))
                || !CloudJson.hex(input.get("sourceStreamId")) || !CloudJson.hex(input.get("appSha256"))
                || !CloudJson.hex(input.get("testSha256")) || !Arrays.asList("google", "microsoft").contains(input.get("provider"))
                || !(continuation ? Arrays.asList("continue", "reopen") : Arrays.asList("prepare", "reopen")).contains(input.get("phase"))
                || !CloudJson.exact(fixture, "a", "b")) {
            throw CloudJson.failure();
        }
        if (input.containsKey("readOnlyCopies")) {
            Map<String, Object> copies = CloudJson.object(input.get("readOnlyCopies"));
            if (!readOnly || !"microsoft".equals(input.get("provider"))
                    || !CloudJson.exact(copies, "current", "previous", "clientHash")
                    || copies.values().stream().anyMatch((value) -> !CloudJson.hex(value))
                    || copies.get("current").equals(copies.get("previous"))) throw CloudJson.failure();
        }
        if (readback) {
            Map<String, Object> pins = CloudJson.object(input.get("readbackFrom"));
            if (!(pins.containsKey("previous") ? CloudJson.exact(pins, "runId", "inputHash", "scopeSha256", "input", "previous")
                    : CloudJson.exact(pins, "runId", "inputHash", "scopeSha256", "input"))
                    || !CloudJson.hex(pins.get("runId")) || !CloudJson.hex(pins.get("inputHash"))
                    || !CloudJson.hex(pins.get("scopeSha256")) || input.get("runId").equals(pins.get("runId"))) throw CloudJson.failure();
            Map<String, Object> previous = CloudJson.object(pins.get("input"));
            if (previous.containsKey("readbackFrom") || previous.containsKey("readOnly")
                    || !"reopen".equals(previous.get("phase")) || !pins.get("runId").equals(previous.get("runId"))
                    || !pins.get("inputHash").equals(identity(previous, fixture))) throw CloudJson.failure();
            for (String key : Arrays.asList("provider", "accountHash", "sourceStreamId")) {
                if (!input.get(key).equals(previous.get(key))) throw CloudJson.failure();
            }
            if (pins.containsKey("previous")) {
                Map<String, Object> last = CloudJson.object(pins.get("previous"));
                if (!CloudJson.exact(last, "runId", "inputHash", "scopeSha256")
                        || last.values().stream().anyMatch((value) -> !CloudJson.hex(value))
                        || input.get("runId").equals(last.get("runId")) || pins.get("runId").equals(last.get("runId"))) throw CloudJson.failure();
            }
        }
        if (continuation) {
            Map<String, Object> prior = CloudJson.object(input.get("continueFrom"));
            if (!"microsoft".equals(input.get("provider"))
                    || !(prior.containsKey("predecessor")
                        ? CloudJson.exact(prior, "runId", "inputHash", "scopeSha256", "failureSha256", "predecessor")
                        : prior.containsKey("predecessors")
                        ? CloudJson.exact(prior, "runId", "inputHash", "scopeSha256", "failureSha256", "predecessors")
                        : CloudJson.exact(prior, "runId", "inputHash", "scopeSha256", "failureSha256"))
                    || Arrays.asList("runId", "inputHash", "scopeSha256", "failureSha256").stream()
                        .anyMatch((key) -> !CloudJson.hex(prior.get(key)))
                    || input.get("runId").equals(prior.get("runId"))) throw CloudJson.failure();
            List<Object> ancestors = predecessors(prior);
            if (ancestors.size() > 2 || prior.containsKey("predecessors") && ancestors.size() != 2) throw CloudJson.failure();
            java.util.Set<Object> runs = new java.util.HashSet<>(Arrays.asList(input.get("runId"), prior.get("runId")));
            for (Object ancestor : ancestors) {
                Map<String, Object> previous = CloudJson.object(ancestor);
                if (!CloudJson.exact(previous, "runId", "inputHash", "scopeSha256")
                        || previous.values().stream().anyMatch((value) -> !CloudJson.hex(value))
                        || !runs.add(previous.get("runId"))) {
                    throw CloudJson.failure();
                }
            }
        }
        for (String name : Arrays.asList("a", "b")) {
            Map<String, Object> row = CloudJson.object(fixture.get(name));
            if (!CloudJson.exact(row, "components", "contentDigest") || !CloudJson.hex(row.get("contentDigest"))
                    || !CloudJson.exact(CloudJson.object(row.get("components")), "reader", "history", "settings", "draft")
                    || !row.get("contentDigest").equals(CloudJson.hash(CloudJson.bytes(row.get("components"))))) throw CloudJson.failure();
        }
        Map<String, Object> value = CloudJson.object(CloudJson.copy(input));
        value.remove("phase");
        value.put("fixture", fixture);
        return CloudJson.hash(CloudJson.bytes(value));
    }

    private static Path owned(Path parent, Map<String, Object> input) throws IOException {
        Path root = parent.toAbsolutePath().normalize().resolve("cloud-sdk-service-v1").resolve(CloudJson.string(input.get("runId")));
        if (Files.isSymbolicLink(root) || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        CloudJournal.directory(root);
        if (!Files.isRegularFile(root.resolve("opened"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        return root;
    }

    private static Map<String, Object> read(Path root, String expected) throws IOException {
        return read(root, expected, root.resolve("native-state"));
    }

    private static Map<String, Object> read(Path root, String expected, Path nativeRoot) throws IOException {
        return read(root, expected, nativeRoot, false);
    }

    private static Map<String, Object> read(Path root, String expected, Path nativeRoot, boolean legacyFullParent) throws IOException {
        if (Files.exists(root.resolve("scope.next"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        Map<String, Object> state = CloudJson.object(CloudJson.parse(CloudJournal.read(root.resolve("scope.json"), 32768), 32768));
        // Full-service parents predate this read-only witness; their pinned bytes stay unchanged.
        if (legacyFullParent && !state.containsKey("sourceReadValidated")) state.put("sourceReadValidated", false);
        if (!CloudJson.exact(state, "format", "version", "inputHash", "runId", "provider", "phase", "prepareProcess", "reopenProcess",
                "ready", "finished", "failed", "requests", "signins", "initiations", "seeds", "snapshots", "publications", "candidates",
                "newNames", "byteDigests", "reopenReadDigests", "profile", "streamId", "acknowledgement", "accountValidated", "credentialsCleared", "nativeState", "sourceReadValidated")
                || !FORMAT.equals(state.get("format")) || CloudJson.integer(state.get("version")) != 1
                || !expected.equals(state.get("inputHash")) || !CloudJson.hex(state.get("runId"))
                || !root.getFileName().toString().equals(state.get("runId"))
                || !Arrays.asList("google", "microsoft").contains(state.get("provider"))
                || !Arrays.asList("prepare", "reopen", "finished").contains(state.get("phase"))
                || CloudJson.integer(state.get("prepareProcess")) < 1) throw CloudJson.failure();
        if ("prepare".equals(state.get("phase")) ? state.get("reopenProcess") != null
                : state.get("reopenProcess") == null || CloudJson.integer(state.get("reopenProcess")) < 1
                    || state.get("reopenProcess").equals(state.get("prepareProcess"))) throw CloudJson.failure();
        for (String key : Arrays.asList("ready", "finished", "failed", "accountValidated", "credentialsCleared", "sourceReadValidated")) {
            if (!(state.get(key) instanceof Boolean)) throw CloudJson.failure();
        }
        if (state.get("nativeState") != null) CloudJson.object(state.get("nativeState"));
        for (String key : Arrays.asList("requests", "signins", "initiations", "seeds", "snapshots", "publications", "candidates")) {
            long count = CloudJson.integer(state.get(key));
            int maximum = key.equals("requests") ? REQUEST_LIMIT : key.equals("candidates") ? 4 : key.equals("signins") ? 1 : 2;
            if (count < 0 || count > maximum) throw CloudJson.failure();
        }
        for (String key : Arrays.asList("newNames", "byteDigests", "reopenReadDigests")) {
            if (CloudJson.array(state.get(key)).size() > 64) throw CloudJson.failure();
        }
        if (state.get("profile") != null && !CloudJson.hex(state.get("profile"))
                || state.get("streamId") != null && !CloudJson.hex(state.get("streamId"))) throw CloudJson.failure();
        for (String key : Arrays.asList("byteDigests", "reopenReadDigests")) {
            List<Object> values = CloudJson.array(state.get(key));
            if (values.stream().anyMatch((value) -> !CloudJson.hex(value))
                    || new java.util.HashSet<>(values).size() != values.size()
                    || key.equals("byteDigests") && values.size() > 2) throw CloudJson.failure();
        }
        if (CloudJson.array(state.get("newNames")).size() > 4
                || CloudJson.array(state.get("newNames")).stream().anyMatch((value) ->
                    !(value instanceof String) || !NEW_NAME.matcher((String) value).matches())) throw CloudJson.failure();
        if (state.get("profile") != null) {
            if (!Files.isRegularFile(nativeRoot.resolve("cloud-installation-v1").resolve("installation.json"), LinkOption.NOFOLLOW_LINKS)
                    || !state.get("profile").equals(CloudOwnership.installation(nativeRoot))
                    || !Files.isDirectory(nativeRoot.resolve("cloud-connections").resolve(CloudJson.string(state.get("profile"))),
                        LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        }
        return state;
    }

    private static Path priorRoot(Path root, Map<String, Object> input) throws IOException {
        return root.getParent().resolve(CloudJson.string(CloudJson.object(input.get("continueFrom")).get("runId")));
    }

    private static List<Object> predecessors(Map<String, Object> pins) throws IOException {
        return pins.containsKey("predecessor") ? Arrays.asList(pins.get("predecessor"))
                : pins.containsKey("predecessors") ? CloudJson.array(pins.get("predecessors")) : new ArrayList<>();
    }

    private static Path claimRoot(Path root, Map<String, Object> input) throws IOException {
        Map<String, Object> pins = CloudJson.object(input.get("continueFrom"));
        List<Object> ancestors = predecessors(pins);
        return !ancestors.isEmpty()
                ? root.getParent().resolve(CloudJson.string(CloudJson.object(ancestors.get(ancestors.size() - 1)).get("runId")))
                : priorRoot(root, input);
    }

    private static Map<String, Object> pinnedParent(Path root, Map<String, Object> input) throws IOException {
        Map<String, Object> pins = CloudJson.object(input.get("continueFrom"));
        Path prior = priorRoot(root, input);
        if (Files.isSymbolicLink(prior) || !Files.isDirectory(prior, LinkOption.NOFOLLOW_LINKS)
                || !CloudJson.string(pins.get("inputHash")).equals(
                    new String(CloudJournal.read(prior.resolve("opened"), 128), java.nio.charset.StandardCharsets.UTF_8))
                || !pins.get("scopeSha256").equals(CloudJson.hash(CloudJournal.read(prior.resolve("scope.json"), 32768)))
                || !pins.get("failureSha256").equals(CloudJson.hash(CloudJournal.read(prior.resolve("failure.json"), 8192)))) {
            throw CloudJson.failure();
        }
        Map<String, Object> state = read(prior, CloudJson.string(pins.get("inputHash")));
        Map<String, Object> failure = CloudJson.object(CloudJson.parse(CloudJournal.read(prior.resolve("failure.json"), 8192), 8192));
        if (!Boolean.TRUE.equals(state.get("failed")) || Boolean.TRUE.equals(state.get("ready"))
                || Boolean.TRUE.equals(state.get("finished")) || Boolean.TRUE.equals(state.get("credentialsCleared"))
                || !"prepare".equals(state.get("phase")) || !input.get("provider").equals(state.get("provider"))
                || !"recap-sdk-service-failure".equals(failure.get("format")) || CloudJson.integer(failure.get("version")) != 1
                || !pins.get("runId").equals(failure.get("runId")) || !input.get("provider").equals(failure.get("provider"))
                || !"prepare".equals(failure.get("phase"))) throw CloudJson.failure();
        Path parent = prior;
        for (Object ancestor : predecessors(pins)) {
            Map<String, Object> previous = CloudJson.object(ancestor);
            Path directory = root.getParent().resolve(CloudJson.string(previous.get("runId")));
            Map<String, Object> claim = CloudJson.object(CloudJson.parse(CloudJournal.read(parent.resolve("continue.claim"), 1024), 1024));
            if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                    || !CloudJson.exact(claim, "runId", "inputHash") || !previous.get("runId").equals(claim.get("runId"))
                    || !previous.get("inputHash").equals(claim.get("inputHash"))
                    || !previous.get("inputHash").equals(new String(CloudJournal.read(directory.resolve("opened"), 128),
                        java.nio.charset.StandardCharsets.UTF_8))
                    || !previous.get("scopeSha256").equals(CloudJson.hash(CloudJournal.read(directory.resolve("scope.json"), 32768)))
                    || Files.exists(directory.resolve("failure.json"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            Map<String, Object> predecessor = read(directory, CloudJson.string(previous.get("inputHash")), prior.resolve("native-state"));
            if (!CloudJson.hex(state.get("profile")) || Boolean.TRUE.equals(predecessor.get("failed")) || Boolean.TRUE.equals(predecessor.get("ready"))
                    || Boolean.TRUE.equals(predecessor.get("finished")) || Boolean.TRUE.equals(predecessor.get("credentialsCleared"))
                    || !"prepare".equals(predecessor.get("phase")) || !state.get("profile").equals(predecessor.get("profile"))
                    || !input.get("provider").equals(predecessor.get("provider"))
                    || CloudJson.integer(predecessor.get("requests")) < CloudJson.integer(state.get("requests"))
                    || !CloudJson.canonical(state.get("nativeState")).equals(CloudJson.canonical(predecessor.get("nativeState")))) {
                throw CloudJson.failure();
            }
            for (String key : Arrays.asList("signins", "initiations", "seeds", "snapshots", "publications", "candidates",
                    "newNames", "byteDigests", "reopenReadDigests")) {
                if (!CloudJson.canonical(state.get(key)).equals(CloudJson.canonical(predecessor.get(key)))) throw CloudJson.failure();
            }
            parent = directory;
            state = predecessor;
        }
        return state;
    }

    private static Path nativeRoot(Path root, Map<String, Object> input, String expected) throws IOException {
        if (input.containsKey("readbackFrom")) {
            pinnedReadback(root, input);
            Map<String, Object> claim = CloudJson.object(CloudJson.parse(
                    CloudJournal.read(readbackClaimRoot(root, input).resolve("readback.claim"), 1024), 1024));
            if (!CloudJson.exact(claim, "runId", "inputHash") || !input.get("runId").equals(claim.get("runId"))
                    || !expected.equals(claim.get("inputHash"))) throw CloudJson.failure();
            Map<String, Object> pins = CloudJson.object(input.get("readbackFrom"));
            return nativeRoot(readbackParent(root, input), CloudJson.object(pins.get("input")), CloudJson.string(pins.get("inputHash")));
        }
        if (!input.containsKey("continueFrom")) return root.resolve("native-state");
        pinnedParent(root, input);
        Map<String, Object> claim = CloudJson.object(CloudJson.parse(
                CloudJournal.read(claimRoot(root, input).resolve("continue.claim"), 1024), 1024));
        if (!CloudJson.exact(claim, "runId", "inputHash") || !input.get("runId").equals(claim.get("runId"))
                || !expected.equals(claim.get("inputHash"))) throw CloudJson.failure();
        Path base = priorRoot(root, input).resolve("native-state");
        if (Files.isSymbolicLink(base) || !Files.isDirectory(base, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        return base;
    }

    private static Path readbackParent(Path root, Map<String, Object> input) throws IOException {
        return root.getParent().resolve(CloudJson.string(CloudJson.object(input.get("readbackFrom")).get("runId")));
    }

    private static Path readbackClaimRoot(Path root, Map<String, Object> input) throws IOException {
        Map<String, Object> pins = CloudJson.object(input.get("readbackFrom"));
        return pins.containsKey("previous") ? root.getParent().resolve(CloudJson.string(
                CloudJson.object(pins.get("previous")).get("runId"))) : readbackParent(root, input);
    }

    private static Map<String, Object> pinnedReadback(Path root, Map<String, Object> input) throws IOException {
        Map<String, Object> pins = CloudJson.object(input.get("readbackFrom"));
        Map<String, Object> previous = CloudJson.object(pins.get("input"));
        Path prior = owned(root.getParent().getParent(), previous);
        String expected = CloudJson.string(pins.get("inputHash"));
        if (!expected.equals(new String(CloudJournal.read(prior.resolve("opened"), 128), java.nio.charset.StandardCharsets.UTF_8))
                || !pins.get("scopeSha256").equals(CloudJson.hash(CloudJournal.read(prior.resolve("scope.json"), 32768)))
                || Files.exists(prior.resolve("failure.json"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        Map<String, Object> state = read(prior, expected, nativeRoot(prior, previous, expected), true);
        if (Boolean.TRUE.equals(state.get("failed")) || Boolean.TRUE.equals(state.get("finished"))
                || Boolean.TRUE.equals(state.get("credentialsCleared")) || CloudJson.integer(state.get("requests")) >= REQUEST_LIMIT
                || !("prepare".equals(state.get("phase")) && Boolean.TRUE.equals(state.get("ready"))
                    || "reopen".equals(state.get("phase")) && !Boolean.TRUE.equals(state.get("ready"))
                        && Files.isRegularFile(prior.resolve("reopen.started"), LinkOption.NOFOLLOW_LINKS))) throw CloudJson.failure();
        secondAcknowledgement(state, input);
        if (pins.containsKey("previous")) {
            Map<String, Object> last = CloudJson.object(pins.get("previous"));
            Map<String, Object> claim = CloudJson.object(CloudJson.parse(CloudJournal.read(prior.resolve("readback.claim"), 1024), 1024));
            Path directory = readbackClaimRoot(root, input);
            if (!CloudJson.exact(claim, "runId", "inputHash") || !last.get("runId").equals(claim.get("runId"))
                    || !last.get("inputHash").equals(claim.get("inputHash"))
                    || Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                    || !last.get("inputHash").equals(new String(CloudJournal.read(directory.resolve("opened"), 128), java.nio.charset.StandardCharsets.UTF_8))
                    || !last.get("scopeSha256").equals(CloudJson.hash(CloudJournal.read(directory.resolve("scope.json"), 32768)))
                    || Files.exists(directory.resolve("failure.json"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            Map<String, Object> current = read(directory, CloudJson.string(last.get("inputHash")), nativeRoot(prior, previous, expected));
            if (!"reopen".equals(current.get("phase")) || Boolean.TRUE.equals(current.get("ready"))
                    || Boolean.TRUE.equals(current.get("failed")) || Boolean.TRUE.equals(current.get("finished"))
                    || Boolean.TRUE.equals(current.get("credentialsCleared"))
                    || !Files.isRegularFile(directory.resolve("reopen.started"), LinkOption.NOFOLLOW_LINKS)
                    || CloudJson.integer(current.get("requests")) < CloudJson.integer(state.get("requests"))
                    || CloudJson.integer(current.get("requests")) >= REQUEST_LIMIT) throw CloudJson.failure();
            for (String key : Arrays.asList("signins", "initiations", "seeds", "snapshots", "publications", "candidates",
                    "newNames", "byteDigests", "profile", "streamId", "acknowledgement")) {
                if (!CloudJson.canonical(state.get(key)).equals(CloudJson.canonical(current.get(key)))) throw CloudJson.failure();
            }
            secondAcknowledgement(current, input);
            state = current;
        }
        return state;
    }

    private static Map<String, Object> secondAcknowledgement(Map<String, Object> state, Map<String, Object> input) throws IOException {
        Map<String, Object> current = CloudJson.object(state.get("nativeState"));
        Map<String, Object> ack = CloudJson.object(current.get("acknowledgement"));
        if (!Boolean.TRUE.equals(state.get("accountValidated")) || !"active".equals(current.get("phase"))
                || !input.get("provider").equals(state.get("provider"))
                || !CloudJson.hex(state.get("profile")) || !state.get("profile").equals(current.get("profileId"))
                || !input.get("accountHash").equals(current.get("account")) || !input.get("provider").equals(current.get("provider"))
                || !CloudJson.hex(current.get("client")) || !CloudJson.hex(current.get("streamId"))
                || !current.get("streamId").equals(state.get("streamId")) || input.get("sourceStreamId").equals(current.get("streamId"))
                || !CloudJson.exact(ack, "attemptEpoch", "attemptId", "byteDigest", "contentDigest", "epoch", "generation", "streamId")
                || !CloudJson.hex(ack.get("attemptId")) || !CloudJson.hex(ack.get("byteDigest")) || !CloudJson.hex(ack.get("contentDigest"))
                || CloudJson.integer(ack.get("generation")) != 2 || !current.get("streamId").equals(ack.get("streamId"))
                || CloudJson.integer(ack.get("epoch")) != CloudJson.integer(current.get("epoch"))
                || !CloudJson.canonical(ack).equals(CloudJson.canonical(state.get("acknowledgement")))
                || CloudJson.integer(state.get("snapshots")) != 2 || CloudJson.integer(state.get("candidates")) != 2
                || CloudJson.array(state.get("byteDigests")).size() != 2
                || !ack.get("byteDigest").equals(CloudJson.array(state.get("byteDigests")).get(1))) throw CloudJson.failure();
        return current;
    }

    private static Map<String, Object> firstAcknowledgement(Map<String, Object> state, Map<String, Object> input,
            Map<String, Object> fixture) throws IOException {
        Map<String, Object> current = CloudJson.object(state.get("nativeState"));
        Map<String, Object> ack = CloudJson.object(current.get("acknowledgement"));
        if (!CloudJson.hex(state.get("profile")) || !CloudJson.exact(ack,
                    "attemptEpoch", "attemptId", "byteDigest", "contentDigest", "epoch", "generation", "streamId")
                || !CloudJson.hex(ack.get("attemptId")) || !CloudJson.hex(ack.get("byteDigest"))
                || !Boolean.TRUE.equals(state.get("accountValidated")) || !"active".equals(current.get("phase"))
                || !input.get("provider").equals(current.get("provider")) || !input.get("accountHash").equals(current.get("account"))
                || !state.get("profile").equals(current.get("profileId")) || !CloudJson.hex(current.get("streamId"))
                || input.get("sourceStreamId").equals(current.get("streamId")) || CloudJson.integer(ack.get("generation")) != 1
                || CloudJson.integer(ack.get("epoch")) != CloudJson.integer(current.get("epoch"))
                || !current.get("streamId").equals(ack.get("streamId"))
                || !CloudJson.object(fixture.get("a")).get("contentDigest").equals(ack.get("contentDigest"))
                || CloudJson.integer(state.get("snapshots")) != 1 || CloudJson.integer(state.get("candidates")) != 1
                || CloudJson.integer(state.get("seeds")) != 2 || CloudJson.integer(state.get("publications")) != 1
                || CloudJson.integer(state.get("signins")) != 1 || CloudJson.integer(state.get("initiations")) != 0
                || CloudJson.array(state.get("newNames")).size() != 3 || CloudJson.array(state.get("byteDigests")).size() != 1
                || !ack.get("byteDigest").equals(CloudJson.array(state.get("byteDigests")).get(0))) throw CloudJson.failure();
        return current;
    }

    private static void write(Path root, Map<String, Object> state) throws IOException {
        Path next = root.resolve("scope.next");
        CloudJournal.exclusive(next, CloudJson.bytes(state));
        Files.move(next, root.resolve("scope.json"), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private static synchronized <T> T locked(Path root, Map<String, Object> input, Map<String, Object> fixture,
            Work<T> work, boolean update, boolean sticky) throws IOException {
        String expected = identity(input, fixture);
        Path base = nativeRoot(root, input, expected);
        Path lock = root.resolve("scope.lock");
        if (Files.isSymbolicLink(lock) || !Files.isRegularFile(lock, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        try (FileChannel channel = FileChannel.open(lock, StandardOpenOption.WRITE); FileLock held = channel.lock()) {
            if (!held.isValid()) throw CloudJson.failure();
            Map<String, Object> state = read(root, expected, base);
            if (CloudJson.integer(state.get("requests")) > requestLimit(input)) throw CloudJson.failure();
            try {
                T value = work.apply(state);
                if (update) write(root, state);
                return value;
            } catch (IOException error) {
                if (sticky) { state.put("failed", true); write(root, state); }
                throw error;
            }
        }
    }

    static CloudSdkQualificationScope open(Path parent, Map<String, Object> input, Map<String, Object> fixture, long process) throws IOException {
        String expected = identity(input, fixture);
        if (process < 1 || process > CloudJson.MAX_INTEGER) throw CloudJson.failure();
        Path root;
        if (input.containsKey("readbackFrom")) {
            Path directory = parent.toAbsolutePath().normalize().resolve("cloud-sdk-service-v1");
            CloudJournal.directory(directory);
            root = directory.resolve(CloudJson.string(input.get("runId")));
            Map<String, Object> prior = pinnedReadback(root, input);
            Map<String, Object> pins = CloudJson.object(input.get("readbackFrom"));
            Path base = nativeRoot(readbackParent(root, input), CloudJson.object(pins.get("input")), CloudJson.string(pins.get("inputHash")));
            Map<String, Object> connection = new CloudConnection(base, CloudJson.string(prior.get("profile"))).inspect();
            Map<String, Object> expectedConnection = secondAcknowledgement(prior, input);
            for (String key : Arrays.asList("profileId", "epoch", "phase", "provider", "account", "client", "streamId", "acknowledgement")) {
                if (!CloudJson.canonical(connection.get(key)).equals(CloudJson.canonical(expectedConnection.get(key)))) throw CloudJson.failure();
            }
            if (process == CloudJson.integer(prior.get("prepareProcess"))
                    || prior.get("reopenProcess") != null && process == CloudJson.integer(prior.get("reopenProcess"))
                    || Files.exists(readbackClaimRoot(root, input).resolve("readback.claim"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            Files.createDirectory(root);
            CloudJournal.exclusive(root.resolve("scope.lock"), "scope-lock-v1\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            Map<String, Object> initial = CloudJson.object(CloudJson.copy(prior));
            initial.putAll(CloudJson.map("inputHash", expected, "runId", input.get("runId"), "phase", "reopen",
                    "reopenProcess", process, "ready", false, "accountValidated", false, "reopenReadDigests", new ArrayList<>()));
            CloudJournal.exclusive(readbackClaimRoot(root, input).resolve("readback.claim"),
                    CloudJson.bytes(CloudJson.map("runId", input.get("runId"), "inputHash", expected)));
            CloudJournal.exclusive(root.resolve("scope.json"), CloudJson.bytes(initial));
            CloudJournal.exclusive(root.resolve("reopen.started"), CloudJson.bytes(CloudJson.map("process", process)));
            CloudJournal.exclusive(root.resolve("opened"), expected.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } else if ("prepare".equals(input.get("phase")) || "continue".equals(input.get("phase"))) {
            Path directory = parent.toAbsolutePath().normalize().resolve("cloud-sdk-service-v1");
            CloudJournal.directory(directory);
            root = directory.resolve(CloudJson.string(input.get("runId")));
            Map<String, Object> prior = null;
            if ("continue".equals(input.get("phase"))) {
                prior = pinnedParent(root, input);
                Path base = priorRoot(root, input).resolve("native-state");
                Map<String, Object> expectedConnection = firstAcknowledgement(prior, input, fixture);
                if (CloudJson.integer(prior.get("prepareProcess")) == process
                        || !CloudJson.canonical(expectedConnection).equals(CloudJson.canonical(
                            new CloudConnection(base, CloudJson.string(prior.get("profile"))).inspect()))
                        || Files.exists(claimRoot(root, input).resolve("continue.claim"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            }
            Files.createDirectory(root);
            if (prior == null) CloudJournal.directory(root.resolve("native-state"));
            CloudJournal.exclusive(root.resolve("scope.lock"), "scope-lock-v1\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            Map<String, Object> initial = CloudJson.map(
                    "format", FORMAT, "version", 1, "inputHash", expected, "runId", input.get("runId"), "provider", input.get("provider"),
                    "phase", "prepare", "prepareProcess", process, "reopenProcess", null, "ready", false, "finished", false, "failed", false,
                    "requests", 0, "signins", 0, "initiations", 0, "seeds", 0, "snapshots", 0, "publications", 0, "candidates", 0,
                    "newNames", new ArrayList<>(), "byteDigests", new ArrayList<>(), "reopenReadDigests", new ArrayList<>(),
                    "profile", null, "streamId", null, "acknowledgement", null, "accountValidated", false, "credentialsCleared", false,
                    "nativeState", null, "sourceReadValidated", false);
            if (prior != null) {
                for (String key : Arrays.asList("requests", "signins", "initiations", "seeds", "snapshots", "publications",
                        "candidates", "newNames", "byteDigests", "profile", "nativeState")) initial.put(key, CloudJson.copy(prior.get(key)));
                CloudJournal.exclusive(claimRoot(root, input).resolve("continue.claim"),
                        CloudJson.bytes(CloudJson.map("runId", input.get("runId"), "inputHash", expected)));
            }
            CloudJournal.exclusive(root.resolve("scope.json"), CloudJson.bytes(initial));
            CloudJournal.exclusive(root.resolve("opened"), expected.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } else {
            root = owned(parent, input);
            if (Files.exists(root.resolve("readback.claim"), LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            final Path selected = root;
            locked(root, input, fixture, (state) -> {
                if (!Boolean.TRUE.equals(state.get("ready")) || Boolean.TRUE.equals(state.get("failed"))
                        || Boolean.TRUE.equals(state.get("finished")) || !"prepare".equals(state.get("phase"))
                        || CloudJson.integer(state.get("prepareProcess")) == process
                        || CloudJson.integer(state.get("snapshots")) != 2 || CloudJson.array(state.get("byteDigests")).size() != 2
                        || !CloudJson.hex(state.get("profile")) || !CloudJson.hex(state.get("streamId"))) throw CloudJson.failure();
                Map<String, Object> connection = new CloudConnection(nativeRoot(selected, input, expected),
                        CloudJson.string(state.get("profile"))).inspect();
                Map<String, Object> ack = CloudJson.object(connection.get("acknowledgement"));
                if (!"active".equals(connection.get("phase")) || !input.get("accountHash").equals(connection.get("account"))
                        || !input.get("provider").equals(connection.get("provider")) || CloudJson.integer(ack.get("generation")) != 2
                        || !CloudJson.object(fixture.get("b")).get("contentDigest").equals(ack.get("contentDigest"))
                        || !CloudJson.canonical(ack).equals(CloudJson.canonical(state.get("acknowledgement")))) throw CloudJson.failure();
                CloudJournal.exclusive(selected.resolve("reopen.started"), CloudJson.bytes(CloudJson.map("process", process)));
                state.put("phase", "reopen"); state.put("reopenProcess", process); state.put("ready", false);
                state.put("accountValidated", false); state.put("reopenReadDigests", new ArrayList<>());
                return null;
            }, true, false);
        }
        return new CloudSdkQualificationScope(root, input, fixture);
    }

    Path nativeBase() { return nativeRoot; }
    CloudProviderHttp.Provider provider() { return provider; }
    String suffix() { return "cloud-service-" + nativeRoot.getParent().getFileName().toString(); }
    String runId() throws IOException { return CloudJson.string(input.get("runId")); }
    private boolean readOnly() { return Boolean.TRUE.equals(input.get("readOnly")); }
    private boolean readOnlyCopies() { return input.containsKey("readOnlyCopies"); }
    private static int requestLimit(Map<String, Object> input) {
        return Boolean.TRUE.equals(input.get("readOnly")) ? input.containsKey("readOnlyCopies") ? 200 : 100 : REQUEST_LIMIT;
    }
    private List<Object> copyDigests() throws IOException {
        Map<String, Object> copies = CloudJson.object(input.get("readOnlyCopies"));
        return Arrays.asList(copies.get("previous"), copies.get("current"));
    }
    private boolean readback() { return input.containsKey("readbackFrom"); }
    String discoveryStreamId() throws IOException {
        return readback() && CloudJson.object(input.get("readbackFrom")).containsKey("previous")
                ? CloudJson.string(pinnedReadback(root, input).get("streamId")) : null;
    }
    boolean keepScreenOn() throws IOException { return readOnlyCopies() || discoveryStreamId() != null; }
    private boolean transferred() { return Files.exists(root.resolve("readback.claim"), LinkOption.NOFOLLOW_LINKS); }
    private void requireOwner() throws IOException { if (transferred()) throw CloudJson.failure(); }

    private <T> T update(Work<T> work) throws IOException {
        requireOwner();
        return locked(root, input, fixture, (state) -> {
            if (Boolean.TRUE.equals(state.get("failed")) || Boolean.TRUE.equals(state.get("finished"))) throw CloudJson.failure();
            if (!input.get("provider").equals(state.get("provider"))) throw CloudJson.failure();
            return work.apply(state);
        }, true, true);
    }

    CloudService.Observer observer() {
        return new CloudService.Observer() {
            @Override public void settled(Map<String, Object> state) throws IOException { nativeState(state); }
            @Override public void failed(String operation, Exception error) {
                String stage = Arrays.asList("status", "connect", "discover", "choose", "read", "write",
                        "reconcile", "maintain", "disconnect").contains(operation) ? "service-" + operation : "service-operation";
                int status = error instanceof CloudProviderHttp.Failure ? ((CloudProviderHttp.Failure) error).status : 0;
                CloudSdkQualificationScope.this.failed(error, stage, status >= 100 && status <= 599 ? status : null, null);
            }
        };
    }

    void nativeState(Map<String, Object> snapshot) throws IOException {
        Map<String, Object> copy = CloudJson.object(CloudJson.copy(snapshot));
        update((state) -> {
            if (!CloudJson.exact(copy, "profileId", "epoch", "phase", "provider", "account", "client", "streamId",
                    "discoveryId", "discoveryDigest", "acknowledgement")
                    || !CloudOwnership.installation(nativeBase()).equals(copy.get("profileId"))
                    || CloudJson.integer(copy.get("epoch")) < 0
                    || !Arrays.asList("disconnected", "connecting", "discovering", "awaiting-choice", "allocating", "active", "disconnecting")
                        .contains(copy.get("phase"))
                    || copy.get("provider") != null && !input.get("provider").equals(copy.get("provider"))
                    || copy.get("account") != null && !input.get("accountHash").equals(copy.get("account"))
                    || state.get("nativeState") != null && CloudJson.integer(copy.get("epoch"))
                        < CloudJson.integer(CloudJson.object(state.get("nativeState")).get("epoch"))) throw CloudJson.failure();
            for (String key : Arrays.asList("account", "client", "streamId", "discoveryId", "discoveryDigest")) {
                if (copy.get(key) != null && !CloudJson.hex(copy.get(key))) throw CloudJson.failure();
            }
            state.put("nativeState", copy);
            return null;
        });
    }

    static Map<String, Object> inspect(Path parent, Map<String, Object> input, Map<String, Object> fixture) throws IOException {
        Path root = owned(parent, input);
        return locked(root, input, fixture, (state) -> {
            Map<String, Object> result = CloudJson.object(CloudJson.copy(state));
            if (!input.get("provider").equals(state.get("provider"))) throw CloudJson.failure();
            return result;
        }, false, false);
    }

    static void prepared(Path parent, Map<String, Object> input, Map<String, Object> fixture) throws IOException {
        if (Boolean.TRUE.equals(input.get("readOnly"))) throw CloudJson.failure();
        Path root = owned(parent, input);
        locked(root, input, fixture, (state) -> {
            if (!"prepare".equals(state.get("phase")) || Boolean.TRUE.equals(state.get("failed"))
                    || Boolean.TRUE.equals(state.get("ready")) || !Boolean.TRUE.equals(state.get("accountValidated"))
                    || CloudJson.integer(state.get("snapshots")) != 2 || CloudJson.array(state.get("byteDigests")).size() != 2) throw CloudJson.failure();
            Map<String, Object> connection = CloudJson.object(state.get("nativeState"));
            Map<String, Object> ack = CloudJson.object(connection.get("acknowledgement"));
            if (!"active".equals(connection.get("phase")) || !input.get("provider").equals(connection.get("provider"))
                    || !input.get("accountHash").equals(connection.get("account")) || input.get("sourceStreamId").equals(connection.get("streamId"))
                    || CloudJson.integer(ack.get("generation")) != 2
                    || !CloudJson.object(fixture.get("b")).get("contentDigest").equals(ack.get("contentDigest"))) throw CloudJson.failure();
            state.put("streamId", connection.get("streamId")); state.put("acknowledgement", ack); state.put("ready", true);
            return null;
        }, true, false);
    }

    static void finished(Path parent, Map<String, Object> input, Map<String, Object> fixture) throws IOException {
        Path root = owned(parent, input);
        locked(root, input, fixture, (state) -> {
            List<Object> read = CloudJson.array(state.get("reopenReadDigests"));
            if (!"reopen".equals(state.get("phase")) || Boolean.TRUE.equals(state.get("failed"))
                    || !Boolean.TRUE.equals(state.get("accountValidated")) || !Boolean.TRUE.equals(state.get("credentialsCleared"))
                    || CloudJson.integer(state.get("snapshots")) != 2 || CloudJson.array(state.get("byteDigests")).size() != 2
                    || !read.containsAll(CloudJson.array(state.get("byteDigests")))) throw CloudJson.failure();
            Map<String, Object> connection = CloudJson.object(state.get("nativeState"));
            if (!"disconnected".equals(connection.get("phase"))) throw CloudJson.failure();
            state.put("phase", "finished"); state.put("finished", true);
            return null;
        }, true, false);
    }

    void identity(String profile, String account, String client) throws IOException {
        requireOwner();
        if (!CloudJson.hex(profile) || !input.get("accountHash").equals(CloudOwnership.hash(account))
                || !profile.equals(CloudOwnership.installation(nativeBase()))) throw CloudJson.failure();
        CloudOwnership.Binding selected = new CloudOwnership.Binding(profile, provider, account, client);
        if (readOnlyCopies() && !selected.client.equals(CloudJson.object(input.get("readOnlyCopies")).get("clientHash"))) throw CloudJson.failure();
        if (binding != null && !CloudJson.canonical(binding.identity()).equals(CloudJson.canonical(selected.identity()))) throw CloudJson.failure();
        if (binding != null) {
            locked(root, input, fixture, (state) -> {
                if (Boolean.TRUE.equals(state.get("failed")) || Boolean.TRUE.equals(state.get("finished"))
                        || !Boolean.TRUE.equals(state.get("accountValidated"))) throw CloudJson.failure();
                return null;
            }, false, false);
            return;
        }
        if ("continue".equals(input.get("phase"))) {
            Map<String, Object> prior = pinnedParent(root, input);
            Map<String, Object> expectedConnection = firstAcknowledgement(prior, input, fixture);
            if (!selected.account.equals(expectedConnection.get("account")) || !selected.client.equals(expectedConnection.get("client"))) {
                throw CloudJson.failure();
            }
            CloudOwnership.Destination destination = CloudOwnership.Destination.load(nativeBase(), selected);
            if (!destination.streamId.equals(expectedConnection.get("streamId"))) throw CloudJson.failure();
            Map<String, Object> ledger = new CloudPublicationLedger(nativeBase(), destination, false).inspect().state;
            Map<String, Object> attempt = CloudJson.object(ledger.get("attempt"));
            Map<String, Object> ack = CloudJson.object(expectedConnection.get("acknowledgement"));
            List<Object> payloads = CloudJson.array(ledger.get("payloads")), snapshots = CloudJson.array(ledger.get("snapshots"));
            if (CloudJson.integer(ledger.get("maxGeneration")) != 1 || !"acknowledged".equals(attempt.get("phase"))
                    || !ack.get("attemptId").equals(attempt.get("id")) || !ack.get("byteDigest").equals(attempt.get("digest"))
                    || !ack.get("contentDigest").equals(attempt.get("contentDigest")) || CloudJson.integer(attempt.get("generation")) != 1
                    || CloudJson.integer(ack.get("attemptEpoch")) != CloudJson.integer(attempt.get("epoch"))
                    || payloads.size() != 1 || snapshots.stream().filter((value) -> value != null).count() != 1) throw CloudJson.failure();
            Map<String, Object> committed = CloudJson.object(snapshots.get((int) CloudJson.integer(attempt.get("slot"))));
            Map<String, Object> payload = CloudJson.object(payloads.get(0));
            if (!ack.get("attemptId").equals(committed.get("id")) || !ack.get("attemptId").equals(payload.get("attemptId"))
                    || !Boolean.TRUE.equals(payload.get("terminal")) || !Boolean.TRUE.equals(payload.get("retired"))
                    || payload.get("cleanup") != null) throw CloudJson.failure();
        }
        if (readback()) {
            Map<String, Object> prior = pinnedReadback(root, input);
            Map<String, Object> expectedConnection = secondAcknowledgement(prior, input);
            if (!selected.account.equals(expectedConnection.get("account")) || !selected.client.equals(expectedConnection.get("client"))) throw CloudJson.failure();
            CloudOwnership.Destination destination = CloudOwnership.Destination.load(nativeBase(), selected);
            if (!destination.streamId.equals(expectedConnection.get("streamId"))) throw CloudJson.failure();
            Map<String, Object> ledger = (provider == CloudProviderHttp.Provider.MICROSOFT
                    ? new CloudPublicationLedger(nativeBase(), destination, false) : new CloudLedger(nativeBase(), destination, false)).inspect().state;
            Map<String, Object> attempt = CloudJson.object(ledger.get("attempt"));
            Map<String, Object> ack = CloudJson.object(expectedConnection.get("acknowledgement"));
            if (CloudJson.integer(ledger.get("maxGeneration")) != 2 || !"acknowledged".equals(attempt.get("phase"))
                    || !ack.get("attemptId").equals(attempt.get("id")) || !ack.get("byteDigest").equals(attempt.get("digest"))
                    || !ack.get("contentDigest").equals(attempt.get("contentDigest")) || CloudJson.integer(attempt.get("generation")) != 2
                    || CloudJson.integer(ack.get("attemptEpoch")) != CloudJson.integer(attempt.get("epoch"))) throw CloudJson.failure();
            List<Object> snapshots = CloudJson.array(ledger.get("snapshots"));
            for (int index = 0; index < 2; index++) {
                Map<String, Object> snapshot = CloudJson.object(snapshots.get(index));
                if (CloudJson.integer(snapshot.get("generation")) != index + 1
                        || !snapshot.get("digest").equals(CloudJson.array(prior.get("byteDigests")).get(index))
                        || !snapshot.get("contentDigest").equals(CloudJson.object(fixture.get(index == 0 ? "a" : "b")).get("contentDigest"))) throw CloudJson.failure();
            }
            if (provider == CloudProviderHttp.Provider.MICROSOFT) {
                List<Object> payloads = CloudJson.array(ledger.get("payloads"));
                if (payloads.size() != 2) throw CloudJson.failure();
                for (Object entry : payloads) {
                    Map<String, Object> payload = CloudJson.object(entry);
                    if (!Boolean.TRUE.equals(payload.get("terminal")) || !Boolean.TRUE.equals(payload.get("retired"))
                            || payload.get("cleanup") != null) throw CloudJson.failure();
                }
            }
        }
        binding = selected;
        update((state) -> {
            if (state.get("profile") != null && !profile.equals(state.get("profile"))) throw CloudJson.failure();
            state.put("profile", profile); state.put("accountValidated", true); return null;
        });
    }

    CloudService.AuthFactory authentication(CloudService.AuthFactory actual) {
        return new CloudService.AuthFactory() {
            @Override public String clientId(CloudProviderHttp.Provider selected) throws Exception {
                if (selected != provider) throw CloudJson.failure();
                return actual.clientId(selected);
            }
            @Override public CloudService.Auth open(String profile, CloudProviderHttp.Provider selected, long epoch) throws Exception {
                requireOwner();
                if (selected != provider) throw CloudJson.failure();
                CloudService.Auth auth = actual.open(profile, selected, epoch);
                String client = actual.clientId(selected);
                return new CloudService.Auth() {
                    private CloudService.Account checked(CloudService.Account account) throws IOException {
                        if (account != null) identity(profile, account.id, client);
                        return account;
                    }
                    @Override public CloudService.Account status() throws Exception {
                        requireOwner();
                        try { return checked(auth.status()); } catch (Exception error) { throw failed(error); }
                    }
                    @Override public CloudService.Account connect(java.util.function.BooleanSupplier current) throws Exception {
                        requireOwner();
                        if (!"prepare".equals(input.get("phase"))) throw CloudJson.failure();
                        update((state) -> {
                            if (CloudJson.integer(state.get("signins")) != 0) throw CloudJson.failure();
                            state.put("signins", 1); return null;
                        });
                        try { return checked(auth.connect(current)); } catch (Exception error) { throw failed(error); }
                    }
                    @Override public String token(java.util.function.BooleanSupplier current) throws Exception {
                        requireOwner();
                        try {
                            if (checked(auth.status()) == null) throw CloudJson.failure();
                            return auth.token(current);
                        } catch (Exception error) { throw failed(error); }
                    }
                    @Override public void disconnect() throws Exception {
                        requireOwner();
                        if (readOnly()) {
                            update((state) -> {
                                if (!Boolean.TRUE.equals(state.get("sourceReadValidated"))
                                        || !"awaiting-choice".equals(CloudJson.object(state.get("nativeState")).get("phase"))
                                        || readOnlyCopies() && !CloudJson.array(state.get("reopenReadDigests")).containsAll(copyDigests())) throw CloudJson.failure();
                                return null;
                            });
                        } else if (!"reopen".equals(input.get("phase"))) throw CloudJson.failure();
                        else if (readback()) update((state) -> {
                            if (!Boolean.TRUE.equals(state.get("accountValidated"))
                                    || !CloudJson.array(state.get("reopenReadDigests")).containsAll(CloudJson.array(state.get("byteDigests")))) throw CloudJson.failure();
                            return null;
                        });
                        try { auth.disconnect(); cleared(); } catch (Exception error) { throw failed(error); }
                    }
                };
            }
        };
    }

    void cleared() throws IOException { update((state) -> { state.put("credentialsCleared", true); return null; }); }
    void refused() throws IOException { update((state) -> { state.put("failed", true); return null; }); }
    private Exception failed(Exception error) {
        return failed(error, "native-operation", null, null);
    }
    private Exception failed(Exception error, String stage, Integer status, Integer limit) {
        // The transferred parent is sealed; its caller still receives the original exception.
        if (transferred()) return error;
        // Transport withdrawal must not suppress the first diagnostic from an already-failed scope.
        try { refused(); } catch (IOException preservation) { error.addSuppressed(preservation); }
        try {
            Path diagnostic = root.resolve("failure.json");
            if (!Files.exists(diagnostic, LinkOption.NOFOLLOW_LINKS)) {
                List<Object> frames = new ArrayList<>();
                List<StackTraceElement> selected = new ArrayList<>();
                StackTraceElement[] stack = error.getStackTrace();
                selected.addAll(Arrays.asList(stack).subList(0, Math.min(8, stack.length)));
                for (StackTraceElement frame : stack) {
                    if (selected.size() == 16) break;
                    if (frame.getClassName().startsWith("io.github.raymondnassar.recappage.prototype.") && !selected.contains(frame)) {
                        selected.add(frame);
                    }
                }
                for (StackTraceElement frame : stack) {
                    if (selected.size() == 16) break;
                    if (!selected.contains(frame)) selected.add(frame);
                }
                for (StackTraceElement frame : selected) {
                    frames.add(CloudJson.map("class", frame.getClassName(), "method", frame.getMethodName(), "line", frame.getLineNumber()));
                }
                CloudJournal.exclusive(diagnostic, CloudJson.bytes(CloudJson.map(
                        "format", "recap-sdk-service-failure", "version", 1, "provider", input.get("provider"),
                        "runId", input.get("runId"), "phase", input.get("phase"),
                        "stage", stage, "providerStatus", status, "defensiveLimit", limit,
                        "exceptionClass", error.getClass().getName(), "frames", frames)));
            }
        } catch (IOException preservation) { error.addSuppressed(preservation); }
        return error;
    }
    void preserveCandidates(BiConsumer<Integer, byte[]> sink) { evidence = sink; }

    private CloudOwnership.Destination destination() throws IOException {
        if (binding == null) throw CloudJson.failure();
        CloudOwnership.Destination destination = CloudOwnership.Destination.load(nativeBase(), binding);
        if (input.get("sourceStreamId").equals(destination.streamId)) throw CloudJson.failure();
        return destination;
    }

    CloudEnvelope.Codec codec(CloudEnvelope.Codec actual) {
        return new CloudEnvelope.Codec() {
            @Override public CloudEnvelope encode(Map<String, Object> components, Map<String, Object> capture) throws Exception {
                if (readOnly() || readback()) throw failed(CloudJson.failure(), "readonly-encoding", null, 0);
                CloudEnvelope envelope;
                try { envelope = actual.encode(components, capture); }
                catch (Exception error) {
                    try { refused(); } catch (IOException preservation) { error.addSuppressed(preservation); }
                    throw error;
                }
                int ordinal = update((state) -> {
                    long next = CloudJson.integer(state.get("candidates")) + 1;
                    if (next > 4) throw CloudJson.failure();
                    state.put("candidates", next); return (int) next;
                });
                if (evidence == null || envelope.bytes.length > BODY_LIMIT) throw CloudJson.failure();
                try { evidence.accept(ordinal, envelope.bytes.clone()); }
                catch (UncheckedIOException error) { throw error.getCause(); }
                update((state) -> {
                    long next = CloudJson.integer(state.get("snapshots")) + 1;
                    if (!"prepare".equals(state.get("phase")) || next > 2 || CloudJson.integer(envelope.snapshot.get("generation")) != next) throw CloudJson.failure();
                    Map<String, Object> expected = CloudJson.object(fixture.get(next == 1 ? "a" : "b"));
                    CloudOwnership.Destination owned = destination();
                    if (!owned.streamId.equals(envelope.snapshot.get("streamId"))
                            || !Arrays.asList(owned.slots).contains(envelope.snapshot.get("slotId"))
                            || !"Android device".equals(envelope.snapshot.get("label"))
                            || !expected.get("contentDigest").equals(envelope.contentDigest)
                            || !CloudJson.canonical(expected.get("components")).equals(CloudJson.canonical(envelope.snapshot.get("components")))) throw CloudJson.failure();
                    CloudJson.array(state.get("byteDigests")).add(envelope.byteDigest);
                    return null;
                });
                return envelope;
            }
            @Override public CloudEnvelope decode(byte[] bytes) throws Exception {
                CloudEnvelope envelope = actual.decode(bytes);
                if (!Arrays.equals(bytes, envelope.bytes)) throw CloudJson.failure();
                Map<String, Object> source = CloudJson.object(fixture.get("a"));
                if (readOnlyCopies() && input.get("sourceStreamId").equals(envelope.snapshot.get("streamId"))) {
                    Map<String, Object> copies = CloudJson.object(input.get("readOnlyCopies"));
                    boolean previous = copies.get("previous").equals(envelope.byteDigest);
                    boolean current = copies.get("current").equals(envelope.byteDigest);
                    Map<String, Object> expected = CloudJson.object(fixture.get(previous ? "a" : "b"));
                    if (!(previous || current) || CloudJson.integer(envelope.snapshot.get("generation")) != (previous ? 1 : 2)
                            || !"Android device".equals(envelope.snapshot.get("label"))
                            || !expected.get("contentDigest").equals(envelope.contentDigest)
                            || !CloudJson.canonical(expected.get("components")).equals(CloudJson.canonical(envelope.snapshot.get("components")))) {
                        throw failed(CloudJson.failure(), "readonly-source-copies", null, null);
                    }
                    update((state) -> {
                        if (!Boolean.TRUE.equals(state.get("accountValidated"))) throw CloudJson.failure();
                        List<Object> reads = CloudJson.array(state.get("reopenReadDigests"));
                        if (!reads.contains(envelope.byteDigest)) reads.add(envelope.byteDigest);
                        state.put("sourceReadValidated", reads.containsAll(copyDigests()));
                        return null;
                    });
                } else if (readOnly() && !readOnlyCopies() && input.get("sourceStreamId").equals(envelope.snapshot.get("streamId"))
                        && source.get("contentDigest").equals(envelope.contentDigest)
                        && CloudJson.canonical(source.get("components")).equals(CloudJson.canonical(envelope.snapshot.get("components")))) {
                    update((state) -> { state.put("sourceReadValidated", true); return null; });
                }
                completedRead(envelope.byteDigest);
                return envelope;
            }
        };
    }

    void completedRead(String digest) throws IOException {
        if (!CloudJson.hex(digest)) throw CloudJson.failure();
        if (!"reopen".equals(input.get("phase"))) return;
        update((state) -> {
            List<Object> values = CloudJson.array(state.get("reopenReadDigests"));
            if (!values.contains(digest)) {
                if (values.size() >= 64) throw CloudJson.failure();
                values.add(digest);
            }
            return null;
        });
    }

    void validateMethod(URL url, String method) throws IOException {
        update((state) -> {
            if ((readOnly() || readback()) && !"GET".equals(method) || "DELETE".equals(method)
                    || !"prepare".equals(state.get("phase")) && Arrays.asList("POST", "PATCH").contains(method)) throw CloudJson.failure();
            if (provider == CloudProviderHttp.Provider.GOOGLE && url.getPath().startsWith("/upload/") && Arrays.asList("POST", "PATCH").contains(method)) {
                long next = CloudJson.integer(state.get("initiations")) + 1;
                if (next > 2) throw CloudJson.failure();
                state.put("initiations", next);
            }
            if (provider == CloudProviderHttp.Provider.MICROSOFT && "POST".equals(method)) {
                Matcher path = Pattern.compile("^/v1\\.0/me/drive/items/[^/]+:/([^/]+):/createUploadSession$").matcher(url.getPath());
                if (!path.matches()) throw CloudJson.failure();
                Matcher name = NEW_NAME.matcher(path.group(1));
                List<Object> names = CloudJson.array(state.get("newNames"));
                if (!name.matches() || input.get("sourceStreamId").equals(name.group(2)) || names.size() >= 4 || names.contains(path.group(1))) throw CloudJson.failure();
                names.add(path.group(1));
            }
            return null;
        });
    }

    void validateBody(URL url, String method, String range, byte[] bytes) throws IOException {
        if (bytes.length == 0) return;
        update((state) -> {
            if (!"prepare".equals(state.get("phase")) || bytes.length > BODY_LIMIT) throw CloudJson.failure();
            if ("PUT".equals(method) && provider == CloudProviderHttp.Provider.MICROSOFT
                    && Arrays.equals(bytes, CloudPublicationRecord.SEED.getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
                long next = CloudJson.integer(state.get("seeds")) + 1;
                if (next > 2) throw CloudJson.failure();
                state.put("seeds", next); return null;
            }
            CloudOwnership.Destination owned = destination();
            if ("PUT".equals(method)) {
                CloudEnvelope snapshot = CloudEnvelope.verify(bytes);
                int index = (int) CloudJson.integer(state.get("snapshots"));
                List<Object> digests = CloudJson.array(state.get("byteDigests"));
                if (index >= 2 || digests.size() != index + 1 || !snapshot.byteDigest.equals(digests.get(index))
                        || !("bytes 0-" + (bytes.length - 1) + "/" + bytes.length).equals(range)) throw CloudJson.failure();
                state.put("snapshots", index + 1); return null;
            }
            Map<String, Object> value = CloudJson.object(CloudJson.parse(bytes, BODY_LIMIT));
            if (provider == CloudProviderHttp.Provider.GOOGLE && url.getPath().startsWith("/upload/")) {
                String id = "POST".equals(method) ? CloudJson.string(value.get("id")) : lastId(url);
                if (!Arrays.asList(owned.slots).contains(id)) throw CloudJson.failure();
            } else if (provider == CloudProviderHttp.Provider.MICROSOFT && "PATCH".equals(method)) {
                String id = lastId(url);
                if (!Arrays.asList(owned.slots).contains(id) || !CloudJson.exact(value, "description")) throw CloudJson.failure();
                CloudPublicationRecord.decode(CloudJson.string(value.get("description")), owned.streamId, id);
                long next = CloudJson.integer(state.get("publications")) + 1;
                if (next > 2) throw CloudJson.failure();
                state.put("publications", next);
            } else throw CloudJson.failure();
            return null;
        });
    }

    private static String lastId(URL url) throws IOException {
        return java.net.URLDecoder.decode(url.getPath().substring(url.getPath().lastIndexOf('/') + 1),
                java.nio.charset.StandardCharsets.UTF_8.name());
    }

    HttpsURLConnection connection(URL url) throws IOException {
        try {
            update((state) -> {
                if ((input.containsKey("continueFrom") || readback() || readOnlyCopies())
                        && !Boolean.TRUE.equals(state.get("accountValidated"))) throw CloudJson.failure();
                long next = CloudJson.integer(state.get("requests")) + 1;
                if (next > requestLimit(input)) throw CloudJson.failure();
                state.put("requests", next); return null;
            });
        } catch (IOException error) { failed(error, "request-admission", null, requestLimit(input)); throw error; }
        try { return new Guarded(url, (HttpsURLConnection) url.openConnection()); }
        catch (IOException error) { failed(error, "connection-open", null, null); throw error; }
    }

    private void stopped(IOException error, String stage, int status, Integer limit) {
        failed(error, stage, status >= 100 && status <= 599 ? status : null, limit);
    }

    private boolean absentNewGoogleSlot(URL url, String method) throws IOException {
        if (provider != CloudProviderHttp.Provider.GOOGLE || !"GET".equals(method)
                || !url.getPath().startsWith("/drive/v3/files/")
                || url.getQuery() != null && url.getQuery().contains("alt=media")) return false;
        CloudOwnership.Destination owned = destination();
        int index = Arrays.asList(owned.slots).indexOf(lastId(url));
        if (index < 0) return false;
        return locked(root, input, fixture,
                (state) -> CloudJson.integer(state.get("snapshots")) <= index, false, false);
    }

    private final class Guarded extends HttpsURLConnection {
        private final HttpsURLConnection actual;
        private int receivedStatus = -1;
        private CloudProviderHttp.HandoffRefusal deniedHandoff;
        Guarded(URL url, HttpsURLConnection actual) { super(url); this.actual = actual; }
        @Override public void setRequestMethod(String method) throws ProtocolException {
            try { validateMethod(url, method); actual.setRequestMethod(method); }
            catch (IOException error) {
                failed(error, "request-method", null, null);
                ProtocolException refused = new ProtocolException("The bounded SDK qualification refused this request.");
                refused.initCause(error);
                throw refused;
            }
        }
        @Override public void setRequestProperty(String key, String value) { actual.setRequestProperty(key, value); }
        @Override public String getRequestProperty(String key) { return actual.getRequestProperty(key); }
        @Override public String getRequestMethod() { return actual.getRequestMethod(); }
        @Override public void setConnectTimeout(int value) { actual.setConnectTimeout(value); }
        @Override public void setReadTimeout(int value) { actual.setReadTimeout(value); }
        @Override public void setInstanceFollowRedirects(boolean value) { actual.setInstanceFollowRedirects(value); }
        @Override public void setDoOutput(boolean value) { actual.setDoOutput(value); }
        @Override public void setFixedLengthStreamingMode(int value) { actual.setFixedLengthStreamingMode(value); }
        @Override public OutputStream getOutputStream() throws IOException {
            if (readOnly()) {
                IOException error = CloudJson.failure();
                stopped(error, "readonly-output", -1, 0);
                throw error;
            }
            return new OutputStream() {
                final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                boolean closed;
                @Override public void write(int value) throws IOException {
                    if (closed || bytes.size() >= BODY_LIMIT) {
                        IOException error = CloudJson.failure(); stopped(error, "request-body", -1, BODY_LIMIT); throw error;
                    }
                    bytes.write(value);
                }
                @Override public void write(byte[] value, int offset, int length) throws IOException {
                    if (closed || length < 0 || bytes.size() + length > BODY_LIMIT) {
                        IOException error = CloudJson.failure(); stopped(error, "request-body", -1, BODY_LIMIT); throw error;
                    }
                    bytes.write(value, offset, length);
                }
                @Override public void close() throws IOException {
                    if (closed) return;
                    closed = true;
                    byte[] value = bytes.toByteArray();
                    try { validateBody(url, actual.getRequestMethod(), actual.getRequestProperty("Content-Range"), value); }
                    catch (IOException error) { stopped(error, "request-body", -1, BODY_LIMIT); throw error; }
                    try (OutputStream output = actual.getOutputStream()) { output.write(value); }
                    catch (IOException error) { stopped(error, "request-output", -1, BODY_LIMIT); throw error; }
                }
            };
        }
        private int responseLimit() {
            return provider == CloudProviderHttp.Provider.GOOGLE && url.getQuery() != null && url.getQuery().contains("alt=media")
                    || provider == CloudProviderHttp.Provider.MICROSOFT
                        && (!"graph.microsoft.com".equals(url.getHost()) || url.getPath().endsWith("/content"))
                    ? BODY_LIMIT : 1024 * 1024;
        }
        private boolean downloadHandoff(int status) {
            deniedHandoff = null;
            if (status != 302 || provider != CloudProviderHttp.Provider.MICROSOFT
                    || !"GET".equals(actual.getRequestMethod())) return false;
            if ("graph.microsoft.com".equals(url.getHost()) && url.getPath().endsWith("/content")) return true;
            try {
                CloudProviderHttp.downloadHandoff(url.toExternalForm(), actual.getHeaderField("Location"));
                return true;
            } catch (CloudProviderHttp.Failure unsupported) {
                deniedHandoff = unsupported.handoffRefusal;
                return false;
            }
        }
        @Override public int getResponseCode() throws IOException {
            try {
                int status = actual.getResponseCode();
                receivedStatus = status;
                boolean download = downloadHandoff(status);
                if (!(status >= 200 && status < 300) && !download && !(status == 404 && absentNewGoogleSlot(url, actual.getRequestMethod()))) {
                    String stage = deniedHandoff == null ? "provider-status"
                            : "download-handoff-" + deniedHandoff.name().toLowerCase(java.util.Locale.ROOT);
                    stopped(new IOException("The real provider stopped the bounded SDK qualification."), stage, status, null);
                }
                String length = actual.getHeaderField("Content-Length");
                if (length != null && (!length.matches("[0-9]+") || Long.parseLong(length) > responseLimit())) {
                    IOException error = CloudJson.failure();
                    stopped(error, "response-length", status, responseLimit());
                    throw error;
                }
                return status;
            } catch (IOException error) { stopped(error, "response-status", receivedStatus, responseLimit()); throw error; }
            catch (NumberFormatException error) {
                IOException refused = CloudJson.failure(); stopped(refused, "response-length", receivedStatus, responseLimit()); throw refused;
            }
        }
        @Override public String getHeaderField(String key) { return actual.getHeaderField(key); }
        @Override public InputStream getInputStream() throws IOException {
            final InputStream stream;
            try { stream = actual.getInputStream(); }
            catch (IOException error) { stopped(error, "response-open", receivedStatus, responseLimit()); throw error; }
            return new java.io.FilterInputStream(stream) {
                int size;
                private void received(int count) throws IOException {
                    if (count <= 0) return;
                    size += count;
                    if (size > responseLimit()) {
                        IOException error = CloudJson.failure(); stopped(error, "response-body", receivedStatus, responseLimit()); throw error;
                    }
                }
                @Override public int read() throws IOException {
                    try { int value = in.read(); received(value < 0 ? 0 : 1); return value; }
                    catch (IOException error) { stopped(error, "response-read", receivedStatus, responseLimit()); throw error; }
                }
                @Override public int read(byte[] value, int offset, int length) throws IOException {
                    try { int count = in.read(value, offset, length); received(count); return count; }
                    catch (IOException error) { stopped(error, "response-read", receivedStatus, responseLimit()); throw error; }
                }
                @Override public void close() throws IOException {
                    try { in.close(); } catch (IOException error) { stopped(error, "response-close", receivedStatus, responseLimit()); throw error; }
                }
            };
        }
        @Override public void disconnect() { actual.disconnect(); }
        @Override public boolean usingProxy() { return actual.usingProxy(); }
        @Override public void connect() throws IOException {
            try { actual.connect(); } catch (IOException error) { stopped(error, "connection-start", receivedStatus, null); throw error; }
        }
        @Override public String getCipherSuite() { return actual.getCipherSuite(); }
        @Override public Certificate[] getLocalCertificates() { return actual.getLocalCertificates(); }
        @Override public Certificate[] getServerCertificates() throws SSLPeerUnverifiedException { return actual.getServerCertificates(); }
        @Override public Principal getPeerPrincipal() throws SSLPeerUnverifiedException { return actual.getPeerPrincipal(); }
        @Override public Principal getLocalPrincipal() { return actual.getLocalPrincipal(); }
    }
}
