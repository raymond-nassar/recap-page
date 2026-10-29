import WebKit

/// The one web view configuration the app uses. The tests build their web views from it too, so what
/// they prove is what ships.
enum WebViewFactory {
    @MainActor
    static func configuration(assets: AppAssets) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        // The persistent store: reading data must outlive every launch.
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(AppSchemeHandler(assets: assets), forURLScheme: assets.config.scheme)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        return configuration
    }
}
