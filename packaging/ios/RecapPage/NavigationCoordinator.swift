import WebKit

/// The main web view's navigation delegate: applies the policy, sends links the reader follows to the
/// web out to the system, and hands page lifecycle events to the screen that owns the web view.
@MainActor
final class NavigationCoordinator: NSObject, WKNavigationDelegate {
    private let policy: NavigationPolicy
    private weak var controller: WebViewController?

    init(policy: NavigationPolicy, controller: WebViewController) {
        self.policy = policy
        self.controller = controller
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        let decision = policy.decide(
            url: navigationAction.request.url,
            isMainFrame: navigationAction.targetFrame?.isMainFrame ?? false,
            opensNewWindow: navigationAction.targetFrame == nil,
            userActivated: navigationAction.navigationType == .linkActivated)
        switch decision {
        case .allow:
            return .allow
        case .openExternally:
            if let url = navigationAction.request.url { controller?.open(externally: url) }
            return .cancel
        case .refuse:
            return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        controller?.pageDidFinishLoading()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard webView === controller?.webView else { return }
        controller?.pageWillStartNavigation()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        controller?.contentProcessDidTerminate()
    }
}
