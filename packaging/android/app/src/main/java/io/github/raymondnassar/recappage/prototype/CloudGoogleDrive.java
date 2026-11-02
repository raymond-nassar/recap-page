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
import java.util.regex.Pattern;

// Google Drive's four operations on Android, list, read, create and delete, in the visible "Recap Page"
// folder at the top of the person's Drive (owner, 2026-11-01). createGoogleDrive in host/googleDrive.mjs
// makes the same requests on Windows and records what each rests on; a comment there is the reason for the
// matching line here. Only this class sets Authorization, and only on a Drive request: an upload session's
// address is a capability in itself and never carries the token.
//
// What differs is the method a change is sent with. The platform's HttpURLConnection refuses PATCH, so a
// change goes as POST with X-HTTP-Method-Override: PATCH, the form Google documents for clients that cannot
// send PATCH (Drive API, "Improve performance", section "Patch", retrieved 2026-11-01).
final class CloudGoogleDrive implements CloudProvider.Drive {
    static final String DRIVE = "https://www.googleapis.com/drive/v3";
    static final String DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
    static final String FOLDER_NAME = "Recap Page";
    static final String FOLDER_TYPE = "application/vnd.google-apps.folder";
    private static final long METADATA_MS = 30_000;
    private static final int MAX_PAGES = 50;
    // Every unsettled session costs a request before each list, so only the newest are kept, as on Windows.
    static final int MAX_UNSETTLED = 16;
    private static final int SMALL = 64 * 1024;
    private static final int PAGE = 8 * 1024 * 1024;
    private static final String ITEM_FIELDS = "id,name,size,createdTime";
    private static final Pattern ITEM_ID = Pattern.compile("^[A-Za-z0-9_-]{1,256}$");
    private static final Pattern SIZE = Pattern.compile("^\\d{1,15}$");
    private static final Set<String> RATE_REASONS =
            new HashSet<>(java.util.Arrays.asList("rateLimitExceeded", "userRateLimitExceeded", "backendError"));
    private static final Set<String> QUOTA_REASONS = new HashSet<>(java.util.Arrays.asList("storageQuotaExceeded", "quotaExceeded"));
    private static final byte[] TRASH = "{\"trashed\":true}".getBytes(StandardCharsets.UTF_8);

    // Uploads under way and upload sessions that could not be settled, kept by the provider across
    // operations and connections, as CloudOneDrive.Tracker is. A session is kept with its size, which the
    // status query names.
    static final class Tracker {
        final Set<CompletableFuture<Void>> inflight = Collections.synchronizedSet(new HashSet<>());
        final Map<String, Map.Entry<String, Long>> unsettled = Collections.synchronizedMap(new LinkedHashMap<>());
    }

    static final class Identity {
        final String account;
        final String hint;
        final String folder;

        Identity(String account, String hint, String folder) {
            this.account = account;
            this.hint = hint;
            this.folder = folder;
        }
    }

    private final CloudHttp http;
    private final CloudOneDrive.Tokens tokens;
    private final LongSupplier clock;
    private final Tracker tracker;
    private final Consumer<String> onFolder;
    private String known;

    CloudGoogleDrive(CloudHttp http, CloudOneDrive.Tokens tokens, LongSupplier clock, Tracker tracker, String folder,
            Consumer<String> onFolder) {
        this.http = http;
        this.tokens = tokens;
        this.clock = clock;
        this.tracker = tracker;
        this.known = folder;
        this.onFolder = onFolder;
    }

    // Only the account authorizes a Drive request; a caller's Authorization in any case is refused (#996, S5-2).
    static Map<String, String> driveHeaders(Map<String, String> headers, String token) {
        for (String name : headers.keySet()) {
            if (name.toLowerCase(Locale.ROOT).equals("authorization")) {
                throw new IllegalArgumentException("Only the account sets Authorization on a Drive request.");
            }
        }
        Map<String, String> out = new LinkedHashMap<>(headers);
        out.put("authorization", "Bearer " + token);
        return out;
    }

