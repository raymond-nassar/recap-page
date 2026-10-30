package io.github.raymondnassar.recappage.prototype;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.Locale;
import java.util.regex.Pattern;

// The small rules the account and the OneDrive client share, each the same as its counterpart for the
// Windows host in host/cloudSignIn.mjs, host/oneDrive.mjs or host/cloudHost.mjs.
final class CloudRules {
    private CloudRules() {}

    static final int MAX_ITEM_BYTES = 32 * 1024 * 1024;
    static final long MAX_WAIT_MS = 60L * 60_000;
    // Never made only of dots, which a request path would read as a dot segment.
    static final Pattern ITEM_ID = Pattern.compile("^(?!\\.+$)[A-Za-z0-9!._-]{1,256}$");
    // Only names of the shape the backup protocol writes.
    static final Pattern ITEM_NAME = Pattern.compile("^recap-page-[a-z0-9][a-z0-9.-]{0,118}$");
    static final Pattern BASE64 = Pattern.compile("^[A-Za-z0-9+/]*={0,2}$");
    static final Pattern CONNECTION = Pattern.compile("^[a-f0-9]{32}$");
    private static final Pattern DIGITS = Pattern.compile("^\\d{1,7}$");
    private static final Pattern NUMERIC_HOST = Pattern.compile("^[\\d.]+$");

    static String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(Character.forDigit((value >> 4) & 0xf, 16)).append(Character.forDigit(value & 0xf, 16));
        return result.toString();
    }

    // As URLSearchParams writes a value: letters, digits and *-._ stay, a space becomes +, and every other
    // byte of the UTF-8 is percent-encoded.
    static String formEncode(String value) {
        StringBuilder out = new StringBuilder();
        for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '*' || c == '-' || c == '.' || c == '_') {
                out.append((char) c);
            } else if (c == ' ') {
                out.append('+');
            } else {
                out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 0xf, 16)));
            }
        }
        return out.toString();
    }

    static String form(String... pairs) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < pairs.length; i += 2) {
            if (i > 0) out.append('&');
            out.append(formEncode(pairs[i])).append('=').append(formEncode(pairs[i + 1]));
        }
        return out.toString();
    }

    // Percent-decoding, with + read as a space when asked, as a query is read. Null for a malformed escape or
    // bytes that are not UTF-8.
    static String decode(String value, boolean plusIsSpace) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '%') {
                if (i + 2 >= value.length()) return null;
                int high = Character.digit(value.charAt(i + 1), 16);
                int low = Character.digit(value.charAt(i + 2), 16);
                if (high < 0 || low < 0) return null;
                bytes.write(high * 16 + low);
                i += 2;
            } else if (c == '+' && plusIsSpace) {
                bytes.write(' ');
            } else if (c < 0x80) {
                bytes.write(c);
            } else {
                byte[] encoded = String.valueOf(c).getBytes(StandardCharsets.UTF_8);
                bytes.write(encoded, 0, encoded.length);
            }
        }
        byte[] raw = bytes.toByteArray();
        String text = new String(raw, StandardCharsets.UTF_8);
        return java.util.Arrays.equals(raw, text.getBytes(StandardCharsets.UTF_8)) ? text : null;
    }

    // Text fit to show as an account: 1 to 256 characters, none of them a control character.
    static String displayText(Object value) {
        if (!(value instanceof String)) return null;
        String text = (String) value;
        if (text.isEmpty() || text.length() > 256) return null;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c <= 0x1f || c == 0x7f) return null;
        }
        return text;
    }

    // A capability URL a provider handed back, an upload session or a download: https to an ordinary host
    // name, never checked against a list of hosts (cloudSignIn.mjs records why). Null when it is not one.
    static String capabilityUrl(Object text) {
        if (!(text instanceof String)) return null;
        URI url;
        try {
            url = new URI((String) text);
        } catch (URISyntaxException error) {
            return null;
        }
        String host = url.getHost() == null ? null : url.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(url.getScheme()) || host == null || url.getRawUserInfo() != null
                || (url.getPort() != -1 && url.getPort() != 443)
                || !host.contains(".") || host.endsWith(".") || host.startsWith("[")
                || NUMERIC_HOST.matcher(host).matches()
                || host.equals("localhost") || host.endsWith(".localhost")) return null;
        return url.toString();
    }

    // Seconds or an HTTP date, as the providers send it, held to an hour.
    static long retryAfterMs(String header, long now) {
        String value = header == null ? "" : header.trim();
        if (value.isEmpty()) return 0;
        long wait;
        if (DIGITS.matcher(value).matches()) {
            wait = Long.parseLong(value) * 1000;
        } else {
            try {
                wait = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - now;
            } catch (DateTimeParseException error) {
                return 0;
            }
        }
        return Math.min(Math.max(0, wait), MAX_WAIT_MS);
    }

    // A whole number JSON can hold exactly, as Number.isSafeInteger asks.
    static boolean safeInteger(Object value) {
        if (!(value instanceof Double)) return false;
        double number = (Double) value;
        return number == Math.rint(number) && Math.abs(number) <= 9007199254740991.0;
    }
}
