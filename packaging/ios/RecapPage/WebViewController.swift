import UIKit
import WebKit

/// The app's one screen: the shared web app in a web view, at its permanent origin.
final class WebViewController: UIViewController {
    private(set) var webView: WKWebView?
    private var policy: NavigationPolicy?
    private var coordinator: NavigationCoordinator?
    private var appPage: URL?
    /// Set when iOS ended the page's content process, until the reloaded page has been told.
    private(set) var restartNoticePending = false

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .recapPageBackground
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let assets: AppAssets
        do {
            assets = try AppAssets.bundled()
        } catch {
            showFatal("The bundled app could not be loaded. Reinstall Recap Page.")
            return
        }
        let policy = NavigationPolicy(config: assets.config)
        let webView = WKWebView(frame: .zero, configuration: WebViewFactory.configuration(assets: assets))
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
        self.webView = webView
        self.policy = policy
        self.coordinator = coordinator
        appPage = assets.appPageURL
        startLoading()
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

    func open(externally url: URL) {
        UIApplication.shared.open(url)
    }

    /// iOS can end the page's content process, most often while the app is in the background. Saved
    /// data lives outside that process, so reloading loses nothing, and the reloaded page says why it
    /// started over, as the Android app tells its reader in the same case.
    func contentProcessDidTerminate() {
        restartNoticePending = true
        guard let webView else { return }
        // Set before any script of the page that loads next, which reads it when it starts. The
        // page learns it that way whenever its own module runs: an event sent once the reload had
        // finished reached the page on both Simulator runtimes and still left the notice hidden.
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
            // The page that just loaded has held the flag since it started, so later pages are not
            // given it. The flag is the only user script the app adds.
            restartNoticePending = false
            webView.configuration.userContentController.removeAllUserScripts()
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
