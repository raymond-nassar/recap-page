package io.github.raymondnassar.recappage.prototype;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class NavigationPolicy {
    static final int MAX_SAVE_BYTES = 32 * 1024 * 1024;
    private static final Set<String> POPUP_ASSETS = new HashSet<>(Arrays.asList(
            "open.html", "open.js", "open.css", "js/lib/apiBase.js", "android/launch.css",
            "android/launcher.js", "android/reader.js"));
    private static final Pattern MARVEL_ISSUE = Pattern.compile(
            "marvelunlimited://issue/drn:src:marvel:unison::prod:"
                    + "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private final String origin;
    private final URI base;
    private static final Pattern REQUEST_PREFIX = Pattern.compile(
            "^\\{\\s*\"v\"\\s*:\\s*1\\s*,\\s*\"kind\"\\s*:\\s*\"save\"\\s*,\\s*\"id\"\\s*:\\s*\"([A-Za-z0-9_.:-]{1,96})\"\\s*,");

    NavigationPolicy(String origin) {
        this.origin = origin;
        base = parse(origin);
        if (base == null || !"http".equals(base.getScheme()) || !"127.0.0.1".equals(base.getHost())
                || base.getPort() != 8787 || base.getRawUserInfo() != null
                || !origin.equals("http://127.0.0.1:8787")) {
            throw new IllegalArgumentException("Unexpected bundled origin");
        }
    }

    private static URI parse(String value) {
        if (value == null || value.length() > 16384) return null;
        try {
            return new URI(value);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    boolean isLocal(String value) {
        URI uri = parse(value);
        return uri != null && base.getScheme().equals(uri.getScheme())
                && base.getRawAuthority().equals(uri.getRawAuthority()) && uri.getRawUserInfo() == null;
    }

    String assetPath(String value) {
        if (!isLocal(value)) return null;
        URI uri = parse(value);
        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) return "index.html";
        if (!path.startsWith("/") || !path.matches("/[A-Za-z0-9_./-]+")) return null;
        if (uri.getRawPath().contains("%")) return null;
        for (String segment : path.substring(1).split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
        }
        return path.substring(1);
    }

    boolean isAppPage(String value) {
        URI uri = parse(value);
        return uri != null && "index.html".equals(assetPath(value))
                && uri.getRawQuery() == null;
    }

    String restoredRoute(String value) {
        URI uri = parse(value);
        if (!isAppPage(value) || uri.getRawFragment() != null && uri.getRawFragment().length() > 2048) {
            return origin + "/";
        }
        return origin + "/" + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
    }

    boolean isPopupPage(String value) {
        return "open.html".equals(assetPath(value));
    }

    boolean isPopupAsset(String path) {
        return POPUP_ASSETS.contains(path);
    }

    boolean isHttps(String value) {
        URI uri = parse(value);
        return uri != null && "https".equals(uri.getScheme()) && uri.getHost() != null
                && uri.getRawUserInfo() == null && uri.getPort() <= 65535;
    }

    boolean isOfficialReader(String value) {
        if (!isHttps(value)) return false;
        URI uri = parse(value);
        if (uri.getPort() != -1 && uri.getPort() != 443) return false;
        String host = uri.getHost();
        return host.equals("read.marvel.com") || host.equals("www.marvel.com") || host.equals("marvel.com");
    }

    boolean isMarvelIssue(String value) {
        return value != null && MARVEL_ISSUE.matcher(value).matches();
    }

    boolean isNetworkSubresource(String value) {
        URI uri = parse(value);
        if (uri == null || uri.getHost() == null || uri.getRawUserInfo() != null) return false;
        return "https".equals(uri.getScheme())
                || ("http".equals(uri.getScheme())
                && ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost())));
    }

    static boolean validRequestId(String id) {
        return id != null && id.matches("[A-Za-z0-9_.:-]{1,96}");
    }

    static boolean validSaveName(String filename, String type) {
        if (filename == null || type == null || !filename.matches("[A-Za-z0-9][A-Za-z0-9._ -]{0,179}")
                || filename.contains("..") || !filename.equals(filename.trim())) return false;
        return switch (type) {
            case "application/json" -> filename.endsWith(".json");
            case "text/markdown" -> filename.endsWith(".md") || filename.endsWith(".markdown");
            case "text/plain" -> filename.endsWith(".txt");
            default -> false;
        };
    }

    static boolean boundedText(String value) {
        return utf8Length(value) >= 0;
    }

    private static int utf8Length(String value) {
        if (value == null || value.length() > MAX_SAVE_BYTES) return -1;
        int bytes = 0;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character < 0x80) bytes++;
            else if (character < 0x800) bytes += 2;
            else if (Character.isHighSurrogate(character) && index + 1 < value.length()
                    && Character.isLowSurrogate(value.charAt(index + 1))) {
                bytes += 4;
                index++;
            } else bytes += 3;
            if (bytes > MAX_SAVE_BYTES) return -1;
        }
        return bytes;
    }

    static byte[] utf8Bytes(String value) {
        int length = utf8Length(value);
        if (length < 0) throw new IllegalArgumentException("Export exceeds the text transport limit");
        byte[] bytes = new byte[length];
        // Match the browser's TextEncoder replacement for an isolated UTF-16 surrogate.
        var encoder = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)
                .replaceWith(new byte[] { (byte) 0xef, (byte) 0xbf, (byte) 0xbd });
        ByteBuffer output = ByteBuffer.wrap(bytes);
        encoder.encode(CharBuffer.wrap(value), output, true);
        encoder.flush(output);
        return bytes;
    }

    static String requestIdFromPrefix(String value) {
        if (value == null) return null;
        Matcher match = REQUEST_PREFIX.matcher(value.substring(0, Math.min(value.length(), 512)));
        return match.find() ? match.group(1) : null;
    }
}