    // A Drive query's string literal: backslashes and single quotes escaped, as Google's search guide asks.
    static String quoted(String text) {
        return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private static long transferMs(long bytes) {
        return 60_000 + ((bytes + 65_535) / 65_536) * 1000;
    }

    private static Map<String, String> jsonHeaders() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("content-type", "application/json; charset=utf-8");
        return headers;
    }

    private static Map<String, String> patchHeaders() {
        Map<String, String> headers = jsonHeaders();
        headers.put("x-http-method-override", "PATCH");
        return headers;
    }

    private CloudError gone() {
        return new CloudError("folder-gone", "The Recap Page folder was deleted from Google Drive.");
    }

    private CloudHttp.Response call(String method, String url, Map<String, String> headers, byte[] body, long timeoutMs, int maxBytes)
            throws CloudError {
        for (int attempt = 0; ; attempt++) {
            String token = tokens.accessToken(attempt > 0);
            CloudHttp.Response response;
            try {
                response = http.send(new CloudHttp.Request(method, url, driveHeaders(headers, token), body, timeoutMs, maxBytes));
            } catch (IOException error) {
                throw CloudMicrosoft.networkFailure(error, "Google Drive");
            }
            if (response.status == 401 && attempt == 0) continue;
            return response;
        }
    }

    private CloudHttp.Response get(String url, int maxBytes) throws CloudError {
        return call("GET", url, Collections.emptyMap(), null, METADATA_MS, maxBytes);
    }

    // Drive gives the reason for a 403 in its body, and a rate limit and a full account both arrive as 403.
    private CloudError failure(CloudHttp.Response response) {
        int status = response.status;
        long wait = CloudRules.retryAfterMs(response.header("retry-after"), clock.getAsLong());
        Set<String> reasons = new HashSet<>();
        Map<String, Object> body = status == 403 || status == 400 ? CloudMicrosoft.json(response) : null;
        Object error = body == null ? null : body.get("error");
        Object errors = error instanceof Map ? ((Map<?, ?>) error).get("errors") : null;
        if (errors instanceof List) {
            for (Object entry : (List<?>) errors) {
                Object reason = entry instanceof Map ? ((Map<?, ?>) entry).get("reason") : null;
                if (reason instanceof String) reasons.add((String) reason);
            }
        }
        if (status == 401) return new CloudError("needs-sign-in", "Google Drive asked for the sign-in to be made again.");
        if (status == 403 && !Collections.disjoint(reasons, QUOTA_REASONS)) {
            return new CloudError("quota", "Google Drive is full, so nothing more can be backed up there.");
        }
        if (status == 403 && !Collections.disjoint(reasons, RATE_REASONS)) {
            return new CloudError("unavailable", "Google Drive asked to wait before trying again.", wait);
        }
        if (status == 403) return new CloudError("refused", "Google Drive refused access to the Recap Page folder.");
        if (status == 404) return new CloudError("not-found", "That item is no longer in Google Drive.");
        if (status == 429 || status == 503) return new CloudError("unavailable", "Google Drive asked to wait before trying again.", wait);
        if (status >= 500) return new CloudError("unavailable", "Google Drive did not answer this time.");
        return new CloudError("invalid", "Google Drive answered in a way this version does not expect (" + status + ").");
    }

    static CloudOneDrive.Item item(Object value) {
        if (!(value instanceof Map)) return null;
        Map<?, ?> map = (Map<?, ?>) value;
        Object id = map.get("id");
        Object name = map.get("name");
        if (!(id instanceof String) || !ITEM_ID.matcher((String) id).matches()
                || !(name instanceof String) || ((String) name).isEmpty() || ((String) name).length() > 1024) return null;
        // Drive writes a file's size as a decimal string, because it is a 64-bit number.
        Object size = map.get("size");
        Long bytes = size instanceof String && SIZE.matcher((String) size).matches() ? Long.valueOf((String) size)
                : CloudRules.safeInteger(size) && (Double) size >= 0 ? (long) (double) (Double) size : null;
        Long created = null;
        Object when = map.get("createdTime");
        if (when instanceof String) {
            try {
                created = OffsetDateTime.parse((String) when).toInstant().toEpochMilli();
            } catch (DateTimeParseException error) {
                created = null;
            }
        }
        return new CloudOneDrive.Item((String) id, (String) name, bytes, created);
    }

