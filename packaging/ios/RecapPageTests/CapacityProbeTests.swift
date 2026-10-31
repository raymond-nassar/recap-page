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
            let call = "return await window.recapCapacityProbe({ targetBytes: \(Self.ownerBytes), wideText: \(wide), sweep: \(wide) });"
            let value = try await WebTestSupport.evaluate(webView, call)
            let json = try XCTUnwrap(value as? String)
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
            if wide {
                let sweep = try XCTUnwrap(result["sizeSweep"] as? [String: Any])
                let attempts = try XCTUnwrap(sweep["attempts"] as? [[String: Any]])
                XCTAssertGreaterThan(attempts.count, 1, "the wide-text sweep measured sizes above the owner data")
                XCTAssertGreaterThan(sweep["ownerReadingBackupBytes"] as? Int ?? 0, 0)
                for attempt in attempts {
                    XCTAssertEqual(attempt["wide"] as? Bool, true, "every generated size retains non-Latin-1 text")
                    let characters = try XCTUnwrap(attempt["readingCharacters"] as? Int)
                    XCTAssertEqual(attempt["chargedStorageBytes"] as? Int, characters * 2)
                    for kind in ["save", "singleEmpty", "singlePopulated", "completeEmpty", "completePopulated"] {
                        XCTAssertNotNil((attempt[kind] as? [String: Any])?["ok"] as? Bool, "\(kind) outcome")
                        XCTAssertGreaterThan((attempt[kind] as? [String: Any])?["bytes"] as? Int ?? 0, 0, "\(kind) input size")
                    }
                }
                let largest = try XCTUnwrap(sweep["largestPassingBytes"] as? [String: Any])
                let firstFailure = try XCTUnwrap(sweep["firstFailingBytes"] as? [String: Any])
                for kind in ["save", "singleEmpty", "singlePopulated", "completeEmpty", "completePopulated"] {
                    XCTAssertNotNil(firstFailure[kind] as? Int, "\(kind) was measured through its first failure")
                    XCTAssertNotNil(largest[kind], "\(kind) has an explicit largest passing result or null when none passed")
                }
                try WebTestSupport.record("capacity-wide-size-sweep", json, in: self)
            }
        }
    }
}
