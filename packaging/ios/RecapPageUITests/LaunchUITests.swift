import XCTest

/// The app as a person launches it: Home and a list's Preview with every remote load blocked, and saved
/// data that survives the app being ended and opened again.
final class LaunchUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func launch(probe: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["RECAP_ISOLATE_REQUESTS"] = "1"
        app.launchEnvironment["RECAP_PROBE_SCRIPT"] = probe
        app.launch()
        return app
    }

    /// The JSON the app's Debug-only probe interface reports for the script it was launched with.
    @MainActor
    private func probeResult(of app: XCUIApplication, timeout: TimeInterval = 90) throws -> [String: Any] {
        let element = app.staticTexts["recap-probe-result"]
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "the probe interface appeared")
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", "pending"), object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [settled], timeout: timeout), .completed, "the probe finished")
        let label = element.label
        XCTAssertFalse(label.hasPrefix("error:"), label)
        let object = try JSONSerialization.jsonObject(with: Data(label.utf8)) as? [String: Any]
        return try XCTUnwrap(object, label)
    }

    @MainActor
    func testHomeAndAListPreviewOpenWithEveryRemoteLoadBlocked() throws {
        let app = launch(probe: Self.homeAndPreview)
        let result = try probeResult(of: app)
        XCTAssertEqual(result["origin"] as? String, "recappage://localhost")
        XCTAssertEqual(result["home"] as? Bool, true)
        XCTAssertGreaterThan(result["previewIssues"] as? Int ?? 0, 0)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "preview-with-remote-loads-blocked"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    func testSavedDataSurvivesTheAppEndingAndOpeningAgain() throws {
        let token = UUID().uuidString
        let writer = launch(probe: """
        localStorage.setItem('recap-ios-relaunch-probe', '\(token)');
        // WebKit commits stored values in batches, so the write is given time to land before the app ends.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return JSON.stringify({ written: localStorage.getItem('recap-ios-relaunch-probe') });
        """)
        XCTAssertEqual(try probeResult(of: writer)["written"] as? String, token)
        writer.terminate()

        let reader = launch(probe: """
        const found = localStorage.getItem('recap-ios-relaunch-probe');
        localStorage.removeItem('recap-ios-relaunch-probe');
        return JSON.stringify({ found });
        """)
        XCTAssertEqual(try probeResult(of: reader)["found"] as? String, token)
    }

    private static let homeAndPreview = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) return null;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    const home = await until(() => {
      const view = document.getElementById('view-home');
      return Boolean(view) && !view.hidden;
    }, 30000);
    location.hash = '#/catalog';
    const opener = await until(() => document.querySelector('#view-catalog [data-act="preview"]'), 30000);
    opener?.click();
    const previewIssues = await until(() => document.querySelectorAll('#preview[open] .preview-issue-link').length, 30000);
    return JSON.stringify({ origin: location.origin, home: Boolean(home), previewIssues: previewIssues ?? 0 });
    """#
}