    private static String param(String name, String value) {
        return CloudRules.form(name, value).replace("+", "%20");
    }

    private Map<String, Object> files(String query, String fields, String orderBy, String pageToken, int pageSize) throws CloudError {
        StringBuilder url = new StringBuilder(DRIVE).append("/files?").append(param("q", query))
                .append('&').append(param("fields", fields)).append('&').append(param("spaces", "drive"))
                .append('&').append(param("pageSize", String.valueOf(pageSize)));
        if (orderBy != null) url.append('&').append(param("orderBy", orderBy));
        if (pageToken != null) url.append('&').append(param("pageToken", pageToken));
        CloudHttp.Response response = get(url.toString(), PAGE);
        if (!response.ok()) throw failure(response);
        Map<String, Object> body = CloudMicrosoft.json(response);
        if (body == null || !(body.get("files") instanceof List)) {
            throw new CloudError("invalid", "Google Drive listed files in a way this version does not expect.");
        }
        return body;
    }

    // The oldest folder of the name at the top of the Drive, among those this app can see. Two devices that
    // made one at the same moment both settle on the older, so their backups meet in one place.
    private String findFolder() throws CloudError {
        Map<String, Object> body = files("name = " + quoted(FOLDER_NAME) + " and mimeType = " + quoted(FOLDER_TYPE)
                + " and 'root' in parents and trashed = false", "files(id,createdTime)", "createdTime", null, 10);
        for (Object entry : (List<?>) body.get("files")) {
            Object id = entry instanceof Map ? ((Map<?, ?>) entry).get("id") : null;
            if (id instanceof String && ITEM_ID.matcher((String) id).matches()) return (String) id;
        }
        return null;
    }

    // The folder the account recorded, if the person has not deleted it. A folder in the trash counts as
    // deleted: its files are still listed under it, but they are on their way out of the account.
    private void checkFolder(String id) throws CloudError {
        CloudHttp.Response response = get(DRIVE + "/files/" + CloudOneDrive.segment(id) + "?fields=id,trashed", SMALL);
        if (response.status == 404) throw gone();
        if (!response.ok()) throw failure(response);
        Map<String, Object> body = CloudMicrosoft.json(response);
        if (body != null && Boolean.TRUE.equals(body.get("trashed"))) throw gone();
        if (body == null || !id.equals(body.get("id"))) {
            throw new CloudError("invalid", "Google Drive described the Recap Page folder in a way this version does not expect.");
        }
    }

    private String makeFolder() throws CloudError {
        Map<String, Object> folder = new LinkedHashMap<>();
        folder.put("name", FOLDER_NAME);
        folder.put("mimeType", FOLDER_TYPE);
        folder.put("parents", Collections.singletonList("root"));
        CloudHttp.Response response = call("POST", DRIVE + "/files?fields=id", jsonHeaders(),
                CloudJson.write(folder).getBytes(StandardCharsets.UTF_8), METADATA_MS, SMALL);
        if (!response.ok()) throw failure(response);
        Map<String, Object> body = CloudMicrosoft.json(response);
        Object id = body == null ? null : body.get("id");
        if (!(id instanceof String) || !ITEM_ID.matcher((String) id).matches()) {
            throw new CloudError("invalid", "Google Drive did not say which folder it made.");
        }
        // Another device may have made one at the same moment. The oldest wins, and an empty one this create
        // made is put in the trash rather than left beside it.
        String oldest;
        try {
            oldest = findFolder();
        } catch (CloudError error) {
            oldest = (String) id;
        }
        if (oldest != null && !oldest.equals(id)) {
            try {
                call("POST", DRIVE + "/files/" + CloudOneDrive.segment((String) id) + "?fields=id", patchHeaders(), TRASH, METADATA_MS, SMALL);
            } catch (CloudError ignored) {
                // An empty folder left beside the oldest does no harm.
            }
            return oldest;
        }
        return (String) id;
    }

    private String folderForCreate() throws CloudError {
        if (known != null) return known;
        String id = findFolder();
        if (id == null) id = makeFolder();
        known = id;
        onFolder.accept(id);
        return id;
    }

