import WebKit
import XCTest
@testable import RecapPage

/// How much of the app's saved data WebKit holds at the owner's data size, measured through the app's
/// own storage and restore code by the repository's capacity probe.
final class CapacityProbeTests: XCTestCase {
    /// The owner's complete backup, measured at 1,183 KB.
    private static let ownerBytes = 1183 * 1024

    private static var probeSource: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("probes/capacity.js")
    }

    @MainActor
    func testCapacityAtTheOwnersSizeIsMeasuredForWideAndLatin1Text() async throws {
        let assets = try AppAssets.bundled()
        let webView = await WebTestSupport.makeWebView(assets: assets)
        defer { webView.removeFromSuperview() }
        try await WebTestSupport.loadAppPage(webView, assets: assets)
        let source = try String(contentsOf: Self.probeSource, encoding: .utf8)
        _ = try await WebTestSupport.evaluate(webView, source + "\nreturn 'loaded';")

        for wide in [true, false] {
            let call = "return await window.recapCapacityProbe({ targetBytes: \(Self.ownerBytes), wideText: \(wide) });"
            let json = try XCTUnwrap(try await WebTestSupport.evaluate(webView, call) as? String)
            WebTestSupport.record("capacity-\(wide ? "wide" : "latin1")", json, in: self)
            let result = try WebTestSupport.object(json)
            let owner = try XCTUnwrap(result["owner"] as? [String: Any])
            let quota = try XCTUnwrap(result["quota"] as? [String: Any])
            XCTAssertEqual(owner["reached"] as? Bool, true, "the data reached the owner's size")
            XCTAssertEqual(owner["readerWide"] as? Bool, wide, "the data is the kind of text this pass measures")
            XCTAssertGreaterThan(quota["latin1Bytes"] as? Int ?? 0, 0)
            XCTAssertGreaterThan(quota["wideBytes"] as? Int ?? 0, 0)
            // Each outcome is a measurement for the capacity decision, not a pass condition: a refused
            // restore that changes nothing is the safe answer, and whether it is acceptable is the
            // owner's call. Only a probe that failed to measure fails this test.
            for step in ["save", "restoreIntoEmpty", "restoreIntoPopulated", "repeatRestore"] {
                XCTAssertNotNil((result[step] as? [String: Any])?["ok"] as? Bool, step)
            }
        }
    }
}
