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

    /// The same record the unit tests write, so the workflow's summary finds UI test measurements too.
    @MainActor
    private func record(_ name: String, _ result: [String: Any]) throws {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
        print("RECAP_PROBE_RESULT \(name) \(json)")
        let attachment = XCTAttachment(string: json)
        attachment.name = "\(name).json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testHomeAndAListPreviewOpenWithEveryRemoteLoadBlocked() throws {
        let app = launch(probe: Self.homeAndPreview)
        // The iOS 18.5 Simulator runs the page at about half the newest runtime's speed, and missed a
        // 90 s wait for this probe that the newest runtime finished in under a minute.
        let result = try probeResult(of: app, timeout: 240)
        try record("home-and-preview", result)
        XCTAssertEqual(result["origin"] as? String, "recappage://localhost")
        XCTAssertEqual(result["home"] as? Bool, true)
        XCTAssertEqual(result["opener"] as? Bool, true, "House of M's card offered Preview")
        XCTAssertEqual(result["previewIssues"] as? Int, 20, "Preview listed all twenty House of M issues")
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
        let persist = 'unavailable';
        try {
          if (navigator.storage?.persist) persist = await navigator.storage.persist();
        } catch (error) {
          persist = `error: ${error.message}`;
        }
        return JSON.stringify({ origin: location.origin, persist, written: localStorage.getItem('recap-ios-relaunch-probe') });
        """)
        let written = try probeResult(of: writer)
        try record("relaunch-writer", written)
        XCTAssertEqual(written["origin"] as? String, "recappage://localhost")
        // Recorded rather than asserted, as the capability probe records it.
        XCTAssertNotNil(written["persist"])
        XCTAssertEqual(written["written"] as? String, token)
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
    // A named single list, as the desktop checks open one: the first card in the timeline can open a
    // grouped Preview with no issue links. House of M is the smallest fixture, at 20 issues. The
    // route is asked for again because on both Simulator runtimes one request went unanswered: a
    // redraw landing before hashchange can undo one (#961), and the retry goes once that is fixed.
    const catalogShown = () => {
      const view = document.getElementById('view-catalog');
      return Boolean(view) && !view.hidden;
    };
    let routeRequests = 0;
    const routeEnd = Date.now() + 60000;
    while (!catalogShown() && Date.now() < routeEnd) {
      routeRequests += 1;
      if (location.hash === '#/catalog') window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = '#/catalog';
      await until(catalogShown, 3000);
    }
    const search = catalogShown() ? document.getElementById('catalog-q') : null;
    if (search) {
      search.value = 'House of M';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const opener = await until(
      () => document.querySelector('#catalog-results [data-story="list:house-of-m"] [data-act="preview"]'), 30000);
    opener?.click();
    await until(() => document.querySelectorAll('#preview[open] .preview-issue-link').length >= 20, 30000);
    const body = document.getElementById('preview-body');
    return JSON.stringify({
      origin: location.origin,
      home: Boolean(home),
      routeRequests,
      hash: location.hash,
      views: [...document.querySelectorAll('.view:not([hidden])')].map((view) => view.id),
      dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
      shellInert: Boolean(document.getElementById('shell')?.inert),
      searched: Boolean(search),
      opener: Boolean(opener),
      previewOpen: Boolean(document.querySelector('#preview[open]')),
      previewIssues: document.querySelectorAll('#preview[open] .preview-issue-link').length,
      previewText: (body?.textContent ?? '').trim().slice(0, 160),
    });
    """#
}