    // What became of an upload whose reply was lost. Asking a resumable session how much it holds answers
    // with the file once it is complete, or 308 while bytes are missing; nothing resumes it, so a 308 is a
    // backup that never arrives. Null leaves the outcome unknown, which the contract calls a timeout. The
    // query carries an empty body, so the platform sends the Content-Length of 0 Google's guide shows.
    private static final class Settled {
        final boolean complete;
        final CloudOneDrive.Item done;

        Settled(boolean complete, CloudOneDrive.Item done) {
            this.complete = complete;
            this.done = done;
        }
    }

    private Settled status(String upload, long size) {
        Map<String, String> range = new LinkedHashMap<>();
        range.put("content-range", "bytes */" + size);
        try {
            CloudHttp.Response response = http.send(new CloudHttp.Request("PUT", upload, range, new byte[0], METADATA_MS, SMALL));
            if (response.status == 200 || response.status == 201) return new Settled(true, item(CloudMicrosoft.json(response)));
            if (response.status == 308 || response.status == 404 || response.status == 410) return new Settled(false, null);
        } catch (IOException error) {
            // Unknown.
        }
        return null;
    }

    private CloudOneDrive.Item settle(String name, String upload, long size, long wait) throws CloudError {
        Settled answer = status(upload, size);
        if (answer == null) {
            synchronized (tracker.unsettled) {
                tracker.unsettled.remove(name);
                tracker.unsettled.put(name, new java.util.AbstractMap.SimpleImmutableEntry<>(upload, size));
                java.util.Iterator<String> oldest = tracker.unsettled.keySet().iterator();
                while (tracker.unsettled.size() > MAX_UNSETTLED) {
                    oldest.next();
                    oldest.remove();
                }
            }
            throw new CloudError("timeout", "Google Drive did not say whether the backup was saved.");
        }
        if (answer.done != null && answer.done.name.equals(name)) return answer.done;
        // Complete, with an answer this version cannot read: the file is there, so the next list shows it, and
        // calling the create refused would break the promise that a refused create never appears later.
        if (answer.complete) throw new CloudError("timeout", "Google Drive did not say whether the backup was saved.");
        throw new CloudError("unavailable", "The backup did not reach Google Drive.", wait > 0 ? wait : 0);
    }

    private CloudOneDrive.Item createOnce(String name, byte[] bytes) throws CloudError {
        String parent = folderForCreate();
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("name", name);
        metadata.put("parents", Collections.singletonList(parent));
        metadata.put("mimeType", "application/octet-stream");
        Map<String, String> headers = jsonHeaders();
        headers.put("x-upload-content-type", "application/octet-stream");
        headers.put("x-upload-content-length", String.valueOf(bytes.length));
        CloudHttp.Response opened = call("POST", DRIVE_UPLOAD + "/files?uploadType=resumable&fields=" + ITEM_FIELDS + ",parents",
                headers, CloudJson.write(metadata).getBytes(StandardCharsets.UTF_8), METADATA_MS, SMALL);
        if (opened.status == 404) throw gone();
        if (!opened.ok()) throw failure(opened);
        String upload = CloudRules.capabilityUrl(opened.header("location"));
        if (upload == null) throw new CloudError("invalid", "Google Drive did not return a usable upload address.");
        Map<String, String> type = new LinkedHashMap<>();
        type.put("content-type", "application/octet-stream");
        CloudHttp.Response response;
        try {
            response = http.send(new CloudHttp.Request("PUT", upload, type, bytes, transferMs(bytes.length), SMALL));
        } catch (IOException error) {
            return settle(name, upload, bytes.length, 0);
        }
        if (response.status == 200 || response.status == 201) {
            CloudOneDrive.Item created = item(CloudMicrosoft.json(response));
            if (created == null || !created.name.equals(name)) return settle(name, upload, bytes.length, 0);
            return created;
        }
        // A timeout or a server failure may come after every byte arrived, so it is settled as a lost reply
        // is: a create refused with any code but timeout must never appear later (stage 2 review, L1).
        if (response.status == 408 || response.status == 308 || response.status >= 500) {
            return settle(name, upload, bytes.length, CloudRules.retryAfterMs(response.header("retry-after"), clock.getAsLong()));
        }
        throw failure(response);
    }

