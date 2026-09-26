package io.github.raymondnassar.recappage.prototype;

import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Collections;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

final class LocalAssets {
    final String origin;
    final NavigationPolicy policy;
    private final AssetManager assets;
    private final Map<String, String> headers;
    private final Map<String, String> healthHeaders;
    private final String healthPath;
    private final Set<String> paths = new HashSet<>();

    LocalAssets(AssetManager assets) throws IOException, JSONException {
        this.assets = assets;
        JSONObject config = json("android-config.json");
        origin = config.getString("origin");
        policy = new NavigationPolicy(origin);
        headers = strings(config.getJSONObject("securityHeaders"));
        healthPath = config.getJSONObject("health").getString("path");
        healthHeaders = strings(config.getJSONObject("health").getJSONObject("headers"));
        JSONArray files = json("android-assets.json").getJSONArray("files");
        for (int index = 0; index < files.length(); index++) {
            paths.add(files.getJSONObject(index).getString("path"));
        }
    }

    private JSONObject json(String path) throws IOException, JSONException {
        try (InputStream stream = assets.open("recap/" + path)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int read; (read = stream.read(buffer)) != -1;) bytes.write(buffer, 0, read);
            return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        }
    }

    private static Map<String, String> strings(JSONObject value) throws JSONException {
        Map<String, String> result = new HashMap<>();
        for (Iterator<String> keys = value.keys(); keys.hasNext();) {
            String key = keys.next();
            result.put(key, value.getString(key));
        }
        return result;
    }

    WebResourceResponse error(int status, String reason) {
        return response("text/plain", status, reason, Collections.emptyMap(),
                new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private WebResourceResponse response(String mime, int status, String reason,
            Map<String, String> extra, InputStream data) {
        Map<String, String> responseHeaders = new HashMap<>(headers);
        responseHeaders.put("cache-control", "no-store");
        responseHeaders.putAll(extra);
        return new WebResourceResponse(mime, "UTF-8", status, reason, responseHeaders, data);
    }

    WebResourceResponse intercept(String url, String method, boolean mainFrame, boolean popup) {
        if (!policy.isLocal(url)) {
            if (!mainFrame && policy.isNetworkSubresource(url)) return null;
            return error(403, "Blocked");
        }
        String path = policy.assetPath(url);
        if (path == null) return error(403, "Forbidden");
        if (!method.equals("GET")) return error(405, "Method Not Allowed");
        if (mainFrame && !(popup ? policy.isPopupPage(url) : policy.isAppPage(url))) {
            return error(403, "Blocked");
        }
        if (popup && !policy.isPopupAsset(path)) return error(403, "Blocked");
        if (("/" + path).equals(healthPath)) {
            return response("text/plain", 204, "No Content", healthHeaders, new ByteArrayInputStream(new byte[0]));
        }
        if (!paths.contains(path)) return error(404, "Not Found");
        try {
            return response(mime(path), 200, "OK", Collections.emptyMap(), assets.open("recap/" + path));
        } catch (IOException | RuntimeException ignored) {
            return error(404, "Not Found");
        }
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".md")) return "text/markdown";
        return "application/octet-stream";
    }
}
