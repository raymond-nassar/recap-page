import UIKit
import WebKit

/// The app's one screen: the shared web app in a web view, at its permanent origin.
final class WebViewController: UIViewController, WKUIDelegate {
    private(set) var webView: WKWebView?
    private var policy: NavigationPolicy?
    private var coordinator: NavigationCoordinator?
    private var bridge: IosBridgeHandler?
    private var appPage: URL?
    private var pendingReadSheets: [ReadSheetController] = []
    private var presentedReadSheet: ReadSheetController?
    private let dataLossState = IOSDataLossState()
    /// Set when iOS ended the page's content process, until the reloaded page has been told.
    private(set) var restartNoticePending = false

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .recapPageBackground
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        registerForTraitChanges([UITraitPreferredContentSizeCategory.self], action: #selector(preferredContentSizeCategoryDidChange))
        let assets: AppAssets
        do {
            assets = try AppAssets.bundled()
        } catch {
            showFatal("The bundled app could not be loaded. Reinstall Recap Page.")
            return
        }
        let policy = NavigationPolicy(config: assets.config)
        #if DEBUG
        if DebugSupport.resetsDataLossState {
            dataLossState.reset()
        }
        #endif
        let bridge = IosBridgeHandler(policy: policy, presenter: self, dataLossState: dataLossState)
        let configuration = WebViewFactory.configuration(assets: assets, bridgeHandler: bridge)
        installPageScripts(in: configuration.userContentController)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        WebViewFactory.configure(webView)
        webView.isOpaque = false
        webView.backgroundColor = .recapPageBackground
        webView.scrollView.backgroundColor = .recapPageBackground
        // The page lays itself out around the home indicator through viewport-fit=cover, so the scroll
        // view must not add the same inset a second time.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        let coordinator = NavigationCoordinator(policy: policy, controller: self)
        webView.navigationDelegate = coordinator
        webView.uiDelegate = self
        self.webView = webView
        self.policy = policy
        self.coordinator = coordinator
        self.bridge = bridge
        appPage = assets.appPageURL
        #if DEBUG
        DebugSupport.prepareHandOffRecorder(in: view)
        #endif
        startLoading()
    }

