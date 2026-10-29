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
        // the ending, so the notice can only come from the reload.
        while webView.isLoading { try await Task.sleep(nanoseconds: 100_000_000) }
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertFalse(controller.restartNoticePending)
        let documentBefore = try await WebTestSupport.evaluate(webView, "return performance.timeOrigin;") as? Double
        // Test-only counter for the diagnostics below: the documents this web view starts from here on.
        webView.configuration.userContentController.addUserScript(WKUserScript(source: """
        sessionStorage.setItem('recap-test-documents', String(Number(sessionStorage.getItem('recap-test-documents') ?? 0) + 1));
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // The content process is ended for real, so WebKit itself tells the navigation delegate, as it
        // does when iOS ends it, and no earlier page survives to unload while the new one starts.
        // Calling the delegate method instead leaves the earlier page running, which an ended process
        // never does, and under it the reloaded page did not show the notice on either Simulator
        // runtime. The selector is WebKit's own test hook, called only from this test bundle, which no
        // build of the app contains.
        let kill = NSSelectorFromString("_killWebContentProcess")
        try XCTSkipUnless(webView.responds(to: kill), "this WebKit gives a test no way to end its content process")
        _ = webView.perform(kill)

        do {
            try await WebTestSupport.waitFor(
                webView, "Boolean(document.getElementById('ios-report')) && !document.getElementById('ios-report').hidden")
        } catch {
            // What the page and the controller hold when the notice never appeared: whether a new
            // document loaded, how many did, whether the restart was consumed and the page had the flag.
            let page = try? await WebTestSupport.evaluate(webView, """
            return JSON.stringify({ href: location.href, readyState: document.readyState, timeOrigin: performance.timeOrigin,
              report: Boolean(document.getElementById('ios-report')), hidden: document.getElementById('ios-report')?.hidden ?? null,
              documents: sessionStorage.getItem('recap-test-documents'), flag: window.recapIosRestarted ?? null });
            """) as? String
            WebTestSupport.record("termination-diagnostics", """
            {"pending":\(controller.restartNoticePending),"loading":\(webView.isLoading),"url":"\(webView.url?.absoluteString ?? "")","documentBefore":\(documentBefore ?? -1),"page":\(page ?? "null")}
            """, in: self)
            throw error
        }
        let notice = try await WebTestSupport.evaluate(webView, "return document.getElementById('ios-report').textContent;") as? String
        XCTAssertEqual(notice, "Recap Page reloaded because iOS stopped its page. Saved reading progress is retained.")
        XCTAssertFalse(controller.restartNoticePending)
    }
}
