import WebKit

/// The one web view configuration the app uses. The tests build their web views from it too, so what
/// they prove is what ships.
enum WebViewFactory {
    @MainActor
    static func configuration(
        assets: AppAssets,
        bridgeHandler: WKScriptMessageHandlerWithReply? = nil
    ) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        // The persistent store: reading data must outlive every launch.
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(AppSchemeHandler(assets: assets), forURLScheme: assets.config.scheme)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if let bridgeHandler {
            configuration.userContentController.addScriptMessageHandler(
                bridgeHandler,
                contentWorld: .page,
                name: IosBridgeHandler.name)
        }
        return configuration
    }

    @MainActor
    static func configure(_ webView: WKWebView) {
        webView.allowsLinkPreview = false
    }
}
