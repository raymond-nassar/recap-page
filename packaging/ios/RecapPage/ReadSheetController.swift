import UIKit
import WebKit

@MainActor
final class ReadSheetController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIAdaptivePresentationControllerDelegate {
    private let webView: WKWebView
    private let policy: NavigationPolicy
    private let openExternally: (URL, @escaping (Bool) -> Void) -> Void
    private let onClose: (ReadSheetController) -> Void
    private var isClosing = false
    private var didRecordPresentation = false

    init(
        webView: WKWebView,
        policy: NavigationPolicy,
        openExternally: @escaping (URL, @escaping (Bool) -> Void) -> Void,
        onClose: @escaping (ReadSheetController) -> Void
    ) {
        self.webView = webView
        self.policy = policy
        self.openExternally = openExternally
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        WebViewFactory.configure(webView)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .recapPageBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.title = "Read"
        let close = UIBarButtonItem(title: "Close", style: .done, target: self, action: #selector(closeTapped))
        close.accessibilityIdentifier = "ios-read-sheet-close"
        navigationItem.leftBarButtonItem = close
        #if DEBUG
        if DebugSupport.readHandoffTestEnabled {
            let followFallback = UIBarButtonItem(
                title: "Test fallback",
                style: .plain,
                target: self,
                action: #selector(followFallbackForTesting))
            followFallback.accessibilityIdentifier = "ios-test-follow-fallback"
            navigationItem.rightBarButtonItem = followFallback
        }
        #endif
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        #if DEBUG
        if !didRecordPresentation {
            didRecordPresentation = true
            DebugSupport.recordReadSheetPresented()
        }
        #endif
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        let decision = policy.decideLauncher(
            url: navigationAction.request.url,
            isMainFrame: navigationAction.targetFrame?.isMainFrame ?? false,
            opensNewWindow: navigationAction.targetFrame == nil)
        #if DEBUG
        NSLog(
            "Recap Page launcher navigation decision: host=%@ path=%@ mainFrame=%@ newWindow=%@ decision=%@",
            navigationAction.request.url?.host ?? "none",
            navigationAction.request.url?.path ?? "none",
            String(describing: navigationAction.targetFrame?.isMainFrame),
            String(navigationAction.targetFrame == nil),
            String(describing: decision))
        #endif
        switch decision {
        case .allow:
            return .allow
        case .openExternally:
            guard let url = navigationAction.request.url else { return .cancel }
            openExternally(url) { [weak self] _ in self?.close() }
            return .cancel
        case .refuse:
            return .cancel
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        close()
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        close()
    }

    @objc private func closeTapped() {
        close()
    }

    #if DEBUG
    @objc private func followFallbackForTesting() {
        webView.evaluateJavaScript("document.getElementById('fallback')?.click();")
    }
    #endif

    func closeForProcessTermination() {
        close()
    }

    private func close() {
        guard !isClosing else { return }
        isClosing = true
        onClose(self)
    }
}
