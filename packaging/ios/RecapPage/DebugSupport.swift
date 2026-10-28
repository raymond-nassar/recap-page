#if DEBUG
import UIKit
import WebKit

/// Test-only surfaces, compiled into Debug builds alone. A repository test fails if any part of this
/// file, or any use of it elsewhere, can reach a Release build.
enum DebugSupport {
    static let probeScriptKey = "RECAP_PROBE_SCRIPT"
    static let isolateRequestsKey = "RECAP_ISOLATE_REQUESTS"
    static let probeResultIdentifier = "recap-probe-result"

    private static var environment: [String: String] {
        ProcessInfo.processInfo.environment
    }

    /// True while the app hosts the unit tests, which build their own web views.
    static var isHostingUnitTests: Bool {
        environment["XCTestConfigurationFilePath"] != nil
    }

    /// No test run may reach a third party, so unit tests and UI tests both isolate.
    static var isolatesRequests: Bool {
        isHostingUnitTests || environment[isolateRequestsKey] == "1"
    }

    /// Blocks every http and https load before it is sent.
    static let isolationRules = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]"#

    static func installRequestIsolation(
        on controller: WKUserContentController,
        completion: @escaping @MainActor (Bool) -> Void
    ) {
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "recap-request-isolation",
            encodedContentRuleList: isolationRules
        ) { list, _ in
            Task { @MainActor in
                if let list { controller.add(list) }
                completion(list != nil)
            }
        }
    }

    @MainActor private static var probeStarted = false

    /// Runs the script a UI test passed in, once, after the app page first finishes loading, and puts
    /// its result in an accessibility element the test reads.
    @MainActor
    static func runProbeIfRequested(in webView: WKWebView, over view: UIView) {
        guard let script = environment[probeScriptKey], !probeStarted else { return }
        probeStarted = true
        let label = UILabel(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        label.accessibilityIdentifier = probeResultIdentifier
        label.isAccessibilityElement = true
        label.accessibilityLabel = "pending"
        label.alpha = 0.1
        view.addSubview(label)
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                label.accessibilityLabel = (value as? String) ?? "error: the probe returned \(String(describing: value))"
            case .failure(let error):
                label.accessibilityLabel = "error: \(error.localizedDescription)"
            }
        }
    }
}
#endif
