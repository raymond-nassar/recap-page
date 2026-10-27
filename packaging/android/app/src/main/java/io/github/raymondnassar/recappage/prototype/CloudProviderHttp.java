package io.github.raymondnassar.recappage.prototype;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

final class CloudProviderHttp {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static final int DEADLINE_MS = 30000;
    enum Provider { GOOGLE, MICROSOFT }
    enum Kind { API, SESSION, DOWNLOAD }
    enum Outcome { NOT_SENT, READ_ONLY, UNKNOWN }
    enum HandoffRefusal { INVALID, ORIGIN, SELF }
    interface Credentials { String token() throws Exception; }
    interface Connections { HttpsURLConnection open(URL url) throws IOException; }

    static final class Failure extends IOException {
        final Outcome outcome;
        final int status;
        final Long retryAfterMs;
        final HandoffRefusal handoffRefusal;
        Failure(String message, Outcome outcome, int status, Long retryAfterMs) {
            this(message, outcome, status, retryAfterMs, null);
        }
        private Failure(String message, Outcome outcome, int status, Long retryAfterMs, HandoffRefusal handoffRefusal) {
            super(message);
            this.outcome = outcome;
            this.status = status;
            this.retryAfterMs = retryAfterMs;
            this.handoffRefusal = handoffRefusal;
        }
    }

    static final class Request {
        final Kind kind;
        final String target;
        final String method;
        private final byte[] body;
        final String contentRange;
        final Integer uploadSize;
        final String ifMatch;
        final int maxBytes;
        Request(Kind kind, String target, String method, byte[] body, String contentRange,
                Integer uploadSize, String ifMatch, int maxBytes) {
            this.kind = kind;
            this.target = target;
            this.method = method;
            this.body = body == null ? null : Arrays.copyOf(body, body.length);
            this.contentRange = contentRange;
            this.uploadSize = uploadSize;
            this.ifMatch = ifMatch;
            this.maxBytes = maxBytes;
        }
    }

    static final class Response {
        final int status;
        final byte[] bytes;
        final String location;
        final String range;
        final Long retryAfterMs;
        Response(int status, byte[] bytes, String location, String range, Long retryAfterMs) {
            this.status = status;
            this.bytes = bytes;
            this.location = location;
            this.range = range;
            this.retryAfterMs = retryAfterMs;
        }
    }

    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor((work) -> {
        Thread thread = new Thread(work, "recap-cloud-storage-deadline");
        thread.setDaemon(true);
        return thread;
    });
    private static final Pattern RANGE = Pattern.compile("bytes (?:(\\d+)-(\\d+)|\\*)/(\\d+)");
    private final Provider provider;
    private final Credentials credentials;
    private final BooleanSupplier isCurrent;
    private final Connections connections;

    CloudProviderHttp(Provider provider, Credentials credentials, BooleanSupplier isCurrent) {
        this(provider, credentials, isCurrent, (url) -> (HttpsURLConnection) url.openConnection());
    }

    CloudProviderHttp(Provider provider, Credentials credentials, BooleanSupplier isCurrent, Connections connections) {
        if (provider == null || credentials == null || isCurrent == null || connections == null) {
            throw new IllegalArgumentException("Native cloud transport configuration is required.");
        }
        this.provider = provider;
        this.credentials = credentials;
        this.isCurrent = isCurrent;
        this.connections = connections;
    }

    private static Failure invalid() {
        return new Failure("Unsupported cloud storage request. No request was sent.", Outcome.NOT_SENT, 0, null);
    }

    private void current(Outcome outcome) throws Failure {
        boolean active;
        try { active = isCurrent.getAsBoolean(); }
        catch (RuntimeException error) {
            throw new Failure("Cloud connection state is unavailable.", outcome, 0, null);
        }
        if (!active) {
            throw new Failure("The cloud connection changed. Discard its response.", outcome, 0, null);
        }
    }

    static boolean strongTag(String value) {
        return value != null && value.matches("\"[\\x21\\x23-\\x7e]{1,1024}\"");
    }

    Provider provider() { return provider; }
    void requireCurrent() throws Failure { current(Outcome.READ_ONLY); }
    String uploadSession(String target) throws Failure { return destination(provider, Kind.SESSION, target).toString(); }

