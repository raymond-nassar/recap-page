import UIKit
import XCTest

private func layoutMetrics(from label: String, prefix: String = "recap-layout-probe ") -> [String: Any]? {
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
        readHandoffTest: Bool = false,
        emptyHomeTest: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-UIPreferredContentSizeCategoryName", category.rawValue,
            "-uiUserInterfaceStyle", appearance,
        ]
        app.launchEnvironment["RECAP_ISOLATE_REQUESTS"] = "1"
        app.launchEnvironment["RECAP_PROBE_SCRIPT"] = Self.layoutProbe(route: route)
        if route == "all" {
            app.launchEnvironment["RECAP_IOS_PRESENTATION_TEST_SEED"] = "1"
        }
        if emptyHomeTest {
            app.launchEnvironment["RECAP_IOS_RESTORE_TEST_SEED"] = "1"
            app.launchEnvironment["RECAP_IOS_DATA_LOSS_RESET"] = "1"
        }
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
          dataSectionHeadings: [...document.querySelectorAll('#view-data .setgroup > h2')].map((heading) => {
            const style = getComputedStyle(heading);
            return {
              text: heading.textContent.trim(),
              overflowWrap: style.overflowWrap,
              clientWidth: heading.clientWidth,
              scrollWidth: heading.scrollWidth,
            };
          }),
          themeSelect: (() => {
            const select = document.getElementById('opt-theme');
            const style = getComputedStyle(select);
            return {
              whiteSpace: style.whiteSpace,
              scrollWidth: select.scrollWidth,
              clientWidth: select.clientWidth,
            };
          })(),
          dataCardDiagnostics: [...document.querySelectorAll('#view-data .setgroup > .card')].map((card) => {
            const cardRect = card.getBoundingClientRect();
            const cardStyle = getComputedStyle(card);
            const descendants = [...card.querySelectorAll('*')].flatMap((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              if (style.display === 'none'
                  || (!rect.width && !rect.height)) return [];
              const matchingRules = [];
              const collectRules = (rules, href, conditions = []) => {
                for (const rule of rules) {
                  if (rule.selectorText && rule.style && !rule.selectorText.includes('::')
                      && (rule.style.width || rule.style.minWidth || rule.style.maxWidth
                        || rule.style.whiteSpace || rule.style.overflow || rule.style.overflowX
                        || rule.style.flex || rule.style.position || rule.style.display)
                      && element.matches(rule.selectorText)) {
                    matchingRules.push({
                      href,
                      conditions,
                      selector: rule.selectorText,
                      declarations: {
                        width: rule.style.width,
                        minWidth: rule.style.minWidth,
                        maxWidth: rule.style.maxWidth,
                        whiteSpace: rule.style.whiteSpace,
                        overflow: rule.style.overflow,
                        overflowX: rule.style.overflowX,
                        flex: rule.style.flex,
                        position: rule.style.position,
                        display: rule.style.display,
                      },
                    });
                  }
                  if (rule.cssRules) {
                    const condition = rule.conditionText || '';
                    if (rule.type === CSSRule.MEDIA_RULE && !matchMedia(condition).matches) continue;
                    if (rule.type === CSSRule.SUPPORTS_RULE && !CSS.supports(condition)) continue;
                    collectRules(rule.cssRules, href, condition ? [...conditions, condition] : conditions);
                  }
                }
              };
              for (const sheet of document.styleSheets) collectRules(sheet.cssRules, sheet.href);
              const boxOutsideCard = rect.left < cardRect.left - 1 || rect.right > cardRect.right + 1;
              const visibleContentOutsideCard = style.overflowX === 'visible'
                && rect.left + element.scrollWidth > cardRect.right + 1;
              return [{
                tag: element.tagName.toLowerCase(),
                id: element.id,
                className: typeof element.className === 'string' ? element.className : '',
                text: element.tagName.toLowerCase() === 'label'
                  ? element.textContent.trim().slice(0, 100)
                  : '',
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                computedWidth: style.width,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                minWidth: style.minWidth,
                whiteSpace: style.whiteSpace,
                overflowX: style.overflowX,
                flex: style.flex,
                boxOutsideCard,
                visibleContentOutsideCard,
                matchingRules,
              }];
            }).sort((a, b) => b.right - a.right || b.width - a.width);
            const overflowingDescendants = descendants.filter((element) =>
              element.boxOutsideCard || element.visibleContentOutsideCard);
            return {
              title: card.querySelector('h2, h3')?.textContent.trim().slice(0, 100) || '',
              className: typeof card.className === 'string' ? card.className : '',
              left: Math.round(cardRect.left * 10) / 10,
              right: Math.round(cardRect.right * 10) / 10,
              width: Math.round(cardRect.width * 10) / 10,
              overflowAmount: card.scrollWidth - card.clientWidth,
              scrollWidth: card.scrollWidth,
              clientWidth: card.clientWidth,
              overflowX: cardStyle.overflowX,
              widestDescendants: descendants.slice(0, 20),
              overflowingDescendants,
            };
          }).filter((card) => card.scrollWidth > card.clientWidth + 1),
          skipLink: (() => {
            const link = document.querySelector('.skip-link');
            if (!link) return null;
            const rect = link.getBoundingClientRect();
            const style = getComputedStyle(link);
            return {
              width: rect.width,
              height: rect.height,
              display: style.display,
              lineHeight: style.lineHeight,
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
                text: /^H[1-6]$/.test(element.tagName)
                  ? element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 100)
                  : undefined,
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
        \(route == "all" ? Self.passiveAuditProbe : "")
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

    private static let passiveAuditProbe = #"""
    const passiveMonitor = document.createElement('p');
    passiveMonitor.setAttribute('role', 'status');
    passiveMonitor.style.cssText = 'position:fixed;left:1px;top:1px;width:1px;height:1px;opacity:0.01;overflow:hidden';
    document.body.append(passiveMonitor);
    const controlSelector = [
      'a[href]', 'button', 'summary', 'input', 'select', 'textarea',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="switch"]', '[role="tab"]', '[role="textbox"]', '[role="combobox"]',
      '[role="listbox"]', '[role="option"]', '[role^="menuitem"]', '[role="slider"]',
      '[role="spinbutton"]', '[role="treeitem"]',
    ].join(',');
    const interactiveSelector = `${controlSelector},[tabindex]`;
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(), id: element.id,
      role: element.getAttribute('role') || ({
        H2: 'heading', NAV: 'navigation', ASIDE: 'complementary', MAIN: 'main',
      }[element.tagName]) || (element.matches('section[aria-labelledby]') ? 'region' : ''),
      tabindex: element.getAttribute('tabindex'),
      inlineHandlers: ['onclick', 'onmousedown', 'onmouseup', 'onpointerdown', 'ontouchstart']
        .filter((name) => typeof element[name] === 'function'),
    });
    const evidence = (key, selector, containerSelector, containerLabel, expectedLabel, directText = false) => {
      const element = document.querySelector(selector);
      if (!element) return { key, selector, safe: false, visible: false,
        error: `Missing reviewed passive text: ${selector}` };
      const textNode = directText ? [...element.childNodes].find((node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent.trim() === expectedLabel) : null;
      if (directText && !textNode) return { key, selector, safe: false, visible: false,
        error: `Missing reviewed direct text: ${expectedLabel}` };
      const ancestors = [];
      for (let node = element; node; node = node.parentElement) ancestors.push(describe(node));
      const range = document.createRange();
      if (textNode) range.selectNodeContents(textNode);
      const rect = textNode ? range.getBoundingClientRect() : element.getBoundingClientRect();
      const interactiveAncestor = element.closest(interactiveSelector);
      const label = (textNode || element).textContent.trim();
      const interactiveDescendant = element.querySelector(interactiveSelector);
      const safe = !interactiveAncestor && !interactiveDescendant && ancestors.every((node) =>
        node.tabindex === null && node.inlineHandlers.length === 0
        && ['', 'heading', 'navigation', 'complementary', 'main', 'region'].includes(node.role))
        && label === expectedLabel
        && Boolean(element.closest(containerSelector));
      return {
        key, selector, containerSelector, containerLabel, label, ancestors, safe,
        interactiveAncestor: interactiveAncestor ? describe(interactiveAncestor) : null,
        interactiveDescendant: interactiveDescendant ? describe(interactiveDescendant) : null,
        visible: element.checkVisibility({ checkVisibilityCSS: true })
          && !element.closest('[hidden], [inert]')
          && (!key.startsWith('sidebar-') || window.matchMedia('(min-width: 881px)').matches)
          && rect.width > 0 && rect.height > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        cursor: getComputedStyle(element).cursor,
      };
    };
    let passiveTick = 0;
    const refreshPassiveMonitor = () => {
      const active = document.activeElement;
      const state = {
        tick: ++passiveTick,
        href: location.href,
        view: document.querySelector('.view:not([hidden])')?.id,
        focus: active ? describe(active) : null,
        focusIsControl: Boolean(active?.matches(`${controlSelector},[tabindex]:not([tabindex="-1"])`)),
        cases: [
          evidence('sidebar-reading', '#sidebar #rail-reading', '#sidebar-nav', 'Main', 'Reading'),
          evidence('sidebar-app', '#sidebar-nav > .nav-foot > h2.rail-h', '#sidebar-nav', 'Main', 'App'),
          evidence('home-read-count', '#home-continue #chero-count > b.glance-n',
            '#home-continue', document.getElementById('chero-h').textContent.trim(), '0'),
          evidence('home-count-total', '#home-continue #chero-count',
            '#home-continue', document.getElementById('chero-h').textContent.trim(), 'of 0 issues', true),
          evidence('home-count-word', '#home-continue #chero-count > .glance-end',
            '#home-continue', document.getElementById('chero-h').textContent.trim(), 'read'),
          evidence('home-next-caption', '#home-continue #chero-next',
            '#home-continue', document.getElementById('chero-h').textContent.trim(),
            'No issues in this Reading List yet. Open it to add comics.'),
          evidence('home-lists-summary', '#home-yours > .sec-h > .sec-note',
            '#home-yours', 'Your Reading Lists', '1 Reading List · 1 not started'),
        ],
      };
      passiveMonitor.setAttribute('aria-label', `recap-passive-probe ${JSON.stringify(state)}`);
    };
    refreshPassiveMonitor();
    window.setInterval(refreshPassiveMonitor, 500);
    """#

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
            let close = app.buttons.matching(NSPredicate(format: "label == %@", "Close")).firstMatch
            XCTAssertTrue(
                toggle.waitForExistence(timeout: 30),
                "the narrow navigation toggle is available: \(app.debugDescription)")
            XCTAssertEqual(toggle.label, "More", "the type-independent query still selects More")
            XCTAssertGreaterThanOrEqual(toggle.frame.width, 44, "More retains its native target width")
            XCTAssertGreaterThanOrEqual(toggle.frame.height, 44, "More retains its native target height")
            toggle.tap()
            let closeVisible = close.waitForExistence(timeout: 30)
            if !closeVisible {
                print("T03 More hierarchy after toggle tap:\n\(app.debugDescription)")
            }
            XCTAssertTrue(closeVisible, "the More sheet is presented")
            XCTAssertTrue(link.waitForExistence(timeout: 30), "\(linkName) is shown in More")
        }
        XCTAssertTrue(link.isHittable, "the \(linkName) navigation link is reachable")
        link.tap()
        let heading = app.webViews.firstMatch.staticTexts.matching(
            NSPredicate(format: "label == %@", headingLabel)).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 30), "the \(linkName) view opened")
    }

    private func passiveState(of app: XCUIApplication) throws -> [String: Any] {
        let monitor = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "recap-passive-probe ")).firstMatch
        XCTAssertTrue(monitor.waitForExistence(timeout: 30), "the passive-text DOM evidence is available")
        return try XCTUnwrap(layoutMetrics(from: monitor.label, prefix: "recap-passive-probe "))
    }

    private func verifyPassiveAuditTexts(in app: XCUIApplication, homeVisible: Bool) throws -> [XCUIElement] {
        let state = try passiveState(of: app)
        let cases = try XCTUnwrap(state["cases"] as? [[String: Any]])
        for item in cases {
            XCTAssertNil(item["error"], "the exact reviewed DOM node remains present: \(item)")
        }
        var accepted: [XCUIElement] = []
        for item in cases where item["visible"] as? Bool == true {
            let key = try XCTUnwrap(item["key"] as? String)
            XCTAssertTrue([
                "sidebar-reading", "sidebar-app", "home-read-count", "home-count-total",
                "home-count-word", "home-next-caption", "home-lists-summary",
            ].contains(key), "only enumerated reviewed cases are tested")
            XCTAssertEqual(item["safe"] as? Bool, true, "the exact DOM node and ancestry remain passive: \(item)")
            let containerLabel = try XCTUnwrap(item["containerLabel"] as? String)
            let domLabel = try XCTUnwrap(item["label"] as? String)
            let label = key.hasPrefix("sidebar-") ? domLabel.uppercased() : domLabel
            let container = app.webViews.firstMatch.otherElements.matching(
                NSPredicate(format: "label == %@ OR label == %@ OR label == %@",
                            containerLabel, "\(containerLabel), navigation", "\(containerLabel), region"))
                .containing(.staticText, identifier: label).firstMatch
            XCTAssertTrue(container.waitForExistence(timeout: 30), "the named AX container exists for \(key)")
            let element = container.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 30), "the exact passive StaticText exists in its container")
            XCTAssertEqual(element.elementType, .staticText)
            XCTAssertTrue(container.frame.contains(element.frame), "the exact text stays within its named AX container")
            let before = try passiveState(of: app)
            element.tap()
            let postTapSample = try passiveState(of: app)
            let oldTick = try XCTUnwrap(postTapSample["tick"] as? Int)
            let monitor = app.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", "recap-passive-probe ")).firstMatch
            let refreshed = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
                guard let monitor = object as? XCUIElement,
                      let value = layoutMetrics(from: monitor.label, prefix: "recap-passive-probe "),
                      let tick = value["tick"] as? Int else { return false }
                return tick > oldTick
            }, object: monitor)
            XCTAssertEqual(XCTWaiter.wait(for: [refreshed], timeout: 30), .completed, "a post-tap DOM sample arrived")
            let after = try passiveState(of: app)
            XCTAssertEqual(after["href"] as? String, before["href"] as? String, "tapping \(key) does not navigate")
            XCTAssertEqual(after["view"] as? String, before["view"] as? String, "tapping \(key) does not switch views")
            XCTAssertEqual(after["focusIsControl"] as? Bool, false, "tapping \(key) does not focus a control")
            let afterCases = try XCTUnwrap(after["cases"] as? [[String: Any]])
            let afterCase = try XCTUnwrap(afterCases.first { $0["key"] as? String == key })
            XCTAssertEqual(afterCase["safe"] as? Bool, true, "the reviewed node remains passive after its tap")
            try record("t03-passive-\(key)", [
                "dom": item, "nativeLabel": element.label,
                "nativeFrame": NSCoder.string(for: element.frame), "before": before, "after": after,
            ])
            accepted.append(element)
        }
        if homeVisible {
            XCTAssertTrue(cases.contains { $0["key"] as? String == "home-read-count" && $0["visible"] as? Bool == true },
                          "the deterministic Home count fixture exercises the accepted count case")
        }
        return accepted
    }

    private func performAccessibilityAudit(of app: XCUIApplication, acceptedTexts: [XCUIElement] = []) throws {
        let previousFailurePolicy = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previousFailurePolicy }
        var unreviewedFindings = 0
        try app.performAccessibilityAudit { issue in
            print("T03 accessibility audit issue: \(issue.compactDescription)")
            print("T03 accessibility audit details: \(issue.detailedDescription)")
            print("T03 accessibility audit element: \(issue.element.debugDescription)")
            if issue.auditType == .hitRegion, let element = issue.element,
               element.elementType == .staticText,
               acceptedTexts.contains(where: { candidate in
                   candidate.exists && candidate.elementType == .staticText
                       && candidate.label == element.label && candidate.identifier == element.identifier
                       && candidate.frame == element.frame
               }) {
                print("T03 accepted enumerated passive-text hitRegion finding: \(element.label)")
                return true
            }
            unreviewedFindings += 1
            return false
        }
        continueAfterFailure = previousFailurePolicy
        XCTAssertEqual(unreviewedFindings, 0, "every finding outside the enumerated passive cases remains a failure")
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

                if category == .accessibilityExtraExtraExtraLarge {
                    let data = try XCTUnwrap(screens.first { $0["view"] as? String == "view-data" })
                    let headings = try XCTUnwrap(data["dataSectionHeadings"] as? [[String: Any]])
                    let personalization = try XCTUnwrap(
                        headings.first { $0["text"] as? String == "Personalization" })
                    XCTAssertEqual(personalization["overflowWrap"] as? String, "anywhere")
                    XCTAssertLessThanOrEqual(
                        try XCTUnwrap(personalization["scrollWidth"] as? Int),
                        try XCTUnwrap(personalization["clientWidth"] as? Int),
                        "the Personalization heading wraps within its section")
                    let themeSelect = try XCTUnwrap(data["themeSelect"] as? [String: Any])
                    XCTAssertEqual(themeSelect["whiteSpace"] as? String, "normal")
                    XCTAssertLessThanOrEqual(
                        try XCTUnwrap(themeSelect["scrollWidth"] as? Int),
                        try XCTUnwrap(themeSelect["clientWidth"] as? Int),
                        "the iOS Theme selection stays inside its field at largest text")
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
                XCTAssertEqual(
                    skipLinkMetrics["lineHeight"] as? String,
                    "44px",
                    "the iOS skip link text wrapper fills its target")

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

    func testFirstRunHomeLinksHaveNativeTargetsAtDefaultAndLargestTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category, emptyHomeTest: true)
            _ = try probeResult(of: app)
            let firstRun = app.webViews.firstMatch.otherElements.matching(
                NSPredicate(format: "label == %@ OR label == %@",
                            "Where do you want to start?", "Where do you want to start?, region")).firstMatch
            for (label, destination) in [
                ("Start with Modern Timeline", "Modern Timeline"),
                ("Search", "Search"),
            ] {
                XCTAssertTrue(firstRun.waitForExistence(timeout: 30), "the empty-Home section is visible")
                let link = firstRun.links.matching(NSPredicate(format: "label == %@", label)).firstMatch
                XCTAssertTrue(link.waitForExistence(timeout: 30), "\(label) is one native link target")
                XCTAssertFalse(firstRun.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch.exists,
                               "\(label) has no separate undersized text target")
                XCTAssertGreaterThanOrEqual(link.frame.width, 44, "\(label) retains its native target width")
                XCTAssertGreaterThanOrEqual(link.frame.height, 44, "\(label) retains its native target height")
                let webView = app.webViews.firstMatch
                let toggle = moreToggle(of: app)
                let usableBottom = toggle.exists
                    ? min(webView.frame.maxY, toggle.frame.minY)
                    : webView.frame.maxY
                for _ in 0..<4 {
                    if link.isHittable && link.frame.minY >= webView.frame.minY
                        && link.frame.maxY <= usableBottom { break }
                    webView.swipeUp()
                }
                XCTAssertTrue(link.isHittable, "\(label) is hittable after native scrolling")
                XCTAssertGreaterThanOrEqual(link.frame.minY, webView.frame.minY)
                XCTAssertLessThanOrEqual(link.frame.maxY, usableBottom, "\(label) is above bottom navigation before tapping")
                try record("t03-first-run-\(category.rawValue)-\(label)", [
                    "label": link.label, "frame": NSCoder.string(for: link.frame),
                ])
                capture(app, named: "t03-first-run-\(category.rawValue)-\(label)-before-tap")
                link.tap()
                let heading = app.webViews.firstMatch.staticTexts.matching(
                    NSPredicate(format: "label == %@", destination)).firstMatch
                XCTAssertTrue(heading.waitForExistence(timeout: 30), "\(label) opens \(destination)")
                if label == "Start with Modern Timeline" {
                    let home = app.links.matching(
                        NSPredicate(format: "label CONTAINS[c] %@ OR label == %@", "Recap Page", "Home")).firstMatch
                    XCTAssertTrue(home.waitForExistence(timeout: 30), "Home remains reachable")
                    home.tap()
                }
            }
            capture(app, named: "t03-first-run-\(category.rawValue)")
            app.terminate()
        }
    }

    func testCoreScreensPassAccessibilityAuditsAtDefaultAndLargestTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category, route: "all")
            let probe = try probeResult(of: app)
            let screens = try XCTUnwrap(probe["screens"] as? [[String: Any]])
            for (name, headingLabel, view, nextLink, nextHeadingLabel) in [
                ("home", "RECAP PAGE!", "view-home", "Library", "Library"),
                ("library", "Library", "view-library", "Search", "Search"),
                ("search", "Search", "view-add", "Backup & settings", "Backup & settings"),
                ("data", "Backup & settings", "view-data", nil, nil),
            ] as [(String, String, String, String?, String?)] {
                let heading = app.webViews.firstMatch.staticTexts.matching(
                    NSPredicate(format: "label == %@", headingLabel)).firstMatch
                XCTAssertTrue(heading.waitForExistence(timeout: 30), "\(name) is visible for audit")
                if name == "home" {
                    let brandLink = app.links.matching(
                        NSPredicate(format: "label CONTAINS[c] %@ OR label == %@", "Recap Page", "Home")).firstMatch
                    XCTAssertTrue(brandLink.waitForExistence(timeout: 30), "the brand is one accessible home link")
                    XCTAssertFalse(app.staticTexts["Recap Page"].exists, "the brand has no separate text target")
                    XCTAssertGreaterThanOrEqual(brandLink.frame.height, 44, "the brand link target is at least 44 points high")

                    let updatesToggle = app.descendants(matching: .any).matching(
                        NSPredicate(format: "label BEGINSWITH[c] %@", "What's new")).firstMatch
                    XCTAssertTrue(updatesToggle.waitForExistence(timeout: 30), "What's new is one accessible disclosure target")
                    XCTAssertFalse(app.staticTexts["What's new"].exists, "the disclosure has no separate text target")
                    XCTAssertGreaterThanOrEqual(updatesToggle.frame.height, 44, "the What's new target is at least 44 points high")
                }
                let skipLink = app.links.matching(
                    NSPredicate(format: "label == %@", "Skip to main content")).firstMatch
                XCTAssertTrue(skipLink.waitForExistence(timeout: 30), "the skip link is present for target measurement")
                XCTAssertFalse(app.staticTexts["Skip to main content"].exists, "the skip link has no separate text target")
                XCTAssertGreaterThanOrEqual(skipLink.frame.height, 44, "the native skip link target is at least 44 points high")
                let screen = try XCTUnwrap(
                    screens.first { $0["view"] as? String == view },
                    "the DOM probe records \(name)")
                let skipTarget = try XCTUnwrap(screen["skipLink"] as? [String: Any])
                let skipLinkWidth = try XCTUnwrap((skipTarget["width"] as? NSNumber)?.doubleValue)
                let skipLinkHeight = try XCTUnwrap((skipTarget["height"] as? NSNumber)?.doubleValue)
                try record("t03-target-\(category.rawValue)-\(name)", [
                    "skipLinkWidth": skipLinkWidth,
                    "skipLinkHeight": skipLinkHeight,
                ])
                XCTAssertGreaterThanOrEqual(skipLinkWidth, 44, "the skip link meets the 44-point width")
                XCTAssertGreaterThanOrEqual(skipLinkHeight, 44, "the skip link meets the 44-point height")
                let acceptedTexts = try verifyPassiveAuditTexts(in: app, homeVisible: name == "home")
                try performAccessibilityAudit(of: app, acceptedTexts: acceptedTexts)
                try record("t03-accessibility-\(category.rawValue)-\(name)", [
                    "audit": "passed", "category": category.rawValue,
                    "reviewedPassiveCases": acceptedTexts.map(\.label),
                ])
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
            XCTAssertFalse(app.staticTexts["Continue manually"].exists, "the manual link has no separate text target")
            XCTAssertGreaterThanOrEqual(manualLink.frame.height, 48, "the native manual link target is at least 48 points high")
            let elements = try XCTUnwrap(styleProbe["elements"] as? [String: [String: Any]])
            let returnLink = app.links["Back to Recap Page"].firstMatch
            XCTAssertTrue(returnLink.waitForExistence(timeout: 30), "the return link is present")
            XCTAssertFalse(app.staticTexts["Back to Recap Page"].exists, "the return link has no separate text target")
            XCTAssertGreaterThanOrEqual(returnLink.frame.height, 48, "the native return link target is at least 48 points high")
            for id in ["fallback", "return"] {
                let element = try XCTUnwrap(elements[id], "the Read launcher contains #\(id)")
                XCTAssertEqual(element["exists"] as? Bool, true, "#\(id) is present")
                XCTAssertGreaterThanOrEqual(
                    try XCTUnwrap(element["height"] as? Double),
                    48,
                    "#\(id) has a 48-point hit region")
                let computed = try XCTUnwrap(element["computed"] as? [String: Any])
                XCTAssertEqual(computed["minHeight"] as? String, "48px", "#\(id) uses the iOS target token")
                XCTAssertEqual(computed["lineHeight"] as? String, "48px", "#\(id) text fills its target")
                let matchingRules = try XCTUnwrap(element["matchingRules"] as? [[String: Any]])
                XCTAssertTrue(
                    matchingRules.contains { ($0["href"] as? String)?.hasSuffix("/ios/launcher.css") == true },
                    "#\(id) matches an iOS launcher rule")
            }
            try performAccessibilityAudit(of: app)
            try record("t03-accessibility-\(category.rawValue)-read-sheet", ["audit": "passed", "category": category.rawValue])
            capture(app, named: "t03-read-sheet-\(category.rawValue)")
            let closeRecorder = app.staticTexts["ios-handoff-recorder"]
            app.buttons["ios-read-sheet-close"].tap()
            let sheetClosed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"),
                object: app.buttons["ios-read-sheet-close"])
            let closeResult = XCTWaiter.wait(for: [sheetClosed], timeout: 30)
            let closeEvents = closeRecorder.label
            try record("t03-read-close-\(category.rawValue)", ["events": closeEvents])
            XCTAssertEqual(closeResult, .completed, "closing Read dismisses its sheet; close recorder: \(closeEvents)")
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
        return app.descendants(matching: .any).matching(more).firstMatch
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
            "the Read sheet recorded its stylesheet probe; recorder: \(recorder.label)")
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
