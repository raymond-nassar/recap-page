import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.CodeSigner;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPublicKey;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeMap;
import java.util.jar.JarFile;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

public final class VerifyBundle {
    private static final long MAX_BYTES = 1024L * 1024 * 1024;
    private static final int MAX_ENTRIES = 100000;
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";

    private static void require(boolean condition, String code) {
        if (!condition) throw new IllegalArgumentException(code);
    }

    private static String hash(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static boolean checkCertificate(X509Certificate certificate) throws Exception {
        certificate.checkValidity();
        var key = certificate.getPublicKey();
        require((key instanceof RSAPublicKey rsa && rsa.getModulus().bitLength() >= 2048)
                || (key instanceof ECPublicKey ec && ec.getParams().getOrder().bitLength() >= 256),
                "CERTIFICATE_KEY_POLICY");
        return certificate.getSubjectX500Principal().getName().toLowerCase(Locale.ROOT)
                .contains("cn=android debug");
    }

    private static long unsignedInt(RandomAccessFile file) throws Exception {
        return Integer.toUnsignedLong(Integer.reverseBytes(file.readInt()));
    }

    private static int unsignedShort(RandomAccessFile file) throws Exception {
        return Short.toUnsignedInt(Short.reverseBytes(file.readShort()));
    }

    private static void centralDirectory(Path archive) throws Exception {
        try (var file = new RandomAccessFile(archive.toFile(), "r")) {
            long size = file.length();
            require(size >= 22 && size <= MAX_BYTES, "ZIP_SIZE");
            long end = -1;
            for (long offset = size - 22; offset >= Math.max(0, size - 65557); offset--) {
                file.seek(offset);
                if (unsignedInt(file) != 0x06054b50L) continue;
                file.seek(offset + 20);
                if (offset + 22 + unsignedShort(file) == size) { end = offset; break; }
            }
            require(end >= 0, "ZIP_END");
            file.seek(end + 4);
            require(unsignedShort(file) == 0 && unsignedShort(file) == 0, "ZIP_MULTIDISK");
            int onDisk = unsignedShort(file);
            int count = unsignedShort(file);
            long length = unsignedInt(file);
            long start = unsignedInt(file);
            require(count == onDisk && count > 0 && count < 65535 && count <= MAX_ENTRIES
                    && start + length == end, "ZIP_DIRECTORY");
            file.seek(start);
            for (int i = 0; i < count; i++) {
                require(unsignedInt(file) == 0x02014b50L, "ZIP_CENTRAL_ENTRY");
                file.skipBytes(4);
                require((unsignedShort(file) & 1) == 0, "ZIP_ENCRYPTED");
                file.skipBytes(18);
                int nameLength = unsignedShort(file);
                int extraLength = unsignedShort(file);
                int commentLength = unsignedShort(file);
                require(unsignedShort(file) == 0, "ZIP_ENTRY_DISK");
                file.skipBytes(2);
                long attributes = unsignedInt(file);
                long mode = (attributes >>> 16) & 0170000;
                require(mode == 0 || mode == 0100000 || mode == 0040000, "ZIP_SPECIAL_FILE");
                file.skipBytes(4 + nameLength + extraLength + commentLength);
            }
            require(file.getFilePointer() == end, "ZIP_CENTRAL_LENGTH");
        }
    }

    private static void archive(String[] args) throws Exception {
        require(args.length == 4, "ARCHIVE_ARGUMENTS");
        Path input = Path.of(args[1]);
        String expected = args[2];
        boolean signed = !expected.equals("-");
        require(!signed || expected.matches("[0-9a-f]{64}"), "SIGNER_ARGUMENT");
        Path output = Path.of(args[3]).toAbsolutePath().normalize();
        require(!Files.exists(output), "OUTPUT_EXISTS");
        centralDirectory(input);
        Files.createDirectory(output);
        Set<String> names = new HashSet<>();
        List<String> rows = new ArrayList<>();
        long total = 0;
        try (var jar = new JarFile(input.toFile(), signed)) {
            var entries = jar.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                String name = entry.getName();
                require(name.matches("[A-Za-z0-9_.+/-]+") && !name.startsWith("/")
                        && !name.contains("//") && names.add(name) && names.size() <= MAX_ENTRIES,
                        "ZIP_ENTRY_NAME");
                for (String part : name.split("/")) {
                    require(!part.equals(".") && !part.equals(".."), "ZIP_ENTRY_TRAVERSAL");
                }
                Path destination = output.resolve(name).normalize();
                require(destination.startsWith(output) && !destination.equals(output), "ZIP_ENTRY_TRAVERSAL");
                if (entry.isDirectory()) { Files.createDirectories(destination); continue; }
                require(entry.getSize() >= 0 && entry.getSize() <= MAX_BYTES, "ZIP_ENTRY_SIZE");
                Files.createDirectories(destination.getParent());
                var sha = MessageDigest.getInstance("SHA-256");
                long bytes = 0;
                byte[] magic = new byte[4];
                try (InputStream stream = jar.getInputStream(entry);
                        OutputStream target = Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        for (int i = 0; i < count && bytes + i < 4; i++) magic[(int) bytes + i] = buffer[i];
                        bytes += count;
                        total += count;
                        require(total <= MAX_BYTES && bytes <= entry.getSize(), "ZIP_EXPANSION_LIMIT");
                        sha.update(buffer, 0, count);
                        target.write(buffer, 0, count);
                    }
                }
                require(bytes == entry.getSize(), "ZIP_ENTRY_LENGTH");
                boolean envelope = name.equals("META-INF/MANIFEST.MF")
                        || name.matches("META-INF/RECAP\\.(SF|RSA|EC|DSA)");
                if (signed && !envelope) {
                    CodeSigner[] signers = entry.getCodeSigners();
                    require(signers != null && signers.length == 1, "UNSIGNED_ENTRY");
                    if (signers != null) {
                        var certificate = (X509Certificate) signers[0].getSignerCertPath().getCertificates().get(0);
                        require(!checkCertificate(certificate)
                                && hash(certificate.getEncoded()).equals(expected), "UNEXPECTED_SIGNER");
                    }
                }
                boolean elf = Arrays.equals(magic, new byte[] { 0x7f, 'E', 'L', 'F' });
                rows.add("{\"name\":\"" + name + "\",\"bytes\":" + bytes + ",\"sha256\":\""
                        + HexFormat.of().formatHex(sha.digest()) + "\",\"elf\":" + elf + "}");
            }
        }
        require(!rows.isEmpty(), "EMPTY_ARCHIVE");
        System.out.println("{\"files\":[" + String.join(",", rows) + "]}");
    }

    private static Element xml(Path path) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return factory.newDocumentBuilder().parse(path.toFile()).getDocumentElement();
    }

    private static List<Element> children(Element parent, String name) {
        var values = new ArrayList<Element>();
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element element && (name == null || element.getTagName().equals(name))) values.add(element);
        }
        return values;
    }

    private static String attr(Element element, String name) {
        return element.getAttributeNS(ANDROID, name);
    }

    private static String canonical(Element element) {
        var attributes = new TreeMap<String, String>();
        for (int i = 0; i < element.getAttributes().getLength(); i++) {
            Node node = element.getAttributes().item(i);
            if (!XMLConstants.XMLNS_ATTRIBUTE_NS_URI.equals(node.getNamespaceURI())) {
                attributes.put(node.getNodeName(), node.getNodeValue());
            }
        }
        var parts = new ArrayList<String>();
        for (Node node = element.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element child) parts.add(canonical(child));
            else if (node.getNodeType() == Node.TEXT_NODE && !node.getNodeValue().isBlank()) parts.add(node.getNodeValue().trim());
        }
        return element.getTagName() + attributes + parts;
    }

    private static String networkCount(int count) {
        return count <= 16 ? Integer.toString(count) : "\"overflow\"";
    }

    private static String networkNamespace(Node node) {
        String namespace = node.getNamespaceURI();
        return namespace == null || namespace.isEmpty() ? "none" : ANDROID.equals(namespace) ? "android" : "other";
    }

    private static int networkAttributeCount(Element element) {
        int count = 0;
        for (int i = 0; i < element.getAttributes().getLength(); i++) {
            if (!XMLConstants.XMLNS_ATTRIBUTE_NS_URI.equals(element.getAttributes().item(i).getNamespaceURI())) count++;
        }
        return count;
    }

    private static List<Element> networkChildren(Element element, String name) {
        return children(element, null).stream().filter(child -> name.equals(child.getLocalName())
                || name.equals(child.getTagName())).toList();
    }

    private static List<Node> networkAttributes(Element element, String name) {
        List<Node> values = new ArrayList<>();
        for (int i = 0; i < element.getAttributes().getLength(); i++) {
            Node attribute = element.getAttributes().item(i);
            if (name.equals(attribute.getLocalName()) || name.equals(attribute.getNodeName())) values.add(attribute);
        }
        return values;
    }

    private static String networkBoolean(List<Node> values) {
        if (values.isEmpty()) return "absent";
        if (values.size() != 1) return "other";
        String value = values.get(0).getNodeValue();
        return value.equals("true") || value.equals("false") ? value : "other";
    }

    private static String networkAttributeNamespace(List<Node> values) {
        return values.isEmpty() ? "absent" : values.size() == 1 ? networkNamespace(values.get(0)) : "ambiguous";
    }

    private static String networkTextKind(Element element) {
        boolean text = false;
        boolean cdata = false;
        boolean blank = false;
        boolean other = false;
        for (Node node = element.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node.getNodeType() == Node.TEXT_NODE || node.getNodeType() == Node.CDATA_SECTION_NODE) {
                if (node.getNodeValue().isBlank()) blank = true;
                else if (node.getNodeType() == Node.TEXT_NODE) text = true;
                else cdata = true;
            } else if (!(node instanceof Element) && node.getNodeType() != Node.COMMENT_NODE) other = true;
        }
        return other ? "other" : text && cdata ? "mixed" : text ? "text" : cdata ? "cdata" : blank ? "blank" : "empty";
    }

    private static String networkConfigShape(Element element) {
        if (element == null) return "null";
        var cleartext = networkAttributes(element, "cleartextTrafficPermitted");
        return "{\"namespace\":\"" + networkNamespace(element) + "\",\"attributes\":" + networkCount(networkAttributeCount(element))
                + ",\"children\":" + networkCount(children(element, null).size()) + ",\"textKind\":\"" + networkTextKind(element)
                + "\",\"cleartext\":\"" + networkBoolean(cleartext) + "\",\"cleartextNamespace\":\""
                + networkAttributeNamespace(cleartext) + "\"}";
    }

    private static String networkDomainShape(Element element) {
        var subdomains = networkAttributes(element, "includeSubdomains");
        String text = element.getTextContent().trim();
        String value = text.isEmpty() ? "absent" : text.equals("127.0.0.1") ? "loopback" : text.equals("localhost") ? "localhost" : "other";
        return "{\"namespace\":\"" + networkNamespace(element) + "\",\"attributes\":" + networkCount(networkAttributeCount(element))
                + ",\"children\":" + networkCount(children(element, null).size()) + ",\"textKind\":\"" + networkTextKind(element)
                + "\",\"includeSubdomains\":\"" + networkBoolean(subdomains) + "\",\"includeNamespace\":\""
                + networkAttributeNamespace(subdomains) + "\",\"value\":\"" + value + "\"}";
    }

    private static String networkShape(Element root) {
        var bases = networkChildren(root, "base-config");
        var configs = networkChildren(root, "domain-config");
        Element base = bases.isEmpty() ? null : bases.get(0);
        Element config = configs.isEmpty() ? null : configs.get(0);
        List<Element> domains = config == null ? List.of() : networkChildren(config, "domain");
        List<String> domainShapes = domains.stream().limit(4).map(VerifyBundle::networkDomainShape).toList();
        String tag = root.getTagName().equals("network-security-config") ? "network-security-config" : "other";
        return "{\"root\":\"" + tag + "\",\"namespace\":\"" + networkNamespace(root)
                + "\",\"attributes\":" + networkCount(networkAttributeCount(root))
                + ",\"children\":" + networkCount(children(root, null).size()) + ",\"textKind\":\"" + networkTextKind(root)
                + "\",\"baseCount\":" + networkCount(bases.size()) + ",\"domainConfigCount\":" + networkCount(configs.size())
                + ",\"base\":" + networkConfigShape(base) + ",\"domainConfig\":" + networkConfigShape(config)
                + ",\"domainCount\":" + networkCount(domains.size()) + ",\"domains\":[" + String.join(",", domainShapes) + "]}";
    }

    private static String sdkToken(String value) {
        if (value.isEmpty()) return "absent";
        return value.matches("0|[1-9][0-9]{0,3}") ? value : "invalid";
    }

    private static void reportSdkShape(String kind, boolean configSplit, Integer ordinal, List<Element> sdk) {
        if (!(kind.equals("app") || kind.equals("apk")) || sdk.size() > MAX_ENTRIES) return;
        String min = sdk.isEmpty() ? "absent" : sdk.size() == 1 ? sdkToken(attr(sdk.get(0), "minSdkVersion")) : "invalid";
        String target = sdk.isEmpty() ? "absent" : sdk.size() == 1 ? sdkToken(attr(sdk.get(0), "targetSdkVersion")) : "invalid";
        System.err.println("SDK_SHAPE {\"kind\":\"" + kind + "\",\"configSplit\":" + configSplit
                + ",\"splitOrdinal\":" + ordinal + ",\"usesSdkCount\":" + sdk.size()
                + ",\"minSdk\":\"" + min + "\",\"targetSdk\":\"" + target + "\"}");
    }

    private static Element generatedMetadata(Element app) {
        var metadata = children(app, "meta-data");
        require(metadata.size() == 1, "GENERATED_SPLITS_METADATA");
        Element value = metadata.get(0);
        require(value.getAttributes().getLength() == 2 && children(value, null).isEmpty()
                && value.getTextContent().isBlank()
                && attr(value, "name").equals("com.android.vending.splits")
                && !attr(value, "resource").isEmpty() && attr(value, "value").isEmpty(),
                "GENERATED_SPLITS_METADATA");
        return value;
    }

    private static boolean xmlResourceReferenceMatches(String reference, String name, String id) {
        return reference.equals("@xml/" + name) || reference.equalsIgnoreCase("@" + id)
                || reference.equalsIgnoreCase("@" + id.substring(2))
                || reference.equalsIgnoreCase("@ref/" + id);
    }

    private static void generatedResourceBinding(Element metadata, String resources) {
        var entry = java.util.regex.Pattern.compile(
                "(?m)^\\s*resource (0x[0-9a-fA-F]+) (?:[\\w.]+:)?xml/splits0(?:\\s|$)").matcher(resources);
        require(entry.find(), "GENERATED_SPLITS_RESOURCE");
        String id = entry.group(1);
        int start = entry.end();
        require(!entry.find(), "GENERATED_SPLITS_RESOURCE");
        String reference = attr(metadata, "resource");
        require(xmlResourceReferenceMatches(reference, "splits0", id), "GENERATED_SPLITS_RESOURCE");
        var next = java.util.regex.Pattern.compile("(?m)^\\s*resource ").matcher(resources);
        int end = next.find(start) ? next.start() : resources.length();
        var files = java.util.regex.Pattern.compile("\\(file\\)\\s+([^\\s]+)").matcher(resources.substring(start, end));
        require(files.find() && files.group(1).equals("res/xml/splits0.xml") && !files.find(),
                "GENERATED_SPLITS_RESOURCE");
    }

    private static void manifest(String[] args) throws Exception {
        manifest(args, true);
    }

    private static void manifest(String[] args, boolean reportSuccess) throws Exception {
        require(args.length == 7 || args.length == 8, "MANIFEST_ARGUMENTS");
        require(args[6].equals("publishing") || args[6].equals("bundletool-1.18.3-api36"), "MANIFEST_ARGUMENTS");
        boolean derivedProfile = args[6].equals("bundletool-1.18.3-api36");
        Integer ordinal = null;
        if (args[5].equals("apk") && args.length == 8) {
            require(args[7].matches("--split-ordinal=([0-9]|[12][0-9]|3[01])"), "MANIFEST_ARGUMENTS");
            ordinal = Integer.valueOf(args[7].substring("--split-ordinal=".length()));
        }
        Element root = xml(Path.of(args[1]));
        require(root.getTagName().equals("manifest") && root.getAttribute("package").equals(args[2]),
                "MANIFEST_PACKAGE");
        boolean test = args[5].equals("test");
        boolean split = args[5].equals("apk") && !root.getAttribute("split").isEmpty();
        require(test || (attr(root, "versionCode").equals(args[3])
                && (attr(root, "versionName").equals(args[4]) || (split && attr(root, "versionName").isEmpty()))), "MANIFEST_VERSION");
        var sdk = children(root, "uses-sdk");
        String minimum = derivedProfile && !split ? "32" : "26";
        boolean derivedConfig = derivedProfile && split;
        boolean sdkMatches = test || (derivedConfig
                ? sdk.size() == 1 && attr(sdk.get(0), "minSdkVersion").equals("32")
                        && attr(sdk.get(0), "targetSdkVersion").isEmpty()
                : (split && sdk.isEmpty()) || (sdk.size() == 1 && attr(sdk.get(0), "minSdkVersion").equals(minimum)
                        && attr(sdk.get(0), "targetSdkVersion").equals("36")));
        if (!sdkMatches) reportSdkShape(args[5], split, ordinal, sdk);
        require(sdkMatches, "MANIFEST_SDK");
        var apps = children(root, "application");
        require(apps.size() == 1, "MANIFEST_APPLICATION");
        Element app = apps.get(0);
        boolean production = args[5].equals("app") || args[5].equals("apk");
        require(production || test, "MANIFEST_KIND");
        if (production) {
            require((attr(app, "debuggable").isEmpty() || attr(app, "debuggable").equals("false"))
                    && (attr(app, "testOnly").isEmpty() || attr(app, "testOnly").equals("false")),
                    "DEBUGGABLE_APPLICATION");
            if (split) {
                if (derivedConfig) {
                    require(root.getAttribute("split").matches("config\\.[A-Za-z0-9_]{1,180}")
                            && (attr(root, "isFeatureSplit").isEmpty() || attr(root, "isFeatureSplit").equals("false"))
                            && root.getAttribute("configForSplit").isEmpty() && attr(root, "configForSplit").isEmpty()
                            && children(root, "uses-split").isEmpty(), "SPLIT_IDENTITY");
                    require(attr(app, "hasCode").equals("false")
                            && attr(app, "name").isEmpty()
                            && children(root, null).stream().allMatch(child ->
                                    List.of("uses-sdk", "application").contains(child.getTagName())),
                            "SPLIT_COMPONENTS");
                }
                require(children(app, null).isEmpty() && children(root, "instrumentation").isEmpty()
                        && children(root, "uses-permission").isEmpty(), "SPLIT_COMPONENTS");
                if (reportSuccess) System.out.println("{\"verified\":true}");
                return;
            }
            require(attr(app, "allowBackup").equals("false") && attr(app, "usesCleartextTraffic").equals("false"),
                    "MANIFEST_BACKUP_NETWORK");
            var permissions = children(root, "uses-permission");
            require(permissions.size() == 1 && attr(permissions.get(0), "name").equals("android.permission.INTERNET"),
                    "MANIFEST_PERMISSIONS");
            require(children(root, "uses-permission-sdk-23").isEmpty() && children(root, "instrumentation").isEmpty(),
                    "MANIFEST_TEST_COMPONENT");
            require(children(root, null).stream().allMatch(child -> List.of("uses-sdk", "uses-permission", "queries", "application")
                    .contains(child.getTagName())), "MANIFEST_ROOT_INVENTORY");
            var queries = children(root, "queries");
            require(queries.size() == 1 && children(queries.get(0), null).size() == 1, "MANIFEST_QUERIES");
            var intents = children(queries.get(0), "intent");
            require(intents.size() == 1, "MANIFEST_QUERY_INTENT");
            var query = intents.get(0);
            require(children(query, null).size() == 3 && children(query, "action").size() == 1
                    && children(query, "category").size() == 1 && children(query, "data").size() == 1,
                    "MANIFEST_QUERY_INVENTORY");
            require(attr(children(query, "action").get(0), "name").equals("android.intent.action.VIEW")
                    && attr(children(query, "category").get(0), "name").equals("android.intent.category.BROWSABLE")
                    && attr(children(query, "data").get(0), "scheme").equals("https")
                    && children(query, "data").get(0).getAttributes().getLength() == 1,
                    "MANIFEST_BROWSER_QUERY");
            var components = children(app, null);
            var activities = children(app, "activity");
            require(activities.size() == 1
                    && attr(activities.get(0), "name").equals("io.github.raymondnassar.recappage.prototype.MainActivity")
                    && attr(activities.get(0), "exported").equals("true"), "MANIFEST_COMPONENTS");
            if (derivedProfile) {
                generatedMetadata(app);
                require(components.size() == 2
                        && components.stream().allMatch(child ->
                                List.of("activity", "meta-data").contains(child.getTagName())), "MANIFEST_COMPONENTS");
            } else {
                require(components.size() == 1, "MANIFEST_COMPONENTS");
            }
            for (String resource : List.of("fullBackupContent", "dataExtractionRules", "networkSecurityConfig")) {
                require(attr(app, resource).startsWith("@"), "MANIFEST_POLICY_RESOURCE");
            }
            if (args.length == 8 && !args[5].equals("apk")) {
                String resources = Files.readString(Path.of(args[7]));
                if (derivedProfile) generatedResourceBinding(generatedMetadata(app), resources);
                var names = List.of("backup_rules", "data_extraction_rules", "network_security_config");
                var attributes = List.of("fullBackupContent", "dataExtractionRules", "networkSecurityConfig");
                for (int i = 0; i < names.size(); i++) {
                    String reference = attr(app, attributes.get(i));
                    var matcher = java.util.regex.Pattern.compile("resource (0x[0-9a-fA-F]+) (?:[\\w.]+:)?xml/"
                            + names.get(i) + "(?:\\s|$)").matcher(resources);
                    require(matcher.find(), "POLICY_RESOURCE_UNRESOLVED");
                    require(xmlResourceReferenceMatches(reference, names.get(i), matcher.group(1)), "POLICY_RESOURCE_REFERENCE");
                }
            }
        } else {
            var instrumentation = children(root, "instrumentation");
            require(instrumentation.size() == 1
                    && attr(instrumentation.get(0), "targetPackage").equals(args[2].replaceFirst("\\.test$", "")),
                    "INSTRUMENTATION_TARGET");
        }
        if (reportSuccess) System.out.println("{\"verified\":true}");
    }

    private static void generatedSplits(String[] args) throws Exception {
        require(args.length >= 7 && args.length <= 38, "GENERATED_SPLITS_XML");
        String expectedPackage = "io.github.raymondnassar.recappage";
        manifest(new String[] { "manifest", args[1], expectedPackage, args[2], args[3],
                "app", "bundletool-1.18.3-api36", args[4] }, false);
        String expectedBase = canonical(xml(Path.of(args[1])));
        Set<String> splitIds = new HashSet<>();
        for (int index = 6; index < args.length; index++) {
            Element split = xml(Path.of(args[index]));
            String id = split.getAttribute("split");
            require(splitIds.add(id), "GENERATED_SPLITS_MAPPING");
            manifest(new String[] { "manifest", args[index], expectedPackage, args[2], args[3],
                    "apk", "bundletool-1.18.3-api36", "--split-ordinal=" + (index - 6) }, false);
            if (id.isEmpty()) require(canonical(split).equals(expectedBase), "GENERATED_SPLITS_MAPPING");
        }
        require(splitIds.contains(""), "GENERATED_SPLITS_MAPPING");
        Element tree = xml(Path.of(args[5]));
        require(tree.getTagName().equals("splits") && tree.getAttributes().getLength() == 0
                && tree.getTextContent().isBlank(), "GENERATED_SPLITS_XML");
        var modules = children(tree, null);
        for (Element module : modules) {
            require(module.getTagName().equals("module") && module.getAttributes().getLength() == 1
                    && module.hasAttribute("name") && module.getAttribute("name").isEmpty(),
                    "GENERATED_SPLITS_MAPPING");
            var languages = children(module, null);
            require(languages.size() == 1 && languages.get(0).getTagName().equals("language")
                    && languages.get(0).getAttributes().getLength() == 0, "GENERATED_SPLITS_XML");
            for (Element entry : children(languages.get(0), null)) {
                require(entry.getTagName().equals("entry") && entry.getAttributes().getLength() == 2
                        && entry.hasAttribute("key") && entry.hasAttribute("split")
                        && children(entry, null).isEmpty() && splitIds.contains(entry.getAttribute("split")),
                        "GENERATED_SPLITS_MAPPING");
            }
        }
        // This fixed source profile has no localized Android resources, checked before derivation inspection.
        require(modules.isEmpty(), "GENERATED_SPLITS_MAPPING");
        System.out.println("{\"verified\":true}");
    }

    public static void main(String[] args) {
        try {
            require(args.length > 0, "COMMAND_REQUIRED");
            switch (args[0]) {
                case "archive" -> archive(args);
                case "manifest" -> manifest(args);
                case "generated-splits" -> generatedSplits(args);
                case "resource" -> {
                    require(args.length == 3, "RESOURCE_POLICY_MISMATCH");
                    Element actual = xml(Path.of(args[1]));
                    Element expected = xml(Path.of(args[2]));
                    boolean matches = canonical(actual).equals(canonical(expected));
                    if (!matches && expected.getTagName().equals("network-security-config")) {
                        System.err.println("NETWORK_SHAPE {\"expected\":" + networkShape(expected)
                                + ",\"actual\":" + networkShape(actual) + "}");
                    }
                    require(matches, "RESOURCE_POLICY_MISMATCH");
                    System.out.println("{\"verified\":true}");
                }
                case "certificate" -> {
                    require(args.length == 4, "CERTIFICATE_ARGUMENTS");
                    String password = System.getenv(args[3]);
                    String alias = System.getenv(args[2]);
                    require(password != null && !password.isEmpty() && alias != null && !alias.isEmpty(), "CREDENTIAL_REQUIRED");
                    char[] chars = password.toCharArray();
                    var store = KeyStore.getInstance(Path.of(args[1]).toFile(), chars);
                    Arrays.fill(chars, '\0');
                    require(store.isKeyEntry(alias), "PRIVATE_KEY_ENTRY_REQUIRED");
                    var certificate = (X509Certificate) store.getCertificate(alias);
                    boolean debug = checkCertificate(certificate);
                    System.out.println("{\"sha256\":\"" + hash(certificate.getEncoded()) + "\",\"debug\":" + debug + "}");
                }
                default -> throw new IllegalArgumentException("UNKNOWN_COMMAND");
            }
        } catch (Exception error) {
            String code = error instanceof IllegalArgumentException && error.getMessage() != null
                    && error.getMessage().matches("[A-Z_]+") ? error.getMessage() : "VERIFICATION_FAILED";
            System.err.println(code);
            System.exit(1);
        }
    }
}