    private static URI destination(Provider provider, Kind kind, String target) throws Failure {
        if (kind == null || target == null || target.isEmpty() || target.length() > 16384
                || Pattern.compile("[\\s\\\\#]").matcher(target).find()) throw invalid();
        if (kind == Kind.API && (!target.startsWith("/") || target.startsWith("//"))) throw invalid();
        try {
            URI uri = new URI(kind == Kind.API
                    ? (provider == Provider.GOOGLE ? "https://www.googleapis.com" : "https://graph.microsoft.com") + target
                    : target);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getRawFragment() != null || uri.getPort() != -1) throw invalid();
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            String path = uri.getRawPath();
            if (kind == Kind.API) {
                if (path == null || Pattern.compile("(?i)(?:^|/)\\.{1,2}(?:/|$)|%(?:2e|2f|5c)").matcher(path).find()) {
                    throw invalid();
                }
                if (provider == Provider.GOOGLE
                        ? !"www.googleapis.com".equals(host) || !path.matches("/(?:upload/)?drive/v3/files(?:/.*)?")
                        : !"graph.microsoft.com".equals(host) || !path.matches("/v1\\.0/me/drive(?:/.*)?")) throw invalid();
            } else if (kind == Kind.SESSION) {
                if (provider == Provider.GOOGLE
                        ? !"www.googleapis.com".equals(host) || path == null || !path.matches("/upload/drive/v3/files(?:/.*)?")
                        : !host.endsWith(".up.1drv.com") && !"my.microsoftpersonalcontent.com".equals(host)) throw invalid();
            } else if (provider != Provider.MICROSOFT
                    || !host.endsWith(".1drv.com") && !"my.microsoftpersonalcontent.com".equals(host)) throw invalid();
            return uri;
        } catch (Failure error) {
            throw error;
        } catch (Exception error) {
            throw invalid();
        }
    }

    static String downloadHandoff(String source, String target) throws Failure {
        URI from, next;
        try {
            from = destination(Provider.MICROSOFT, Kind.DOWNLOAD, source);
            next = destination(Provider.MICROSOFT, Kind.DOWNLOAD, target);
        } catch (Failure unsupported) { throw handoffFailure(HandoffRefusal.INVALID); }
        if (!from.getHost().equalsIgnoreCase(next.getHost())) throw handoffFailure(HandoffRefusal.ORIGIN);
        if (from.normalize().equals(next.normalize())) throw handoffFailure(HandoffRefusal.SELF);
        return next.toString();
    }

    private static Failure handoffFailure(HandoffRefusal reason) {
        return new Failure("The provider returned an unsupported cloud download destination.", Outcome.READ_ONLY, 302, null, reason);
    }

    private static Long retryAfter(String value) {
        if (value == null || value.length() > 128) return null;
        try {
            long delay = value.matches("\\d+") ? Math.multiplyExact(Long.parseLong(value), 1000)
                    : Math.subtractExact(ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME)
                            .toInstant().toEpochMilli(), System.currentTimeMillis());
            return delay >= 0 && delay <= 9007199254740991L ? delay : null;
        } catch (RuntimeException error) {
            return null;
        }
    }

    private static String query(URI uri, String name) throws Failure {
        if (uri.getRawQuery() == null) return null;
        try {
            for (String part : uri.getRawQuery().split("&")) {
                String[] pair = part.split("=", 2);
                if (name.equals(URLDecoder.decode(pair[0], StandardCharsets.UTF_8.name()))) {
                    return pair.length == 1 ? "" : URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name());
                }
            }
        } catch (Exception error) {
            throw invalid();
        }
        return null;
    }

    Response request(Request request) throws Failure {
        if (request == null) throw invalid();
        URI uri = destination(provider, request.kind, request.target);
        String path = uri.getRawPath();
        boolean conditionalContent = provider == Provider.MICROSOFT && request.kind == Kind.API
                && path.matches("/v1\\.0/me/drive/items/[^/]+/content");
        boolean microsoftItem = provider == Provider.MICROSOFT && request.kind == Kind.API
                && path.matches("/v1\\.0/me/drive/items/[^/]+");
        boolean conditionalDelete = microsoftItem && "DELETE".equals(request.method) && uri.getRawQuery() == null;
        boolean allowed = request.kind == Kind.API
                ? Arrays.asList("GET", "POST", "PATCH").contains(request.method) || conditionalContent && "PUT".equals(request.method)
                    || conditionalDelete
                : request.kind == Kind.SESSION
                    ? "PUT".equals(request.method) || provider == Provider.MICROSOFT && "GET".equals(request.method)
                    : "GET".equals(request.method);
        if (!allowed || request.maxBytes < 1 || request.maxBytes > MAX_BYTES
                || request.body != null && (request.body.length > MAX_BYTES || "GET".equals(request.method))) throw invalid();
        if (request.ifMatch != null && (provider != Provider.MICROSOFT || request.kind != Kind.API
                || !strongTag(request.ifMatch)
                || !(conditionalDelete ? request.body == null : request.body != null && request.body.length > 0
                    && ("PUT".equals(request.method) && conditionalContent || "PATCH".equals(request.method) && microsoftItem)))) throw invalid();
        if (request.kind == Kind.API && Arrays.asList("PUT", "DELETE").contains(request.method) && request.ifMatch == null) throw invalid();
        boolean starting = provider == Provider.GOOGLE && request.kind == Kind.API && path.startsWith("/upload/");
        if (starting) {
            if (!Arrays.asList("POST", "PATCH").contains(request.method) || request.uploadSize == null
                    || request.uploadSize < 1 || request.uploadSize > MAX_BYTES || request.body == null
                    || !"resumable".equals(query(uri, "uploadType"))) throw invalid();
        } else if (request.uploadSize != null) throw invalid();
        boolean statusQuery = false;
        if (request.contentRange != null) {
            if (request.kind != Kind.SESSION || !"PUT".equals(request.method)) throw invalid();
            Matcher range = RANGE.matcher(request.contentRange);
            if (!range.matches()) throw invalid();
            try {
                long total = Long.parseLong(range.group(3));
                if (total < 1 || total > MAX_BYTES) throw invalid();
                if (range.group(1) == null) {
                    if (provider != Provider.GOOGLE || request.body != null && request.body.length != 0) throw invalid();
                    statusQuery = true;
                } else {
                    long start = Long.parseLong(range.group(1));
                    long end = Long.parseLong(range.group(2));
                    if (start > end || end >= total || request.body == null || request.body.length != end - start + 1) throw invalid();
                }
            } catch (NumberFormatException error) {
                throw invalid();
            }
        } else if (request.kind == Kind.SESSION && "PUT".equals(request.method)) throw invalid();
        current(Outcome.NOT_SENT);
        String token = null;
        if (request.kind == Kind.API || provider == Provider.GOOGLE) {
            try { token = credentials.token(); }
            catch (Exception error) {
                throw new Failure("Cloud authentication is unavailable. Reconnect before retrying.", Outcome.NOT_SENT, 0, null);
            }
            if (token == null || token.length() > 65536 || !token.matches("[\\x21-\\x7e]+")) {
                throw new Failure("Cloud authentication is unavailable. Reconnect before retrying.", Outcome.NOT_SENT, 0, null);
            }
        }
        current(Outcome.NOT_SENT);
        Outcome outcome = "GET".equals(request.method) || statusQuery ? Outcome.READ_ONLY : Outcome.UNKNOWN;
        HttpsURLConnection connection = null;
        ScheduledFuture<?> deadline = null;
        AtomicBoolean expired = new AtomicBoolean();
        int status = 0;
        Long retry = null;
        try {
            connection = connections.open(uri.toURL());
            HttpsURLConnection active = connection;
            deadline = DEADLINES.schedule(() -> { expired.set(true); active.disconnect(); }, DEADLINE_MS, TimeUnit.MILLISECONDS);
            connection.setConnectTimeout(DEADLINE_MS);
            connection.setReadTimeout(DEADLINE_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(request.method);
            connection.setRequestProperty("Accept", "application/json");
            if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (request.ifMatch != null) connection.setRequestProperty("If-Match", request.ifMatch);
            if (request.contentRange != null) connection.setRequestProperty("Content-Range", request.contentRange);
            if (starting) {
                connection.setRequestProperty("X-Upload-Content-Type", "application/json");
                connection.setRequestProperty("X-Upload-Content-Length", request.uploadSize.toString());
            }
            current(Outcome.NOT_SENT);
            if (request.body != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(request.body.length);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) { output.write(request.body); }
            }
            status = connection.getResponseCode();
            retry = retryAfter(connection.getHeaderField("Retry-After"));
            current(outcome);
            if (expired.get()) throw new IOException();
            if (status == 302 && provider == Provider.MICROSOFT && "GET".equals(request.method)
                    && (request.kind == Kind.DOWNLOAD || request.kind == Kind.API
                        && path.matches("/v1\\.0/me/drive/items/[^/]+/content"))) {
                String location;
                try {
                    location = request.kind == Kind.DOWNLOAD
                            ? downloadHandoff(uri.toString(), connection.getHeaderField("Location"))
                            : destination(provider, Kind.DOWNLOAD, connection.getHeaderField("Location")).toString();
                } catch (Failure unsupported) {
                    throw new Failure("The provider returned an unsupported cloud download destination.", outcome, status, retry);
                }
                return new Response(status, new byte[0], location, null, retry);
            }
            if (!(status >= 200 && status < 300)
                    && !(status == 308 && provider == Provider.GOOGLE && request.kind == Kind.SESSION)) {
                throw new Failure("The provider refused or redirected the cloud request.", outcome, status, retry);
            }
            String length = connection.getHeaderField("Content-Length");
            if (length != null && (!length.matches("\\d+") || Long.parseLong(length) > request.maxBytes)) throw new IOException();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (expired.get() || bytes.size() + count > request.maxBytes) throw new IOException();
                    bytes.write(buffer, 0, count);
                }
            }
            current(outcome);
            if (expired.get()) throw new IOException();
            String location = connection.getHeaderField("Location");
            if (location != null && location.length() > 16384) throw new IOException();
            return new Response(status, bytes.toByteArray(), location, connection.getHeaderField("Range"), retry);
        } catch (Failure error) {
            if (error.outcome == Outcome.NOT_SENT && status != 0) {
                throw new Failure("The provider returned an unsupported cloud destination.", outcome, status, retry);
            }
            throw error;
        } catch (Exception error) {
            throw new Failure("Cloud request failed, timed out or exceeded its byte limit.", outcome, status, retry);
        } finally {
            if (deadline != null) deadline.cancel(false);
            if (connection != null) connection.disconnect();
        }
    }
}
