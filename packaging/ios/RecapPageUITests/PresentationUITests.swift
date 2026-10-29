import UIKit
import XCTest

@MainActor
final class PresentationUITests: XCTestCase {
    private static let defaultTypeSizes: [String: Double] = [
        "--t-caption": 12,
        "--t-body": 14,
        "--t-body-lg": 18,
        "--t-subtitle": 20,
        "--t-title": 28,
        "--t-title-lg": 40,
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(
        category: UIContentSizeCategory = .large,
        appearance: String = "Light",
        route: String = "home",
        readHandoffTest: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-UIPreferredContentSizeCategoryName", category.rawValue,
            "-uiUserInterfaceStyle", appearance,
        ]
        app.launchEnvironment["RECAP_ISOLATE_REQUESTS"] = "1"
        app.launchEnvironment["RECAP_PROBE_SCRIPT"] = Self.layoutProbe(route: route)
        if readHandoffTest {
            app.launchEnvironment["RECAP_IOS_READ_HANDOFF_TEST"] = "1"
            app.launchEnvironment["RECAP_IOS_RECORD_HANDOFFS"] = "1"
        }
        app.launch()
        return app
    }

    private static func layoutProbe(route: String) -> String {
        let routeScript: String
        if route == "all" {
            routeScript = """
            for (const route of routes) {
              await openRoute(route);
              screens.push(snapshot(route.id));
            }
            await openRoute(routes[0]);
            """
        } else {
            routeScript = """
            const route = \(route == "issue-search" ? "issueSearchRoute" : "routes.find(({ name }) => name === '\(route)')");
            if (!route) throw new Error('Unknown presentation test route');
            await openRoute(route);
            screens.push(snapshot(route.id));
            """
        }
        return """
        const issueSearchRoute = {
          name: 'issue-search', id: 'view-add-search', selector: '[data-view="add-search"]'
        };
        const routes = [
          { name: 'home', id: 'view-home', selector: '[data-view="home"]' },
          { name: 'library', id: 'view-library', selector: '[data-view="library"]' },
          { name: 'search', id: 'view-add', selector: '[data-view="add"]' },
          { name: 'data', id: 'view-data', selector: '[data-view="data"]' },
        ];
        const waitFor = async (condition, name) => {
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            if (condition()) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`Timed out opening ${name}`);
        };
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() =>
          requestAnimationFrame(resolve)));
        const openRoute = async (route) => {
          const link = document.querySelector(route.selector);
          if (!link) throw new Error(`Missing navigation link for ${route.name}`);
          link.click();
          await waitFor(() => !document.getElementById(route.id)?.hidden, route.name);
          await nextFrame();
        };
        const tokenNames = ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg'];
        const measurement = document.createElement('span');
        measurement.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
        measurement.setAttribute('aria-hidden', 'true');
        document.body.append(measurement);
        const tokens = {};
        for (const name of tokenNames) {
          measurement.style.fontSize = `var(${name})`;
          tokens[name] = Number.parseFloat(getComputedStyle(measurement).fontSize);
        }
        measurement.remove();
        const safeArea = document.createElement('div');
        safeArea.style.cssText = [
          'position:fixed',
          'padding-top:env(safe-area-inset-top)',
          'padding-right:env(safe-area-inset-right)',
          'padding-bottom:env(safe-area-inset-bottom)',
          'padding-left:env(safe-area-inset-left)',
        ].join(';');
        document.body.append(safeArea);
        const safeStyles = getComputedStyle(safeArea);
        const safeInsets = ['top', 'right', 'bottom', 'left'].map((side) =>
          Number.parseFloat(safeStyles[`padding${side[0].toUpperCase()}${side.slice(1)}`]) || 0);
        safeArea.remove();
        const monitor = document.createElement('div');
        monitor.id = 'recap-layout-probe';
        monitor.setAttribute('role', 'status');
        monitor.setAttribute('aria-live', 'polite');
        monitor.style.cssText = 'position:fixed;left:1px;top:1px;width:1px;height:1px;opacity:0.01;overflow:hidden;white-space:nowrap';
        document.body.append(monitor);
        const snapshot = (view) => ({
          view,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        });
        const refreshMonitor = () => {
          monitor.textContent = JSON.stringify(snapshot('current'));
          monitor.setAttribute('aria-label', monitor.textContent);
        };
        window.addEventListener('resize', refreshMonitor);
        window.visualViewport?.addEventListener('resize', refreshMonitor);
        new ResizeObserver(refreshMonitor).observe(document.documentElement);
        refreshMonitor();
        const screens = [];
        \(routeScript)
        const restartRegion = await waitFor(() => document.getElementById('ios-report'), 'iOS report status region');
        return JSON.stringify({
          scale: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ios-text-scale')),
          rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
          tokens,
          safeInsets,
          restartLiveRegion: {
            role: restartRegion?.getAttribute('role'),
            live: restartRegion?.getAttribute('aria-live'),
          },
          screens,
        });
        """
    }

