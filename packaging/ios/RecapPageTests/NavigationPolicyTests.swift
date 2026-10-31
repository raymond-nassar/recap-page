import WebKit
import XCTest
@testable import RecapPage

final class NavigationPolicyTests: XCTestCase {
    private let policy = NavigationPolicy(scheme: "recappage", host: "localhost")

    private func url(_ text: String) throws -> URL {
        try XCTUnwrap(URL(string: text), text)
    }

    func testOnlyPlainPathsAtTheAppOriginNameBundledFiles() throws {
        XCTAssertEqual(policy.assetPath(try url("recappage://localhost")), "index.html")
        XCTAssertEqual(policy.assetPath(try url("recappage://localhost/")), "index.html")
        XCTAssertEqual(policy.assetPath(try url("recappage://localhost/js/main.js")), "js/main.js")
        XCTAssertEqual(policy.assetPath(try url("recappage://localhost/data/catalog.json?fresh=1")), "data/catalog.json")
        for refused in [
            "recappage://localhost/js/../index.html",
            "recappage://localhost/./index.html",
            "recappage://localhost/js//main.js",
            "recappage://localhost/js/%2e%2e/index.html",
            "recappage://localhost/a%20b.js",
            "recappage://elsewhere/index.html",
            "recappage://localhost:8787/",
            "recappage://reader@localhost/",
            "http://localhost/index.html",
            "https://localhost/index.html",
            "file:///index.html",
        ] {
            XCTAssertNil(policy.assetPath(try url(refused)), refused)
        }
    }

    func testOnlyTheAppPageWithoutAQueryIsTheAppPage() throws {
        XCTAssertTrue(policy.isAppPage(try url("recappage://localhost/")))
        XCTAssertTrue(policy.isAppPage(try url("recappage://localhost/#/read")))
        XCTAssertTrue(policy.isAppPage(try url("recappage://localhost/index.html")))
        XCTAssertFalse(policy.isAppPage(try url("recappage://localhost/?q=storm")))
        XCTAssertFalse(policy.isAppPage(try url("recappage://localhost/open.html")))
        XCTAssertTrue(policy.isLauncherPage(try url("recappage://localhost/open.html?issue=1")))
    }

    func testTheMainWebViewLoadsOnlyTheAppPageAndSendsFollowedWebLinksOut() throws {
        let app = try url("recappage://localhost/#/home")
        XCTAssertEqual(policy.decide(url: app, isMainFrame: true, opensNewWindow: false, userActivated: false), .allow)
        XCTAssertEqual(policy.decide(url: app, isMainFrame: true, opensNewWindow: true, userActivated: true), .refuse)
        let launcher = try url("recappage://localhost/open.html?i=6482")
        XCTAssertEqual(policy.decide(url: launcher, isMainFrame: false, opensNewWindow: true, userActivated: true), .allow)
        XCTAssertEqual(policy.decide(url: launcher, isMainFrame: true, opensNewWindow: false, userActivated: true), .refuse)
        XCTAssertEqual(policy.decide(url: app, isMainFrame: false, opensNewWindow: false, userActivated: false), .refuse)
        let web = try url("https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md")
        XCTAssertEqual(policy.decide(url: web, isMainFrame: true, opensNewWindow: true, userActivated: true), .openExternally)
        XCTAssertEqual(policy.decide(url: web, isMainFrame: true, opensNewWindow: false, userActivated: true), .openExternally)
        XCTAssertEqual(policy.decide(url: web, isMainFrame: true, opensNewWindow: false, userActivated: false), .refuse)
        for refused in [
            "http://example.com/",
            "recappage://localhost/open.html",
            "about:blank",
            "javascript:void(0)",
            "data:text/html,page",
            "blob:recappage://localhost/0",
            "https://reader@example.com/",
        ] {
            XCTAssertEqual(
                policy.decide(url: try url(refused), isMainFrame: true, opensNewWindow: false, userActivated: true),
                .refuse, refused)
        }
        XCTAssertEqual(policy.decide(url: nil, isMainFrame: true, opensNewWindow: false, userActivated: true), .refuse)
    }

    func testLauncherOnlyLoadsItsOwnPageAndHandsOffMainFrameHttps() throws {
        XCTAssertEqual(
            policy.decideLauncher(
                url: try url("recappage://localhost/open.html?i=6482"),
                isMainFrame: true,
                opensNewWindow: false),
            .allow)
        XCTAssertEqual(
            policy.decideLauncher(
                url: try url("https://example.com/reader"),
                isMainFrame: true,
                opensNewWindow: false),
            .openExternally)
        for refused in [
            ("https://example.com/", false, false),
            ("https://example.com/", true, true),
            ("http://example.com/", true, false),
            ("recappage://localhost/index.html", true, false),
            ("about:blank", true, false),
        ] {
            XCTAssertEqual(
                policy.decideLauncher(
                    url: try url(refused.0),
                    isMainFrame: refused.1,
                    opensNewWindow: refused.2),
                .refuse,
                refused.0)
        }
    }

    @MainActor
    func testLinkPreviewsAreDisabledOnAppAndLauncherWebViews() {
        let app = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        let launcher = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        WebViewFactory.configure(app)
        WebViewFactory.configure(launcher)
        XCTAssertFalse(app.allowsLinkPreview)
        XCTAssertFalse(launcher.allowsLinkPreview)
    }

    @MainActor
    func testReadSheetClosesOnceWhenItsWebContentProcessEnds() {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        var closeCount = 0
        let sheet = ReadSheetController(
            webView: webView,
            policy: policy,
            openExternally: { _, completion in completion(true) },
            onClose: { _ in closeCount += 1 })
        XCTAssertTrue(webView.navigationDelegate === sheet)
        XCTAssertTrue(webView.uiDelegate === sheet)
        sheet.webViewWebContentProcessDidTerminate(webView)
        sheet.webViewWebContentProcessDidTerminate(webView)
        XCTAssertEqual(closeCount, 1)
    }
}