    private func installPageScripts(in controller: WKUserContentController) {
        #if DEBUG
        if DebugSupport.clearsReadingData {
            controller.addUserScript(WKUserScript(
                source: "localStorage.removeItem('mrt.state.v2');",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        }
        if DebugSupport.failsFifthJournalPut {
            controller.addUserScript(WKUserScript(
                source: DebugSupport.failFifthJournalPutScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        }
        #endif
        controller.addUserScript(WKUserScript(
            source: dataLossState.pageStateScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(
            source: Self.dynamicTypeScaleScript(for: traitCollection),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(
            source: Self.accessibleTargetScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true))
        #if DEBUG
        if DebugSupport.seedsPresentationTest {
            controller.addUserScript(WKUserScript(
                source: DebugSupport.passiveAuditTrackingScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
            controller.addUserScript(WKUserScript(
                source: DebugSupport.presentationTestSeedScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        }
        if DebugSupport.seedsRestoreTest {
            controller.addUserScript(WKUserScript(
                source: DebugSupport.restoreTestSeedScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        }
        if DebugSupport.seedsUnreadableRecovery {
            controller.addUserScript(WKUserScript(
                source: DebugSupport.unreadableRecoveryScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        }
        if DebugSupport.readHandoffTestEnabled {
            controller.addUserScript(WKUserScript(
                source: DebugSupport.readHandoffTestScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        }
        #endif
    }

    private static let accessibleTargetScript = #"""
    (() => {
      const selector = '.skip-link, #fallback, #return, .brand, #home-updates-toggle, #btn-home-browse, #btn-home-add';
      const additionalTargets = '#sidebar-nav a.ri[data-view="library"], #sidebar-nav a.ri[data-view="add"], '
        + '#sidebar-nav a.ri[data-view="data"], #sidebar-nav a.ri[data-view="about"], '
        + '#btn-chero-open, .app-footer > a[data-view="about"], '
        + '.breadcrumb a, #library-rated-shelf .btn, #view-library .search-hub-card, '
        + '#view-add .search-hub-card, #view-add summary, #view-data summary, #view-data .backup-restore-label';
      const applyAccessibleTargets = () => {
        for (const control of document.querySelectorAll(
          '#btn-chero-read, #btn-chero-done, #btn-chero-review, #btn-chero-deferred')) {
          if (control.hidden) control.setAttribute('aria-hidden', 'true');
          else control.removeAttribute('aria-hidden');
        }
        for (const target of document.querySelectorAll(`${selector}, ${additionalTargets}`)) {
          const label = (target.id === 'btn-chero-open' ? target.getAttribute('aria-label') : null)
            || (target.innerText || target.textContent).trim().replace(/\s+/g, ' ');
          if (!label) continue;
          if (target.dataset.iosAccessibleTarget === 'true') {
            if (target.getAttribute('aria-label') !== label) target.setAttribute('aria-label', label);
            continue;
          }
          if (target.matches('.backup-restore-label')) {
            target.setAttribute('role', 'button');
            target.setAttribute('tabindex', '0');
            const input = document.getElementById(target.htmlFor);
            const describedBy = input?.getAttribute('aria-describedby');
            if (describedBy) {
              target.setAttribute('aria-describedby', describedBy);
              for (const id of ['restore-complete-hint', 'restore-file-hint', 'restore-history-hint']) {
                const hint = document.getElementById(id);
                if (hint && describedBy.split(/\s+/).includes(id)) hint.setAttribute('aria-hidden', 'true');
              }
            }
            target.addEventListener('keydown', event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (event.key === 'Enter') target.click();
              }
            });
            target.addEventListener('keyup', event => {
              if (event.key === ' ') {
                event.preventDefault();
                target.click();
              }
            });
          }
          for (const child of target.children) child.setAttribute('aria-hidden', 'true');
          for (const node of [...target.childNodes]) {
            if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
            const visualText = document.createElement('span');
            visualText.setAttribute('aria-hidden', 'true');
            node.replaceWith(visualText);
            visualText.append(node);
          }
          target.setAttribute('aria-label', label);
          target.dataset.iosAccessibleTarget = 'true';
        }
      };
      applyAccessibleTargets();
      new MutationObserver(applyAccessibleTargets).observe(document.documentElement,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    })();
    """#

    private static func dynamicTypeScaleScript(for traits: UITraitCollection) -> String {
        let bodySize = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits).pointSize
        let scale = String(Double(bodySize) / 17.0)
        let isLargestText = traits.preferredContentSizeCategory == .accessibilityExtraExtraExtraLarge
        return """
        (() => {
          const apply = () => {
            const root = document.documentElement;
            if (!root) return;
            root.style.setProperty('--ios-text-scale', '\(scale)');
            root.dataset.iosLargestText = '\(isLargestText)';
          };
          if (document.documentElement) apply();
          else document.addEventListener('DOMContentLoaded', apply, { once: true });
        })();
        """
    }

    @objc private func preferredContentSizeCategoryDidChange() {
        guard let webView else { return }
        webView.evaluateJavaScript(Self.dynamicTypeScaleScript(for: traitCollection)) { _, error in
            if let error {
                NSLog("Could not update the page's Dynamic Type scale: %@", error.localizedDescription)
            }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // A second Read tap can queue a sheet while UIKit is completing the previous dismissal.
        presentNextReadSheet()
    }

    private func startLoading() {
        #if DEBUG
        if DebugSupport.isolatesRequests, let webView {
            DebugSupport.installRequestIsolation(on: webView.configuration.userContentController) { [weak self] installed in
                guard let self else { return }
                if installed {
                    self.loadAppPage()
                } else {
                    self.showFatal("Request isolation for tests could not be installed.")
                }
            }
            return
        }
        #endif
        loadAppPage()
    }

    func loadAppPage() {
        guard let webView, let appPage else { return }
        webView.load(URLRequest(url: appPage))
    }

    func pageWillStartNavigation() {
        bridge?.pageWillEnd()
    }

    func open(externally url: URL, completion: ((Bool) -> Void)? = nil) {
        #if DEBUG
        if DebugSupport.recordsHandOffs {
            DebugSupport.recordHandOff(url)
            reportExternalOpen(success: true)
            // UI tests close the sheet after observing this synchronous recorder update.
            return
        }
        #endif
        UIApplication.shared.open(url) { [weak self] success in
            Task { @MainActor in
                self?.reportExternalOpen(success: success)
                completion?(success)
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard webView === self.webView,
              navigationAction.targetFrame == nil,
              let url = navigationAction.request.url,
              let policy,
              policy.isLauncherPage(url) else { return nil }

        let child = WKWebView(frame: .zero, configuration: configuration)
        WebViewFactory.configure(child)
        let sheet = ReadSheetController(
            webView: child,
            policy: policy,
            openExternally: { [weak self] url, completion in
                guard let self else {
                    completion(false)
                    return
                }
                self.open(externally: url, completion: completion)
            },
            onClose: { [weak self] sheet in self?.closeReadSheet(sheet) })
        pendingReadSheets.append(sheet)
        #if DEBUG
        if DebugSupport.recordsHandOffs {
            DebugSupport.recordLauncherOpened(child)
        }
        #endif
        presentNextReadSheet()
        return child
    }

    private func presentNextReadSheet() {
        guard presentedReadSheet == nil, !pendingReadSheets.isEmpty, presentedViewController == nil else { return }
        let sheet = pendingReadSheets.removeFirst()
        presentedReadSheet = sheet
        let navigation = UINavigationController(rootViewController: sheet)
        navigation.modalPresentationStyle = .pageSheet
        if let presentation = navigation.sheetPresentationController {
            presentation.detents = [.large()]
            presentation.prefersGrabberVisible = true
        }
        present(navigation, animated: true) {
            navigation.presentationController?.delegate = sheet
        }
    }

    private func closeReadSheet(_ sheet: ReadSheetController) {
        #if DEBUG
        DebugSupport.recordReadSheetClose("parent-close-callback")
        #endif
        guard presentedReadSheet === sheet else {
            pendingReadSheets.removeAll { $0 === sheet }
            return
        }
        guard let navigation = sheet.navigationController,
              navigation.presentingViewController != nil else {
            #if DEBUG
            DebugSupport.recordReadSheetClose("dismissal-skipped-no-presenter")
            #endif
            presentedReadSheet = nil
            presentNextReadSheet()
            return
        }
        #if DEBUG
        DebugSupport.recordReadSheetClose("dismiss-requested")
        #endif
        navigation.dismiss(animated: true) { [weak self, weak sheet] in
            #if DEBUG
            DebugSupport.recordReadSheetClose("dismissal-completed")
            #endif
            guard let self, let sheet, self.presentedReadSheet === sheet else { return }
            self.presentedReadSheet = nil
            self.presentNextReadSheet()
        }
    }

    private func closeReadSheets() {
        pendingReadSheets.removeAll()
        presentedReadSheet?.closeForProcessTermination()
    }

    private func reportExternalOpen(success: Bool) {
        let status = success ? "opened" : "failed"
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('recapios:external-open', { detail: { status: '\(status)' } }));")
    }

    /// iOS can end the page's content process, most often while the app is in the background. Saved
    /// data lives outside that process, so reloading loses nothing, and the reloaded page says why it
    /// started over, as the Android app tells its reader in the same case.
    func contentProcessDidTerminate() {
        restartNoticePending = true
        bridge?.pageWillEnd()
        closeReadSheets()
        guard let webView else { return }
        // Set before any script of the page that loads next, which reads it when it starts. The
        // page learns it that way whenever its own module runs: an event sent once the reload had
        // finished reached the page on both Simulator runtimes and still left the notice hidden.
        webView.configuration.userContentController.removeAllUserScripts()
        installPageScripts(in: webView.configuration.userContentController)
        webView.configuration.userContentController.addUserScript(WKUserScript(
            source: "window.recapIosRestarted = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let current = webView.url, policy?.isAppPage(current) == true {
            // A reload keeps the reader's place: the address the ended page had, view and all, loads
            // again in a new content process.
            webView.reload()
        } else {
            loadAppPage()
        }
    }

    func pageDidFinishLoading() {
        guard let webView else { return }
        if restartNoticePending {
            // Remove the one-load restart flag without losing scripts that restore page state,
            // apply Dynamic Type, and support the Debug-only Simulator probes.
            restartNoticePending = false
            webView.configuration.userContentController.removeAllUserScripts()
            installPageScripts(in: webView.configuration.userContentController)
        }
        #if DEBUG
        DebugSupport.runProbeIfRequested(in: webView, over: view)
        #endif
    }

    private func showFatal(_ message: String) {
        webView?.removeFromSuperview()
        webView = nil
        let label = UILabel()
        label.text = message
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}

extension UIColor {
    /// The page background in each appearance, so nothing flashes before the page draws: the colors the
    /// shared page names for the browser's own title bar.
    static let recapPageBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: CGFloat(0x11) / 255, green: CGFloat(0x11) / 255, blue: CGFloat(0x17) / 255, alpha: 1)
            : UIColor(red: CGFloat(0xFA) / 255, green: CGFloat(0xFA) / 255, blue: CGFloat(0xFF) / 255, alpha: 1)
    }
}
