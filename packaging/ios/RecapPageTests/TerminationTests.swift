import WebKit
import XCTest
@testable import RecapPage

final class TerminationTests: XCTestCase {
    @MainActor
    func testAnEndedContentProcessReloadsThePageAndSaysSavedDataIsRetained() async throws {
        let controller = WebViewController()
        let window = try XCTUnwrap(WebTestSupport.window)
        controller.view.frame = window.bounds
        window.addSubview(controller.view)
        defer { controller.view.removeFromSuperview() }
        let webView = try XCTUnwrap(controller.webView)
        try await WebTestSupport.waitFor(
            webView,
            "location.origin === '\(AppAssets.permanentOrigin)' && document.readyState === 'complete' && Boolean(document.getElementById('ios-report'))")
        // The first load's own completion is reported after readyState settles; let it arrive before
        // the simulated ending, so the notice can only come from the reload.
        while webView.isLoading { try await Task.sleep(nanoseconds: 100_000_000) }
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertFalse(controller.restartNoticePending)

        // WebKit reports an ended content process to the navigation delegate. Calling that delegate
        // method, rather than the controller's, proves the wiring as well as the recovery.
        webView.navigationDelegate?.webViewWebContentProcessDidTerminate?(webView)
        XCTAssertTrue(controller.restartNoticePending)

        try await WebTestSupport.waitFor(
            webView, "Boolean(document.getElementById('ios-report')) && !document.getElementById('ios-report').hidden")
        let notice = try await WebTestSupport.evaluate(webView, "return document.getElementById('ios-report').textContent;") as? String
        XCTAssertEqual(notice, "Recap Page reloaded because iOS stopped its page. Saved reading progress is retained.")
        XCTAssertFalse(controller.restartNoticePending)
    }
}
