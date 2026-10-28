import UIKit
import WebKit
import XCTest
@testable import RecapPage

/// Helpers for tests that run the app's own page in a web view built from the app's own configuration.
@MainActor
enum WebTestSupport {
    enum WaitError: Error {
        case timedOut(String)
    }

    static var window: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first
    }

    /// A web view with the shipping configuration and every remote load blocked, attached to the app's
    /// window so WebKit runs its page as a visible one.
    static func makeWebView(assets: AppAssets) async -> WKWebView {
        let configuration = WebViewFactory.configuration(assets: assets)
        let installed = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            DebugSupport.installRequestIsolation(on: configuration.userContentController) { installed in
                continuation.resume(returning: installed)
            }
        }
        XCTAssertTrue(installed, "the request isolation rules compiled")
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        window?.addSubview(webView)
        return webView
    }

    static func evaluate(_ webView: WKWebView, _ body: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    static func waitFor(
        _ webView: WKWebView,
        _ condition: String,
        timeout: TimeInterval = 30,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let value = try? await evaluate(webView, "return Boolean(\(condition));"), (value as? Bool) == true {
                return
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTFail("Timed out after \(Int(timeout)) s waiting for \(condition)", file: file, line: line)
        throw WaitError.timedOut(condition)
    }

    static func loadAppPage(_ webView: WKWebView, assets: AppAssets) async throws {
        webView.load(URLRequest(url: assets.appPageURL))
        try await waitFor(webView, "location.origin === '\(AppAssets.permanentOrigin)' && document.readyState === 'complete'")
    }

    /// Writes a probe's result to the test log, where CI keeps it, and attaches it to the result bundle.
    static func record(_ name: String, _ json: String, in testCase: XCTestCase) {
        print("RECAP_PROBE_RESULT \(name) \(json)")
        let attachment = XCTAttachment(string: json)
        attachment.name = "\(name).json"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    static func object(_ json: String) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }
}
