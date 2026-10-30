package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

// One HTTPS exchange, as the account and the OneDrive client need it: never following a redirect, held to a
// deadline for the whole exchange, and reading a body to a stated limit and no further. The device's
// implementation is HttpsNetwork; the tests answer from a script, so every rule above it runs on a plain JVM.
interface CloudHttp {
    // Throws Timeout when no answer came within the deadline, and any other IOException when none came at all.
    Response send(Request request) throws IOException;

    final class Timeout extends IOException {
        private static final long serialVersionUID = 1L;

        Timeout() {
            super("timed out");
        }
    }

    final class Request {
        final String method;
        final String url;
        final Map<String, String> headers;
        final byte[] body;
        final long timeoutMs;
        final int maxBytes;

        Request(String method, String url, Map<String, String> headers, byte[] body, long timeoutMs, int maxBytes) {
            this.method = method;
            this.url = url;
            this.headers = Collections.unmodifiableMap(new LinkedHashMap<>(headers));
            this.body = body;
            this.timeoutMs = timeoutMs;
            this.maxBytes = maxBytes;
        }

        boolean hasHeader(String name) {
            for (String key : headers.keySet()) if (key.equalsIgnoreCase(name)) return true;
            return false;
        }
    }

    final class Response {
        final int status;
        private final Map<String, String> headers;
        // Null when the body was longer than the request's limit, which is then read no further, or when it
        // stopped part way, which the deadline running out while it arrived counts as.
        final byte[] body;
        final boolean tooLarge;
        final boolean broken;

        Response(int status, Map<String, String> headers, byte[] body) {
            this(status, headers, body, false, false);
        }

        Response(int status, Map<String, String> headers, byte[] body, boolean tooLarge, boolean broken) {
            this.status = status;
            Map<String, String> lower = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (entry.getKey() != null) lower.put(entry.getKey().toLowerCase(Locale.ROOT), entry.getValue());
            }
            this.headers = Collections.unmodifiableMap(lower);
            this.body = tooLarge || broken ? null : body;
            this.tooLarge = tooLarge;
            this.broken = broken;
        }

        String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }

        boolean ok() {
            return status >= 200 && status < 300;
        }
    }
}
