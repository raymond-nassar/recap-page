package io.github.raymondnassar.recappage.prototype;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.HttpsURLConnection;

// CloudHttp on the platform's own HTTPS client, so the release build adds no library (OD-13). Redirects are
// never followed, because a download's address is handed back as Location and must be fetched without the
// token, and the one deadline covers the whole exchange: when it runs out the connection is closed under
// the read, which a read timeout alone would not do for a server trickling bytes.
final class HttpsNetwork implements CloudHttp {
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(work -> {
        Thread thread = new Thread(work, "recap-cloud-deadline");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public Response send(Request request) throws IOException {
        URL url = new URL(request.url);
        if (!"https".equals(url.getProtocol())) throw new IOException("Only https is used.");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        AtomicBoolean expired = new AtomicBoolean();
        ScheduledFuture<?> deadline = DEADLINES.schedule(() -> {
            expired.set(true);
            connection.disconnect();
        }, request.timeoutMs, TimeUnit.MILLISECONDS);
        try {
            int limit = (int) Math.min(Integer.MAX_VALUE, Math.max(1, request.timeoutMs));
            connection.setConnectTimeout(limit);
            connection.setReadTimeout(limit);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestMethod(request.method);
            for (Map.Entry<String, String> header : request.headers.entrySet()) {
                connection.setRequestProperty(header.getKey(), header.getValue());
            }
            int status;
            try {
                if (request.body != null) {
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(request.body.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(request.body);
                    }
                }
                status = connection.getResponseCode();
            } catch (IOException error) {
                if (expired.get()) throw new Timeout();
                throw error;
            }
            if (expired.get()) throw new Timeout();
            Map<String, String> headers = new LinkedHashMap<>();
            for (Map.Entry<String, List<String>> field : connection.getHeaderFields().entrySet()) {
                if (field.getKey() != null && field.getValue() != null && !field.getValue().isEmpty()) {
                    headers.put(field.getKey(), field.getValue().get(0));
                }
            }
            String length = connection.getHeaderField("Content-Length");
            if (length != null && length.matches("\\d{1,18}") && Long.parseLong(length) > request.maxBytes) {
                return new Response(status, headers, null, true, false);
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                if (input != null) {
                    byte[] chunk = new byte[8192];
                    int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (bytes.size() + count > request.maxBytes) return new Response(status, headers, null, true, false);
                        bytes.write(chunk, 0, count);
                    }
                }
            } catch (IOException error) {
                return new Response(status, headers, null, false, true);
            }
            if (expired.get()) return new Response(status, headers, null, false, true);
            return new Response(status, headers, bytes.toByteArray());
        } finally {
            deadline.cancel(false);
            connection.disconnect();
        }
    }
}
