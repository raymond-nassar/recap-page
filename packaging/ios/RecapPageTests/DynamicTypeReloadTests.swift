import UIKit
import WebKit
import XCTest
@testable import RecapPage

final class DynamicTypeReloadTests: XCTestCase {
    /// A text size change used to reach only the page then shown, so the next load, such as the
    /// reload after a complete restore, put the size the view loaded with back (#1030).
    @MainActor
    func testATextSizeChangeCarriesIntoLaterPageLoads() async throws {
        let controller = WebViewController()
        let window = try XCTUnwrap(WebTestSupport.window)
        controller.view.frame = window.bounds
        window.addSubview(controller.view)
        defer { controller.view.removeFromSuperview() }
        let webView = try XCTUnwrap(controller.webView)
        try await WebTestSupport.waitFor(
            webView,
            "location.origin === '\(AppAssets.permanentOrigin)' && document.readyState === 'complete'",
            timeout: WebTestSupport.pageLoadTimeout)
        while webView.isLoading { try await Task.sleep(nanoseconds: 100_000_000) }
        let before = try await WebTestSupport.evaluate(
            webView, "return document.documentElement.dataset.iosLargestText;") as? String
        XCTAssertEqual(before, "false", "the test starts below the largest text size")

        let largest = UIContentSizeCategory.accessibilityExtraExtraExtraLarge
        controller.traitOverrides.preferredContentSizeCategory = largest
        controller.updateTraitsIfNeeded()
        let expectedScale = String(Double(UIFont.preferredFont(
            forTextStyle: .body,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: largest)).pointSize) / 17.0)

        let scaleScripts = webView.configuration.userContentController.userScripts
            .map(\.source)
            .filter { $0.contains("--ios-text-scale") }
        XCTAssertEqual(scaleScripts.count, 1, "one text size script is installed")
        XCTAssertTrue(scaleScripts.first?.contains("'\(expectedScale)'") == true,
                      "the installed script carries the new scale")
        XCTAssertTrue(scaleScripts.first?.contains("iosLargestText = 'true'") == true)
        XCTAssertFalse(webView.configuration.userContentController.userScripts.contains {
            $0.source.contains("recapIosRestarted")
        }, "no restart is pending, so the reinstall adds no restart flag")

        let documentBefore = try await WebTestSupport.evaluate(webView, "return performance.timeOrigin;") as? Double
        webView.reload()
        try await WebTestSupport.waitFor(
            webView,
            "performance.timeOrigin !== \(documentBefore ?? -1) && document.readyState === 'complete'",
            timeout: WebTestSupport.pageLoadTimeout)
        let reloaded = try await WebTestSupport.evaluate(webView, """
        const root = document.documentElement;
        return JSON.stringify({ largest: root.dataset.iosLargestText ?? null,
          scale: root.style.getPropertyValue('--ios-text-scale') });
        """) as? String
        let page = try WebTestSupport.object(try XCTUnwrap(reloaded))
        XCTAssertEqual(page["largest"] as? String, "true", "the reloaded page keeps the largest text size")
        XCTAssertEqual(page["scale"] as? String, expectedScale, "the reloaded page keeps the new scale")
    }
}
