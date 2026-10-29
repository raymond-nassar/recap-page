import UIKit
import XCTest

private func layoutMetrics(from label: String) -> [String: Any]? {
    let prefix = "recap-layout-probe "
    guard label.hasPrefix(prefix) else { return nil }
    let suffix = ", application status"
    let reported = String(label.dropFirst(prefix.count))
    let json = reported.hasSuffix(suffix)
        ? String(reported.dropLast(suffix.count))
        : reported
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

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
            const value = condition();
            if (value) return value;
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
          homeHeader: (() => {
            const header = document.querySelector('#view-home > .head');
            if (!header) return null;
            const style = getComputedStyle(header);
            const tracks = style.gridTemplateColumns.trim();
            return {
              largestText: document.documentElement.dataset.iosLargestText === 'true',
              display: style.display,
              gridTemplateColumnCount: style.display === 'grid' && tracks !== 'none'
                ? tracks.split(/\\s+/).length
                : 0,
            };
          })(),
          skipLink: (() => {
            const link = document.querySelector('.skip-link');
            if (!link) return null;
            const rect = link.getBoundingClientRect();
            const style = getComputedStyle(link);
            return {
              width: rect.width,
              height: rect.height,
              display: style.display,
              minWidth: style.minWidth,
              minHeight: style.minHeight,
            };
          })(),
          widestOverflowingElements: [...document.querySelectorAll('body *')]
            .filter((element) => element !== monitor)
            .flatMap((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              if (style.display === 'none' || (!rect.width && !rect.height)) return [];
              const extent = Math.max(rect.right, rect.left + element.scrollWidth);
              if (rect.left >= -1 && extent <= document.documentElement.clientWidth + 1) return [];
              return [{
                tag: element.tagName.toLowerCase(),
                id: element.id,
                className: typeof element.className === 'string' ? element.className : '',
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                extent: Math.round(extent * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
              }];
            })
            .sort((a, b) => b.extent - a.extent || b.width - a.width)
            .slice(0, 8),
        });
        const refreshMonitor = () => {
          monitor.textContent = JSON.stringify(snapshot('current'));
          monitor.setAttribute('aria-label', `recap-layout-probe ${monitor.textContent}`);
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

    private func navigate(_ app: XCUIApplication, linkName: String, headingLabel: String) {
        let link = app.links.matching(identifier: linkName).firstMatch
        if !link.isHittable {
            let toggle = moreToggle(of: app)
            let close = app.buttons["more-sheet-close"]
            XCTAssertTrue(
                toggle.waitForExistence(timeout: 30),
                "the narrow navigation toggle is available: \(app.debugDescription)")
            toggle.tap()
            XCTAssertTrue(close.waitForExistence(timeout: 30), "the More sheet is presented")
            XCTAssertTrue(link.waitForExistence(timeout: 30), "\(linkName) is shown in More")
        }
        XCTAssertTrue(link.isHittable, "the \(linkName) navigation link is reachable")
        link.tap()
        let heading = app.webViews.firstMatch.staticTexts.matching(
            NSPredicate(format: "label == %@", headingLabel)).firstMatch
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
                    let overflow = String(describing: screen["widestOverflowingElements"] ?? [])
                    XCTAssertGreaterThan(viewport, 0)
                    XCTAssertLessThanOrEqual(
                        document,
                        viewport,
                        "\(screen["view"] ?? "unknown") has no horizontal overflow; widest elements: \(overflow)")
                    XCTAssertEqual(screenRoot, 16, accuracy: 0.1)
                }

                let home = try XCTUnwrap(screens.first { $0["view"] as? String == "view-home" })
                let homeHeader = try XCTUnwrap(home["homeHeader"] as? [String: Any])
                XCTAssertEqual(
                    homeHeader["largestText"] as? Bool,
                    category == .accessibilityExtraExtraExtraLarge,
                    "the iOS-only Home override follows only the largest Dynamic Type category")
                if category == .accessibilityExtraExtraExtraLarge {
                    XCTAssertEqual(homeHeader["display"] as? String, "grid")
                    XCTAssertEqual(homeHeader["gridTemplateColumnCount"] as? Int, 1)
                }
                let skipLinkMetrics = try XCTUnwrap(home["skipLink"] as? [String: Any])
                XCTAssertGreaterThanOrEqual(
                    try XCTUnwrap(skipLinkMetrics["height"] as? Double),
                    44,
                    "the iOS skip link has a 44-point target")

                let safeInsets = try XCTUnwrap((result["safeInsets"] as? [NSNumber])?.map(\.doubleValue))
                XCTAssertEqual(safeInsets.count, 4)
                XCTAssertTrue(safeInsets.allSatisfy { $0 >= 0 })
                let restartLiveRegion = try XCTUnwrap(result["restartLiveRegion"] as? [String: String])
                XCTAssertEqual(restartLiveRegion["role"], "status", "the restart notice uses a VoiceOver status region")
                XCTAssertEqual(restartLiveRegion["live"], "polite", "the restart notice is announced without interrupting")

                capture(app, named: "t03-\(category.rawValue)-\(appearance)-home")
                navigate(app, linkName: "Library", headingLabel: "Library")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-library")
                navigate(app, linkName: "Search", headingLabel: "Search")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-search")
                navigate(app, linkName: "Backup & settings", headingLabel: "Backup & settings")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-data")
                app.terminate()
            }
        }
    }

    func testCoreScreensPassAccessibilityAuditsAtDefaultAndLargestTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category)
            _ = try probeResult(of: app)
            for (name, headingLabel, nextLink, nextHeadingLabel) in [
                ("home", "RECAP PAGE!", "Library", "Library"),
                ("library", "Library", "Search", "Search"),
                ("search", "Search", "Backup & settings", "Backup & settings"),
                ("data", "Backup & settings", nil, nil),
            ] as [(String, String, String?, String?)] {
                let heading = app.webViews.firstMatch.staticTexts.matching(
                    NSPredicate(format: "label == %@", headingLabel)).firstMatch
                XCTAssertTrue(heading.waitForExistence(timeout: 30), "\(name) is visible for audit")
                let skipLink = app.links.matching(
                    NSPredicate(format: "label == %@", "Skip to main content")).firstMatch
                XCTAssertTrue(skipLink.waitForExistence(timeout: 30), "the skip link is present for target measurement")
                try record("t03-target-\(category.rawValue)-\(name)", [
                    "skipLinkWidth": Double(skipLink.frame.width),
                    "skipLinkHeight": Double(skipLink.frame.height),
                ])
                XCTAssertGreaterThanOrEqual(skipLink.frame.width, 44, "the skip link meets the 44-point width")
                XCTAssertGreaterThanOrEqual(skipLink.frame.height, 44, "the skip link meets the 44-point height")
                try app.performAccessibilityAudit()
                try record("t03-accessibility-\(category.rawValue)-\(name)", ["audit": "passed", "category": category.rawValue])
                capture(app, named: "t03-audit-\(category.rawValue)-\(name)")
                if let nextLink, let nextHeadingLabel {
                    navigate(app, linkName: nextLink, headingLabel: nextHeadingLabel)
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
            let styleProbe = try readSheetStyleProbe(of: app)
            try record("t03-read-sheet-style-\(category.rawValue)", styleProbe)
            let links = try XCTUnwrap(styleProbe["links"] as? [[String: Any]])
            XCTAssertTrue(
                links.contains {
                    ($0["href"] as? String)?.hasSuffix("/ios/launcher.css") == true
                        && ($0["loaded"] as? Bool) == true
                },
                "the iOS launcher stylesheet loads in the Read sheet: \(styleProbe)")
            let stylesheets = try XCTUnwrap(styleProbe["stylesheets"] as? [[String: Any]])
            let launcherSheet = try XCTUnwrap(
                stylesheets.first { ($0["href"] as? String)?.hasSuffix("/ios/launcher.css") == true },
                "the Read sheet exposes its iOS launcher stylesheet")
            let rules = try XCTUnwrap(launcherSheet["rules"] as? [[String: Any]])
            XCTAssertTrue(
                rules.contains { ($0["selector"] as? String)?.contains("#fallback") == true },
                "the launcher stylesheet contains the target rule")
            let manualLink = app.links.matching(
                NSPredicate(format: "label == %@", "Continue manually")).firstMatch
            XCTAssertTrue(manualLink.waitForExistence(timeout: 30), "the manual Read link is present for target measurement")
            try record("t03-read-target-\(category.rawValue)", [
                "manualLinkWidth": Double(manualLink.frame.width),
                "manualLinkHeight": Double(manualLink.frame.height),
            ])
            XCTAssertGreaterThanOrEqual(manualLink.frame.height, 48, "the manual Read link meets the iOS target")
            let elements = try XCTUnwrap(styleProbe["elements"] as? [String: [String: Any]])
            for id in ["fallback", "return"] {
                let element = try XCTUnwrap(elements[id], "the Read launcher contains #\(id)")
                XCTAssertEqual(element["exists"] as? Bool, true, "#\(id) is present")
                XCTAssertGreaterThanOrEqual(
                    try XCTUnwrap(element["height"] as? Double),
                    48,
                    "#\(id) has a 48-point hit region")
                let computed = try XCTUnwrap(element["computed"] as? [String: Any])
                XCTAssertEqual(computed["minHeight"] as? String, "48px", "#\(id) uses the iOS target token")
                let matchingRules = try XCTUnwrap(element["matchingRules"] as? [[String: Any]])
                XCTAssertTrue(
                    matchingRules.contains { ($0["href"] as? String)?.hasSuffix("/ios/launcher.css") == true },
                    "#\(id) matches an iOS launcher rule")
            }
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
        let initialInsets = try XCTUnwrap((result["safeInsets"] as? [NSNumber])?.map(\.doubleValue))
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
        let current = try XCTUnwrap(layoutMetrics(from: monitor.label), monitor.label)
        let documentWidth = try XCTUnwrap((current["documentWidth"] as? NSNumber)?.doubleValue)
        let viewportWidth = try XCTUnwrap((current["viewportWidth"] as? NSNumber)?.doubleValue)
        XCTAssertLessThanOrEqual(documentWidth, viewportWidth, "landscape has no horizontal page overflow")
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
            .matching(NSPredicate(format: "label BEGINSWITH %@", "recap-layout-probe "))
            .firstMatch
    }

    private func moreToggle(of app: XCUIApplication) -> XCUIElement {
        let more = NSPredicate(format: "label == %@ OR identifier == %@", "More", "btn-rail-toggle")
        return app.buttons.matching(more).firstMatch
    }

    private func readSheetStyleProbe(of app: XCUIApplication) throws -> [String: Any] {
        let recorder = app.staticTexts["ios-handoff-recorder"]
        XCTAssertTrue(recorder.waitForExistence(timeout: 30), "the Read-sheet recorder appeared")
        let probeReady = XCTNSPredicateExpectation(
            predicate: NSPredicate { object, _ in
                guard let element = object as? XCUIElement,
                      let data = element.label.data(using: .utf8),
                      let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
                return record["readSheetStyleProbe"] != nil
            },
            object: recorder)
        XCTAssertEqual(
            XCTWaiter.wait(for: [probeReady], timeout: 30),
            .completed,
            "the Read sheet recorded its stylesheet probe")
        let data = try XCTUnwrap(recorder.label.data(using: .utf8))
        let record = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let probe = try XCTUnwrap(record["readSheetStyleProbe"] as? [String: Any])
        XCTAssertNil(probe["error"], String(describing: probe))
        return probe
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
                          let metrics = layoutMetrics(from: element.label),
                          let width = (metrics["viewportWidth"] as? NSNumber)?.doubleValue,
                          let documentWidth = (metrics["documentWidth"] as? NSNumber)?.doubleValue else { return false }
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
