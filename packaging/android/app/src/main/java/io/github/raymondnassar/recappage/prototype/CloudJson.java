package io.github.raymondnassar.recappage.prototype;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

final class CloudJson {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static final long MAX_INTEGER = 9007199254740991L;
    private CloudJson() {}
    static IOException failure() { return new IOException("Native cloud data is incomplete, changed or unsupported."); }
    static boolean hex(Object value) { return value instanceof String && ((String) value).matches("[a-f0-9]{64}"); }
    static boolean id(Object value) {
        return value instanceof String && ((String) value).matches("[A-Za-z0-9!_.:-]{1,256}")
                && !".".equals(value) && !"..".equals(value);
    }
    static long integer(Object value) throws IOException {
        if (!(value instanceof Number)) throw failure();
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number < 0 || number > MAX_INTEGER || number != Math.floor(number)) throw failure();
        return ((Number) value).longValue();
    }
    static String string(Object value) throws IOException { if (!(value instanceof String)) throw failure(); return (String) value; }
    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) throws IOException {
        if (!(value instanceof Map)) throw failure();
        return (Map<String, Object>) value;
    }
    @SuppressWarnings("unchecked")
    static List<Object> array(Object value) throws IOException {
        if (!(value instanceof List)) throw failure();
        return (List<Object>) value;
    }
    static Map<String, Object> map(Object... pairs) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
        return result;
    }
    static boolean exact(Map<String, Object> value, String... keys) {
        return value.size() == keys.length && value.keySet().containsAll(Arrays.asList(keys));
    }
    static String hash(byte[] bytes) {
        try {
            StringBuilder result = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) {
                result.append(Character.forDigit((b >>> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
            }
            return result.toString();
        } catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    static String random() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return hash(bytes);
    }
    static byte[] bytes(Object value) throws IOException { return canonical(value).getBytes(StandardCharsets.UTF_8); }
    static Object copy(Object value) throws IOException { return parse(bytes(value), MAX_BYTES); }
    static String canonical(Object value) throws IOException {
        StringBuilder out = new StringBuilder();
        write(value, out, 0);
        return out.toString();
    }
    private static void write(Object value, StringBuilder out, int depth) throws IOException {
        if (depth > 64) throw failure();
        if (value == null) { out.append("null"); return; }
        if (value instanceof String) {
            out.append('"');
            String text = (String) value;
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                switch (c) {
                    case '"': out.append("\\\""); break;
                    case '\\': out.append("\\\\"); break;
                    case '\b': out.append("\\b"); break;
                    case '\f': out.append("\\f"); break;
                    case '\n': out.append("\\n"); break;
                    case '\r': out.append("\\r"); break;
                    case '\t': out.append("\\t"); break;
                    default:
                        boolean lone = Character.isHighSurrogate(c)
                                ? i + 1 == text.length() || !Character.isLowSurrogate(text.charAt(i + 1))
                                : Character.isLowSurrogate(c) && (i == 0 || !Character.isHighSurrogate(text.charAt(i - 1)));
                        if (c < 32 || lone) out.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int) c));
                        else out.append(c);
                }
            }
            out.append('"');
        } else if (value instanceof Boolean) out.append(value);
        else if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            if (!Double.isFinite(number) || Math.abs(number) > MAX_INTEGER) throw failure();
            if (number == 0) out.append('0');
            else {
                BigDecimal decimal = BigDecimal.valueOf(number).stripTrailingZeros();
                if (Math.abs(number) >= 0.000001) out.append(decimal.toPlainString());
                else out.append(decimal.toString().replace("E-", "e-").replace("E+", "e+").replace("E", "e+"));
            }
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : new TreeMap<>(object(value)).entrySet()) {
                if (!first) out.append(',');
                first = false;
                write(entry.getKey(), out, depth + 1);
                out.append(':');
                write(entry.getValue(), out, depth + 1);
            }
            out.append('}');
        } else if (value instanceof List) {
            out.append('[');
            boolean first = true;
            for (Object entry : array(value)) {
                if (!first) out.append(',');
                first = false;
                write(entry, out, depth + 1);
            }
            out.append(']');
        } else throw failure();
    }
    static Object parse(byte[] bytes, int limit) throws IOException {
        if (bytes == null || bytes.length < 1 || bytes.length > limit || limit < 1 || limit > 2 * MAX_BYTES + 8192) throw failure();
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            Parser parser = new Parser(text);
            Object result = parser.value(0);
            parser.space();
            if (parser.at != text.length()) throw failure();
            return result;
        } catch (IOException error) { throw error; }
        catch (RuntimeException error) { throw failure(); }
    }
    private static final class Parser {
        final String text;
        int at;
        Parser(String text) { this.text = text; }
        void space() { while (at < text.length() && " \r\n\t".indexOf(text.charAt(at)) >= 0) at++; }
        char take() throws IOException { if (at == text.length()) throw failure(); return text.charAt(at++); }
        Object value(int depth) throws IOException {
            space();
            if (depth > 64 || at == text.length()) throw failure();
            char c = text.charAt(at);
            if (c == '"') return quoted();
            if (c == '{') {
                at++;
                Map<String, Object> result = new LinkedHashMap<>();
                space();
                if (at < text.length() && text.charAt(at) == '}') { at++; return result; }
                while (true) {
                    space();
                    String key = quoted();
                    space();
                    if (take() != ':' || result.containsKey(key)) throw failure();
                    result.put(key, value(depth + 1));
                    space();
                    char next = take();
                    if (next == '}') return result;
                    if (next != ',') throw failure();
                }
            }
            if (c == '[') {
                at++;
                List<Object> result = new ArrayList<>();
                space();
                if (at < text.length() && text.charAt(at) == ']') { at++; return result; }
                while (true) {
                    result.add(value(depth + 1));
                    space();
                    char next = take();
                    if (next == ']') return result;
                    if (next != ',') throw failure();
                }
            }
            for (String token : new String[] { "true", "false", "null" }) {
                if (text.startsWith(token, at)) { at += token.length(); return "null".equals(token) ? null : Boolean.valueOf(token); }
            }
            int start = at;
            while (at < text.length() && "-+0123456789.eE".indexOf(text.charAt(at)) >= 0) at++;
            String raw = text.substring(start, at);
            if (!raw.matches("-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?")) throw failure();
            double number = Double.parseDouble(raw);
            if (!Double.isFinite(number) || Math.abs(number) > MAX_INTEGER) throw failure();
            return number;
        }
        String quoted() throws IOException {
            if (take() != '"') throw failure();
            StringBuilder result = new StringBuilder();
            while (true) {
                char c = take();
                if (c == '"') return result.toString();
                if (c < 32) throw failure();
                if (c != '\\') { result.append(c); continue; }
                c = take();
                switch (c) {
                    case '"': case '\\': case '/': result.append(c); break;
                    case 'b': result.append('\b'); break;
                    case 'f': result.append('\f'); break;
                    case 'n': result.append('\n'); break;
                    case 'r': result.append('\r'); break;
                    case 't': result.append('\t'); break;
                    case 'u':
                        if (at + 4 > text.length()) throw failure();
                        String digits = text.substring(at, at + 4);
                        if (!digits.matches("[a-fA-F0-9]{4}")) throw failure();
                        result.append((char) Integer.parseInt(digits, 16));
                        at += 4;
                        break;
                    default: throw failure();
                }
            }
        }
    }
}
