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
        let web = try url("https://raymond-nassar.github.io/recap-page/privacy.html")
        XCTAssertEqual(policy.decide(url: web, isMainFrame: true, opensNewWindow: true, userActivated: true), .openExternally)
        XCTAssertEqual(policy.decide(url: web, isMainFrame: true, opensNewWindow: false, userActivated: true), .openExternally)
        XCTAssertEqual(policy.decide(url: web, isMainFrame: true, opensNewWindow: false, userActivated: false), .refuse)
        XCTAssertEqual(
            policy.decide(url: try url("https://raymond-nassar.github.io/recap-page/privacy.html#deleting-your-data"),
                          isMainFrame: true, opensNewWindow: true, userActivated: true),
            .openExternally)
        for address in [
            "https://www.hoopladigital.com/title/123456789",
            "https://www.hoopladigital.com/comic/stand-in-book/123456789",
            "https://share.libbyapp.com/title/123456",
        ] {
            let provider = try url(address)
            XCTAssertEqual(
                policy.decide(url: provider, isMainFrame: false, opensNewWindow: true, userActivated: true),
                .openExternally, address)
            XCTAssertEqual(
                policy.decide(url: provider, isMainFrame: false, opensNewWindow: true, userActivated: false),
                .refuse, address)
        }
        for refused in [
            "http://raymond-nassar.github.io/recap-page/privacy.html",
            "https://reader@raymond-nassar.github.io/recap-page/privacy.html",
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

    func testOnlyExactViewerLinksGetTheMarvelComicsAppAddress() throws {
        XCTAssertEqual(
            NavigationPolicy.marvelComicsAppAddress(for: try url("https://www.marvelcomicsapp.com/viewer/1703"))?.absoluteString,
            "marvelcomicsapp://viewer?issueId=1703")
        XCTAssertEqual(
            NavigationPolicy.marvelComicsAppAddress(for: try url("https://www.marvelcomicsapp.com/viewer/123456789"))?.absoluteString,
            "marvelcomicsapp://viewer?issueId=123456789")
        for refused in [
            "https://www.marvelcomicsapp.com/mu/issues/10441",
            "https://www.marvelcomicsapp.com/issues/36887",
            "https://www.marvelcomicsapp.com/viewer/0",
            "https://www.marvelcomicsapp.com/viewer/01703",
            "https://www.marvelcomicsapp.com/viewer/1234567890",
            "https://www.marvelcomicsapp.com/viewer/%31703",
            "https://www.marvelcomicsapp.com/viewer/1703/",
            "https://www.marvelcomicsapp.com/viewer/1703?x=1",
            "https://www.marvelcomicsapp.com/viewer/1703#page",
            "https://www.marvelcomicsapp.com:8443/viewer/1703",
            "https://reader@www.marvelcomicsapp.com/viewer/1703",
            "http://www.marvelcomicsapp.com/viewer/1703",
            "https://marvelcomicsapp.com/viewer/1703",
            "https://www.marvelcomicsapp.com.evil/viewer/1703",
            "https://read.marvel.com/#/book/1703",
            "marvelcomicsapp://viewer?issueId=1703",
        ] {
            XCTAssertNil(NavigationPolicy.marvelComicsAppAddress(for: try url(refused)), refused)
        }
    }

    func testReadTriesTheAppFirstAndOpensTheWebLinkOnlyWhenTheAppDoesNot() throws {
        let link = try url("https://www.marvelcomicsapp.com/viewer/1703")
        let app = try XCTUnwrap(NavigationPolicy.marvelComicsAppAddress(for: link))
        for appOpens in [true, false] {
            var attempts: [String] = []
            var results: [Bool] = []
            NavigationPolicy.openPreferringApp(link, appAddress: app, open: { target, done in
                attempts.append(target.absoluteString)
                done(target == link || appOpens)
            }, completion: { results.append($0) })
            XCTAssertEqual(attempts, appOpens ? [app.absoluteString] : [app.absoluteString, link.absoluteString])
            XCTAssertEqual(results, [true], "Only the final outcome is reported, once")
        }
        var attempts: [String] = []
        var results: [Bool] = []
        NavigationPolicy.openPreferringApp(link, appAddress: app, open: { target, done in
            attempts.append(target.absoluteString)
            done(false)
        }, completion: { results.append($0) })
        XCTAssertEqual(attempts, [app.absoluteString, link.absoluteString])
        XCTAssertEqual(results, [false], "A failed web link still reports a failure")
        attempts = []
        results = []
        let other = try url("https://marvel.webtoon.com/")
        NavigationPolicy.openPreferringApp(other, appAddress: nil, open: { target, done in
            attempts.append(target.absoluteString)
            done(true)
        }, completion: { results.append($0) })
        XCTAssertEqual(attempts, [other.absoluteString], "Without an app address only the web link opens")
        XCTAssertEqual(results, [true])
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
