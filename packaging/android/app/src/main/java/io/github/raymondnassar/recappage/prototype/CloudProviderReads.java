package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.Map;

final class CloudProviderReads {
    private static final int METADATA_BYTES = 1024 * 1024;
    private static final int LIST_BYTES = 8 * METADATA_BYTES;
    private static final String GOOGLE_FIELDS = "id,name,size,mimeType,spaces,trashed,modifiedTime";
    private static final String MICROSOFT_FIELDS = "id,name,size,file,folder,package,remoteItem,deleted,parentReference,lastModifiedDateTime,eTag";
    private final CloudProviderHttp http;
    private final CloudProviderHttp.Provider provider;
    private final String expectedRoot;
    private final String expectedDrive;

    static final class Failure extends IOException {
        Failure() {
            super("Cloud file metadata or bytes are incomplete or unsupported. No backup was selected or changed.");
        }
    }

    static final class Root {
        final String id;
        final String driveId;
        Root(String id, String driveId) { this.id = id; this.driveId = driveId; }
    }

    static final class File {
        final String id;
        final String name;
        final long size;
        final String modifiedAt;
        File(String id, String name, long size, String modifiedAt) {
            this.id = id;
            this.name = name;
            this.size = size;
            this.modifiedAt = modifiedAt;
        }
    }

    static final class Selected {
        final File file;
        final byte[] bytes;
        final String digest;
        final String condition;
        final Map<String, Object> publication;
        Selected(File file, byte[] bytes, String digest, String condition) {
            this(file, bytes, digest, condition, null);
        }
        Selected(File file, byte[] bytes, String digest, String condition, Map<String, Object> publication) {
            this.file = file;
            this.bytes = bytes;
            this.digest = digest;
            this.condition = condition;
            this.publication = publication;
        }
    }

    static final class Metadata {
        final File file;
        final String condition;
        final String description;
        Metadata(File file, String condition, String description) {
            this.file = file; this.condition = condition; this.description = description;
        }
    }

    CloudProviderReads(CloudProviderHttp http) { this(http, null, null); }
    CloudProviderReads(CloudProviderHttp http, String expectedRoot, String expectedDrive) {
        if (http == null || expectedRoot == null && expectedDrive != null
                || expectedRoot != null && (!identifier(expectedRoot) || expectedDrive != null && !identifier(expectedDrive)
                    || http.provider() != CloudProviderHttp.Provider.MICROSOFT)) {
            throw new IllegalArgumentException("Native file reads require an exact current provider/root binding.");
        }
        this.http = http;
        this.provider = http.provider();
        this.expectedRoot = expectedRoot;
        this.expectedDrive = expectedDrive;
    }

