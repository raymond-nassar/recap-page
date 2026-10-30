#if DEBUG
import UIKit
import WebKit

/// Test-only surfaces, compiled into Debug builds alone. A repository test fails if any part of this
/// file, or any use of it elsewhere, can reach a Release build.
enum DebugSupport {
    static let probeScriptKey = "RECAP_PROBE_SCRIPT"
    static let isolateRequestsKey = "RECAP_ISOLATE_REQUESTS"
    static let exportPickerOutcomeKey = "RECAP_IOS_EXPORT_PICKER"
    static let unreadableRecoveryKey = "RECAP_IOS_UNREADABLE_RECOVERY"
    static let restoreTestSeedKey = "RECAP_IOS_RESTORE_TEST_SEED"
    static let presentationTestSeedKey = "RECAP_IOS_PRESENTATION_TEST_SEED"
    static let readHandoffTestKey = "RECAP_IOS_READ_HANDOFF_TEST"
    static let recordHandOffsKey = "RECAP_IOS_RECORD_HANDOFFS"
    static let liveCorsCheckKey = "RECAP_IOS_LIVE_CORS_CHECK"
    static let dataLossStateResetKey = "RECAP_IOS_DATA_LOSS_RESET"
    static let clearReadingDataKey = "RECAP_IOS_CLEAR_READING_DATA"
    static let failFifthJournalPutKey = "RECAP_IOS_FAIL_FIFTH_JOURNAL_PUT"
    static let probeResultIdentifier = "recap-probe-result"
    static let handOffRecorderIdentifier = "ios-handoff-recorder"

    private static var environment: [String: String] {
        ProcessInfo.processInfo.environment
    }

    /// True while the app hosts the unit tests, which build their own web views.
    static var isHostingUnitTests: Bool {
        environment["XCTestConfigurationFilePath"] != nil
    }

    /// No test run may reach a third party, so unit tests and UI tests both isolate.
    static var isolatesRequests: Bool {
        if environment[liveCorsCheckKey] == "1" { return false }
        return isHostingUnitTests || environment[isolateRequestsKey] == "1"
    }

    static var exportPickerOutcome: ExportPickerOutcome? {
        switch environment[exportPickerOutcomeKey] {
        case "confirm": return .saved
        case "cancel": return .cancelled
        case "fail": return .failed("The Files provider refused the export.")
        default: return nil
        }
    }

    static var seedsUnreadableRecovery: Bool {
        environment[unreadableRecoveryKey] == "1"
    }

    static var seedsRestoreTest: Bool {
        environment[restoreTestSeedKey] == "1"
    }

    static var seedsPresentationTest: Bool {
        environment[presentationTestSeedKey] == "1"
    }

    static var readHandoffTestEnabled: Bool {
        environment[readHandoffTestKey] == "1"
    }

    static var recordsHandOffs: Bool {
        environment[recordHandOffsKey] == "1"
    }

    static var readSheetStyleProbeEnabled: Bool {
        readHandoffTestEnabled && recordsHandOffs
    }

    static var resetsDataLossState: Bool {
        environment[dataLossStateResetKey] == "1"
    }

    static var clearsReadingData: Bool {
        environment[clearReadingDataKey] == "1"
    }

    static var failsFifthJournalPut: Bool {
        environment[failFifthJournalPutKey] == "1"
    }

