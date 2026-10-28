import XCTest
@testable import RecapPage

final class AssetResponderTests: XCTestCase {
    private func reply(_ path: String, method: String? = "GET") throws -> AssetReply {
        AssetResponder(assets: try AppAssets.bundled()).reply(to: URL(string: "recappage://localhost\(path)"), method: method)
    }

    func testTheAppPageArrivesWithTheSharedContentSecurityPolicy() throws {
        let assets = try AppAssets.bundled()
        let reply = AssetResponder(assets: assets).reply(to: assets.appPageURL, method: "GET")
        XCTAssertEqual(reply.statusCode, 200)
        XCTAssertEqual(reply.headers["Content-Type"], "text/html; charset=utf-8")
        XCTAssertEqual(reply.headers["Cache-Control"], "no-store")
        XCTAssertEqual(reply.headers["x-content-type-options"], "nosniff")
        let policy = try XCTUnwrap(reply.headers["content-security-policy"])
        XCTAssertTrue(policy.hasPrefix("default-src 'self'; script-src 'self';"), policy)
        XCTAssertTrue(policy.hasSuffix("; frame-src 'none'; worker-src 'none'"), policy)
        let page = String(decoding: reply.body, as: UTF8.self)
        XCTAssertTrue(page.contains(#"<script type="module" src="./ios/app.js"></script>"#))
        XCTAssertTrue(page.contains("viewport-fit=cover"))
    }

    func testEachKindOfFileCarriesItsType() throws {
        XCTAssertEqual(try reply("/js/main.js").headers["Content-Type"], "text/javascript; charset=utf-8")
        XCTAssertEqual(try reply("/styles.css").headers["Content-Type"], "text/css; charset=utf-8")
        XCTAssertEqual(try reply("/data/catalog.json").headers["Content-Type"], "application/json; charset=utf-8")
        XCTAssertEqual(try reply("/manifest.webmanifest").headers["Content-Type"], "application/manifest+json")
        XCTAssertEqual(try reply("/icons/icon.svg").headers["Content-Type"], "image/svg+xml")
        XCTAssertEqual(try reply("/icons/icon-192.png").headers["Content-Type"], "image/png")
        XCTAssertEqual(MimeType.of("notes.md"), "text/markdown; charset=utf-8")
        XCTAssertEqual(MimeType.of("archive.bin"), "application/octet-stream")
    }

    func testOnlyListedFilesAtTheAppOriginAreServed() throws {
        let responder = AssetResponder(assets: try AppAssets.bundled())
        XCTAssertEqual(try reply("/no-such-file.js").statusCode, 404)
        XCTAssertEqual(try reply("/sw.js").statusCode, 404, "the service worker is left out of the app")
        XCTAssertEqual(try reply("/dev-faults.html").statusCode, 404, "the fault harness is left out of the app")
        XCTAssertEqual(try reply("/js/../index.html").statusCode, 403)
        XCTAssertEqual(responder.reply(to: URL(string: "recappage://elsewhere/index.html"), method: "GET").statusCode, 403)
        XCTAssertEqual(responder.reply(to: URL(string: "https://localhost/index.html"), method: "GET").statusCode, 403)
        XCTAssertEqual(responder.reply(to: nil, method: "GET").statusCode, 403)
        XCTAssertEqual(try reply("/index.html", method: "POST").statusCode, 405)
    }

    func testTheHealthAnswerMatchesTheWindowsServer() throws {
        let assets = try AppAssets.bundled()
        let health = AssetResponder(assets: assets)
            .reply(to: URL(string: "recappage://localhost\(assets.config.health.path)"), method: "GET")
        XCTAssertEqual(health.statusCode, 204)
        XCTAssertEqual(health.headers["X-Recap-Page-Server"], "1")
        XCTAssertTrue(health.body.isEmpty)
    }

    func testEveryListedFileIsServedWhole() throws {
        let assets = try AppAssets.bundled()
        let responder = AssetResponder(assets: assets)
        XCTAssertGreaterThan(assets.paths.count, 600)
        for path in assets.paths.sorted() {
            let reply = responder.reply(to: URL(string: "recappage://localhost/\(path)"), method: "GET")
            XCTAssertEqual(reply.statusCode, 200, path)
            XCTAssertEqual(reply.body, try Data(contentsOf: assets.root.appendingPathComponent(path)), path)
        }
    }

    func testAConfigurationNamingAnotherOriginIsRefused() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = #"{"version":"0","origin":"recappage://elsewhere","scheme":"recappage","host":"elsewhere","securityHeaders":{},"health":{"path":"/health","headers":{}}}"#
        try Data(config.utf8).write(to: directory.appendingPathComponent("ios-config.json"))
        try Data(#"{"files":[]}"#.utf8).write(to: directory.appendingPathComponent("ios-assets.json"))
        XCTAssertThrowsError(try AppAssets(root: directory)) { error in
            XCTAssertEqual(error as? AppAssetsError, .unexpectedOrigin("recappage://elsewhere"))
        }
    }
}