    private static boolean identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9!_.:-]{1,256}") && !".".equals(value) && !"..".equals(value);
    }

    private static String string(Map<String, Object> object, String key) throws Failure {
        Object value = object.get(key);
        if (!(value instanceof String)) throw new Failure();
        return (String) value;
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
    }

    private static String pathId(String value) throws Exception {
        return encode(value).replace("%21", "!");
    }

    private CloudProviderHttp.Response get(String target, int limit) throws CloudProviderHttp.Failure {
        return http.request(new CloudProviderHttp.Request(CloudProviderHttp.Kind.API, target, "GET",
                null, null, null, null, limit));
    }

    private static Map<String, Object> metadata(CloudProviderHttp.Response response) throws Exception {
        if (response.status != 200 || response.bytes.length > METADATA_BYTES) throw new Failure();
        return CloudJson.object(CloudJson.parse(response.bytes, METADATA_BYTES));
    }

    // Microsoft's special-folder GET can create it; native callers must obtain consent first.
    Root discoverRoot() throws IOException {
        try {
            http.requireCurrent();
            if (provider == CloudProviderHttp.Provider.GOOGLE) return new Root("appDataFolder", null);
            String target = expectedRoot == null
                    ? "/v1.0/me/drive/special/approot?$select=id,folder,parentReference"
                    : "/v1.0/me/drive/items/" + pathId(expectedRoot) + "?$select=id,folder,parentReference,specialFolder";
            Map<String, Object> value = metadata(get(target, METADATA_BYTES));
            String id = string(value, "id");
            Map<String, Object> parent = CloudJson.object(value.get("parentReference"));
            if (!identifier(id) || !(value.get("folder") instanceof Map)) throw new Failure();
            String drive = string(parent, "driveId");
            if (!identifier(drive) || expectedRoot != null && (!expectedRoot.equals(id)
                    || expectedDrive != null && !expectedDrive.equals(drive))) {
                throw new Failure();
            }
            if (expectedRoot != null) {
                Map<String, Object> special = CloudJson.object(value.get("specialFolder"));
                if (!"approot".equalsIgnoreCase(string(special, "name"))) throw new Failure();
            }
            http.requireCurrent();
            return new Root(id, drive);
        } catch (CloudProviderHttp.Failure | Failure error) {
            throw error;
        } catch (Exception error) {
            throw new Failure();
        }
    }

    private File descriptor(Map<String, Object> value, Root root) throws Exception {
        String id = string(value, "id");
        String name = string(value, "name");
        if (!identifier(id) || name.isEmpty() || name.getBytes(StandardCharsets.UTF_8).length > 1024) throw new Failure();
        String mime;
        if (provider == CloudProviderHttp.Provider.GOOGLE) {
            List<Object> spaces = CloudJson.array(value.get("spaces"));
            if (!spaces.contains("appDataFolder") || !Boolean.FALSE.equals(value.get("trashed"))) throw new Failure();
            mime = string(value, "mimeType");
            if ("application/vnd.google-apps.folder".equals(mime)) return null;
        } else {
            Map<String, Object> parent = CloudJson.object(value.get("parentReference"));
            if (!root.id.equals(parent.get("id")) || !root.driveId.equals(parent.get("driveId"))
                    || value.get("remoteItem") != null || value.get("deleted") != null || value.get("package") != null) throw new Failure();
            if (value.get("folder") != null) {
                if (!(value.get("folder") instanceof Map)) throw new Failure();
                return null;
            }
            Map<String, Object> file = CloudJson.object(value.get("file"));
            mime = string(file, "mimeType");
        }
        if (!"application/json".equals(mime)) return null;
        long size;
        if (provider == CloudProviderHttp.Provider.GOOGLE) {
            String raw = string(value, "size");
            if (!raw.matches("0|[1-9]\\d*")) throw new Failure();
            size = Long.parseLong(raw);
        } else {
            Object raw = value.get("size");
            if (!(raw instanceof Number) || ((Number) raw).doubleValue() != ((Number) raw).longValue()) throw new Failure();
            size = ((Number) raw).longValue();
        }
        if (size < 0 || size > 9007199254740991L) throw new Failure();
        String modifiedKey = provider == CloudProviderHttp.Provider.GOOGLE ? "modifiedTime" : "lastModifiedDateTime";
        String modified = value.get(modifiedKey) == null ? null : string(value, modifiedKey);
        if (modified != null) {
            if (modified.length() > 64) throw new Failure();
            OffsetDateTime.parse(modified);
        }
        return new File(id, name, size, modified);
    }

    private static String nextMicrosoft(String value, String path) throws Exception {
        if (value.length() > 16384 || value.matches("(?s).*[\\s\\\\#].*")) throw new Failure();
        URI uri = new URI(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !"graph.microsoft.com".equalsIgnoreCase(uri.getHost())
                || uri.getRawUserInfo() != null || uri.getPort() != -1 || uri.getRawFragment() != null
                || !path.equals(uri.getRawPath()) || uri.getRawQuery() == null) throw new Failure();
        Set<String> keys = new HashSet<>();
        boolean token = false;
        for (String part : uri.getRawQuery().split("&")) {
            String[] pair = part.split("=", 2);
            String key = URLDecoder.decode(pair[0], StandardCharsets.UTF_8.name()).toLowerCase(Locale.ROOT);
            if (!Arrays.asList("$select", "$top", "$skiptoken").contains(key) || !keys.add(key)) throw new Failure();
            if ("$skiptoken".equals(key)) {
                token = pair.length == 2 && !URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name()).isEmpty();
            }
        }
        if (!token) throw new Failure();
        return uri.getRawPath() + "?" + uri.getRawQuery();
    }

    List<File> listFiles() throws IOException {
        try {
            Root root = discoverRoot();
            String path = provider == CloudProviderHttp.Provider.MICROSOFT
                    ? "/v1.0/me/drive/items/" + pathId(root.id) + "/children" : null;
            String google = "/drive/v3/files?spaces=appDataFolder&q=" + encode("trashed = false") + "&pageSize=100&fields="
                    + encode("nextPageToken,incompleteSearch,files(" + GOOGLE_FIELDS + ")");
            String target = path == null ? google : path + "?$select=" + encode(MICROSOFT_FIELDS) + "&$top=100";
            Set<String> pages = new HashSet<>();
            Set<String> ids = new HashSet<>();
            List<File> files = new ArrayList<>();
            int total = 0;
            for (int pageNumber = 0; pageNumber < 20; pageNumber++) {
                if (!pages.add(target)) throw new Failure();
                CloudProviderHttp.Response response = get(target, METADATA_BYTES);
                Map<String, Object> page = metadata(response);
                total += response.bytes.length;
                List<Object> entries = CloudJson.array(page.get(path == null ? "files" : "value"));
                if (total > LIST_BYTES || path == null
                        && page.containsKey("incompleteSearch") && !Boolean.FALSE.equals(page.get("incompleteSearch"))) throw new Failure();
                for (Object entry : entries) {
                    Map<String, Object> item = CloudJson.object(entry);
                    File file = descriptor(item, root);
                    if (ids.size() >= 2000 || !ids.add(string(item, "id"))) throw new Failure();
                    if (file != null) files.add(file);
                }
                String key = path == null ? "nextPageToken" : "@odata.nextLink";
                if (page.get(key) == null) {
                    http.requireCurrent();
                    return files;
                }
                String next = string(page, key);
                if (path == null) {
                    if (next.isEmpty() || next.getBytes(StandardCharsets.UTF_8).length > 8192) throw new Failure();
                    target = google + "&pageToken=" + encode(next);
                } else target = nextMicrosoft(next, path);
            }
            throw new Failure();
        } catch (CloudProviderHttp.Failure | Failure error) {
            throw error;
        } catch (Exception error) {
            throw new Failure();
        }
    }

    Selected readFile(String id) throws IOException { return selected(id, false, CloudProviderHttp.MAX_BYTES); }
    Selected readFile(String id, int maxBytes) throws IOException { return selected(id, false, maxBytes); }
    Selected readConditionalFile(String id) throws IOException { return selected(id, true, CloudProviderHttp.MAX_BYTES); }

    Metadata readMetadata(String id) throws IOException {
        try {
            if (provider != CloudProviderHttp.Provider.MICROSOFT || !identifier(id)) throw new Failure();
            Root root = discoverRoot();
            Map<String, Object> info = metadata(get("/v1.0/me/drive/items/" + pathId(id)
                    + "?$select=" + encode(MICROSOFT_FIELDS + ",description"), METADATA_BYTES));
            File file = descriptor(info, root);
            String condition = string(info, "eTag");
            String description = info.get("description") == null ? null : string(info, "description");
            if (file == null || !id.equals(file.id) || file.size > CloudProviderHttp.MAX_BYTES
                    || !CloudProviderHttp.strongTag(condition)) throw new Failure();
            http.requireCurrent();
            return new Metadata(file, condition, description);
        } catch (CloudProviderHttp.Failure | Failure error) {
            throw error;
        } catch (Exception error) {
            throw new Failure();
        }
    }

    private Selected selected(String id, boolean conditional, int maxBytes) throws IOException {
        try {
            if (!identifier(id) || maxBytes < 1 || maxBytes > CloudProviderHttp.MAX_BYTES
                    || conditional && provider != CloudProviderHttp.Provider.MICROSOFT) throw new Failure();
            Root root = discoverRoot();
            String path = provider == CloudProviderHttp.Provider.GOOGLE
                    ? "/drive/v3/files/" + pathId(id) : "/v1.0/me/drive/items/" + pathId(id);
            Map<String, Object> info = metadata(get(path + (provider == CloudProviderHttp.Provider.GOOGLE ? "?fields=" : "?$select=")
                    + encode(provider == CloudProviderHttp.Provider.GOOGLE ? GOOGLE_FIELDS : MICROSOFT_FIELDS), METADATA_BYTES));
            File file = descriptor(info, root);
            String condition = conditional ? string(info, "eTag") : null;
            if (file == null || !id.equals(file.id) || file.size > maxBytes
                    || conditional && !CloudProviderHttp.strongTag(condition)) throw new Failure();
            CloudProviderHttp.Response response = get(path + (provider == CloudProviderHttp.Provider.GOOGLE ? "?alt=media" : "/content"),
                    (int) Math.max(1, file.size));
            if (provider == CloudProviderHttp.Provider.MICROSOFT && response.status == 302) {
                String first = response.location;
                response = http.request(new CloudProviderHttp.Request(CloudProviderHttp.Kind.DOWNLOAD, response.location,
                        "GET", null, null, null, null, (int) Math.max(1, file.size)));
                if (response.status == 302) {
                    String next = CloudProviderHttp.downloadHandoff(first, response.location);
                    response = http.request(new CloudProviderHttp.Request(CloudProviderHttp.Kind.DOWNLOAD, next,
                            "GET", null, null, null, null, (int) Math.max(1, file.size)));
                }
            }
            if (response.status != 200 || response.bytes.length != file.size) throw new Failure();
            byte[] bytes = Arrays.copyOf(response.bytes, response.bytes.length);
            http.requireCurrent();
            return new Selected(file, bytes, CloudJson.hash(bytes), condition);
        } catch (CloudProviderHttp.Failure | Failure error) {
            throw error;
        } catch (Exception error) {
            throw new Failure();
        }
    }
}
