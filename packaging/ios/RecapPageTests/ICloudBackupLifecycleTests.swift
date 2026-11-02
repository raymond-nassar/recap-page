import WebKit
import XCTest
@testable import RecapPage

@MainActor
private final class ICloudLifecycleBridge: NSObject, WKScriptMessageHandlerWithReply {
    let store = ICloudFakeStore()
    private let defaults: UserDefaults
    private let suite: String
    private lazy var handler = ICloudBackupHandler(store: store, defaults: defaults)
    private var creates = 0
    private var maximumPending = 0

    init(offline: Bool) {
        let suite = "recap.ios.icloud.lifecycle.\(UUID().uuidString)"
        self.suite = suite
        defaults = UserDefaults(suiteName: suite)!
        super.init()
        store.automaticallyUpload = !offline
        store.uploadDelaySeconds = 10
    }

    func close() {
        defaults.removePersistentDomain(forName: suite)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let input = message.body as? [String: Any], let operation = input["operation"] as? String else {
            replyHandler(nil, "The lifecycle probe sent an invalid request.")
            return
        }
        Task { @MainActor in
            if operation == "advance" || operation == "summary" {
                if let body = input["body"] as? [String: Any], let seconds = body["seconds"] as? Double {
                    store.advance(seconds: seconds)
                }
                replyHandler([
                    "elapsed": store.elapsed, "files": store.files.count, "pending": store.notUploaded.count,
                    "creates": creates, "maximumPending": maximumPending,
                ], nil)
                return
            }
            let before = store.files.count
            let reply = await handler.handle(operation: operation, body: input["body"] as? String ?? "{}")
            if operation == "create", store.files.count > before { creates += 1 }
            maximumPending = max(maximumPending, store.notUploaded.count)
            replyHandler(["status": reply.status, "body": reply.body, "elapsed": store.elapsed], nil)
        }
    }
}

@MainActor
final class ICloudBackupLifecycleTests: XCTestCase {
    private func originState(of webView: WKWebView) async throws -> String {
        let value = try await WebTestSupport.evaluate(webView, """
        const values = (storage) => Object.keys(storage).sort().map((key) => [key, storage.getItem(key)]);
        const databases = await indexedDB.databases();
        const { CLOUD_BACKUP_DATABASE } = await import(new URL('js/storage.js', location.href).href);
        let cloudRecord = null;
        if (databases.some(({ name }) => name === CLOUD_BACKUP_DATABASE)) {
          const { createCloudRecordStore } = await import(new URL('js/lib/cloudProtocol.js', location.href).href);
          const records = createCloudRecordStore();
          try { cloudRecord = await records.read(); } finally { await records.close(); }
        }
        const probes = databases.filter(({ name }) => typeof name === 'string' && name.startsWith(`${CLOUD_BACKUP_DATABASE}-probe-`))
          .map(({ name, version }) => [name, version]).sort(([a], [b]) => a.localeCompare(b));
        return JSON.stringify({ local: values(localStorage), session: values(sessionStorage), probes, cloudRecord });
        """)
        return try XCTUnwrap(value as? String)
    }

    private func run(offline: Bool, failAfterConsent: Bool = false) async throws -> [String: Any] {
        let assets = try AppAssets.bundled()
        let webView = await WebTestSupport.makeWebView(assets: assets)
        let bridge = ICloudLifecycleBridge(offline: offline)
        webView.configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "icloudProbe")
        defer {
            bridge.close()
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "icloudProbe", contentWorld: .page)
            webView.removeFromSuperview()
        }
        try await WebTestSupport.loadAppPage(webView, assets: assets)
        try await WebTestSupport.waitFor(webView, "localStorage.getItem('mrt.cache-purge.v1') !== null")
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("probes/icloud-backup.js")
        let script = try String(contentsOf: source, encoding: .utf8)
        let before = try await originState(of: webView)
        let invocation: String
        if failAfterConsent {
            invocation = """
            try {
              await window.recapICloudBackupProbe({ offline: \(offline), failAfterConsent: true });
            } catch (error) {
              if (error?.message !== 'The probe stopped after saving fake consent.') throw error;
              return JSON.stringify({ failure: error.message });
            }
            throw new Error('The injected probe failure did not fire.');
            """
        } else {
            invocation = "return await window.recapICloudBackupProbe({ offline: \(offline) });"
        }
        let result = try await WebTestSupport.evaluate(webView, script + "\n" + invocation)
        let unchanged = try await originState(of: webView) == before
        let scenario = failAfterConsent ? "interrupted" : offline ? "offline" : "delayed"
        WebTestSupport.record("icloud-origin-cleanup-\(scenario)", "{\"unchanged\":\(unchanged)}", in: self)
        XCTAssertTrue(unchanged, "the probe leaves app-origin storage and the cloud record unchanged")
        let json = try XCTUnwrap(result as? String)
        WebTestSupport.record("icloud-lifecycle-\(scenario)", json, in: self)
        return try WebTestSupport.object(json)
    }

    func testAnInterruptedProbeLeavesAppOriginDataUnchanged() async throws {
        let result = try await run(offline: false, failAfterConsent: true)
        XCTAssertEqual(result["failure"] as? String, "The probe stopped after saving fake consent.")
    }

    func testTenSecondUploadsVerifyEveryChangeOverAnHourWithoutAccumulatingFiles() async throws {
        let result = try await run(offline: false)
        XCTAssertEqual(result["changes"] as? Int, 10)
        XCTAssertEqual(result["verified"] as? Int, 10)
        XCTAssertEqual(result["creates"] as? Int, 10, "no retry creates a replacement for an unverified upload")
        XCTAssertEqual(result["files"] as? Int, 2, "only the two retained, verified generations remain")
        XCTAssertEqual(result["pending"] as? Int, 0)
        XCTAssertEqual(result["maximumPending"] as? Int, 1)
        XCTAssertEqual(result["phase"] as? String, "up-to-date")
    }

    func testAnHourOfflineLeavesAtMostOnePendingFile() async throws {
        let result = try await run(offline: true)
        XCTAssertEqual(result["verified"] as? Int, 0)
        XCTAssertEqual(result["creates"] as? Int, 1)
        XCTAssertEqual(result["files"] as? Int, 1)
        XCTAssertEqual(result["pending"] as? Int, 1)
        XCTAssertEqual(result["maximumPending"] as? Int, 1)
        XCTAssertEqual(result["phase"] as? String, "retrying")
    }
}
