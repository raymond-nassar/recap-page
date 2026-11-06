import XCTest

@MainActor
final class NativeTabSpikeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private static let monitorScript = """
    const deadline = Date.now() + 30000;
    while ((!document.body || !document.querySelector('.view:not([hidden])')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!document.body || !document.querySelector('.view:not([hidden])')) {
      throw new Error('The initial app view did not appear');
    }
    const monitor = document.createElement('div');
    monitor.setAttribute('role', 'status');
    monitor.style.cssText = 'position:fixed;left:1px;top:1px;width:1px;height:1px;opacity:0.01;overflow:hidden';
    document.body.append(monitor);
    const update = () => {
      monitor.textContent = 'native-spike ' + JSON.stringify({
        view: document.querySelector('.view:not([hidden])')?.id,
        hash: location.hash,
      });
    };
    update();
    setInterval(update, 100);
    return JSON.stringify({ ready: true });
    """

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["RECAP_ISOLATE_REQUESTS"] = "1"
        app.launchEnvironment["RECAP_IOS_PRESENTATION_TEST_SEED"] = "1"
        app.launchEnvironment["RECAP_PROBE_SCRIPT"] = Self.monitorScript
        app.launch()
        return app
    }

    private func waitForView(_ id: String, in app: XCUIApplication) {
        let monitor = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "native-spike ")).firstMatch
        XCTAssertTrue(monitor.waitForExistence(timeout: 60), "the web view monitor appeared")
        let predicate = NSPredicate(format: "label CONTAINS %@", "\"view\":\"\(id)\"")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: monitor)
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation], timeout: 30),
            .completed,
            "the \(id) view opened; monitor: \(monitor.label)")
    }

    func testNativeTabsOpenTheirSections() {
        let app = launch()
        waitForView("view-read", in: app)
        let bar = app.tabBars["ios-native-spike-tabs"]
        XCTAssertTrue(bar.waitForExistence(timeout: 60), "the native tab bar appeared")
        for (title, view) in [
            ("Library", "view-library"),
            ("Home", "view-home"),
            ("Search", "view-add"),
            ("Settings", "view-data"),
        ] {
            let tab = bar.buttons[title]
            XCTAssertTrue(tab.waitForExistence(timeout: 30), "\(title) tab appeared")
            tab.tap()
            waitForView(view, in: app)
            XCTAssertTrue(tab.isSelected, "\(title) remains selected")
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "native-tab-\(title.lowercased())"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}
