package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.LongSupplier;

// The four operations on the app's own OneDrive folder, list, read, create and delete, exactly as
// createOneDrive in host/oneDrive.mjs makes them on Windows, which records the observations each request
// rests on. Only this class sets Authorization, and only on a Graph request: an upload session's address
// and a download's are capabilities in themselves, and never carry the token.
final class CloudOneDrive implements CloudProvider.Drive {
    static final String GRAPH = "https://graph.microsoft.com/v1.0";
    private static final long METADATA_MS = 30_000;
    private static final int MAX_PAGES = 50;
    private static final int SMALL = 64 * 1024;
    private static final int JSON = 1024 * 1024;
    private static final int PAGE = 8 * 1024 * 1024;
    private static final String ITEM_FIELDS = "$select=id,name,size,createdDateTime";
    // Only the conflict behavior: a name here would have to equal the path's, which the reference requires.
    private static final byte[] CREATE_SESSION =
            "{\"item\":{\"@microsoft.graph.conflictBehavior\":\"fail\"}}".getBytes(StandardCharsets.UTF_8);

    interface Tokens {
        String accessToken(boolean renew) throws CloudError;
    }

    // Uploads under way and upload sessions that could not be settled, kept by the account across
    // operations and connections: a list waits for the first and cancels the second, so nothing a reply
    // said had failed can appear in the account after a list that missed it.
    static final class Tracker {
        final Set<CompletableFuture<Void>> inflight = Collections.synchronizedSet(new HashSet<>());
        final Map<String, String> unsettled = Collections.synchronizedMap(new LinkedHashMap<>());
    }

    static final class Item {
        final String id;
        final String name;
        final Long size;
        final Long created;

        Item(String id, String name, Long size, Long created) {
            this.id = id;
            this.name = name;
            this.size = size;
            this.created = created;
        }

