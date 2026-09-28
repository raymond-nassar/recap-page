package io.github.raymondnassar.recappage.prototype;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class NavigationPolicyTest {
    private static int checks;

    private static void check(boolean condition, String label) {
        checks++;
        if (!condition) throw new AssertionError(label);
    }

    public static void main(String[] args) {
        String origin = "http://127.0.0.1:8787";
        NavigationPolicy policy = new NavigationPolicy(origin);
        if (args.length == 1 && args[0].equals("--traversal-only")) {
            check(policy.assetPath(origin + "/../index.html") == null, "Parent traversal is rejected");
            System.out.println("Traversal policy: " + checks + " check passed");
            return;
        }
        check(policy.isAppPage(origin + "/#settings"), "App hash route");
        check("js/main.js".equals(policy.assetPath(origin + "/js/main.js")), "Shared module");
        for (String url : new String[] {
                "http://user@127.0.0.1:8787/", "http://127.0.0.1:8788/",
                "http://localhost:8787/", "https://127.0.0.1:8787/",
                "http://127.0.0.1:8787.evil/", "file:///index.html", "content://provider/data",
                "javascript:alert(1)", "intent://reader", origin + "/../index.html",
                origin + "/%2e%2e/index.html", origin + "/js%2fmain.js", origin + "/js//main.js",
                origin + "/%252e%252e/index.html", origin + "/%00", origin + "/js\\main.js",
        }) check(policy.assetPath(url) == null, "Reject local bypass: " + url);
        check(!policy.isAppPage(origin + "/open.html"), "Launcher not main page");
        check(policy.isPopupPage(origin + "/open.html?d=1"), "Popup launch");
        check(policy.isPopupAsset("js/lib/apiBase.js"), "Popup settings dependency");
        check(policy.isPopupAsset("android/launch.css"), "Package-only popup accessibility stylesheet");
        check(!policy.isPopupAsset("android/bridge.js"), "No popup bridge");
        check(!policy.isPopupAsset("index.html"), "No popup main app");
        check((origin + "/").equals(policy.restoredRoute("https://evil.example/#settings")), "Untrusted restore");
        check((origin + "/#data").equals(policy.restoredRoute(origin + "/index.html#data")), "Restore hash only");
        check(policy.isOfficialReader("https://read.marvel.com/#/book/1"), "Reader handoff");
        check(!policy.isOfficialReader("https://read.marvel.com.evil/#/book/1"), "Reader lookalike");
        check(!policy.isOfficialReader("https://user@read.marvel.com/"), "Reader credentials");
        check(!policy.isOfficialReader("http://read.marvel.com/"), "No plain HTTP handoff");
        String marvelIssue = "marvelunlimited://issue/drn:src:marvel:unison::prod:"
                + "03baf094-d1bf-4eb6-8533-0840ebc0d0b9";
        check(policy.isMarvelIssue(marvelIssue), "Exact Marvel DRN handoff");
        for (String rejected : new String[] {
                null, "", "marvelunlimited://reader/38811", marvelIssue.toUpperCase(),
                marvelIssue + "/", marvelIssue + "?x=1", marvelIssue + "#fragment",
                marvelIssue.replace("prod:", "stage:"), marvelIssue.replace("issue/", "user@issue/"),
                marvelIssue.replace("issue/", "issue:443/"), marvelIssue.replace("drn:", "%64rn:"),
                marvelIssue.replace("marvelunlimited:", "intent:"), "https://evil.example/" + marvelIssue
        }) check(!policy.isMarvelIssue(rejected), "Reject app-link bypass: " + rejected);
        check(policy.isPopupAsset("android/launcher.js"), "Android launcher entry permitted");
        check(policy.isPopupAsset("android/reader.js"), "Android reader controller permitted");
        check(!policy.isPopupAsset("android/app.js"), "Popup still has no app entry");
        check(policy.isNetworkSubresource("https://api.example/v1/issues/1"), "Configurable metadata");
        check(policy.isNetworkSubresource("https://i.annihil.us/cover.jpg"), "Cover network");
        check(policy.isNetworkSubresource("http://127.0.0.1:9999/v1/health"), "Existing loopback metadata mirror");
        check(policy.isNetworkSubresource("http://localhost:9999/v1/health"), "Existing localhost metadata mirror");
        check(!policy.isAppPage("http://127.0.0.1:9999/"), "Metadata origin never becomes the app origin");
        check(!policy.isNetworkSubresource("http://api.example/v1/health"), "Plain HTTP remote metadata stays blocked");
        check(!policy.isNetworkSubresource("file:///secret"), "File subresource blocked");
        check(NavigationPolicy.validRequestId("save:1-abc"), "Request identity");
        check(!NavigationPolicy.validRequestId(""), "Empty identity");
        check(NavigationPolicy.validSaveName("recap-backup.json", "application/json"), "Backup filename");
        check(NavigationPolicy.validSaveName("recap-notes.md", "text/markdown"), "Markdown filename");
        check(!NavigationPolicy.validSaveName("../backup.json", "application/json"), "Filename containment");
        check(!NavigationPolicy.validSaveName("backup.html", "text/plain"), "Wrong text extension");
        check(!NavigationPolicy.validSaveName("backup.json", "image/png"), "No binary exports");
        check(NavigationPolicy.boundedText("Résumé 📚"), "UTF-8 content");
        check(!NavigationPolicy.boundedText(null), "Missing content");
        check(Arrays.equals(NavigationPolicy.utf8Bytes("Résumé 📚"), "Résumé 📚".getBytes(StandardCharsets.UTF_8)),
                "TextEncoder-compatible UTF-8 bytes");
        check(Arrays.equals(NavigationPolicy.utf8Bytes("\uD800"), "\uFFFD".getBytes(StandardCharsets.UTF_8)),
                "Isolated UTF-16 surrogate replacement");
        check(!NavigationPolicy.boundedText("é".repeat(NavigationPolicy.MAX_SAVE_BYTES / 2 + 1)),
                "UTF-8 bound does not allocate a second oversized byte array");
        check("save-9".equals(NavigationPolicy.requestIdFromPrefix(
                "{\"v\":1,\"kind\":\"save\",\"id\":\"save-9\",\"text\":\"payload\"}")), "Oversize reply identity");
        check(NavigationPolicy.requestIdFromPrefix("{\"v\":1,\"kind\":\"back\",\"id\":\"save-9\",") == null,
                "Only export envelope has a save reply identity");
        System.out.println("NavigationPolicy: " + checks + " checks passed");
    }
}
