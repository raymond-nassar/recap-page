package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

final class CloudJournal {
    static final int LIMIT = 8192;
    interface Check { void check(Map<String, Object> value) throws IOException; }
    interface Transition { void check(Map<String, Object> before, Map<String, Object> after) throws IOException; }
    interface Change { Map<String, Object> apply(Map<String, Object> value) throws Exception; }
    interface Visit { void visit(Map<String, Object> value, boolean checkpoint) throws IOException; }
    interface Work<T> { T run() throws Exception; }
    static final class Head {
        final long sequence;
        final Map<String, Object> state;
        final byte[] bytes;
        final long base;
        final boolean maintenance;
        Head(long sequence, Map<String, Object> state, byte[] bytes, long base, boolean maintenance) {
            this.sequence = sequence; this.state = state; this.bytes = bytes; this.base = base; this.maintenance = maintenance;
        }
    }
    private final Path root;
    private final String format;
    private final Check validate;
    private final Transition transition;

    CloudJournal(Path root, String format, Map<String, Object> initial, Check validate, Transition transition) throws IOException {
        this.root = root.toAbsolutePath().normalize();
        this.format = format;
        this.validate = validate;
        this.transition = transition;
        boolean existed = Files.exists(this.root, LinkOption.NOFOLLOW_LINKS);
        directory(this.root);
        locked(() -> {
            List<Path> entries = entries();
            if (!existed && entries.size() == 1 && entries.get(0).getFileName().toString().equals("owner.lock")) {
                validate.check(initial);
                transition.check(null, initial);
                exclusive(this.root.resolve(name(0)), record(0, null, "state", initial));
            }
            load(null);
            return null;
        });
    }
    static void directory(Path root) throws IOException {
        Path absolute = root.toAbsolutePath().normalize();
        Path current = absolute.getRoot();
        for (Path part : absolute) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw CloudJson.failure();
            if (!Files.exists(current, LinkOption.NOFOLLOW_LINKS)) {
                try { Files.createDirectory(current); }
                catch (java.nio.file.FileAlreadyExistsException error) {
                    if (!Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) throw error;
                }
            }
            if (!Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
        }
    }
    static void exclusive(Path path, byte[] bytes) throws IOException {
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            java.nio.ByteBuffer data = java.nio.ByteBuffer.wrap(bytes);
            while (data.hasRemaining()) channel.write(data);
            channel.force(true);
        }
        if (!Arrays.equals(bytes, read(path, bytes.length))) throw CloudJson.failure();
    }
    static void pruneUploadDirectory(Path client) throws IOException {
        Path provider = client.getParent();
        Path reference = provider == null ? null : provider.getParent();
        Path boundary = reference == null ? null : reference.getParent();
        if (boundary == null || !"cloud-upload-v1".equals(boundary.getFileName().toString())
                || !CloudJson.hex(client.getFileName().toString()) || !CloudJson.hex(reference.getFileName().toString())
                || !Arrays.asList("google", "microsoft").contains(provider.getFileName().toString())) throw CloudJson.failure();
        for (Path directory : Arrays.asList(client, provider, reference)) {
            if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) continue;
            if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) throw CloudJson.failure();
            try (Stream<Path> entries = Files.list(directory)) { if (entries.findAny().isPresent()) throw CloudJson.failure(); }
            Files.delete(directory);
        }
    }
    static byte[] read(Path path, int limit) throws IOException {
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
                || Files.size(path) < 1 || Files.size(path) > limit) throw CloudJson.failure();
        byte[] value = Files.readAllBytes(path);
        if (value.length > limit) throw CloudJson.failure();
        return value;
    }
    <T> T locked(Work<T> work) throws IOException {
        Path path = root.resolve("owner.lock");
        if (Files.isSymbolicLink(path)) throw CloudJson.failure();
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            FileLock lease;
            try { lease = channel.tryLock(); } catch (OverlappingFileLockException error) { throw CloudJson.failure(); }
            if (lease == null) throw CloudJson.failure();
            try { return work.run(); } finally { lease.release(); }
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw CloudJson.failure(); }
    }
    private String name(long value) { return String.format(java.util.Locale.ROOT, "%016d.json", value); }
    private byte[] record(long sequence, String previous, String kind, Map<String, Object> state) throws IOException {
        if (sequence < 0 || sequence > CloudJson.MAX_INTEGER) throw CloudJson.failure();
        byte[] value = CloudJson.bytes(CloudJson.map("format", format, "version", 1, "sequence", sequence,
                "previous", previous, "kind", kind, "state", state));
        if (value.length > 32768) throw CloudJson.failure();
        return value;
    }
    private List<Path> entries() throws IOException {
        try (Stream<Path> files = Files.list(root)) {
            List<Path> result = new ArrayList<>();
            files.forEach(result::add);
            if (result.size() > LIMIT * 4) throw CloudJson.failure();
            result.sort(Comparator.comparing((path) -> path.getFileName().toString()));
            return result;
        }
    }
    private Map<String, Object> decode(byte[] bytes) throws IOException {
        Map<String, Object> value = CloudJson.object(CloudJson.parse(bytes, 32768));
        if (!CloudJson.exact(value, "format", "version", "sequence", "previous", "kind", "state")
                || !format.equals(value.get("format")) || CloudJson.integer(value.get("version")) != 1
                || !Arrays.asList("state", "maintenance").contains(value.get("kind"))
                || value.get("previous") != null && !CloudJson.hex(value.get("previous"))
                || !Arrays.equals(bytes, CloudJson.bytes(value))) throw CloudJson.failure();
        validate.check(CloudJson.object(value.get("state")));
        return value;
    }
    Head load(Visit visit) throws IOException {
        List<Path> files = entries();
        Path checkpoint = null;
        for (Path file : files) {
            String name = file.getFileName().toString();
            if (name.equals("owner.lock")) continue;
            if (!name.matches("(?:c-)?\\d{16}\\.json")) throw CloudJson.failure();
            if (name.startsWith("c-")) checkpoint = file;
        }
        Head head = null;
        long base = -1;
        if (checkpoint != null) {
            byte[] bytes = read(checkpoint, 32768);
            Map<String, Object> value = decode(bytes);
            base = CloudJson.integer(value.get("sequence"));
            if (!checkpoint.getFileName().toString().equals("c-" + name(base)) || !"maintenance".equals(value.get("kind"))) throw CloudJson.failure();
            head = new Head(base, CloudJson.object(value.get("state")), bytes, base, false);
            if (visit != null) visit.visit(head.state, true);
        }
        int count = 0;
        for (Path file : files) {
            String fileName = file.getFileName().toString();
            if (!fileName.matches("\\d{16}\\.json") || fileName.compareTo(name(base < 0 ? 0 : base)) < (base < 0 ? 0 : 1)) continue;
            if (++count > LIMIT + 1 || head != null && head.maintenance) throw CloudJson.failure();
            byte[] bytes = read(file, 32768);
            Map<String, Object> value = decode(bytes);
            long sequence = CloudJson.integer(value.get("sequence"));
            if (sequence != (head == null ? 0 : head.sequence + 1) || !fileName.equals(name(sequence))
                    || !(head == null ? value.get("previous") == null : CloudJson.hash(head.bytes).equals(value.get("previous")))) throw CloudJson.failure();
            Map<String, Object> state = CloudJson.object(value.get("state"));
            boolean maintenance = "maintenance".equals(value.get("kind"));
            if (maintenance) {
                if (head == null || !CloudJson.canonical(head.state).equals(CloudJson.canonical(state))) throw CloudJson.failure();
            } else transition.check(head == null ? null : head.state, state);
            head = new Head(sequence, state, bytes, base, maintenance);
            if (visit != null) visit.visit(state, false);
        }
        if (head == null || count > LIMIT && !head.maintenance) throw CloudJson.failure();
        return head;
    }
    Head inspect() throws IOException { return locked(() -> load(null)); }
    Head scan(Visit visit) throws IOException { return locked(() -> load(visit)); }
    Head update(long expected, Change change) throws IOException {
        return locked(() -> {
            Head head = load(null);
            if (head.sequence != expected || head.maintenance || head.sequence - head.base >= LIMIT) throw CloudJson.failure();
            Map<String, Object> state = change.apply(CloudJson.object(CloudJson.copy(head.state)));
            validate.check(state);
            transition.check(head.state, state);
            byte[] bytes = record(head.sequence + 1, CloudJson.hash(head.bytes), "state", state);
            exclusive(root.resolve(name(head.sequence + 1)), bytes);
            return new Head(head.sequence + 1, state, bytes, head.base, false);
        });
    }
    Head compact(Check safe) throws IOException {
        return locked(() -> {
            Head head = load(null);
            safe.check(head.state);
            long sequence = head.maintenance ? head.sequence : head.sequence + 1;
            byte[] bytes = head.maintenance ? head.bytes : record(sequence, CloudJson.hash(head.bytes), "maintenance", head.state);
            if (!head.maintenance) exclusive(root.resolve(name(sequence)), bytes);
            Path checkpoint = root.resolve("c-" + name(sequence));
            exclusive(checkpoint, bytes);
            for (Path file : entries()) {
                String entry = file.getFileName().toString();
                if (file.equals(checkpoint) || entry.equals("owner.lock")) continue;
                read(file, 32768);
                Files.delete(file);
            }
            return load(null);
        });
    }
}
