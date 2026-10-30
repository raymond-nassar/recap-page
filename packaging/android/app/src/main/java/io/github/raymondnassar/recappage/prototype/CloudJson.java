package io.github.raymondnassar.recappage.prototype;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// JSON for the cloud code, read the way JSON.parse reads it and written the way JSON.stringify writes it, so
// the native side answers the page in exactly the shapes the Windows host does. It is here rather than
// org.json because org.json is part of Android and not of a plain JVM, and every rule that reads a provider's
// answer is tested on a plain JVM. Objects are LinkedHashMap, arrays ArrayList, numbers Double, so a check
// for a whole number is the caller's, as Number.isSafeInteger is in the host.
final class CloudJson {
    private static final int MAX_DEPTH = 64;
    private final String text;
    private int at;

    private CloudJson(String text) {
        this.text = text;
    }

    static final class Invalid extends Exception {
        private static final long serialVersionUID = 1L;

        Invalid() {
            super("not JSON", null, false, false);
        }
    }

    static Object parse(String text) throws Invalid {
        if (text == null) throw new Invalid();
        CloudJson reader = new CloudJson(text);
        reader.space();
        Object value = reader.value(0);
        reader.space();
        if (reader.at != text.length()) throw new Invalid();
        return value;
    }

    // The object, or null for anything else, including text that is not JSON.
    @SuppressWarnings("unchecked")
    static Map<String, Object> object(String text) {
        try {
            Object value = parse(text);
            return value instanceof Map ? (Map<String, Object>) value : null;
        } catch (Invalid error) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    static String string(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private void space() {
        while (at < text.length()) {
            char c = text.charAt(at);
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') return;
            at++;
        }
    }

    private Object value(int depth) throws Invalid {
        if (depth > MAX_DEPTH || at >= text.length()) throw new Invalid();
        char c = text.charAt(at);
        if (c == '{') return objectValue(depth);
        if (c == '[') return arrayValue(depth);
        if (c == '"') return stringValue();
        if (c == '-' || (c >= '0' && c <= '9')) return number();
        if (text.startsWith("true", at)) { at += 4; return Boolean.TRUE; }
        if (text.startsWith("false", at)) { at += 5; return Boolean.FALSE; }
        if (text.startsWith("null", at)) { at += 4; return null; }
        throw new Invalid();
    }

    private Map<String, Object> objectValue(int depth) throws Invalid {
        Map<String, Object> result = new LinkedHashMap<>();
        at++;
        space();
        if (at < text.length() && text.charAt(at) == '}') { at++; return result; }
        for (;;) {
            space();
            if (at >= text.length() || text.charAt(at) != '"') throw new Invalid();
            String key = stringValue();
            space();
            if (at >= text.length() || text.charAt(at) != ':') throw new Invalid();
            at++;
            space();
            // A repeated name keeps the last value, as JSON.parse does.
            result.remove(key);
            result.put(key, value(depth + 1));
            space();
            if (at >= text.length()) throw new Invalid();
            char c = text.charAt(at++);
            if (c == '}') return result;
            if (c != ',') throw new Invalid();
        }
    }

    private List<Object> arrayValue(int depth) throws Invalid {
        List<Object> result = new ArrayList<>();
        at++;
        space();
        if (at < text.length() && text.charAt(at) == ']') { at++; return result; }
        for (;;) {
            space();
            result.add(value(depth + 1));
            space();
            if (at >= text.length()) throw new Invalid();
            char c = text.charAt(at++);
            if (c == ']') return result;
            if (c != ',') throw new Invalid();
        }
    }

    private String stringValue() throws Invalid {
        StringBuilder result = new StringBuilder();
        at++;
        for (;;) {
            if (at >= text.length()) throw new Invalid();
            char c = text.charAt(at++);
            if (c == '"') return result.toString();
            if (c < 0x20) throw new Invalid();
            if (c != '\\') { result.append(c); continue; }
            if (at >= text.length()) throw new Invalid();
            char e = text.charAt(at++);
            switch (e) {
                case '"': result.append('"'); break;
                case '\\': result.append('\\'); break;
                case '/': result.append('/'); break;
                case 'b': result.append('\b'); break;
                case 'f': result.append('\f'); break;
                case 'n': result.append('\n'); break;
                case 'r': result.append('\r'); break;
                case 't': result.append('\t'); break;
                case 'u':
                    if (at + 4 > text.length()) throw new Invalid();
                    int code = 0;
                    for (int i = 0; i < 4; i++) {
                        int digit = Character.digit(text.charAt(at++), 16);
                        if (digit < 0) throw new Invalid();
                        code = code * 16 + digit;
                    }
                    result.append((char) code);
                    break;
                default: throw new Invalid();
            }
        }
    }

    private Double number() throws Invalid {
        int start = at;
        if (text.charAt(at) == '-') at++;
        if (at >= text.length()) throw new Invalid();
        if (text.charAt(at) == '0') {
            at++;
        } else if (text.charAt(at) >= '1' && text.charAt(at) <= '9') {
            while (at < text.length() && Character.isDigit(text.charAt(at)) && text.charAt(at) < 0x80) at++;
        } else {
            throw new Invalid();
        }
        if (at < text.length() && text.charAt(at) == '.') {
            at++;
            int digits = at;
            while (at < text.length() && text.charAt(at) >= '0' && text.charAt(at) <= '9') at++;
            if (at == digits) throw new Invalid();
        }
        if (at < text.length() && (text.charAt(at) == 'e' || text.charAt(at) == 'E')) {
            at++;
            if (at < text.length() && (text.charAt(at) == '+' || text.charAt(at) == '-')) at++;
            int digits = at;
            while (at < text.length() && text.charAt(at) >= '0' && text.charAt(at) <= '9') at++;
            if (at == digits) throw new Invalid();
        }
        return Double.valueOf(text.substring(start, at));
    }

    // The value as JSON.stringify writes it. Whole numbers within the safe range are written without a
    // fraction, as JavaScript writes them.
    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        write(out, value);
        return out.toString();
    }

    private static void write(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String) {
            quote(out, (String) value);
        } else if (value instanceof Boolean) {
            out.append(value.toString());
        } else if (value instanceof Long || value instanceof Integer) {
            out.append(value.toString());
        } else if (value instanceof Double) {
            double number = (Double) value;
            if (Double.isNaN(number) || Double.isInfinite(number)) out.append("null");
            else if (number == Math.rint(number) && Math.abs(number) <= 9007199254740991.0) out.append((long) number);
            else out.append(number);
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (!first) out.append(',');
                first = false;
                quote(out, String.valueOf(entry.getKey()));
                out.append(':');
                write(out, entry.getValue());
            }
            out.append('}');
        } else if (value instanceof List) {
            out.append('[');
            Iterator<?> items = ((List<?>) value).iterator();
            while (items.hasNext()) {
                write(out, items.next());
                if (items.hasNext()) out.append(',');
            }
            out.append(']');
        } else {
            throw new IllegalArgumentException("Not a JSON value");
        }
    }

    private static void quote(StringBuilder out, String text) {
        out.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                default:
                    if (c < 0x20) out.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        out.append('"');
    }
}
