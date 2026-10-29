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
}
