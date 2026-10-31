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
func revealNativeTarget(_ element: XCUIElement, in app: XCUIApplication, bottomClearance: CGFloat = 0) {
    let webView = app.webViews.firstMatch
    let toggle = app.descendants(matching: .any).matching(
        NSPredicate(format: "label == %@ OR identifier == %@", "More", "btn-rail-toggle")).firstMatch
    let usableBottom = toggle.exists
        ? min(webView.frame.maxY, toggle.frame.minY) - bottomClearance : webView.frame.maxY
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
    const add = async (name, html, configure = () => {}) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      fixture.append(wrapper);
      const text = wrapper.querySelector('span');
      configure(wrapper, text);
      await nextFrame();
      guardFixtures.push({ name, passive: guard.passive(text), display: getComputedStyle(text).display,
        rect: text.getBoundingClientRect().toJSON(), diagnostics: guard.explain(text),
        globalValid: guard.globalInventoryValid() });
      return text;
    };
    if (fixtureMode === 'guard-structural') {
      await add('plain positive', '<span>Guard plain text</span>');
      await add('link text child', '<a href="#/library"><span>Guard link</span></a>');
      await add('button text', '<button type="button"><span>Guard button</span></button>');
      await add('own click handler', '<span>Guard click</span>', (_, text) =>
        text.addEventListener('click', () => {}));
      await add('hidden node', '<span hidden>Guard hidden</span>');
      await add('display none node', '<span>Guard display none</span>', (_, text) => {
        text.style.display = 'none';
        if (getComputedStyle(text).display !== 'none') throw new Error('Display-none fixture is visible');
      });
      await add('ancestor click handler', '<div><span>Guard ancestor click</span></div>', wrapper =>
        wrapper.firstElementChild.addEventListener('click', () => {}));
      await add('ancestor keydown handler', '<div><span>Guard ancestor key</span></div>', wrapper =>
        wrapper.firstElementChild.addEventListener('keydown', () => {}));
      const overlap = (_, text) => { text.style.cssText = 'position:fixed;top:200px;left:20px'; };
      const duplicateFirst = await add('duplicate first', '<span>Guard duplicate</span>', overlap);
      const duplicateSecond = await add('duplicate second', '<span>Guard duplicate</span>', overlap);
      if (JSON.stringify(duplicateFirst.getBoundingClientRect().toJSON())
        !== JSON.stringify(duplicateSecond.getBoundingClientRect().toJSON())) {
        throw new Error('Ambiguous duplicate fixtures do not overlap');
      }
      const duplicates = guard.candidates().filter(candidate => candidate.label === 'Guard duplicate');
      guardFixtures.push({ name: 'ambiguous duplicate label', rejected: duplicates.length === 0 });
      const cropped = document.createElement('span');
      cropped.id = 'ios-partial-fragment';
      cropped.textContent = 'Guard cropped heading';
      cropped.style.cssText = 'position:fixed;top:250px;left:20px;width:332px;font:20px/30px sans-serif;z-index:100001';
      document.getElementById('view-home').append(cropped);
      await nextFrame();
      const croppedRange = document.createRange();
      croppedRange.selectNodeContents(cropped);
      const croppedRect = croppedRange.getBoundingClientRect();
      const cover = document.createElement('div');
      cover.setAttribute('role', 'button');
      const cutoff = croppedRect.top + 5;
      cover.style.cssText = `position:fixed;left:0;right:0;top:${cutoff}px;bottom:0;z-index:100002;background:white`;
      document.getElementById('view-home').append(cover);
      await nextFrame();
      const partial = guard.candidates().filter(candidate => candidate.selector === '#ios-partial-fragment');
      guardFixtures.push({ name: 'partially occluded text', accepted: partial.length === 1
        && partial[0].hitPoints.length > 0 && partial[0].hitPoints.every(point => point.y < cutoff),
        candidates: partial });
      cover.style.top = `${croppedRect.top - 1}px`;
      await nextFrame();
      guardFixtures.push({ name: 'fully occluded text', rejected: !guard.candidates()
        .some(candidate => candidate.selector === '#ios-partial-fragment') });
      cropped.remove();
      cover.remove();
      document.addEventListener('click', () => {});
      guardFixtures.push({ name: 'unreviewed global click', rejected: !guard.globalInventoryValid()
        && guard.candidates().length === 0 && !guard.passive(fixture.querySelector('span')) });
    } else if (fixtureMode === 'guard-global-property') {
      const beforeValid = guard.globalInventoryValid();
      const previous = document.onclick;
      let calls = 0;
      const handler = () => { calls += 1; };
      document.onclick = handler;
      const handlerPreserved = document.onclick === handler;
      const installedValid = guard.globalInventoryValid();
      document.dispatchEvent(new MouseEvent('click'));
      document.onclick = previous;
      document.dispatchEvent(new MouseEvent('click'));
      guardFixtures.push({ name: 'removed global property handler', beforeValid, installedValid,
        handlerPreserved, calls, afterRemovalValid: guard.globalInventoryValid(),
        rejected: !guard.globalInventoryValid() && guard.candidates().length === 0
          && !guard.passive(fixture) });
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
      await nextFrame();
      for (const [name, id, expected] of [
        ['hidden-button positive', 'ios-aria-hidden-text', true],
        ['visible-button negative', 'ios-aria-visible-text', false],
        ['exposed-input negative', 'ios-aria-exposed-text', false],
        ['hidden-checkbox-label negative', 'ios-aria-checkbox-label', false],
      ]) {
        const text = document.getElementById(id);
        guardFixtures.push({ name, label: text.textContent, expected, passive: guard.passive(text) });
      }
    } else if (fixtureMode === 'guard-occlusion') {
      const sidebar = document.getElementById('sidebar');
      const navigation = sidebar?.querySelector('.rail-header');
      if (!navigation || getComputedStyle(navigation).position !== 'fixed') {
        throw new Error('Bottom navigation is not fixed');
      }
      const navigationRect = navigation.getBoundingClientRect();
      const home = document.getElementById('view-home');
      const font = 'font:11px/14px sans-serif;white-space:nowrap';
      const place = async (element, top, left) => {
        await nextFrame();
        const rect = element.getBoundingClientRect();
        element.style.top = `${parseFloat(element.style.top) + top - rect.top}px`;
        element.style.left = `${parseFloat(element.style.left) + left - rect.left}px`;
        await nextFrame();
      };
      const row = document.createElement('div');
      row.id = 'ios-occlusion-row';
      row.style.cssText = `position:absolute;top:0px;left:0px;display:flex;gap:6px;${font}`;
      row.innerHTML = '<div>Occ plain</div><div>Occ click</div>'
        + '<label for="ios-occlusion-check">Occ label</label><div>Occ nav</div>'
        + '<input id="ios-occlusion-check" type="checkbox" hidden>';
      row.children[1].addEventListener('keydown', () => {});
      // Native text frames round outward to whole points, so a box the width of its text cannot
      // contain its own crop. Padding gives each owner room without moving the text off the bar.
      for (const owner of row.children) owner.style.padding = '4px';
      home.append(row);
      const spacer = document.createElement('div');
      spacer.style.height = `${innerHeight * 2}px`;
      home.append(spacer);
      await place(row, navigationRect.top + 6, 20);
      const fixed = document.createElement('div');
      fixed.textContent = 'Occ fixed';
      fixed.style.cssText = `position:fixed;top:0px;left:0px;z-index:1;padding:4px;${font}`;
      home.append(fixed);
      await place(fixed, navigationRect.top + 6, innerWidth - 80);
      const textRect = element => {
        const range = document.createRange();
        range.selectNodeContents(element.firstChild);
        return range.getBoundingClientRect();
      };
      const viewNavigationText = textRect(row.children[3]);
      const navigationText = document.createElement('span');
      navigationText.id = 'ios-occlusion-navigation-text';
      navigationText.textContent = 'Occ nav';
      navigationText.style.cssText = `position:fixed;top:0px;left:0px;z-index:21;${font}`;
      sidebar.append(navigationText);
      await place(navigationText, viewNavigationText.top, viewNavigationText.left);
      const owners = [...row.children].filter(element => element.tagName !== 'INPUT').concat(fixed);
      const placed = owners.map(owner => {
        const box = textRect(owner);
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!hit || !sidebar.contains(hit) || box.top <= navigationRect.top || box.bottom >= navigationRect.bottom) {
          throw new Error(`${owner.textContent} is not entirely under the bottom navigation`);
        }
        return { label: owner.textContent, text: box.toJSON(), hit: hit.tagName };
      });
      guardFixtures.push({ name: 'bottom navigation occlusion', navigation: navigationRect.toJSON(),
        scrollY, placed, evidence: guard.navigationOcclusions() });
    } else {
      const text = await add('tap fixture', '<span id="ios-guard-tap-text">Guard tap text</span>', (_, text) => {
        text.style.cssText = 'display:block;min-height:48px;line-height:48px';
      });
      if (fixtureMode === 'guard-tooltip') {
        text.className = 'has-tooltip';
        text.dataset.tooltip = 'Guard tooltip changed the DOM';
      } else if (fixtureMode === 'guard-global-pointer') {
        document.addEventListener('pointerdown', () => { text.dataset.changedByPointer = 'true'; }, true);
      } else if (fixtureMode === 'guard-reviewed-pointer') {
        const updates = document.getElementById('home-updates');
        if (!updates || updates.open) throw new Error('Home updates is missing or already open');
        const toggled = new Promise(resolve => updates.addEventListener('toggle', resolve, { once: true }));
        updates.open = true;
        await toggled;
        await nextFrame();
        if (!updates.open) throw new Error('Home updates closed itself, so the reviewed handler has nothing to close');
        guardFixtures.push({ name: 'reviewed pointerdown', open: updates.open,
          globalValid: guard.globalInventoryValid(), passive: guard.passive(text) });
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
    const fontContext = document.createElement('canvas').getContext('2d');
    if (!fontContext) throw new Error('Font geometry canvas unavailable');
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
      range.selectNodeContents(textNode || element);
      const rect = textNode ? range.getBoundingClientRect() : element.getBoundingClientRect();
      const style = getComputedStyle(element);
      fontContext.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
      const metrics = fontContext.measureText((textNode || element).textContent.trim());
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
        rangeRects: [...range.getClientRects()].map(fragment => fragment.toJSON()),
        fontGeometry: {
          font: style.font, canvasFont: fontContext.font, fontSize: style.fontSize,
          fontVariantNumeric: style.fontVariantNumeric, fontFeatureSettings: style.fontFeatureSettings,
          fontVariationSettings: style.fontVariationSettings,
          lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
          textSizeAdjust: style.getPropertyValue('-webkit-text-size-adjust'),
          width: metrics.width, actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
          actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
          fontBoundingBoxAscent: metrics.fontBoundingBoxAscent ?? null,
          fontBoundingBoxDescent: metrics.fontBoundingBoxDescent ?? null,
          parentRect: element.parentElement?.getBoundingClientRect().toJSON(),
        },
        cursor: getComputedStyle(element).cursor,
      };
    };
    // Diagnostics only: the guard still decides on the digest. This names what changed in a native
    // no-op tap window, since SE's home-read-count rejection on run 41204085610 recorded only two
    // digests. An observer rather than a listener, so the reviewed handler inventory is untouched.
    // Date.now() is the host clock the Simulator shares with the test runner, so entries can be
    // placed relative to the native tap.
    const probeSelector = '[id^="recap-"], [data-recap-passive-monitor]';
    const mutationLog = [];
    let mutationSeq = 0;
    const clip = (value) => value === null || value === undefined ? null : String(value).slice(0, 80);
    const elementOf = (node) => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const mutationPath = (node) => {
      const parts = [];
      for (let element = elementOf(node); element && parts.length < 5; element = element.parentElement) {
        const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join('');
        parts.unshift(element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}${classes}`);
        if (element.id) break;
      }
      return node.nodeType === Node.TEXT_NODE ? `${parts.join(' > ')} > #text` : parts.join(' > ');
    };
    const isProbe = (node) => Boolean(elementOf(node)?.closest(probeSelector));
    const nodeSummary = (node) => node.nodeType === Node.TEXT_NODE ? `#text ${clip(node.textContent)}`
      : node.nodeType === Node.ELEMENT_NODE ? `<${mutationPath(node)}> ${clip(node.textContent)}`
      : `node ${node.nodeType}`;
    // Run 41216886397 showed Home rewriting identical values every 0.8s or so, enough to push the
    // one real change out of a 40-entry log. Rewrites that leave a node exactly as it was cannot
    // move the digest, so they are tallied per target rather than logged.
    const sameValue = { total: 0, targets: {} };
    const tallySame = (target) => {
      sameValue.total += 1;
      sameValue.targets[target] = (sameValue.targets[target] ?? 0) + 1;
    };
    const sameNode = (a, b) => a.nodeType === b.nodeType && (a.nodeType === Node.ELEMENT_NODE
      ? a.outerHTML === b.outerHTML : a.textContent === b.textContent);
    const logMutations = (records) => {
      for (const record of records) {
        if (isProbe(record.target)) continue;
        const target = mutationPath(record.target);
        const entry = { seq: 0, at: Date.now(), type: record.type, target };
        if (record.type === 'attributes') {
          const now = record.target.getAttribute(record.attributeName);
          if (now === record.oldValue) { tallySame(`${target}@${record.attributeName}`); continue; }
          Object.assign(entry, { attribute: record.attributeName, old: clip(record.oldValue), now: clip(now) });
        } else if (record.type === 'characterData') {
          if (record.target.data === record.oldValue) { tallySame(target); continue; }
          Object.assign(entry, { old: clip(record.oldValue), now: clip(record.target.data) });
        } else {
          const added = [...record.addedNodes].filter((node) => !isProbe(node));
          const removed = [...record.removedNodes].filter((node) =>
            !(node.nodeType === Node.ELEMENT_NODE && node.matches(probeSelector)));
          if (!added.length && !removed.length) continue;
          if (added.length === removed.length && added.every((node, index) => sameNode(node, removed[index]))) {
            tallySame(`${target} children`);
            continue;
          }
          Object.assign(entry, { addedCount: added.length, removedCount: removed.length,
            added: added.slice(0, 3).map(nodeSummary), removed: removed.slice(0, 3).map(nodeSummary) });
        }
        entry.seq = ++mutationSeq;
        mutationLog.push(entry);
      }
      if (mutationLog.length > 200) mutationLog.splice(0, mutationLog.length - 200);
    };
    const mutationObserver = new MutationObserver(logMutations);
    mutationObserver.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeOldValue: true,
      characterData: true, characterDataOldValue: true,
    });
    // The digest also covers control values, which mutate without a DOM record.
    let lastControls = null;
    const logControls = () => {
      const controls = [...document.querySelectorAll('input, select, textarea')].filter((element) => !isProbe(element))
        .map((element) => ({ target: mutationPath(element), value: clip(JSON.stringify([element.value, element.checked,
          element instanceof HTMLSelectElement ? element.selectedIndex : null])) }));
      if (lastControls) {
        controls.forEach((control, index) => {
          const previous = lastControls[index];
          if (previous && previous.target === control.target && previous.value === control.value) return;
          mutationLog.push({ seq: ++mutationSeq, at: Date.now(), type: 'control', target: control.target,
            old: previous?.value ?? null, now: control.value });
        });
        if (lastControls.length > controls.length) {
          mutationLog.push({ seq: ++mutationSeq, at: Date.now(), type: 'control', target: 'controls',
            old: String(lastControls.length), now: String(controls.length) });
        }
      }
      lastControls = controls;
    };
    // Flushed synchronously immediately before the digest clones the document, so a sample's seq
    // and its digest describe the same moment.
    const mutationSnapshot = () => {
      logMutations(mutationObserver.takeRecords());
      logControls();
      if (mutationLog.length > 200) mutationLog.splice(0, mutationLog.length - 200);
      return { seq: mutationSeq, at: Date.now(), entries: mutationLog.slice(),
        sameValue: { total: sameValue.total, targets: { ...sameValue.targets } } };
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
          navigationOcclusions: window.__recapPassiveGuard.navigationOcclusions(),
          diagnostics: currentView === 'view-data'
            ? [...document.querySelectorAll('#view-data h3, #restore-copy-summary')]
              .map(element => window.__recapPassiveGuard.explain(element)) : [],
          focus: window.__recapPassiveGuard.focus(),
          mutations: mutationSnapshot(),
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

    private func record(_ name: String, _ value: [String: Any], summary: [String: Any]? = nil) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        let json = String(decoding: data, as: UTF8.self)
        let summaryData = try JSONSerialization.data(withJSONObject: summary ?? value, options: [.sortedKeys])
        print("RECAP_PROBE_RESULT \(name) \(String(decoding: summaryData, as: UTF8.self))")
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
            revealNativeTarget(element, in: app, bottomClearance: 44)
            XCTAssertTrue(container.frame.contains(element.frame), "the exact text stays within its named AX container")
            let proved = try acceptPassiveFinding(element, in: app, routeState: state)
            XCTAssertTrue(proved, "the reviewed positive requires the same exact native no-op proof: \(key)")
            try record("t03-passive-\(key)", [
                "dom": item, "nativeLabel": element.label,
                "nativeFrame": NSCoder.string(for: element.frame), "proved": proved,
            ], summary: ["key": key, "label": element.label, "proved": proved])
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

    private func domOwnerContainsNativeFrame(_ nativeFrame: CGRect, ownerFrame: CGRect,
                                            allowance: CGFloat) -> Bool {
        return ownerFrame.insetBy(dx: -allowance, dy: -allowance).contains(nativeFrame)
    }

    private func isBottomNavigationOcclusion(
        nativeCrop: CGRect, navigationFrame: CGRect, ownerFrame: CGRect,
        findingIsNavigation: Bool, samples: [[String: Any]]
    ) -> Bool {
        guard !findingIsNavigation, !nativeCrop.isEmpty, !nativeCrop.isInfinite,
              !navigationFrame.isEmpty, !navigationFrame.isInfinite,
              !ownerFrame.isEmpty, !ownerFrame.isInfinite,
              navigationFrame.contains(nativeCrop), ownerFrame.contains(nativeCrop),
              !samples.isEmpty else { return false }
        return samples.allSatisfy { sample in
            sample["inNavigation"] as? Bool == true
                && sample["ownerContains"] as? Bool == false
                && (sample["hit"] as? String)?.isEmpty == false
        }
    }

    private enum OcclusionMutant { case none, ignoresPassivity, ignoresReachability, ignoresNavigation }

    private static let nativeControlTypes: [XCUIElement.ElementType] = [
        .button, .link, .checkBox, .switch, .toggle, .radioButton, .radioGroup, .textField,
        .secureTextField, .searchField, .textView, .slider, .stepper, .picker, .pickerWheel,
        .datePicker, .segmentedControl, .menu, .menuItem, .menuButton, .menuBar, .menuBarItem,
        .popUpButton, .comboBox, .tab, .tabGroup, .incrementArrow, .decrementArrow, .colorWell,
        .disclosureTriangle, .keyboard, .key,
    ]

    private func nativeControlOwnsText(label: String, frame: CGRect, in app: XCUIApplication) -> Bool {
        let controls = app.webViews.firstMatch.descendants(matching: .any).matching(
            NSPredicate(format: "elementType IN %@", Self.nativeControlTypes.map { $0.rawValue }))
        for query in [controls.matching(NSPredicate(format: "label == %@", label)),
                      controls.containing(NSPredicate(format: "label == %@", label))] {
            if query.allElementsBoundByIndex.contains(where: { $0.exists && $0.frame.contains(frame) }) {
                return true
            }
        }
        return false
    }

    private func classifyBottomNavigationOcclusion(
        _ element: XCUIElement, in app: XCUIApplication, routeState: [String: Any],
        mutant: OcclusionMutant = .none
    ) throws -> Bool {
        func decline(_ reason: String) -> Bool {
            print("T03 occlusion classification declined \(element.label): \(reason)")
            return false
        }
        guard element.exists, element.elementType == .staticText else { return decline("not static text") }
        let label = element.label
        let nativeCrop = element.frame
        if nativeControlOwnsText(label: label, frame: nativeCrop, in: app) { return decline("native control") }
        let settled = try freshPassiveState(of: app)
        let before = try freshPassiveState(of: app)
        guard before["view"] as? String == routeState["view"] as? String,
              before["href"] as? String == routeState["href"] as? String,
              settled["view"] as? String == before["view"] as? String,
              settled["href"] as? String == before["href"] as? String,
              let proof = before["guard"] as? [String: Any], proof["valid"] as? Bool == true,
              let settledProof = settled["guard"] as? [String: Any], settledProof["valid"] as? Bool == true,
              let dom = proof["dom"] as? String, !dom.isEmpty, settledProof["dom"] as? String == dom,
              let evidence = proof["navigationOcclusions"] as? [String: Any],
              let settledEvidence = settledProof["navigationOcclusions"] as? [String: Any],
              NSDictionary(dictionary: evidence).isEqual(NSDictionary(dictionary: settledEvidence)),
              let viewport = (proof["viewportWidth"] as? NSNumber)?.doubleValue, viewport > 0,
              let navigationRect = evidence["rect"] as? [String: Any],
              let owners = evidence["owners"] as? [[String: Any]] else { return decline("route or proof") }
        let webFrame = app.webViews.firstMatch.frame
        let scale = webFrame.width / viewport
        func nativeRect(_ value: [String: Any]) -> CGRect? {
            guard let x = (value["x"] as? NSNumber)?.doubleValue,
                  let y = (value["y"] as? NSNumber)?.doubleValue,
                  let width = (value["width"] as? NSNumber)?.doubleValue,
                  let height = (value["height"] as? NSNumber)?.doubleValue,
                  [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
            return CGRect(x: webFrame.minX + x * scale, y: webFrame.minY + y * scale,
                          width: width * scale, height: height * scale)
        }
        guard webFrame.contains(nativeCrop), let navigationFrame = nativeRect(navigationRect) else {
            return decline("crop outside web view or no navigation frame")
        }
        var navigationFindings: [String: Bool] = [:]
        let matches = owners.filter { owner in
            guard owner["label"] as? String == label, let key = owner["key"] as? String,
                  let rect = owner["rect"] as? [String: Any], let ownerFrame = nativeRect(rect),
                  let navigationTexts = owner["navigationTexts"] as? [[String: Any]],
                  let samples = owner["samples"] as? [[String: Any]] else { return false }
            let navigationFrames = navigationTexts.compactMap(nativeRect)
            guard navigationFrames.count == navigationTexts.count else { return false }
            let findingIsNavigation = navigationFrames.contains { $0.intersects(nativeCrop) }
            navigationFindings[key] = findingIsNavigation
            print("T03 occlusion candidate \(key): crop \(NSCoder.string(for: nativeCrop)) owner \(NSCoder.string(for: ownerFrame)) navigation \(NSCoder.string(for: navigationFrame)) findingIsNavigation \(findingIsNavigation)")
            return isBottomNavigationOcclusion(nativeCrop: nativeCrop, navigationFrame: navigationFrame,
                ownerFrame: ownerFrame, findingIsNavigation: mutant == .ignoresNavigation ? false : findingIsNavigation,
                samples: samples)
        }
        guard matches.count == 1, let owner = matches.first, element.frame == nativeCrop,
              app.webViews.firstMatch.frame == webFrame else { return decline("\(matches.count) matching owners") }
        let passive = owner["passive"] as? Bool == true
        let reachability = owner["reachability"] as? [String: Any] ?? [:]
        let reachable = reachability["reachable"] as? Bool == true
        let ariaAbsent = ariaControlsAbsentFromNativeTree(owner, in: app)
        guard passive || mutant == .ignoresPassivity, reachable || mutant == .ignoresReachability,
              ariaAbsent else {
            try record("t03-bottom-navigation-occlusion-rejected", [
                "label": label, "nativeCrop": NSCoder.string(for: nativeCrop),
                "navigationFrame": NSCoder.string(for: navigationFrame), "owner": owner,
            ], summary: ["label": label, "passive": passive, "reachable": reachable,
                         "ariaControlsAbsent": ariaAbsent, "reachability": reachability])
            return false
        }
        let after = try freshPassiveState(of: app)
        let afterEvidence = (after["guard"] as? [String: Any])?["navigationOcclusions"] as? [String: Any]
        guard after["view"] as? String == before["view"] as? String,
              after["href"] as? String == before["href"] as? String,
              (after["guard"] as? [String: Any])?["dom"] as? String == dom,
              (afterEvidence?["scrollX"] as? NSNumber)?.doubleValue == (evidence["scrollX"] as? NSNumber)?.doubleValue,
              (afterEvidence?["scrollY"] as? NSNumber)?.doubleValue == (evidence["scrollY"] as? NSNumber)?.doubleValue,
              evidence["scrollY"] != nil else {
            try record("t03-bottom-navigation-occlusion-changed", ["before": before, "after": after])
            return false
        }
        try record("t03-bottom-navigation-occlusion", [
            "label": label, "nativeCrop": NSCoder.string(for: nativeCrop),
            "navigationFrame": NSCoder.string(for: navigationFrame),
            "webFrame": NSCoder.string(for: webFrame), "evidence": evidence, "owner": owner,
            "findingIsNavigation": navigationFindings[owner["key"] as? String ?? ""] ?? NSNull(),
            "mutant": "\(mutant)",
        ], summary: ["label": label, "nativeCrop": NSCoder.string(for: nativeCrop),
                     "navigationFrame": NSCoder.string(for: navigationFrame),
                     "samples": owner["samples"] ?? [], "passive": passive, "reachability": reachability,
                     "mutant": "\(mutant)"])
        return true
    }

    private func acceptPassiveFinding(
        _ element: XCUIElement, in app: XCUIApplication, routeState: [String: Any],
        checksDOMUnchanged: Bool = true
    ) throws -> Bool {
        lastTapWindow = nil
        guard element.exists, element.elementType == .staticText else { return false }
        let nativeLabel = element.label
        if nativeControlOwnsText(label: nativeLabel, frame: element.frame, in: app) {
            print("T03 passive guard rejected a native control's StaticText child: \(element.debugDescription)")
            return false
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
            guard candidate["label"] as? String == nativeLabel,
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
                  domOwnerContainsNativeFrame(nativeFrame, ownerFrame: domFrame, allowance: 2),
                  let point = points.first else { return nil }
            return (candidate, point)
        }
        guard matches.count == 1, let match = matches.first else {
            print("T03 passive guard rejected unmatched or ambiguous label/container/frame: \(element.debugDescription)")
            try record("t03-passive-guard-unmatched", [
                "label": nativeLabel, "nativeFrame": NSCoder.string(for: nativeFrame),
                "webFrame": NSCoder.string(for: webFrame),
                "matchingCandidates": candidates.filter { $0["label"] as? String == nativeLabel },
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
        let tapStart = Date().timeIntervalSince1970 * 1000
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: point.x, dy: point.y)).tap()
        let tapEnd = Date().timeIntervalSince1970 * 1000
        let after = try freshPassiveState(of: app)
        let window = tapWindow(before: before, after: after, tapStart: tapStart, tapEnd: tapEnd)
        lastTapWindow = window
        let afterMatches = ((after["guard"] as? [String: Any])?["candidates"] as? [[String: Any]] ?? [])
            .filter { $0["key"] as? String == key }
        guard after["view"] as? String == before["view"] as? String,
              after["href"] as? String == before["href"] as? String,
              let afterProof = after["guard"] as? [String: Any],
              afterProof["valid"] as? Bool == true,
              let dom = proof["dom"] as? String, !dom.isEmpty,
              afterProof["dom"] as? String == dom || !checksDOMUnchanged,
              afterProof["focus"] as? String == proof["focus"] as? String,
              afterMatches.count == 1,
              ariaControlsAbsentFromNativeTree(candidate, in: app),
              NSDictionary(dictionary: afterMatches[0]).isEqual(NSDictionary(dictionary: candidate)) else {
            try record("t03-passive-guard-rejected-tap", [
                "candidate": candidate, "nativeLabel": nativeLabel,
                "nativeFrame": NSCoder.string(for: nativeFrame),
                "nativeTapPoint": NSCoder.string(for: point),
                "beforeDOM": proof["dom"] ?? NSNull(),
                "afterDOM": (after["guard"] as? [String: Any])?["dom"] ?? NSNull(),
                "beforeFocus": proof["focus"] ?? NSNull(),
                "afterFocus": (after["guard"] as? [String: Any])?["focus"] ?? NSNull(),
                "beforeRoute": before["href"] ?? NSNull(), "afterRoute": after["href"] ?? NSNull(),
                "afterCandidates": afterMatches,
                "afterValid": (after["guard"] as? [String: Any])?["valid"] ?? NSNull(),
                "tapWindow": window,
            ], summary: [
                "key": key, "label": nativeLabel, "nativeFrame": NSCoder.string(for: nativeFrame),
                "domChanged": (after["guard"] as? [String: Any])?["dom"] as? String != proof["dom"] as? String,
                "focus": [proof["focus"] ?? NSNull(), (after["guard"] as? [String: Any])?["focus"] ?? NSNull()],
                "route": [before["href"] ?? NSNull(), after["href"] ?? NSNull()],
                "tapMutations": window["count"] ?? 0, "complete": window["complete"] ?? false,
                "sameValueRewrites": window["sameValueRewrites"] ?? 0,
                "diff": Array((window["diff"] as? [[String: Any]] ?? []).prefix(8)),
            ])
            return false
        }
        try record("t03-passive-guard", [
            "candidate": candidate, "nativeLabel": nativeLabel,
            "nativeFrame": NSCoder.string(for: nativeFrame), "before": before, "after": after,
            "nativeTapPoint": NSCoder.string(for: point), "tapWindow": window,
        ], summary: ["label": nativeLabel, "nativeFrame": NSCoder.string(for: nativeFrame),
                     "nativeTapPoint": NSCoder.string(for: point), "proved": true,
                     "tapMutations": window["count"] ?? 0, "complete": window["complete"] ?? false,
                     "sameValueRewrites": window["sameValueRewrites"] ?? 0,
                     "diff": Array((window["diff"] as? [[String: Any]] ?? []).prefix(8))])
        return true
    }

    /// Diagnostics only: the mutations sampled between the last pre-tap and first post-tap guard
    /// samples, timed relative to the native tap, plus a per-node before/after diff.
    private var lastTapWindow: [String: Any]?

    private func tapWindow(
        before: [String: Any], after: [String: Any], tapStart: Double, tapEnd: Double
    ) -> [String: Any] {
        let beforeLog = (before["guard"] as? [String: Any])?["mutations"] as? [String: Any] ?? [:]
        let afterLog = (after["guard"] as? [String: Any])?["mutations"] as? [String: Any] ?? [:]
        let beforeSeq = (beforeLog["seq"] as? NSNumber)?.intValue ?? -1
        let afterSeq = (afterLog["seq"] as? NSNumber)?.intValue ?? -1
        let entries: [[String: Any]] = (afterLog["entries"] as? [[String: Any]] ?? []).compactMap { entry in
            guard let seq = (entry["seq"] as? NSNumber)?.intValue, seq > beforeSeq else { return nil }
            var timed = entry
            if let at = (entry["at"] as? NSNumber)?.doubleValue { timed["relativeMs"] = Int((at - tapStart).rounded()) }
            return timed
        }
        var order: [String] = []
        var nodes: [String: [String: Any]] = [:]
        for entry in entries {
            let type = entry["type"] as? String ?? ""
            let target = entry["target"] as? String ?? ""
            let id = "\(type)|\(target)|\(entry["attribute"] as? String ?? "")"
            if var node = nodes[id] {
                node["now"] = entry["now"] ?? NSNull()
                node["records"] = ((node["records"] as? Int) ?? 1) + 1
                node["lastMs"] = entry["relativeMs"] ?? NSNull()
                if type == "childList" {
                    node["added"] = ((node["added"] as? Int) ?? 0) + ((entry["addedCount"] as? NSNumber)?.intValue ?? 0)
                    node["removed"] = ((node["removed"] as? Int) ?? 0) + ((entry["removedCount"] as? NSNumber)?.intValue ?? 0)
                }
                nodes[id] = node
            } else {
                order.append(id)
                var node: [String: Any] = ["type": type, "target": target, "records": 1,
                                           "firstMs": entry["relativeMs"] ?? NSNull(),
                                           "lastMs": entry["relativeMs"] ?? NSNull()]
                if let attribute = entry["attribute"] { node["attribute"] = attribute }
                if type == "childList" {
                    node["added"] = (entry["addedCount"] as? NSNumber)?.intValue ?? 0
                    node["removed"] = (entry["removedCount"] as? NSNumber)?.intValue ?? 0
                    node["sample"] = ["added": entry["added"] ?? [String](), "removed": entry["removed"] ?? [String]()]
                } else {
                    node["old"] = entry["old"] ?? NSNull()
                    node["now"] = entry["now"] ?? NSNull()
                }
                nodes[id] = node
            }
        }
        let beforeSame = beforeLog["sameValue"] as? [String: Any] ?? [:]
        let afterSame = afterLog["sameValue"] as? [String: Any] ?? [:]
        let beforeTargets = beforeSame["targets"] as? [String: NSNumber] ?? [:]
        let afterTargets = afterSame["targets"] as? [String: NSNumber] ?? [:]
        var sameDeltas: [(String, Int)] = []
        for (key, value) in afterTargets {
            let delta: Int = value.intValue - (beforeTargets[key]?.intValue ?? 0)
            if delta > 0 { sameDeltas.append((key, delta)) }
        }
        sameDeltas.sort { lhs, rhs in lhs.1 != rhs.1 ? lhs.1 > rhs.1 : lhs.0 < rhs.0 }
        var sameTargetList: [[String: Int]] = []
        for (key, delta) in sameDeltas.prefix(8) { sameTargetList.append([key: delta]) }
        let afterSameTotal: Int = (afterSame["total"] as? NSNumber)?.intValue ?? 0
        let beforeSameTotal: Int = (beforeSame["total"] as? NSNumber)?.intValue ?? 0
        let count: Int = max(0, afterSeq - beforeSeq)
        var window: [String: Any] = [:]
        window["beforeSeq"] = beforeSeq
        window["afterSeq"] = afterSeq
        window["count"] = count
        window["complete"] = beforeSeq >= 0 && entries.count == count
        window["sameValueRewrites"] = afterSameTotal - beforeSameTotal
        window["sameValueTargets"] = sameTargetList
        window["tapDurationMs"] = Int((tapEnd - tapStart).rounded())
        let beforeAt: Double? = (beforeLog["at"] as? NSNumber)?.doubleValue
        let afterAt: Double? = (afterLog["at"] as? NSNumber)?.doubleValue
        window["beforeSampleMs"] = beforeAt.map { Int(($0 - tapStart).rounded()) as Any } ?? NSNull()
        window["afterSampleMs"] = afterAt.map { Int(($0 - tapStart).rounded()) as Any } ?? NSNull()
        window["entries"] = entries
        window["diff"] = order.compactMap { nodes[$0] }
        return window
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
                            if try self.classifyBottomNavigationOcclusion(element, in: app, routeState: routeState) {
                                print("T03 classified a bottom-navigation-obscured hitRegion finding")
                                return true
                            }
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
                try record("t03-accessibility-retry", ["attempt": attempt + 2, "state": retryState],
                           summary: ["attempt": attempt + 2, "route": retryState["href"] ?? NSNull(),
                                     "view": retryState["view"] ?? NSNull(), "tick": retryState["tick"] ?? NSNull()])
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
        let measuredCrop = CGRect(x: 29, y: 766, width: 332, height: 10)
        let navigationFrame = CGRect(x: 0, y: 760, width: 390, height: 84)
        let occludedOwner = CGRect(x: 29, y: 766, width: 332, height: 30)
        let navigationSamples: [[String: Any]] = [
            ["inNavigation": true, "ownerContains": false, "hit": "#sidebar > div:nth-child(1) > a:nth-child(2)"],
        ]
        let ownerSamples: [[String: Any]] = [
            ["inNavigation": true, "ownerContains": true, "hit": "#sidebar > div:nth-child(1) > a:nth-child(2)"],
        ]
        let aboveNavigation = CGRect(x: 29, y: navigationFrame.minY - 1, width: 332, height: 10)
        let fixtureOwner = CGRect(x: 29, y: aboveNavigation.minY, width: 332, height: 40)
        let occlusionFixtures: [(String, CGRect, CGRect, Bool, [[String: Any]])] = [
            ("above-navigation", aboveNavigation, fixtureOwner, false, navigationSamples),
            ("owner-hit", measuredCrop, occludedOwner, false, ownerSamples),
        ]
        XCTAssertTrue(isBottomNavigationOcclusion(nativeCrop: measuredCrop, navigationFrame: navigationFrame,
            ownerFrame: occludedOwner, findingIsNavigation: false, samples: navigationSamples))
        var occlusionResults: [[String: Any]] = []
        do {
            let previousContinuation = continueAfterFailure
            continueAfterFailure = true
            defer { continueAfterFailure = previousContinuation }
            let options = XCTExpectedFailure.Options()
            options.isStrict = true
            options.issueMatcher = { issue in
                issue.type == .assertionFailure && issue.compactDescription.contains("occlusion-mutant")
            }
            for (name, crop, owner, isNavigation, samples) in occlusionFixtures {
                let accepted = isBottomNavigationOcclusion(nativeCrop: crop, navigationFrame: navigationFrame,
                    ownerFrame: owner, findingIsNavigation: isNavigation, samples: samples)
                XCTAssertFalse(accepted, "\(name) must not be classified")
                XCTExpectFailure("Ignoring the \(name) evidence loses its rejection", options: options) {
                    let expandedNavigation = name == "above-navigation"
                        ? navigationFrame.insetBy(dx: 0, dy: -1) : navigationFrame
                    XCTAssertFalse(self.isBottomNavigationOcclusion(
                        nativeCrop: crop, navigationFrame: expandedNavigation, ownerFrame: owner,
                        findingIsNavigation: false, samples: navigationSamples), "occlusion-mutant: \(name)")
                }
                occlusionResults.append(["name": name, "nativeCrop": NSCoder.string(for: crop),
                                         "accepted": accepted])
            }
        }
        try record("t03-bottom-navigation-fixtures", [
            "measuredCrop": NSCoder.string(for: measuredCrop),
            "syntheticNavigationFrame": NSCoder.string(for: navigationFrame),
            "measuredCropAccepted": true, "negatives": occlusionResults,
        ])
        let owner = CGRect(x: 29, y: 316.453125 + 20, width: 40.55377197265625, height: 76)
        let measured = CGRect(x: 29, y: 336, width: 41, height: 78)
        XCTAssertTrue(domOwnerContainsNativeFrame(measured, ownerFrame: owner, allowance: 2))
        do {
            let previousContinuation = continueAfterFailure
            continueAfterFailure = true
            defer { continueAfterFailure = previousContinuation }
            let mutationOptions = XCTExpectedFailure.Options()
            mutationOptions.isStrict = true
            mutationOptions.issueMatcher = { issue in
                issue.type == .assertionFailure && issue.compactDescription.contains("owner-bound-mutant")
            }
            XCTExpectFailure("The old one-point bound rejects the measured SE frame", options: mutationOptions) {
                XCTAssertTrue(self.domOwnerContainsNativeFrame(measured, ownerFrame: owner, allowance: 1),
                              "owner-bound-mutant: measured SE acceptance")
            }
            let beyond = CGFloat(2.001)
            let outside = [
                ("left", CGRect(x: owner.minX - beyond, y: owner.minY,
                                width: owner.width + beyond, height: owner.height)),
                ("right", CGRect(x: owner.minX, y: owner.minY,
                                 width: owner.width + beyond, height: owner.height)),
                ("top", CGRect(x: owner.minX, y: owner.minY - beyond,
                               width: owner.width, height: owner.height + beyond)),
                ("bottom", CGRect(x: owner.minX, y: owner.minY,
                                  width: owner.width, height: owner.height + beyond)),
            ]
            var boundaries: [[String: Any]] = []
            for (edge, frame) in outside {
                let accepted = domOwnerContainsNativeFrame(frame, ownerFrame: owner, allowance: 2)
                XCTAssertFalse(accepted, "\(edge) beyond two points must fail")
                XCTExpectFailure("An oversized bound misses the \(edge) rejection", options: mutationOptions) {
                    XCTAssertFalse(self.domOwnerContainsNativeFrame(frame, ownerFrame: owner, allowance: 3),
                                   "owner-bound-mutant: \(edge) rejection")
                }
                boundaries.append(["edge": edge, "frame": NSCoder.string(for: frame), "accepted": accepted])
            }
            try record("t03-native-owner-boundary", [
                "ownerFrame": NSCoder.string(for: owner), "nativeFrame": NSCoder.string(for: measured),
                "bottomExcess": measured.maxY - owner.maxY,
                "oldOnePointAccepted": domOwnerContainsNativeFrame(measured, ownerFrame: owner, allowance: 1),
                "measuredAccepted": domOwnerContainsNativeFrame(measured, ownerFrame: owner, allowance: 2),
                "boundaries": boundaries,
            ])
        }
        let app = launch(route: "guard-structural")
        let result = try probeResult(of: app)
        let fixtures = try XCTUnwrap(result["guardFixtures"] as? [[String: Any]])
        XCTAssertEqual(fixtures.count, 14)
        try record("t03-guard-negative-fixtures", ["fixtures": fixtures])
        let positives = ["plain positive", "duplicate first", "duplicate second"]
        for fixture in fixtures {
            let name = try XCTUnwrap(fixture["name"] as? String)
            if fixture["accepted"] != nil {
                XCTAssertEqual(fixture["accepted"] as? Bool, true, name)
            } else if fixture["rejected"] != nil {
                XCTAssertEqual(fixture["rejected"] as? Bool, true, name)
            } else {
                XCTAssertEqual(fixture["passive"] as? Bool, positives.contains(name), name)
            }
        }
        app.terminate()
        let propertyApp = launch(route: "guard-global-property")
        let propertyResult = try probeResult(of: propertyApp)
        let propertyFixtures = try XCTUnwrap(propertyResult["guardFixtures"] as? [[String: Any]])
        XCTAssertEqual(propertyFixtures.count, 1)
        let property = try XCTUnwrap(propertyFixtures.first)
        try record("t03-guard-property-history", ["fixture": property])
        XCTAssertEqual(property["beforeValid"] as? Bool, true, "the fresh fixture starts with reviewed globals")
        XCTAssertEqual(property["handlerPreserved"] as? Bool, true, "the native setter retains handler identity")
        XCTAssertEqual(property["calls"] as? Int, 1, "the handler runs once and removal prevents a second call")
        XCTAssertEqual(property["installedValid"] as? Bool, false, "an assigned global property rejects")
        XCTAssertEqual(property["afterRemovalValid"] as? Bool, false, "removal cannot review a handler")
        XCTAssertEqual(property["rejected"] as? Bool, true, "removed global properties still reject every node")
        propertyApp.terminate()
    }

    func testBottomNavigationOcclusionRejectsLiveInteractiveLabelUnreachableAndNavigationOwners() throws {
        if UIDevice.current.userInterfaceIdiom == .pad {
            throw XCTSkip("iPad keeps navigation in the sidebar, so no text sits under a bottom bar")
        }
        let app = launch(route: "guard-occlusion")
        let result = try probeResult(of: app)
        let fixtures = try XCTUnwrap(result["guardFixtures"] as? [[String: Any]])
        XCTAssertEqual(fixtures.count, 1)
        try record("t03-occlusion-live-fixtures", ["fixtures": fixtures])
        let routeState = try freshPassiveState(of: app)
        func texts(_ label: String) -> [XCUIElement] {
            let query = app.webViews.firstMatch.staticTexts.matching(NSPredicate(format: "label == %@", label))
            _ = query.firstMatch.waitForExistence(timeout: 30)
            return query.allElementsBoundByIndex
        }
        var nativeFrames: [String: [String]] = [:]
        for label in ["Occ plain", "Occ click", "Occ label", "Occ nav", "Occ fixed"] {
            nativeFrames[label] = texts(label).map { NSCoder.string(for: $0.frame) }
        }
        try record("t03-occlusion-live-native", ["nativeFrames": nativeFrames,
                                                 "webFrame": NSCoder.string(for: app.webViews.firstMatch.frame)])
        let plain = texts("Occ plain")
        XCTAssertEqual(plain.count, 1, "the positive owner has one native text")
        XCTAssertTrue(try classifyBottomNavigationOcclusion(plain[0], in: app, routeState: routeState),
                      "plain passive reachable text under the bar classifies")
        let negatives: [(String, String, OcclusionMutant)] = [
            ("interactive owner", "Occ click", .ignoresPassivity),
            ("label-linked owner", "Occ label", .ignoresPassivity),
            ("unreachable owner", "Occ fixed", .ignoresReachability),
            ("navigation finding", "Occ nav", .ignoresNavigation),
        ]
        var outcomes: [[String: Any]] = []
        let previousContinuation = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previousContinuation }
        let options = XCTExpectedFailure.Options()
        options.isStrict = true
        options.issueMatcher = { issue in
            issue.type == .assertionFailure && issue.compactDescription.contains("occlusion-mutant")
        }
        for (name, label, mutant) in negatives {
            let elements = texts(label)
            XCTAssertFalse(elements.isEmpty, "\(name) has native text to classify")
            var accepted: [Bool] = []
            for element in elements {
                accepted.append(try classifyBottomNavigationOcclusion(element, in: app, routeState: routeState))
            }
            XCTAssertFalse(accepted.contains(true), "\(name) must not be classified")
            // Measured on the iOS 18 iPhone SE at fd75442b: the native tree exposes the label's text
            // as part of a control, so the every-control-type exclusion rejects it before passivity
            // runs and a passivity mutant cannot be observed there. Only the label-linked case may
            // stop at that guard; the newest runtime still proves its passivity rejection.
            let controlOwned = elements.allSatisfy { nativeControlOwnsText(label: $0.label, frame: $0.frame, in: app) }
            if controlOwned {
                XCTAssertEqual(mutant, .ignoresPassivity, "\(name) must reach its own guard, not the control exclusion")
                XCTAssertEqual(label, "Occ label", "\(name) must reach its own guard, not the control exclusion")
                outcomes.append(["name": name, "label": label, "mutant": "\(mutant)",
                                 "nativeTexts": elements.count, "accepted": accepted,
                                 "rejectedBy": "native-control"])
                continue
            }
            XCTExpectFailure("Ignoring the \(name) evidence loses its rejection", options: options) {
                let mutated = elements.contains { element in
                    (try? self.classifyBottomNavigationOcclusion(
                        element, in: app, routeState: routeState, mutant: mutant)) ?? false
                }
                XCTAssertFalse(mutated, "occlusion-mutant: \(name)")
            }
            outcomes.append(["name": name, "label": label, "mutant": "\(mutant)",
                             "nativeTexts": elements.count, "accepted": accepted,
                             "rejectedBy": "\(mutant)"])
        }
        let after = try freshPassiveState(of: app)
        let beforeProof = try XCTUnwrap(routeState["guard"] as? [String: Any])
        let afterProof = try XCTUnwrap(after["guard"] as? [String: Any])
        let beforeEvidence = try XCTUnwrap(beforeProof["navigationOcclusions"] as? [String: Any])
        let afterEvidence = try XCTUnwrap(afterProof["navigationOcclusions"] as? [String: Any])
        XCTAssertEqual(after["href"] as? String, routeState["href"] as? String)
        XCTAssertEqual(afterProof["dom"] as? String, beforeProof["dom"] as? String)
        XCTAssertEqual((afterEvidence["scrollY"] as? NSNumber)?.doubleValue,
                       (beforeEvidence["scrollY"] as? NSNumber)?.doubleValue)
        try record("t03-occlusion-live-negatives", ["outcomes": outcomes])
        app.terminate()
    }

    func testPassiveGuardRejectsReviewedPointerdownThatChangesThePage() throws {
        let app = launch(route: "guard-reviewed-pointer")
        let result = try probeResult(of: app)
        let fixtures = try XCTUnwrap(result["guardFixtures"] as? [[String: Any]])
        let reviewed = try XCTUnwrap(fixtures.first { $0["name"] as? String == "reviewed pointerdown" })
        XCTAssertEqual(reviewed["open"] as? Bool, true, "the reviewed handler has an open menu to close")
        XCTAssertEqual(reviewed["globalValid"] as? Bool, true, "only reviewed page-wide handlers are present")
        XCTAssertEqual(reviewed["passive"] as? Bool, true, "the static proof alone accepts the text")
        let element = app.webViews.firstMatch.staticTexts.matching(
            NSPredicate(format: "label == %@", "Guard tap text")).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 30))
        let before = try freshPassiveState(of: app)
        XCTAssertEqual((before["guard"] as? [String: Any])?["valid"] as? Bool, true)
        let accepted = try acceptPassiveFinding(element, in: app, routeState: before)
        XCTAssertFalse(accepted, "a reviewed pointerdown that closes a menu changes the page")
        let window = try XCTUnwrap(lastTapWindow, "the rejected tap recorded its mutation window")
        XCTAssertEqual(window["complete"] as? Bool, true, "the tap window kept every changing record")
        let diff = window["diff"] as? [[String: Any]] ?? []
        XCTAssertTrue(diff.contains {
            $0["type"] as? String == "attributes" && $0["attribute"] as? String == "open"
                && ($0["target"] as? String)?.hasSuffix("#home-updates") == true
                && $0["now"] is NSNull && $0["old"] as? String == ""
        }, "the tap-window diagnostic names the menu closing: \(diff)")
        let after = try freshPassiveState(of: app)
        let beforeDOM = try XCTUnwrap((before["guard"] as? [String: Any])?["dom"] as? String)
        let afterDOM = try XCTUnwrap((after["guard"] as? [String: Any])?["dom"] as? String)
        XCTAssertNotEqual(beforeDOM, afterDOM, "the native tap actually closed the menu")
        try record("t03-guard-reviewed-pointer", ["fixtures": fixtures, "before": before, "after": after])
        app.terminate()
        let mutantApp = launch(route: "guard-reviewed-pointer")
        _ = try probeResult(of: mutantApp)
        let mutantElement = mutantApp.webViews.firstMatch.staticTexts.matching(
            NSPredicate(format: "label == %@", "Guard tap text")).firstMatch
        XCTAssertTrue(mutantElement.waitForExistence(timeout: 30))
        let mutantBefore = try freshPassiveState(of: mutantApp)
        let previousContinuation = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previousContinuation }
        let options = XCTExpectedFailure.Options()
        options.isStrict = true
        options.issueMatcher = { issue in
            issue.type == .assertionFailure && issue.compactDescription.contains("pointer-mutant")
        }
        XCTExpectFailure("Without the no-change comparison the reviewed pointerdown passes", options: options) {
            let mutated = (try? self.acceptPassiveFinding(
                mutantElement, in: mutantApp, routeState: mutantBefore, checksDOMUnchanged: false)) ?? false
            XCTAssertFalse(mutated, "pointer-mutant: reviewed pointerdown")
        }
        mutantApp.terminate()
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
            let close = app.buttons["ios-read-sheet-close"]
            let closeReady = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == true AND hittable == true"), object: close)
            XCTAssertEqual(XCTWaiter.wait(for: [closeReady], timeout: 30), .completed)
            try record("t03-read-close-before-\(category.rawValue)", [
                "exists": close.exists, "hittable": close.isHittable,
                "frame": NSCoder.string(for: close.frame), "events": closeRecorder.label,
            ])
            close.tap()
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