    // The account and the folder, asked once at sign-in. The account is Drive's permission id for the
    // person, which stays the same for their account; the email address is shown on the card.
    Identity identify() throws CloudError {
        CloudHttp.Response response = get(DRIVE + "/about?" + param("fields", "user(emailAddress,displayName,permissionId)"), SMALL);
        if (!response.ok()) throw failure(response);
        Map<String, Object> body = CloudMicrosoft.json(response);
        Object user = body == null ? null : body.get("user");
        Map<?, ?> fields = user instanceof Map ? (Map<?, ?>) user : Collections.emptyMap();
        String id = CloudRules.displayText(fields.get("permissionId"));
        if (id == null) throw new CloudError("invalid", "Google did not confirm which account signed in.");
        String hint = CloudRules.displayText(fields.get("emailAddress"));
        if (hint == null) hint = CloudRules.displayText(fields.get("displayName"));
        return new Identity("google:" + id, hint, known != null ? known : findFolder());
    }

    // Every backup in the Recap Page folder, all pages. No folder yet lists as empty; the folder the account
    // recorded gone or in the trash means the person deleted it.
    @Override
    public List<CloudOneDrive.Item> list() throws CloudError {
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
        List<Map.Entry<String, Map.Entry<String, Long>>> waiting;
        synchronized (tracker.unsettled) {
            waiting = new ArrayList<>(tracker.unsettled.entrySet());
        }
        for (Map.Entry<String, Map.Entry<String, Long>> entry : waiting) {
            if (status(entry.getValue().getKey(), entry.getValue().getValue()) != null) {
                tracker.unsettled.remove(entry.getKey(), entry.getValue());
            }
        }
        if (known != null) {
            checkFolder(known);
        } else {
            known = findFolder();
            if (known == null) return new ArrayList<>();
            onFolder.accept(known);
        }
        List<CloudOneDrive.Item> items = new ArrayList<>();
        String pageToken = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            Map<String, Object> body = files(quoted(known) + " in parents and trashed = false",
                    "nextPageToken,files(" + ITEM_FIELDS + ")", null, pageToken, 1000);
            for (Object value : (List<?>) body.get("files")) {
                CloudOneDrive.Item found = item(value);
                if (found != null) items.add(found);
            }
            if (!body.containsKey("nextPageToken")) return items;
            Object next = body.get("nextPageToken");
            if (!(next instanceof String) || ((String) next).isEmpty() || ((String) next).length() > 4096) {
                throw new CloudError("invalid", "Google Drive pointed the next page somewhere this version does not expect.");
            }
            pageToken = (String) next;
        }
        throw new CloudError("invalid", "The Recap Page folder holds more items than this version reads.");
    }

    @Override
    public byte[] read(String id) throws CloudError {
        CloudHttp.Response content = call("GET", DRIVE + "/files/" + CloudOneDrive.segment(id) + "?alt=media",
                Collections.emptyMap(), null, transferMs(CloudRules.MAX_ITEM_BYTES), CloudRules.MAX_ITEM_BYTES);
        if (content.status != 200) throw failure(content);
        // Read to the cap and no further, whatever the response declares.
        if (content.tooLarge) throw new CloudError("too-large", "That item is larger than a cloud backup can be.");
        if (content.broken || content.body == null) throw new CloudError("unavailable", "The download from Google Drive stopped part way.");
        return content.body;
    }

    @Override
    public CloudOneDrive.Item create(String name, byte[] bytes) throws CloudError {
        CompletableFuture<Void> job = new CompletableFuture<>();
        tracker.inflight.add(job);
        try {
            return createOnce(name, bytes);
        } finally {
            tracker.inflight.remove(job);
            job.complete(null);
        }
    }

    // Put in the person's Drive trash, where it stays for 30 days, as OneDrive's recycle bin keeps a
    // deleted backup. An item already gone counts as deleted.
    @Override
    public void delete(String id) throws CloudError {
        CloudHttp.Response response = call("POST", DRIVE + "/files/" + CloudOneDrive.segment(id) + "?fields=id", patchHeaders(),
                TRASH, METADATA_MS, SMALL);
        if (response.status == 404) return;
        if (!response.ok()) throw failure(response);
    }
}