        Map<String, Object> toJson() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("name", name);
            out.put("size", size);
            out.put("created", created);
            return out;
        }
    }

    static final class AppFolder {
        final String id;
        final String driveId;

        AppFolder(String id, String driveId) {
            this.id = id;
            this.driveId = driveId;
        }
    }

    private final CloudHttp http;
    private final Tokens tokens;
    private final LongSupplier clock;
    private final Tracker tracker;
    private final String folder;
    private final Consumer<String> onFolder;
    private final String base;

    CloudOneDrive(CloudHttp http, Tokens tokens, LongSupplier clock, Tracker tracker, String folder, Consumer<String> onFolder) {
        this.http = http;
        this.tokens = tokens;
        this.clock = clock;
        this.tracker = tracker;
        this.folder = folder;
        this.onFolder = onFolder;
        // The app folder by its item id once known, so a folder the person deleted answers 404 rather than
        // being made again without a word; until then the special app-root path, which Microsoft resolves.
        this.base = folder != null ? "/me/drive/items/" + segment(folder) : "/me/drive/special/approot";
    }

    // As encodeURIComponent writes a path segment.
    static String segment(String value) {
        StringBuilder out = new StringBuilder();
        for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || "-_.!~*'()".indexOf(c) >= 0) {
                out.append((char) c);
            } else {
                out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 0xf, 16)));
            }
        }
        return out.toString();
    }

    // Only the account authorizes a Graph request. Header names are not case sensitive, so a caller's
    // Authorization in any case would travel beside the account's as a second header, and is refused
    // instead, as graphHeaders refuses it on Windows (#996, S5-2).
    static Map<String, String> graphHeaders(Map<String, String> headers, String token) {
        for (String name : headers.keySet()) {
            if (name.toLowerCase(Locale.ROOT).equals("authorization")) {
                throw new IllegalArgumentException("Only the account sets Authorization on a Graph request.");
            }
        }
        Map<String, String> out = new LinkedHashMap<>(headers);
        out.put("authorization", "Bearer " + token);
        return out;
    }

    private static long transferMs(long bytes) {
        return 60_000 + ((bytes + 65_535) / 65_536) * 1000;
    }

    private CloudError gone() {
        return new CloudError("folder-gone", "The Recap Page folder was deleted from OneDrive.");
    }

    private CloudHttp.Response call(String method, String path, Map<String, String> headers, byte[] body, int maxBytes) throws CloudError {
        for (int attempt = 0; ; attempt++) {
            String token = tokens.accessToken(attempt > 0);
            CloudHttp.Response response;
            try {
                response = http.send(new CloudHttp.Request(method, GRAPH + path, graphHeaders(headers, token), body, METADATA_MS, maxBytes));
            } catch (IOException error) {
                throw CloudMicrosoft.networkFailure(error, "OneDrive");
            }
            if (response.status == 401 && attempt == 0) continue;
            return response;
        }
    }

    private CloudHttp.Response call(String method, String path, int maxBytes) throws CloudError {
        return call(method, path, Collections.emptyMap(), null, maxBytes);
    }

    private CloudError failure(CloudHttp.Response response) {
        int status = response.status;
        long wait = CloudRules.retryAfterMs(response.header("retry-after"), clock.getAsLong());
        if (status == 401) return new CloudError("needs-sign-in", "OneDrive asked for the sign-in to be made again.");
        if (status == 403) return new CloudError("refused", "OneDrive refused access to the app folder.");
        if (status == 404) return new CloudError("not-found", "That item is no longer in OneDrive.");
        if (status == 409) return new CloudError("exists", "OneDrive already holds an item with that name.");
        if (status == 429 || status == 503) return new CloudError("unavailable", "OneDrive asked to wait before trying again.", wait);
        if (status == 507) return new CloudError("quota", "OneDrive is full, so nothing more can be backed up there.");
        if (status >= 500) return new CloudError("unavailable", "OneDrive did not answer this time.");
        return new CloudError("invalid", "OneDrive answered in a way this version does not expect (" + status + ").");
    }

    static Item item(Object value) {
        if (!(value instanceof Map)) return null;
        Map<?, ?> map = (Map<?, ?>) value;
        Object id = map.get("id");
        Object name = map.get("name");
        if (!(id instanceof String) || !CloudRules.ITEM_ID.matcher((String) id).matches()
                || !(name instanceof String) || ((String) name).isEmpty() || ((String) name).length() > 1024) return null;
        Object size = map.get("size");
        Long created = null;
        Object when = map.get("createdDateTime");
        if (when instanceof String) {
            try {
                created = OffsetDateTime.parse((String) when).toInstant().toEpochMilli();
            } catch (DateTimeParseException error) {
                created = null;
            }
        }
        return new Item((String) id, (String) name,
                CloudRules.safeInteger(size) && (Double) size >= 0 ? (long) (double) (Double) size : null, created);
    }

    private static Object path(Map<String, Object> body, String first, String second) {
        Object inner = body == null ? null : body.get(first);
        return inner instanceof Map ? ((Map<?, ?>) inner).get(second) : null;
    }

    private static boolean itemId(Object value) {
        return value instanceof String && CloudRules.ITEM_ID.matcher((String) value).matches();
    }

    // Cancelling a session makes it unable to complete later. A session that is already gone, because it
    // completed or expired, answers 404, which settles it just as well.
    private boolean cancel(String upload) {
        try {
            CloudHttp.Response response = http.send(new CloudHttp.Request("DELETE", upload, Collections.emptyMap(), null, METADATA_MS, SMALL));
            return response.status == 204 || response.status == 404;
        } catch (IOException error) {
            return false;
        }
    }

    private Item lookup(String name) throws CloudError {
        CloudHttp.Response response = call("GET", base + ":/" + segment(name) + "?" + ITEM_FIELDS, JSON);
        if (response.status == 404) return null;
        if (!response.ok()) throw failure(response);
        Item found = item(CloudMicrosoft.json(response));
        if (found == null) throw new CloudError("invalid", "OneDrive described the item in a way this version does not expect.");
        return found;
    }

    // An upload that got no answer may still have been committed. Its session is cancelled first, so nothing
    // can complete after this reply, and then its name is looked up: the file is there now, or never will be.
    // A session that cannot be cancelled leaves the outcome unknown, which the contract calls a timeout: the
    // next list cancels it first and shows whether it landed. A wait the service asked for is kept when the
    // file is not there.
    private Item settle(String name, String upload, long wait) throws CloudError {
        if (!cancel(upload)) {
            tracker.unsettled.put(name, upload);
            throw new CloudError("timeout", "OneDrive did not say whether the backup was saved.");
        }
        Item found = lookup(name);
        if (found == null) throw new CloudError("unavailable", "The backup did not reach OneDrive.", wait > 0 ? wait : 0);
        return found;
    }

    private Item createOnce(String name, byte[] bytes) throws CloudError {
        Map<String, String> json = new LinkedHashMap<>();
        json.put("content-type", "application/json");
        CloudHttp.Response opened = call("POST", base + ":/" + segment(name) + ":/createUploadSession", json, CREATE_SESSION, SMALL);
        if (opened.status == 404 && folder != null) throw gone();
        if (!opened.ok()) throw failure(opened);
        Map<String, Object> session = CloudMicrosoft.json(opened);
        String upload = CloudRules.capabilityUrl(session == null ? null : session.get("uploadUrl"));
        if (upload == null) throw new CloudError("invalid", "OneDrive did not return a usable upload address.");
        Map<String, String> range = new LinkedHashMap<>();
        range.put("content-range", "bytes 0-" + (bytes.length - 1) + "/" + bytes.length);
        CloudHttp.Response response;
        try {
            response = http.send(new CloudHttp.Request("PUT", upload, range, bytes, transferMs(bytes.length), SMALL));
        } catch (IOException error) {
            return settle(name, upload, 0);
        }
        if (response.status == 200 || response.status == 201) {
            Map<String, Object> body = CloudMicrosoft.json(response);
            Item created = item(body);
            if (created == null || !created.name.equals(name)) return settle(name, upload, 0);
            // A folder made again by this create, after the old one was deleted, is learned from its answer,
            // so a later deletion is noticed again.
            Object parent = path(body, "parentReference", "id");
            if (folder == null && itemId(parent)) onFolder.accept((String) parent);
            return created;
        }
        if (response.status == 202) return settle(name, upload, 0);
        // A timeout or a server failure may come after every byte was committed, so it is settled as a lost
        // reply is: a create refused with any code but timeout must never appear later. Other refusals are
        // definite, and the session is cancelled so its bytes can never be committed under another name.
        if (response.status == 408 || (response.status >= 500 && response.status != 507)) {
            return settle(name, upload, CloudRules.retryAfterMs(response.header("retry-after"), clock.getAsLong()));
        }
        CloudError refused = failure(response);
        cancel(upload);
        throw refused;
    }

    // The app folder's own id, and its drive, which names the account: a later sign-in to the same drive
    // and the same folder keeps the connection, so no browser has to agree to backups again.
    AppFolder appFolder() throws CloudError {
        CloudHttp.Response response = call("GET", "/me/drive/special/approot?$select=id,parentReference", SMALL);
        if (response.status == 404) return new AppFolder(null, null);
        if (!response.ok()) throw failure(response);
        Map<String, Object> body = CloudMicrosoft.json(response);
        Object id = body == null ? null : body.get("id");
        Object drive = path(body, "parentReference", "driveId");
        return new AppFolder(itemId(id) ? (String) id : null, itemId(drive) ? (String) drive : null);
    }

    // Every item in the app folder, all pages. A folder not made yet lists as empty; the folder the account
    // recorded answering 404 means the person deleted it.
    @Override
    public List<Item> list() throws CloudError {
        List<CompletableFuture<Void>> running;
        synchronized (tracker.inflight) {
            running = new ArrayList<>(tracker.inflight);
        }
        for (CompletableFuture<Void> job : running) {
            try {
                job.join();
            } catch (RuntimeException ignored) {
                // Only that it has finished matters here.
            }
        }
        List<Map.Entry<String, String>> waiting;
        synchronized (tracker.unsettled) {
            waiting = new ArrayList<>(tracker.unsettled.entrySet());
        }
        for (Map.Entry<String, String> entry : waiting) {
            if (cancel(entry.getValue())) tracker.unsettled.remove(entry.getKey(), entry.getValue());
        }
        List<Item> items = new ArrayList<>();
        String path = base + "/children?" + ITEM_FIELDS + "&$top=200";
        for (int page = 0; page < MAX_PAGES; page++) {
            CloudHttp.Response response = call("GET", path, PAGE);
            if (response.status == 404 && page == 0) {
                if (folder != null) throw gone();
                return items;
            }
            if (!response.ok()) throw failure(response);
            Map<String, Object> body = CloudMicrosoft.json(response);
            Object value = body == null ? null : body.get("value");
            if (!(value instanceof List)) {
                throw new CloudError("invalid", "OneDrive listed the app folder in a way this version does not expect.");
            }
            for (Object entry : (List<?>) value) {
                Item found = item(entry);
                if (found != null) items.add(found);
            }
            if (!body.containsKey("@odata.nextLink")) return items;
            Object next = body.get("@odata.nextLink");
            if (!(next instanceof String) || !((String) next).startsWith(GRAPH + "/")) {
                throw new CloudError("invalid", "OneDrive pointed the next page somewhere this version does not expect.");
            }
            path = ((String) next).substring(GRAPH.length());
        }
        throw new CloudError("invalid", "The app folder holds more items than this version reads.");
    }

    @Override
    public byte[] read(String id) throws CloudError {
        CloudHttp.Response content = call("GET", "/me/drive/items/" + segment(id) + "/content", CloudRules.MAX_ITEM_BYTES);
        if (content.status == 302) {
            String download = CloudRules.capabilityUrl(content.header("location"));
            if (download == null) throw new CloudError("invalid", "OneDrive pointed the download somewhere this version does not expect.");
            try {
                content = http.send(new CloudHttp.Request("GET", download, Collections.emptyMap(), null,
                        transferMs(CloudRules.MAX_ITEM_BYTES), CloudRules.MAX_ITEM_BYTES));
            } catch (IOException error) {
                throw CloudMicrosoft.networkFailure(error, "OneDrive");
            }
        }
        if (content.status != 200) throw failure(content);
        // Read to the cap and no further, whatever the response declares, so an item over it is refused
        // without its bytes ever being returned.
        if (content.tooLarge) throw new CloudError("too-large", "That item is larger than a cloud backup can be.");
        if (content.broken || content.body == null) throw new CloudError("unavailable", "The download from OneDrive stopped part way.");
        return content.body;
    }

    @Override
    public Item create(String name, byte[] bytes) throws CloudError {
        CompletableFuture<Void> job = new CompletableFuture<>();
        tracker.inflight.add(job);
        try {
            return createOnce(name, bytes);
        } finally {
            tracker.inflight.remove(job);
            job.complete(null);
        }
    }

    // An item already gone counts as deleted. OneDrive keeps every deleted item in the person's recycle bin
    // for up to 30 days, because the app-folder permission cannot delete permanently.
    @Override
    public void delete(String id) throws CloudError {
        CloudHttp.Response response = call("DELETE", "/me/drive/items/" + segment(id), SMALL);
        if (response.status == 204 || response.status == 404) return;
        throw failure(response);
    }
}
