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
    private func run(offline: Bool) async throws -> [String: Any] {
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
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("probes/icloud-backup.js")
        let script = try String(contentsOf: source, encoding: .utf8)
        let result = try await WebTestSupport.evaluate(
            webView, script + "\nreturn await window.recapICloudBackupProbe({ offline: \(offline) });"
        )
        let json = try XCTUnwrap(result as? String)
        WebTestSupport.record("icloud-lifecycle-\(offline ? "offline" : "delayed")", json, in: self)
        return try WebTestSupport.object(json)
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
