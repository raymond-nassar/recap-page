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
func revealNativeTarget(_ element: XCUIElement, in app: XCUIApplication) {
    let webView = app.webViews.firstMatch
    let toggle = app.descendants(matching: .any).matching(
        NSPredicate(format: "label == %@ OR identifier == %@", "More", "btn-rail-toggle")).firstMatch
    let usableBottom = toggle.exists ? min(webView.frame.maxY, toggle.frame.minY) : webView.frame.maxY
    let usableFrame = CGRect(
        x: webView.frame.minX, y: webView.frame.minY,
        width: webView.frame.width, height: usableBottom - webView.frame.minY)
    for _ in 0..<8 {
        if element.isHittable && element.frame.minY >= usableFrame.minY
            && element.frame.maxY <= usableBottom { break }
        let displacement = element.frame.midY - usableFrame.midY
        let travel = min(abs(displacement), usableFrame.height / 2)
        let startY = usableFrame.midY + (displacement > 0 ? travel / 2 : -travel / 2)
        let endY = usableFrame.midY + (displacement > 0 ? -travel / 2 : travel / 2)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: usableFrame.midX, dy: startY))
        let end = origin.withOffset(CGVector(dx: usableFrame.midX, dy: endY))
        start.press(forDuration: 0.1, thenDragTo: end)
    }
    XCTAssertTrue(element.isHittable, "\(element.label) is hittable after native scrolling")
    XCTAssertGreaterThanOrEqual(element.frame.minY, usableFrame.minY)
    XCTAssertLessThanOrEqual(element.frame.maxY, usableBottom, "the target is above bottom navigation before tapping")
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
        if route == "all" || route.hasPrefix("guard-") {
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
        if route == "comic" {
            routeScript = """
            const covers = document.getElementById('opt-covers');
            if (covers.checked) covers.click();
            location.hash = '#/issue/2092?order=house-of-m';
            await waitFor(() => !document.getElementById('view-issue').hidden
              && !document.getElementById('issue-focus-card').hidden
              && document.getElementById('issue-focus-h').textContent === 'House of M (2005) #1', 'bundled comic');
            await nextFrame();
            screens.push(snapshot('view-issue'));
            """
        } else if route.hasPrefix("guard-") {
            routeScript = """
            await openRoute(routes[0]);
            const fixtureMode = '\(route)';
            \(Self.passiveGuardFixtures)
            """
        } else if route == "all" {
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
          activeView: document.querySelector('.view:not([hidden])')?.id,
          href: location.href,
          moreMethods: (() => {
            const disclosure = document.getElementById('add-other-methods');
            const summary = disclosure.querySelector('summary');
            const rect = summary.getBoundingClientRect();
            return {
              open: disclosure.open,
              summaryWidth: rect.width,
              summaryHeight: rect.height,
              summaryScrollWidth: summary.scrollWidth,
              summaryClientWidth: summary.clientWidth,
              chevronContent: getComputedStyle(summary, '::after').content,
            };
          })(),
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
          hiddenContinueActions: [...document.querySelectorAll('#chero-actions button')].map((control) => ({
            id: control.id,
            hidden: control.hidden,
            ariaHidden: control.getAttribute('aria-hidden'),
            display: getComputedStyle(control).display,
          })),
          comic: (() => {
            const card = document.getElementById('issue-focus-card');
            const action = document.getElementById('btn-issue-read');
            const details = document.getElementById('btn-issue-info');
            return {
              cardDisplay: getComputedStyle(card).display,
              title: document.getElementById('issue-focus-h').textContent,
              actionName: action.getAttribute('aria-label'),
              detailsName: details.getAttribute('aria-label'),
            };
          })(),
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
        document.getElementById('add-other-methods').addEventListener('toggle', refreshMonitor);
        window.visualViewport?.addEventListener('resize', refreshMonitor);
        new ResizeObserver(refreshMonitor).observe(document.documentElement);
        refreshMonitor();
        const screens = [];
        const guardFixtures = [];
        \(routeScript)
        refreshMonitor();
        \(route == "all" || route.hasPrefix("guard-") ? Self.passiveAuditProbe : "")
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
          guardFixtures,
        });
        """
    }

    private static let passiveGuardFixtures = #"""
    const guard = window.__recapPassiveGuard;
    if (!guard?.globalInventoryValid()) throw new Error('Reviewed global inventory missing before fixtures');
    const fixture = document.createElement('section');
    fixture.id = 'ios-passive-fixtures';
    fixture.style.cssText = 'position:fixed;z-index:10000;top:100px;left:20px;right:20px;background:white';
    document.getElementById('view-home').prepend(fixture);
    const add = (name, html, configure = () => {}) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      fixture.append(wrapper);
      const text = wrapper.querySelector('span');
      configure(wrapper, text);
      guardFixtures.push({ name, passive: guard.passive(text), display: getComputedStyle(text).display,
        rect: text.getBoundingClientRect().toJSON(), diagnostics: guard.explain(text),
        globalValid: guard.globalInventoryValid() });
      return text;
    };
    if (fixtureMode === 'guard-structural') {
      add('plain positive', '<span>Guard plain text</span>');
      add('link text child', '<a href="#/library"><span>Guard link</span></a>');
      add('button text', '<button type="button"><span>Guard button</span></button>');
      add('own click handler', '<span>Guard click</span>', (_, text) =>
        text.addEventListener('click', () => {}));
      add('hidden node', '<span hidden>Guard hidden</span>');
      add('display none node', '<span>Guard display none</span>', (_, text) => {
        text.style.display = 'none';
        if (getComputedStyle(text).display !== 'none') throw new Error('Display-none fixture is visible');
      });
      add('ancestor click handler', '<div><span>Guard ancestor click</span></div>', wrapper =>
        wrapper.firstElementChild.addEventListener('click', () => {}));
      add('ancestor keydown handler', '<div><span>Guard ancestor key</span></div>', wrapper =>
        wrapper.firstElementChild.addEventListener('keydown', () => {}));
      const overlap = (_, text) => { text.style.cssText = 'position:fixed;top:200px;left:20px'; };
      const duplicateFirst = add('duplicate first', '<span>Guard duplicate</span>', overlap);
      const duplicateSecond = add('duplicate second', '<span>Guard duplicate</span>', overlap);
      if (JSON.stringify(duplicateFirst.getBoundingClientRect().toJSON())
        !== JSON.stringify(duplicateSecond.getBoundingClientRect().toJSON())) {
        throw new Error('Ambiguous duplicate fixtures do not overlap');
      }
      const duplicates = guard.candidates().filter(candidate => candidate.label === 'Guard duplicate');
      guardFixtures.push({ name: 'ambiguous duplicate label', rejected: duplicates.length === 0 });
      document.addEventListener('click', () => {});
      guardFixtures.push({ name: 'unreviewed global click', rejected: !guard.globalInventoryValid()
        && guard.candidates().length === 0 && !guard.passive(fixture.querySelector('span')) });
    } else if (fixtureMode === 'guard-aria') {
      fixture.innerHTML = [
        '<p id="ios-aria-hidden-text">Guard hidden-button description</p>',
        '<button id="ios-aria-hidden-control" aria-describedby="ios-aria-hidden-text">Guard hidden control</button>',
        '<p id="ios-aria-visible-text">Guard visible-button description</p>',
        '<button id="ios-aria-visible-control" aria-describedby="ios-aria-visible-text">Guard visible control</button>',
        '<p id="ios-aria-exposed-text">Guard exposed-input description</p>',
        '<input id="ios-aria-exposed-control" class="visually-hidden" aria-label="Guard exposed control" aria-describedby="ios-aria-exposed-text">',
        '<label id="ios-aria-checkbox-label" for="ios-aria-checkbox">Guard hidden-checkbox label</label>',
        '<input id="ios-aria-checkbox" type="checkbox" hidden>',
      ].join('');
      fixture.querySelector('#ios-aria-hidden-control').style.display = 'none';
      for (const [name, id, expected] of [
        ['hidden-button positive', 'ios-aria-hidden-text', true],
        ['visible-button negative', 'ios-aria-visible-text', false],
        ['exposed-input negative', 'ios-aria-exposed-text', false],
        ['hidden-checkbox-label negative', 'ios-aria-checkbox-label', false],
      ]) {
        const text = document.getElementById(id);
        guardFixtures.push({ name, label: text.textContent, expected, passive: guard.passive(text) });
      }
    } else {
      const text = add('tap fixture', '<span id="ios-guard-tap-text">Guard tap text</span>', (_, text) => {
        text.style.cssText = 'display:block;min-height:48px;line-height:48px';
      });
      if (fixtureMode === 'guard-tooltip') {
        text.className = 'has-tooltip';
        text.dataset.tooltip = 'Guard tooltip changed the DOM';
      } else if (fixtureMode === 'guard-global-pointer') {
        document.addEventListener('pointerdown', () => { text.dataset.changedByPointer = 'true'; }, true);
      } else throw new Error('Unknown guard fixture mode');
    }
    """#

    private static let passiveAuditProbe = #"""
    const passiveMonitor = document.createElement('p');
    passiveMonitor.setAttribute('data-recap-passive-monitor', '');
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
    let refreshingPassive = false;
    const refreshPassiveMonitor = async () => {
      if (refreshingPassive) return;
      refreshingPassive = true;
      try {
      const active = document.activeElement;
      const currentView = document.querySelector('.view:not([hidden])')?.id;
      const breadcrumbLabel = {
        'view-library': 'Library', 'view-add': 'Search', 'view-data': 'Backup & settings',
      }[currentView];
      const state = {
        tick: ++passiveTick,
        href: location.href,
        view: currentView,
        focus: active ? describe(active) : null,
        focusIsControl: Boolean(active?.matches(`${controlSelector},[tabindex]:not([tabindex="-1"])`)),
        guard: window.__recapPassiveGuard ? {
          valid: window.__recapPassiveGuard.globalInventoryValid(),
          inventory: window.__recapPassiveGuard.inventory(),
          candidates: window.__recapPassiveGuard.candidates(),
          diagnostics: currentView === 'view-data'
            ? [...document.querySelectorAll('#view-data h3, #restore-copy-summary')]
              .map(element => window.__recapPassiveGuard.explain(element)) : [],
          focus: window.__recapPassiveGuard.focus(),
          dom: await window.__recapPassiveGuard.domDigest(),
          viewportWidth: document.documentElement.clientWidth,
        } : { valid: false, error: 'Document-start passive guard missing' },
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
          evidence('library-lists-summary', '#library-yours > .sec-h > .sec-note',
            '#library-yours', 'Your Reading Lists', '1 Reading List · 1 not started'),
          evidence('library-ratings-caption', '#library-rated-shelf-status',
            '#library-rated-shelf', 'Top-rated comics',
            'Comics you rate from their Issue details will appear here.'),
          ...(breadcrumbLabel ? [
            evidence('current-breadcrumb', '.view:not([hidden]) > .breadcrumb [aria-current="page"]',
              '.breadcrumb', 'Breadcrumb', breadcrumbLabel),
          ] : []),
        ],
      };
      passiveMonitor.setAttribute('aria-label', `recap-passive-probe ${JSON.stringify(state)}`);
      } finally {
        refreshingPassive = false;
      }
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

    private func waitForActiveView(_ app: XCUIApplication, view: String, route: String) throws {
        let previousTick = try XCTUnwrap(passiveState(of: app)["tick"] as? Int)
        let monitor = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "recap-passive-probe ")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
            guard let monitor = object as? XCUIElement,
                  let state = layoutMetrics(from: monitor.label, prefix: "recap-passive-probe "),
                  state["view"] as? String == view,
                  let tick = state["tick"] as? Int, tick > previousTick,
                  let href = state["href"] as? String, let url = URL(string: href) else { return false }
            return url.fragment?.split(separator: "/").first == Substring(route)
        }, object: monitor)
        XCTAssertEqual(
            XCTWaiter.wait(for: [settled], timeout: 30), .completed,
            "a fresh DOM sample confirms \(view) and its route before native inspection: \(monitor.label)")
    }

    private func navigate(
        _ app: XCUIApplication, linkName: String, headingLabel: String, view: String, route: String
    ) throws {
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
        try waitForActiveView(app, view: view, route: route)
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
        let guardProof = try XCTUnwrap(state["guard"] as? [String: Any])
        XCTAssertEqual(guardProof["valid"] as? Bool, true, "the exact reviewed global-handler inventory")
        for item in cases {
            XCTAssertNil(item["error"], "the exact reviewed DOM node remains present: \(item)")
        }
        var accepted: [XCUIElement] = []
        for item in cases where item["visible"] as? Bool == true {
            let key = try XCTUnwrap(item["key"] as? String)
            XCTAssertTrue([
                "sidebar-reading", "sidebar-app", "home-read-count", "home-count-total",
                "home-count-word", "home-next-caption", "home-lists-summary",
                "library-lists-summary", "library-ratings-caption", "current-breadcrumb",
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

    private func freshPassiveState(of app: XCUIApplication) throws -> [String: Any] {
        let tick = try XCTUnwrap(passiveState(of: app)["tick"] as? Int)
        let monitor = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "recap-passive-probe ")).firstMatch
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
            guard let element = object as? XCUIElement,
                  let state = layoutMetrics(from: element.label, prefix: "recap-passive-probe "),
                  let next = state["tick"] as? Int else { return false }
            return next > tick
        }, object: monitor)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 30), .completed, "a fresh passive-guard sample")
        return try passiveState(of: app)
    }

    private func ariaControlsAbsentFromNativeTree(_ candidate: [String: Any], in app: XCUIApplication) -> Bool {
        guard let controls = candidate["ariaControls"] as? [[String: Any]] else { return false }
        for control in controls {
            guard let identifier = control["id"] as? String, !identifier.isEmpty,
                  let name = control["name"] as? String, !name.isEmpty else { return false }
            if app.webViews.firstMatch.descendants(matching: .any).matching(
                NSPredicate(format: "identifier == %@ OR label == %@", identifier, name)).firstMatch.exists {
                return false
            }
        }
        return true
    }

    private func acceptPassiveFinding(
        _ element: XCUIElement, in app: XCUIApplication, routeState: [String: Any]
    ) throws -> Bool {
        guard element.exists, element.elementType == .staticText else { return false }
        for controls in [app.webViews.firstMatch.buttons, app.webViews.firstMatch.links] {
            let parents = controls.containing(NSPredicate(format: "label == %@", element.label)).allElementsBoundByIndex
            if parents.contains(where: { $0.exists && $0.frame.contains(element.frame) }) {
                print("T03 passive guard rejected a native control's StaticText child: \(element.debugDescription)")
                return false
            }
        }
        let settled = try freshPassiveState(of: app)
        let before = try freshPassiveState(of: app)
        guard before["view"] as? String == routeState["view"] as? String,
              before["href"] as? String == routeState["href"] as? String,
              let proof = before["guard"] as? [String: Any], proof["valid"] as? Bool == true,
              let settledProof = settled["guard"] as? [String: Any],
              settledProof["valid"] as? Bool == true,
              settled["href"] as? String == before["href"] as? String,
              settled["view"] as? String == before["view"] as? String,
              settledProof["dom"] as? String == proof["dom"] as? String,
              let candidates = proof["candidates"] as? [[String: Any]],
              let viewport = (proof["viewportWidth"] as? NSNumber)?.doubleValue, viewport > 0 else {
            print("T03 passive guard rejected route or global inventory: \(before)")
            return false
        }
        let webFrame = app.webViews.firstMatch.frame
        let scale = webFrame.width / viewport
        let nativeFrame = element.frame
        let matches = candidates.compactMap { candidate -> (candidate: [String: Any], point: CGPoint)? in
            guard candidate["label"] as? String == element.label,
                  let container = candidate["container"] as? String,
                  container == before["view"] as? String || container == "sidebar-nav",
                  let hitPoints = candidate["hitPoints"] as? [[String: Any]],
                  let rect = candidate["rect"] as? [String: Any],
                  let x = (rect["x"] as? NSNumber)?.doubleValue,
                  let y = (rect["y"] as? NSNumber)?.doubleValue,
                  let width = (rect["width"] as? NSNumber)?.doubleValue,
                  let height = (rect["height"] as? NSNumber)?.doubleValue else { return nil }
            let domFrame = CGRect(x: webFrame.minX + x * scale, y: webFrame.minY + y * scale,
                                  width: width * scale, height: height * scale)
            let points = hitPoints.compactMap { value -> CGPoint? in
                guard let x = (value["x"] as? NSNumber)?.doubleValue,
                      let y = (value["y"] as? NSNumber)?.doubleValue else { return nil }
                let point = CGPoint(x: webFrame.minX + x * scale, y: webFrame.minY + y * scale)
                return nativeFrame.contains(point) && webFrame.contains(point) ? point : nil
            }
            guard width > 0 && height > 0 && nativeFrame.width > 0 && nativeFrame.height > 0,
                  webFrame.contains(nativeFrame),
                  domFrame.insetBy(dx: -1, dy: -1).contains(nativeFrame),
                  let point = points.first else { return nil }
            return (candidate, point)
        }
        guard matches.count == 1, let match = matches.first else {
            print("T03 passive guard rejected unmatched or ambiguous label/container/frame: \(element.debugDescription)")
            try record("t03-passive-guard-unmatched", [
                "label": element.label, "nativeFrame": NSCoder.string(for: nativeFrame),
                "webFrame": NSCoder.string(for: webFrame),
                "matchingCandidates": candidates.filter { $0["label"] as? String == element.label },
                "diagnostics": proof["diagnostics"] ?? [],
            ])
            return false
        }
        let candidate = match.candidate
        let point = match.point
        guard ariaControlsAbsentFromNativeTree(candidate, in: app) else {
            print("T03 passive guard rejected an associated control exposed in the native tree")
            return false
        }
        let settledMatches = (settledProof["candidates"] as? [[String: Any]] ?? [])
            .filter { $0["key"] as? String == candidate["key"] as? String }
        guard settledMatches.count == 1,
              NSDictionary(dictionary: settledMatches[0]).isEqual(NSDictionary(dictionary: candidate)),
              element.frame == nativeFrame, app.webViews.firstMatch.frame == webFrame,
              let key = candidate["key"] as? String else {
            print("T03 passive guard rejected changed candidate geometry: \(element.debugDescription)")
            return false
        }
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: point.x, dy: point.y)).tap()
        let after = try freshPassiveState(of: app)
        let afterMatches = ((after["guard"] as? [String: Any])?["candidates"] as? [[String: Any]] ?? [])
            .filter { $0["key"] as? String == key }
        guard after["view"] as? String == before["view"] as? String,
              after["href"] as? String == before["href"] as? String,
              let afterProof = after["guard"] as? [String: Any],
              afterProof["valid"] as? Bool == true,
              let dom = proof["dom"] as? String, !dom.isEmpty, afterProof["dom"] as? String == dom,
              afterProof["focus"] as? String == proof["focus"] as? String,
              afterMatches.count == 1,
              ariaControlsAbsentFromNativeTree(candidate, in: app),
              NSDictionary(dictionary: afterMatches[0]).isEqual(NSDictionary(dictionary: candidate)) else {
            try record("t03-passive-guard-rejected-tap", [
                "candidate": candidate, "nativeLabel": element.label,
                "nativeFrame": NSCoder.string(for: nativeFrame),
                "nativeTapPoint": NSCoder.string(for: point),
                "beforeDOM": proof["dom"] ?? NSNull(),
                "afterDOM": (after["guard"] as? [String: Any])?["dom"] ?? NSNull(),
                "beforeFocus": proof["focus"] ?? NSNull(),
                "afterFocus": (after["guard"] as? [String: Any])?["focus"] ?? NSNull(),
                "beforeRoute": before["href"] ?? NSNull(), "afterRoute": after["href"] ?? NSNull(),
                "afterCandidates": afterMatches,
                "afterValid": (after["guard"] as? [String: Any])?["valid"] ?? NSNull(),
            ])
            return false
        }
        try record("t03-passive-guard", [
            "candidate": candidate, "nativeLabel": element.label,
            "nativeFrame": NSCoder.string(for: nativeFrame), "before": before, "after": after,
            "nativeTapPoint": NSCoder.string(for: point),
        ])
        return true
    }

    private func performAccessibilityAudit(of app: XCUIApplication, allowsPassiveGuard: Bool = false) throws {
        let previousFailurePolicy = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previousFailurePolicy }
        let routeState: [String: Any]
        if allowsPassiveGuard {
            routeState = try freshPassiveState(of: app)
        } else {
            routeState = [:]
        }
        var unreviewedFindings = 0
        for attempt in 0...1 {
            var observedFindings = 0
            do {
                try app.performAccessibilityAudit { issue in
                    observedFindings += 1
                    print("T03 accessibility audit issue: \(issue.compactDescription)")
                    print("T03 accessibility audit details: \(issue.detailedDescription)")
                    print("T03 accessibility audit element: \(issue.element.debugDescription)")
                    if allowsPassiveGuard, issue.auditType == .hitRegion, let element = issue.element,
                       element.elementType == .staticText {
                        do {
                            if try self.acceptPassiveFinding(element, in: app, routeState: routeState) {
                                print("T03 accepted proven passive-text hitRegion finding: \(element.label)")
                                return true
                            }
                        } catch {
                            XCTFail("Passive guard evidence failed: \(error)")
                        }
                    }
                    unreviewedFindings += 1
                    return false
                }
                break
            } catch {
                let failure = error as NSError
                guard failure.domain == "com.apple.xcode.xctest.accessibilityAudit", failure.code == -56 else {
                    throw error
                }
                let retry = attempt == 0 && observedFindings == 0 && allowsPassiveGuard
                try record("t03-accessibility-timeout", [
                    "domain": failure.domain, "code": failure.code, "attempt": attempt + 1,
                    "findings": observedFindings, "retry": retry,
                ])
                guard retry else { throw error }
                let expectedView = try XCTUnwrap(routeState["view"] as? String)
                let expectedHref = try XCTUnwrap(routeState["href"] as? String)
                let fragment = try XCTUnwrap(URL(string: expectedHref)?.fragment)
                let expectedRoute = String(try XCTUnwrap(fragment.split(separator: "/").first))
                try waitForActiveView(app, view: expectedView, route: expectedRoute)
                let retryState = try freshPassiveState(of: app)
                guard retryState["href"] as? String == expectedHref,
                      retryState["view"] as? String == expectedView else {
                    throw error
                }
                try record("t03-accessibility-retry", ["attempt": attempt + 2, "state": retryState])
            }
        }
        continueAfterFailure = previousFailurePolicy
        XCTAssertEqual(unreviewedFindings, 0, "every finding without a complete passive guard proof remains a failure")
    }

    func testComicPageRetainsNativeHeadingAndActionsAtBothTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category, route: "comic")
            let result = try probeResult(of: app)
            let screens = try XCTUnwrap(result["screens"] as? [[String: Any]])
            let screen = try XCTUnwrap(screens.first)
            XCTAssertEqual(screen["view"] as? String, "view-issue")
            let comic = try XCTUnwrap(screen["comic"] as? [String: Any])
            XCTAssertEqual(comic["cardDisplay"] as? String, "contents",
                           "the shared phone layout flattens the card without removing its accessible children")
            let title = try XCTUnwrap(comic["title"] as? String)
            XCTAssertEqual(title, "House of M (2005) #1")
            let heading = app.webViews.firstMatch.staticTexts.matching(NSPredicate(format: "label == %@", title)).firstMatch
            XCTAssertTrue(heading.waitForExistence(timeout: 30), "WebKit retains the named comic heading")
            let actionName = try XCTUnwrap(comic["actionName"] as? String)
            XCTAssertTrue(actionName.contains(title), "the launcher-owned action retains its comic context")
            let action = app.webViews.firstMatch.buttons.matching(NSPredicate(format: "label == %@", actionName)).firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 30), "WebKit retains the comic's reader action")
            XCTAssertTrue(action.isEnabled)
            let detailsName = try XCTUnwrap(comic["detailsName"] as? String)
            XCTAssertTrue(detailsName.contains(title))
            let details = app.webViews.firstMatch.links.matching(NSPredicate(format: "label == %@", detailsName)).firstMatch
            XCTAssertTrue(details.waitForExistence(timeout: 30), "WebKit retains the comic's details link")
            XCTAssertLessThanOrEqual(
                try XCTUnwrap(screen["documentWidth"] as? Double),
                try XCTUnwrap(screen["viewportWidth"] as? Double),
                "the merged comic layout has no horizontal overflow")
            try record("t03-comic-tree-\(category.rawValue)", [
                "screen": screen, "nativeHierarchy": app.debugDescription,
                "heading": heading.label, "action": action.label, "details": details.label,
            ])
            capture(app, named: "t03-comic-tree-\(category.rawValue)")
            app.terminate()
        }
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
                try navigate(app, linkName: "Library", headingLabel: "Library", view: "view-library", route: "library")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-library")
                try navigate(app, linkName: "Search", headingLabel: "Search", view: "view-add", route: "add")
                capture(app, named: "t03-\(category.rawValue)-\(appearance)-search")
                try navigate(app, linkName: "Backup & settings", headingLabel: "Backup & settings", view: "view-data", route: "data")
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
                revealNativeTarget(link, in: app)
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
            for (name, headingLabel, view, route, nextLink, nextHeadingLabel, nextView, nextRoute) in [
                ("home", "RECAP PAGE!", "view-home", "home", "Library", "Library", "view-library", "library"),
                ("library", "Library", "view-library", "library", "Search", "Search", "view-add", "add"),
                ("search", "Search", "view-add", "add", "Backup & settings", "Backup & settings", "view-data", "data"),
                ("data", "Backup & settings", "view-data", "data", nil, nil, nil, nil),
            ] as [(String, String, String, String, String?, String?, String?, String?)] {
                try waitForActiveView(app, view: view, route: route)
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
                if name == "home" {
                    let hiddenActions = try XCTUnwrap(screen["hiddenContinueActions"] as? [[String: Any]])
                    XCTAssertEqual(hiddenActions.count, 4)
                    for action in hiddenActions {
                        XCTAssertEqual(action["hidden"] as? Bool, true)
                        XCTAssertEqual(action["ariaHidden"] as? String, "true")
                        XCTAssertEqual(action["display"] as? String, "none")
                    }
                    let region = app.webViews.firstMatch.otherElements.matching(
                        NSPredicate(format: "label == %@ OR label == %@",
                                    "iOS presentation fixture", "iOS presentation fixture, region"))
                        .containing(.link, identifier: "Open the list: iOS presentation fixture").firstMatch
                    XCTAssertTrue(region.exists)
                    XCTAssertEqual(region.buttons.count, 0, "hidden Continue actions have no native Button nodes")
                }
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
                try performAccessibilityAudit(of: app, allowsPassiveGuard: true)
                try record("t03-accessibility-\(category.rawValue)-\(name)", [
                    "audit": "passed", "category": category.rawValue,
                    "reviewedPassiveCases": acceptedTexts.map(\.label),
                ])
                capture(app, named: "t03-audit-\(category.rawValue)-\(name)")
                if let nextLink, let nextHeadingLabel, let nextView, let nextRoute {
                    try navigate(
                        app, linkName: nextLink, headingLabel: nextHeadingLabel, view: nextView, route: nextRoute)
                }
            }
            app.terminate()
        }
    }

    func testPassiveGuardChecksHiddenARIAControlsWithoutExemptingLabels() throws {
        let app = launch(route: "guard-aria")
        let result = try probeResult(of: app)
        let fixtures = try XCTUnwrap(result["guardFixtures"] as? [[String: Any]])
        XCTAssertEqual(fixtures.count, 4)
        XCTAssertFalse(app.buttons["Guard hidden control"].exists)
        XCTAssertTrue(app.buttons["Guard visible control"].exists)
        XCTAssertTrue(app.textFields["Guard exposed control"].exists)
        for fixture in fixtures {
            let name = try XCTUnwrap(fixture["name"] as? String)
            let expected = try XCTUnwrap(fixture["expected"] as? Bool)
            XCTAssertEqual(fixture["passive"] as? Bool, expected, name)
            let label = try XCTUnwrap(fixture["label"] as? String)
            let element = app.webViews.firstMatch.staticTexts.matching(
                NSPredicate(format: "label == %@", label)).firstMatch
            if expected {
                XCTAssertTrue(element.waitForExistence(timeout: 30))
                let before = try freshPassiveState(of: app)
                let accepted = try acceptPassiveFinding(element, in: app, routeState: before)
                XCTAssertTrue(accepted, name)
            }
        }
        try record("t03-guard-aria-fixtures", ["fixtures": fixtures])
        app.terminate()
    }

    func testPassiveGuardRejectsStructuralAndGlobalNegativeFixtures() throws {
        let app = launch(route: "guard-structural")
        let result = try probeResult(of: app)
        let fixtures = try XCTUnwrap(result["guardFixtures"] as? [[String: Any]])
        XCTAssertEqual(fixtures.count, 12)
        try record("t03-guard-negative-fixtures", ["fixtures": fixtures])
        let positives = ["plain positive", "duplicate first", "duplicate second"]
        for fixture in fixtures {
            let name = try XCTUnwrap(fixture["name"] as? String)
            if fixture["rejected"] != nil {
                XCTAssertEqual(fixture["rejected"] as? Bool, true, name)
            } else {
                XCTAssertEqual(fixture["passive"] as? Bool, positives.contains(name), name)
            }
        }
        app.terminate()
    }

    func testPassiveGuardRejectsTooltipAndGlobalPointerDOMChangesAfterNativeTaps() throws {
        for route in ["guard-tooltip", "guard-global-pointer"] {
            let app = launch(route: route)
            _ = try probeResult(of: app)
            let element = app.webViews.firstMatch.staticTexts.matching(
                NSPredicate(format: "label == %@", "Guard tap text")).firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 30))
            let before = try freshPassiveState(of: app)
            if route == "guard-tooltip" {
                let accepted = try acceptPassiveFinding(element, in: app, routeState: before)
                XCTAssertFalse(accepted, "a tooltip-changing native tap is not passive")
            } else {
                let proof = try XCTUnwrap(before["guard"] as? [String: Any])
                XCTAssertEqual(proof["valid"] as? Bool, false, "an unknown global handler rejects every node")
                element.tap()
            }
            let after = try freshPassiveState(of: app)
            let beforeProof = try XCTUnwrap(before["guard"] as? [String: Any])
            let afterProof = try XCTUnwrap(after["guard"] as? [String: Any])
            let originalDOM = try XCTUnwrap(beforeProof["dom"] as? String)
            let changedDOM = try XCTUnwrap(afterProof["dom"] as? String)
            XCTAssertNotEqual(originalDOM, changedDOM, "the native tap actually changed the DOM, not a vacuous rejection")
            try record("t03-\(route)", ["before": before, "after": after])
            app.terminate()
        }
    }

    func testExpandedMoreMethodsFitsAtDefaultAndLargestTextSizes() throws {
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let app = launch(category: category, route: "search")
            _ = try probeResult(of: app)
            let summary = app.webViews.firstMatch.buttons.matching(
                NSPredicate(format: "label == %@", "More ways to add")).firstMatch
            XCTAssertTrue(summary.waitForExistence(timeout: 30))
            let monitor = layoutMonitor(of: app)
            let initial = try XCTUnwrap(layoutMetrics(from: monitor.label))
            XCTAssertEqual(initial["activeView"] as? String, "view-add")
            let initialMore = try XCTUnwrap(initial["moreMethods"] as? [String: Any])
            XCTAssertEqual(initialMore["open"] as? Bool, false)
            for expectedOpen in [true, false] {
                revealNativeTarget(summary, in: app)
                XCTAssertGreaterThanOrEqual(summary.frame.width, 44)
                XCTAssertGreaterThanOrEqual(summary.frame.height, 44)
                summary.tap()
                let changed = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
                    guard let monitor = object as? XCUIElement,
                          let state = layoutMetrics(from: monitor.label),
                          state["activeView"] as? String == "view-add",
                          let href = state["href"] as? String,
                          URL(string: href)?.fragment?.split(separator: "/").first == "add",
                          let more = state["moreMethods"] as? [String: Any] else { return false }
                    return more["open"] as? Bool == expectedOpen
                }, object: monitor)
                XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 30), .completed)
                let metrics = try XCTUnwrap(layoutMetrics(from: monitor.label))
                let more = try XCTUnwrap(metrics["moreMethods"] as? [String: Any])
                XCTAssertEqual(more["open"] as? Bool, expectedOpen)
                let viewport = try XCTUnwrap((metrics["viewportWidth"] as? NSNumber)?.doubleValue)
                let document = try XCTUnwrap((metrics["documentWidth"] as? NSNumber)?.doubleValue)
                XCTAssertGreaterThan(viewport, 0)
                XCTAssertEqual(document, viewport, "expanded More has no sideways overflow")
                let summaryWidth = try XCTUnwrap((more["summaryClientWidth"] as? NSNumber)?.doubleValue)
                let summaryScroll = try XCTUnwrap((more["summaryScrollWidth"] as? NSNumber)?.doubleValue)
                XCTAssertGreaterThan(summaryWidth, 0)
                try record("t03-more-methods-\(category.rawValue)-\(expectedOpen)", [
                    "metrics": metrics, "summaryOverflow": summaryScroll - summaryWidth,
                ])
                capture(app, named: "t03-more-methods-\(category.rawValue)-\(expectedOpen)")
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
