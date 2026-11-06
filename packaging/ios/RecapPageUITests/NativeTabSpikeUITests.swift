import UIKit
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
        historyLength: history.length,
        dialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.id),
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

    private func monitor(in app: XCUIApplication) -> XCUIElement {
        let monitor = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "native-spike ")).firstMatch
        XCTAssertTrue(monitor.waitForExistence(timeout: 60), "the web view monitor appeared")
        return monitor
    }

    private func waitForView(_ id: String, in app: XCUIApplication) {
        let monitor = monitor(in: app)
        let predicate = NSPredicate(format: "label CONTAINS %@", "\"view\":\"\(id)\"")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: monitor)
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation], timeout: 30),
            .completed,
            "the \(id) view opened; monitor: \(monitor.label)")
    }

    private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func swipeBack(in app: XCUIApplication) {
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "the root web view appeared")
        let start = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.4))
        let end = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.4))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func openSeededList(in app: XCUIApplication) {
        let bar = app.tabBars["ios-native-spike-tabs"]
        XCTAssertTrue(bar.waitForExistence(timeout: 30), "the native tab bar appeared")
        if bar.buttons["Library"].isSelected {
            bar.buttons["Home"].tap()
            waitForView("view-home", in: app)
        }
        bar.buttons["Library"].tap()
        waitForView("view-library", in: app)
        let list = app.webViews.firstMatch.links.matching(
            NSPredicate(format: "label BEGINSWITH %@", "iOS presentation fixture")).firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 30), "the seeded reading list appeared")
        list.tap()
        waitForView("view-read", in: app)
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
            if title == "Library" {
                let heading = app.webViews.firstMatch.descendants(matching: .any).matching(
                    NSPredicate(format: "label == %@", "Your Reading Lists")).firstMatch
                XCTAssertTrue(heading.waitForExistence(timeout: 30), "the Library content appeared")
                let visible = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "hittable == YES"), object: heading)
                XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 30), .completed, "the Library content is visible")
            }
            capture(app, named: "native-tab-\(title.lowercased())")
        }
        bar.buttons["Library"].tap()
        waitForView("view-library", in: app)
        capture(app, named: "native-tab-library-return")
    }

    func testBackGestureOnInitialPage() {
        let app = launch()
        waitForView("view-read", in: app)
        let before = monitor(in: app).label
        swipeBack(in: app)
        Thread.sleep(forTimeInterval: 2)
        let after = monitor(in: app).label
        print("NATIVE_SPIKE_GESTURE initial before=\(before) after=\(after)")
        capture(app, named: "native-gesture-initial")
        waitForView("view-read", in: app)
    }

    func testBackGestureFromReadingList() {
        let app = launch()
        waitForView("view-read", in: app)
        openSeededList(in: app)
        let before = monitor(in: app).label
        swipeBack(in: app)
        waitForView("view-library", in: app)
        let afterSwipe = monitor(in: app).label
        capture(app, named: "native-gesture-reading-list")

        let list = app.webViews.firstMatch.links.matching(
            NSPredicate(format: "label BEGINSWITH %@", "iOS presentation fixture")).firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 30), "the seeded list remains available")
        list.tap()
        waitForView("view-read", in: app)
        let breadcrumb = app.webViews.firstMatch.links.matching(identifier: "Library").firstMatch
        XCTAssertTrue(breadcrumb.waitForExistence(timeout: 30), "the existing Library breadcrumb appeared")
        breadcrumb.tap()
        waitForView("view-library", in: app)
        print("NATIVE_SPIKE_GESTURE reading before=\(before) swipe=\(afterSwipe) breadcrumb=\(monitor(in: app).label)")
    }

    func testBackGestureWithDialogOpen() {
        let app = launch()
        waitForView("view-read", in: app)
        openSeededList(in: app)
        let options = app.webViews.firstMatch.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "Reading List options")).firstMatch
        XCTAssertTrue(options.waitForExistence(timeout: 30), "the list options appeared")
        options.tap()
        let rename = app.webViews.firstMatch.buttons["Rename"].firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 30), "the Rename action appeared")
        rename.tap()
        let monitor = monitor(in: app)
        let dialogOpen = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "\"dialogs\":[\"ask\"]"),
            object: monitor)
        XCTAssertEqual(XCTWaiter.wait(for: [dialogOpen], timeout: 30), .completed, "the rename dialog opened")
        let before = monitor.label
        swipeBack(in: app)
        Thread.sleep(forTimeInterval: 2)
        print("NATIVE_SPIKE_GESTURE dialog before=\(before) after=\(monitor.label)")
        capture(app, named: "native-gesture-dialog")
    }
}