    static let passiveAuditTrackingScript = #"""
    (() => {
      const observedType = /^(?:click|dblclick|auxclick|contextmenu|mouse.*|pointer.*|touch.*|key.*)$/;
      const registrations = new WeakMap();
      const globals = [];
      let unreviewedGlobalEver = false;
      const originalAdd = EventTarget.prototype.addEventListener;
      const originalRemove = EventTarget.prototype.removeEventListener;
      const optionsOf = (options) => ({
        capture: typeof options === 'boolean' ? options : Boolean(options?.capture),
        passive: typeof options === 'object' && options?.passive != null ? Boolean(options.passive) : null,
        once: typeof options === 'object' ? Boolean(options?.once) : false,
      });
      const registeringSource = (stack) => {
        for (const line of stack.split('\n')) {
          if (line.includes('addEventListener')) continue;
          const match = line.match(/([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s)]+):\d+:\d+\)?$/);
          if (!match) continue;
          const script = new URL(match[1]);
          if (script.origin !== location.origin) return { script: script.href, enclosingFunction: '' };
          const prefix = line.slice(0, match.index).trim().replace(/^at\s+/, '').replace(/\s*\($/, '');
          const enclosingFunction = prefix.replace(/^Object\./, '').replace(/@$/, '');
          return { script: script.pathname, enclosingFunction };
        }
        return { script: '', enclosingFunction: '' };
      };
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (listener && observedType.test(type) && !options?.signal?.aborted) {
          const optionsRecord = optionsOf(options);
          const entries = registrations.get(this) || [];
          if (!entries.some(entry => !entry.removed && !entry.signal?.aborted
            && entry.type === type && entry.listener === listener
            && entry.capture === optionsRecord.capture)) {
            const stack = new Error().stack || '';
            const entry = { type, listener, ...optionsRecord, ...registeringSource(stack), stack,
              target: this === document ? 'document' : this === window ? 'window' : 'element',
              signal: options?.signal };
            entries.push(entry);
            registrations.set(this, entries);
            if (entry.target !== 'element') {
              globals.push(entry);
              if (!approved.includes(identity(entry))) unreviewedGlobalEver = true;
            }
          }
        }
        return originalAdd.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function(type, listener, options) {
        const capture = optionsOf(options).capture;
        const entry = (registrations.get(this) || []).find(entry =>
          entry.type === type && entry.listener === listener && entry.capture === capture && !entry.removed);
        if (entry) entry.removed = true;
        return originalRemove.call(this, type, listener, options);
      };
      const active = entry => !entry.removed && !entry.signal?.aborted;
      const identity = entry => JSON.stringify([
        entry.type, entry.target, entry.capture, entry.passive, entry.once,
        entry.script, entry.enclosingFunction,
      ]);
      const approved = [
        ['pointerdown', true, true, '/js/views/rated-comics.js', 'createRatedComicsView'],
        ['keydown', true, true, '/js/views/rated-comics.js', 'createRatedComicsView'],
        ['touchmove', true, true, '/js/views/rated-comics.js', 'createRatedComicsView'],
        ['pointerdown', true, null, '/mobile/mobile-ui.js', 'wireMobileUi'],
        ['keydown', true, null, '/mobile/mobile-ui.js', 'wireMobileUi'],
        ['keydown', true, null, '/js/views/home-updates.js', 'wire'],
        ['pointerdown', false, null, '/js/views/home-updates.js', 'wire'],
        ['keydown', true, null, '/js/lib/tooltips.js', 'wireTooltips'],
        ['pointerover', false, null, '/js/lib/tooltips.js', 'wireTooltips'],
        ['pointerout', false, null, '/js/lib/tooltips.js', 'wireTooltips'],
        ['pointermove', false, null, '/js/lib/tooltips.js', 'wireTooltips'],
        ['keydown', false, null, '/js/main.js', 'wireSidebar'],
        ['keydown', false, null, '/js/views/reading.js', 'wireShortcuts'],
      ].map(([type, capture, passive, script, enclosingFunction]) =>
        identity({ type, target: 'document', capture, passive, once: false, script, enclosingFunction })).sort();
      const inventory = () => globals.filter(active).map(entry => ({
        type: entry.type, target: entry.target, capture: entry.capture, passive: entry.passive,
        once: entry.once, script: entry.script, enclosingFunction: entry.enclosingFunction,
        stack: entry.stack,
      }));
      const propertyHandlers = target => {
        const names = new Set();
        for (let prototype = target; prototype; prototype = Object.getPrototypeOf(prototype)) {
          for (const name of Object.getOwnPropertyNames(prototype)) {
            if (name.startsWith('on') && observedType.test(name.slice(2))) names.add(name);
          }
        }
        return [...names].some(name => typeof target[name] === 'function');
      };
      const globalInventoryValid = () => !unreviewedGlobalEver
        && !propertyHandlers(document) && !propertyHandlers(window)
        && JSON.stringify(globals.filter(active).map(identity).sort()) === JSON.stringify(approved);
      const interactive = [
        'a[href]', 'area[href]', 'button', 'summary', 'input', 'select', 'textarea', 'label',
        'audio[controls]', 'video[controls]', 'iframe', 'object', 'embed',
        '[tabindex]', '[contenteditable]:not([contenteditable="false"])',
      ].join(',');
      const passiveRoles = new Set([
        '', 'none', 'presentation', 'heading', 'navigation', 'complementary', 'main', 'region',
        'status', 'paragraph', 'generic', 'list', 'listitem', 'group', 'note',
      ]);
      const hasHandler = element => (registrations.get(element) || []).some(active)
        || Object.getOwnPropertyNames(HTMLElement.prototype).filter(name => /^on/.test(name)
          && observedType.test(name.slice(2))).some(name => typeof element[name] === 'function')
        || [...element.attributes].some(attribute =>
          attribute.name.startsWith('on') && observedType.test(attribute.name.slice(2)));
      const safeElement = element => !element.matches(interactive) && !element.isContentEditable
        && !element.labels?.length && passiveRoles.has((element.getAttribute('role') || '').toLowerCase())
        && (!element.id || !document.querySelector(`label[for="${CSS.escape(element.id)}"]`))
        && (!element.id || ![...document.querySelectorAll('[aria-labelledby]')].some(control =>
          (control.matches(interactive) || !passiveRoles.has((control.getAttribute('role') || '').toLowerCase()))
          && control.getAttribute('aria-labelledby').split(/\s+/).includes(element.id)))
        && !hasHandler(element);
      const visible = element => {
        if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
          const closed = node.parentElement?.closest('details:not([open])');
          if (closed && !closed.querySelector(':scope > summary')?.contains(element)) return false;
        }
        return element.getClientRects().length > 0;
      };
      const passiveDom = element => {
        if (!visible(element)) return false;
        for (let node = element; node; node = node.parentElement) if (!safeElement(node)) return false;
        return [...element.querySelectorAll('*')].every(safeElement);
      };
      const passive = element => globalInventoryValid() && passiveDom(element);
      const path = element => {
        const parts = [];
        for (let node = element; node; node = node.parentElement) {
          if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
          const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
          parts.unshift(`${node.localName}:nth-child(${index})`);
        }
        return parts.join(' > ');
      };
      const labelOf = (text, element) => {
        const value = text.trim().replace(/\s+/g, ' ');
        return getComputedStyle(element).textTransform === 'uppercase' ? value.toUpperCase() : value;
      };
      const candidates = () => {
        if (!globalInventoryValid()) return [];
        const root = document.querySelector('.view:not([hidden])');
        if (!root) return [];
        const roots = [root, document.getElementById('sidebar-nav')].filter(Boolean);
        const found = [];
        for (const container of roots) {
          for (const element of [container, ...container.querySelectorAll('*')]) {
            if (element.closest('[id^="recap-"]') || !passiveDom(element)) continue;
            const texts = [...element.childNodes].filter(node =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            for (const text of texts) {
              const range = document.createRange();
              range.selectNodeContents(text);
              const rect = texts.length === 1 && element.children.length === 0
                ? element.getBoundingClientRect() : range.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
              const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
              if (right <= left || bottom <= top) continue;
              const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
              found.push({ key: `${path(element)}:text:${[...element.childNodes].indexOf(text)}`,
                selector: path(element), container: container.id, label: labelOf(text.textContent, element),
                hitSafe: Boolean(hit && element.contains(hit) && passiveDom(hit)),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
            }
          }
        }
        return found.filter(candidate => candidate.hitSafe && !found.some(other => other !== candidate
          && other.label === candidate.label && other.container === candidate.container
          && other.rect.x < candidate.rect.x + candidate.rect.width
          && candidate.rect.x < other.rect.x + other.rect.width
          && other.rect.y < candidate.rect.y + candidate.rect.height
          && candidate.rect.y < other.rect.y + other.rect.height));
      };
      const domDigest = async () => {
        const clone = document.documentElement.cloneNode(true);
        for (const probe of clone.querySelectorAll('[id^="recap-"], [data-recap-passive-monitor]')) probe.remove();
        const controls = [...document.querySelectorAll('input, select, textarea, details')].map(element => ({
          path: path(element), value: element.value, checked: element.checked, open: element.open,
          selected: element instanceof HTMLSelectElement ? [...element.options].map(option => option.selected) : null,
        }));
        const bytes = new TextEncoder().encode(JSON.stringify({ html: clone.outerHTML, controls }));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      };
      window.__recapPassiveGuard = Object.freeze({
        candidates, passive, inventory, globalInventoryValid, domDigest,
        focus: () => document.activeElement ? path(document.activeElement) : null,
      });
    })();
    """#

    static let failFifthJournalPutScript = """
    (() => {
      const originalPut = IDBObjectStore.prototype.put;
      let journalPuts = 0;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'journal') journalPuts += 1;
        if (this.name === 'journal' && journalPuts === 5) {
          throw new DOMException('Injected journal failure', 'UnknownError');
        }
        return originalPut.apply(this, args);
      };
    })();
    """

    static let readHandoffTestScript = #"""
    (() => {
      const addButtons = () => {
        for (const [label, suffix] of [['Open Read test', ''], ['Open failing Read test', '&recapTestFail=1']]) {
          if (location.pathname !== '/open.html') {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `recap-ios-${suffix ? 'failing-' : ''}read-test`;
            button.textContent = label;
            button.addEventListener('click', () => {
              window.open(`${location.origin}/open.html?i=6482&t=Read%20test${suffix}`, '_blank', 'noopener');
            });
            document.body.prepend(button);
          }
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons, { once: true });
      else addButtons();

      if (new URLSearchParams(location.search).has('recapTestFail')) {
        const schedule = window.setTimeout.bind(window);
        window.setTimeout = (handler, delay, ...args) =>
          delay === 1400 ? 0 : schedule(handler, delay, ...args);
      }

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const requestUrl = typeof input === 'string' || input instanceof URL ? input : input.url;
        const url = new URL(requestUrl, location.href);
        if (url.pathname.endsWith('/issues/6482')) {
          if (new URLSearchParams(location.search).has('recapTestFail')) {
            return new Response('unavailable', { status: 503 });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return new Response(JSON.stringify({ digitalId: '987654321' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };
    })();
    """#

    static let unreadableRecoveryScript = """
    const originalSetItem = Storage.prototype.setItem.bind(localStorage);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'mrt.state.salvage' || key.startsWith('mrt.state.salvage.')) {
        throw new DOMException('Injected storage quota failure', 'QuotaExceededError');
      }
      return originalSetItem(key, value);
    };
    localStorage.setItem('mrt.state.v2', '{unreadable');
    localStorage.removeItem('mrt.state.salvage');
    """

    static let presentationTestSeedScript = """
    localStorage.setItem('mrt.state.v2', JSON.stringify({
      schemaVersion: 4, issues: {}, read: {}, overrides: {}, notes: {}, ratings: {},
      lists: {
        'ios-presentation': {
          id: 'ios-presentation', name: 'iOS presentation fixture', description: '', note: '',
          created: 1, catalogId: null, itemIds: [], collectedIn: {}, deferredIssueIds: []
        }
      },
      listOrder: ['ios-presentation'], active: 'ios-presentation'
    }));
    """

    static let restoreTestSeedScript = """
    localStorage.setItem('mrt.state.v2', JSON.stringify({
      schemaVersion: 4, issues: {}, read: {}, overrides: {}, notes: {}, ratings: {},
      lists: {}, listOrder: [], active: null
    }));
    for (const key of ['mrt.state.restore.tmp', 'mrt.state.prerestore', 'mrt.state.salvage', 'mrt.import.draft.v1']) {
      localStorage.removeItem(key);
    }
    """

    /// Blocks every http and https load before it is sent.
    static let isolationRules = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]"#

    static func installRequestIsolation(
        on controller: WKUserContentController,
        completion: @escaping @MainActor (Bool) -> Void
    ) {
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "recap-request-isolation",
            encodedContentRuleList: isolationRules
        ) { list, _ in
            Task { @MainActor in
                if let list { controller.add(list) }
                completion(list != nil)
            }
        }
    }

    @MainActor private static var probeStarted = false
    @MainActor private static var launchedWebViews = Set<ObjectIdentifier>()
    @MainActor private static var presentedReadSheets = 0
    @MainActor private static var recordedHandOffs: [String] = []
    @MainActor private static var readSheetCloseEvents: [String] = []
    @MainActor private static var readSheetStyleProbe: [String: Any]?
    @MainActor private static var handOffRecorder: UILabel?

    @MainActor
    static func prepareHandOffRecorder(in view: UIView) {
        guard recordsHandOffs else { return }
        launchedWebViews = []
        presentedReadSheets = 0
        recordedHandOffs = []
        readSheetCloseEvents = []
        readSheetStyleProbe = nil
        let label = UILabel(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        label.accessibilityIdentifier = handOffRecorderIdentifier
        label.isAccessibilityElement = true
        label.alpha = 0.1
        view.addSubview(label)
        handOffRecorder = label
        updateHandOffRecorder()
    }

    @MainActor
    static func recordLauncherOpened(_ webView: WKWebView) {
        guard recordsHandOffs else { return }
        launchedWebViews.insert(ObjectIdentifier(webView))
        updateHandOffRecorder()
    }

    @MainActor
    static func recordReadSheetPresented() {
        guard recordsHandOffs else { return }
        presentedReadSheets += 1
        updateHandOffRecorder()
    }

    @MainActor
    static func recordReadSheetClose(_ event: String) {
        guard recordsHandOffs else { return }
        readSheetCloseEvents.append(event)
        updateHandOffRecorder()
    }

    @MainActor
    static func recordHandOff(_ url: URL) {
        guard recordsHandOffs else { return }
        recordedHandOffs.append(url.absoluteString)
        updateHandOffRecorder()
    }

    @MainActor
    static func recordReadSheetStyleProbe(_ value: Any?, error: Error?) {
        guard readSheetStyleProbeEnabled else { return }
        if let error {
            readSheetStyleProbe = ["error": Self.debugDescription(of: error)]
        } else if let value = value as? String,
                  let data = value.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let result = object as? [String: Any] {
            readSheetStyleProbe = result
        } else {
            readSheetStyleProbe = ["error": "The Read stylesheet probe returned no JSON result."]
        }
        updateHandOffRecorder()
    }

    @MainActor
    private static func updateHandOffRecorder() {
        guard let handOffRecorder else { return }
        do {
            var record: [String: Any] = [
                "launches": launchedWebViews.count,
                "presentations": presentedReadSheets,
                "handoffs": recordedHandOffs,
                "readSheetCloseEvents": readSheetCloseEvents,
            ]
            if let readSheetStyleProbe {
                record["readSheetStyleProbe"] = readSheetStyleProbe
            }
            let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
            handOffRecorder.accessibilityLabel = String(decoding: data, as: UTF8.self)
        } catch {
            handOffRecorder.accessibilityLabel = "error: \(Self.debugDescription(of: error))"
        }
    }

    static let readSheetStyleProbeScript = #"""
    (() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((link) => ({
        href: link.href,
        loaded: Boolean(link.sheet),
      }));
      const stylesheets = Array.from(document.styleSheets).map((sheet) => {
        let rules = [];
        try {
          rules = Array.from(sheet.cssRules || []).flatMap((rule) =>
            rule.selectorText ? [{ selector: rule.selectorText, cssText: rule.cssText }] : []);
        } catch (error) {
          rules = [{ error: `${error.name}: ${error.message}` }];
        }
        return { href: sheet.href, disabled: sheet.disabled, rules };
      });
      const elements = {};
      for (const id of ['fallback', 'return']) {
        const element = document.getElementById(id);
        if (!element) {
          elements[id] = { exists: false };
          continue;
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const matchingRules = stylesheets.flatMap((sheet) => sheet.rules
          .filter((rule) => {
            try {
              return element.matches(rule.selector);
            } catch {
              return false;
            }
          })
          .map((rule) => ({ href: sheet.href, selector: rule.selector, cssText: rule.cssText })));
        elements[id] = {
          exists: true,
          width: rect.width,
          height: rect.height,
          computed: {
            display: style.display,
            width: style.width,
            height: style.height,
            minWidth: style.minWidth,
            minHeight: style.minHeight,
            boxSizing: style.boxSizing,
            padding: style.padding,
            lineHeight: style.lineHeight,
          },
          matchingRules,
        };
      }
      return JSON.stringify({ links, stylesheets, elements });
    })()
    """#

    private static func debugDescription(of error: Error) -> String {
        let error = error as NSError
        let keys = [
            "WKJavaScriptExceptionMessage",
            "WKJavaScriptExceptionLineNumber",
            "WKJavaScriptExceptionColumnNumber",
            "WKJavaScriptExceptionSourceURL",
        ]
        let details = keys.compactMap { key in
            error.userInfo[key].map { "\(key)=\($0)" }
        }
        let summary = "\(error.domain) (\(error.code)): \(error.localizedDescription)"
        return ([summary] + details).joined(separator: "; ")
    }

    /// Runs the script a UI test passed in, once, after the app page first finishes loading, and puts
    /// its result in an accessibility element the test reads.
    @MainActor
    static func runProbeIfRequested(in webView: WKWebView, over view: UIView) {
        guard let script = environment[probeScriptKey], !probeStarted else { return }
        probeStarted = true
        let label = UILabel(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        label.accessibilityIdentifier = probeResultIdentifier
        label.isAccessibilityElement = true
        label.accessibilityLabel = "pending"
        label.alpha = 0.1
        view.addSubview(label)
        // The Objective-C method, not WebKit's Swift refinement of it. Built with the iOS 26 SDK, the
        // refinement lives in libswiftWebKit.dylib, which iOS 18 does not have: on the iOS 18.5
        // Simulator this build stopped at launch with "Library not loaded:
        // /usr/lib/swift/libswiftWebKit.dylib".
        webView.__callAsyncJavaScript(script, arguments: [:], inFrame: nil, in: .page) { value, error in
            if let error {
                label.accessibilityLabel = "error: \(Self.debugDescription(of: error))"
            } else {
                label.accessibilityLabel = (value as? String) ?? "error: the probe returned \(String(describing: value))"
            }
        }
    }
}
#endif
