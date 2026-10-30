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