    private func probeResult(of app: XCUIApplication) throws -> [String: Any] {
        let element = app.staticTexts["recap-probe-result"]
        XCTAssertTrue(element.waitForExistence(timeout: 240), "the layout probe appeared")
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", "pending"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 240), .completed, "the layout probe finished")
        let label = element.label
        XCTAssertFalse(label.hasPrefix("error:"), label)
        let object = try JSONSerialization.jsonObject(with: Data(label.utf8)) as? [String: Any]
        return try XCTUnwrap(object, label)
    }

    private func record(_ name: String, _ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        let json = String(decoding: data, as: UTF8.self)
        print("RECAP_PROBE_RESULT \(name) \(json)")
        let attachment = XCTAttachment(string: json)
        attachment.name = "\(name).json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func navigate(_ app: XCUIApplication, linkName: String, headingID: String) {
        var link = app.links.matching(identifier: linkName).allElementsBoundByIndex.first(where: \.isHittable)
        if link == nil {
            let toggle = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "sidebar")).firstMatch
            if toggle.exists { toggle.tap() }
            link = app.links.matching(identifier: linkName).allElementsBoundByIndex.first(where: \.isHittable)
        }
        XCTAssertNotNil(link, "the \(linkName) navigation link is reachable")
        link?.tap()
        let heading = app.descendants(matching: .any).matching(identifier: headingID).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 30), "the \(linkName) view opened")
    }

    func testDynamicTypeReflowsCoreScreensAtBothAppearances() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            for appearance in ["Light", "Dark"] {
                let app = launch(category: category, appearance: appearance, route: "all")
                let result = try probeResult(of: app)
                try record("t03-layout-\(category.rawValue)-\(appearance)", result)

                let scale = try XCTUnwrap(result["scale"] as? Double)
                let rootFontSize = try XCTUnwrap(result["rootFontSize"] as? Double)
                let tokens = try XCTUnwrap(result["tokens"] as? [String: Double])
                let screens = try XCTUnwrap(result["screens"] as? [[String: Any]])
                XCTAssertEqual(screens.map { $0["view"] as? String }, ["view-home", "view-library", "view-add", "view-data"])
                XCTAssertEqual(rootFontSize, 16, accuracy: 0.1, "Dynamic Type does not scale rem-based layout dimensions")
                XCTAssertEqual(tokens.count, Self.defaultTypeSizes.count)
                if category == .large {
                    XCTAssertEqual(scale, 1, accuracy: 0.1, "the default system body size preserves the shared type ramp")
                    for (token, size) in Self.defaultTypeSizes {
                        XCTAssertEqual(tokens[token] ?? 0, size, accuracy: 0.1, token)
                    }
                } else {
                    XCTAssertGreaterThan(scale, 1, "the accessibility category increases the native scale")
                    for (token, size) in Self.defaultTypeSizes {
                        XCTAssertGreaterThan(tokens[token] ?? 0, size, token)
                    }
                }

                for screen in screens {
                    let viewport = try XCTUnwrap(screen["viewportWidth"] as? Double)
                    let document = try XCTUnwrap(screen["documentWidth"] as? Double)
                    let screenRoot = try XCTUnwrap(screen["rootFontSize"] as? Double)
                    XCTAssertGreaterThan(viewport, 0)
                    XCTAssertLessThanOrEqual(document, viewport, "\(screen["view"] ?? "unknown") has no horizontal overflow")
                    XCTAssertEqual(screenRoot, 16, accuracy: 0.1)
                }

                let safeInsets = try XCTUnwrap(result["safeInsets"] as? [Double])
                XCTAssertEqual(safeInsets.count, 4)
                XCTAssertTrue(safeInsets.allSatisfy { $0 >= 0 })
                let restartLiveRegion = try XCTUnwrap(result["restartLiveRegion"] as? [String: String])
                XCTAssertEqual(restartLiveRegion["role"], "status", "the restart notice uses a VoiceOver status region")
                XCTAssertEqual(restartLiveRegion["live"], "polite", "the restart notice is announced without interrupting")

                capture(app, named: "t03-\(category.rawValue)-\(appearance)-home")
                navigate(app, linkName: "Library", headingID: "library-h")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-library")
                navigate(app, linkName: "Search", headingID: "add-h")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-search")
                navigate(app, linkName: "Backup & settings", headingID: "data-h")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-data")
                app.terminate()
            }
        }
    }

    func testCoreScreensPassAccessibilityAuditsAtDefaultAndLargestTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category)
            _ = try probeResult(of: app)
            for (name, headingID, nextLink) in [
                ("home", "home-h", "Library"),
                ("library", "library-h", "Search"),
                ("search", "add-h", "Backup & settings"),
                ("data", "data-h", nil),
            ] as [(String, String, String?)] {
                if name == "home" {
                    XCTAssertTrue(app.staticTexts["RECAP PAGE!"].waitForExistence(timeout: 30), "Home is visible for audit")
                } else {
                    let heading = app.descendants(matching: .any).matching(identifier: headingID).firstMatch
                    XCTAssertTrue(heading.waitForExistence(timeout: 30), "\(name) is visible for audit")
                }
                try app.performAccessibilityAudit()
                try record("t03-accessibility-\(category.rawValue)-\(name)", ["audit": "passed", "category": category.rawValue])
                capture(app, named: "t03-audit-\(category.rawValue)-\(name)")
                if let nextLink {
                    navigate(app, linkName: nextLink, headingID: nextLink == "Library" ? "library-h" : nextLink == "Search" ? "add-h" : "data-h")
                }
            }
            app.terminate()
        }
    }

    func testReadSheetPassesAccessibilityAuditAtDefaultAndLargestTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category, readHandoffTest: true)
            _ = try probeResult(of: app)
            let openRead = app.buttons["Open Read test"]
            XCTAssertTrue(openRead.waitForExistence(timeout: 30), "the Debug-only Read opener is visible")
            openRead.tap()
            XCTAssertTrue(app.buttons["ios-read-sheet-close"].waitForExistence(timeout: 30), "the Read sheet is presented")
            waitForReadSheetPresentation(app)
            try app.performAccessibilityAudit()
            try record("t03-accessibility-\(category.rawValue)-read-sheet", ["audit": "passed", "category": category.rawValue])
            capture(app, named: "t03-read-sheet-\(category.rawValue)")
            app.buttons["ios-read-sheet-close"].tap()
            let sheetClosed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"),
                object: app.buttons["ios-read-sheet-close"])
            XCTAssertEqual(
                XCTWaiter.wait(for: [sheetClosed], timeout: 30),
                .completed,
                "closing Read dismisses its sheet")
            XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30), "the app web view remains after closing Read")
            app.terminate()
        }
    }

    func testRotationAndKeyboardKeepSearchUsableWithinTheWindow() throws {
        let app = launch(route: "issue-search")
        let result = try probeResult(of: app)
        let initialInsets = try XCTUnwrap(result["safeInsets"] as? [Double])
        XCTAssertTrue(initialInsets.allSatisfy { $0 >= 0 })
        let window = app.windows.firstMatch
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30))

        let initialFrame = webView.frame
        XCTAssertGreaterThan(initialFrame.height, initialFrame.width, "Search starts in portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = webView.frame
                return frame.width > frame.height
            },
            object: webView)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 30), .completed, "the window reflows to landscape")
        XCTAssertGreaterThanOrEqual(webView.frame.minX, window.frame.minX)
        XCTAssertLessThanOrEqual(webView.frame.maxX, window.frame.maxX)
        XCTAssertLessThanOrEqual(webView.frame.maxY, window.frame.maxY)
        let monitor = layoutMonitor(of: app)
        XCTAssertTrue(monitor.waitForExistence(timeout: 30))
        let layout = try XCTUnwrap(monitor.label.data(using: .utf8))
        let current = try XCTUnwrap(try JSONSerialization.jsonObject(with: layout) as? [String: Any])
        XCTAssertLessThanOrEqual(
            try XCTUnwrap(current["documentWidth"] as? Double),
            try XCTUnwrap(current["viewportWidth"] as? Double),
            "landscape has no horizontal page overflow")
        capture(app, named: "t03-landscape-search")

        let searchField = app.searchFields["Search issue titles"].firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 30), "Search has a labeled field")
        searchField.tap()
        searchField.typeText("Secret")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 30), "the system keyboard is visible")
        XCTAssertLessThanOrEqual(searchField.frame.maxY, keyboard.frame.minY, "the focused search field stays above the keyboard")
        XCTAssertLessThanOrEqual(searchField.frame.maxX, window.frame.maxX)
        capture(app, named: "t03-search-keyboard")

        XCUIDevice.shared.orientation = .portrait
        app.terminate()
    }

    private func layoutMonitor(of app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "\"viewportWidth\""))
            .firstMatch
    }

    private func waitForReadSheetPresentation(_ app: XCUIApplication) {
        let recorder = app.staticTexts["ios-handoff-recorder"]
        XCTAssertTrue(recorder.waitForExistence(timeout: 30), "the presentation recorder appeared")
        let presented = XCTNSPredicateExpectation(
            predicate: NSPredicate { object, _ in
                guard let element = object as? XCUIElement,
                      let data = element.label.data(using: .utf8),
                      let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
                return (record["presentations"] as? Int ?? 0) > 0
            },
            object: recorder)
        XCTAssertEqual(
            XCTWaiter.wait(for: [presented], timeout: 30),
            .completed,
            "UIKit completed presenting the Read sheet")
    }

    func testWindowReflowsAcrossSupportedOrientations() throws {
        let app = launch(route: "home")
        _ = try probeResult(of: app)
        let window = app.windows.firstMatch
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30))
        let isIPad = min(window.frame.width, window.frame.height) >= 700
        let orientations: [UIDeviceOrientation] = isIPad
            ? [.landscapeLeft, .portraitUpsideDown, .landscapeRight, .portrait]
            : [.landscapeLeft, .portrait]

        for orientation in orientations {
            XCUIDevice.shared.orientation = orientation
            let frameSettled = XCTNSPredicateExpectation(
                predicate: NSPredicate { _, _ in
                    let frame = webView.frame
                    guard frame.width > 0, frame.height > 0 else { return false }
                    return orientation.isLandscape ? frame.width > frame.height : frame.height > frame.width
                },
                object: webView)
            XCTAssertEqual(XCTWaiter.wait(for: [frameSettled], timeout: 30), .completed, "orientation \(orientation.rawValue) has a nonzero page window")
            XCTAssertGreaterThanOrEqual(webView.frame.minX, window.frame.minX)
            XCTAssertLessThanOrEqual(webView.frame.maxX, window.frame.maxX)
            XCTAssertLessThanOrEqual(webView.frame.maxY, window.frame.maxY)

            let monitor = layoutMonitor(of: app)
            let settled = XCTNSPredicateExpectation(
                predicate: NSPredicate { object, _ in
                    guard let element = object as? XCUIElement,
                          let data = element.label.data(using: .utf8),
                          let metrics = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let width = metrics["viewportWidth"] as? Double,
                          let documentWidth = metrics["documentWidth"] as? Double else { return false }
                    return width > 0 && documentWidth <= width
                },
                object: monitor)
            XCTAssertEqual(
                XCTWaiter.wait(for: [settled], timeout: 30),
                .completed,
                "orientation \(orientation.rawValue) has no horizontal overflow; metrics: \(monitor.label)")
        }

        capture(app, named: "t03-final-orientation")
        XCUIDevice.shared.orientation = .portrait
        app.terminate()
    }
}
