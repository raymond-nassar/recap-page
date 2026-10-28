import WebKit
import XCTest
@testable import RecapPage

/// The platform facts the shared app relies on, read from the app's own page in the app's own web
/// view configuration rather than assumed from WebKit's source.
final class CapabilityProbeTests: XCTestCase {
    @MainActor
    func testThePageRunsAtThePermanentOriginWithEverythingTheAppNeeds() async throws {
        let assets = try AppAssets.bundled()
        let webView = await WebTestSupport.makeWebView(assets: assets)
        defer { webView.removeFromSuperview() }
        try await WebTestSupport.loadAppPage(webView, assets: assets)

        let json = try XCTUnwrap(try await WebTestSupport.evaluate(webView, Self.probe) as? String)
        WebTestSupport.record("capability", json, in: self)
        let result = try WebTestSupport.object(json)
        XCTAssertEqual(result["origin"] as? String, AppAssets.permanentOrigin)
        XCTAssertEqual(result["secure"] as? Bool, true)
        XCTAssertEqual(result["locks"] as? String, "function")
        XCTAssertEqual(result["randomUUID"] as? String, "function")
        XCTAssertEqual(result["indexedDB"] as? String, "complete")
        XCTAssertEqual(result["module"] as? String, "function")
        XCTAssertEqual(result["inlineScriptRan"] as? Bool, false, "the content security policy refuses inline script")
        // Recorded rather than asserted: WebKit grants persistence only to origins it exempts, and
        // which answer this origin gets is evidence for the storage notes, not a pass condition.
        XCTAssertNotNil(result["persist"])
    }

    private static let probe = #"""
    const result = {
      origin: location.origin,
      secure: window.isSecureContext,
      locks: typeof navigator.locks?.request,
      randomUUID: typeof crypto.randomUUID,
    };
    try {
      result.persist = await navigator.storage.persist();
    } catch (error) {
      result.persist = `error: ${error.message}`;
    }
    result.indexedDB = await new Promise((resolve) => {
      const request = indexedDB.open('recap-ios-capability-probe', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('probe');
      request.onerror = () => resolve(`error: ${request.error}`);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('probe', 'readwrite', { durability: 'strict' });
        transaction.objectStore('probe').put('value', 'key');
        transaction.oncomplete = () => {
          db.close();
          indexedDB.deleteDatabase('recap-ios-capability-probe');
          resolve('complete');
        };
        transaction.onerror = () => resolve(`error: ${transaction.error}`);
      };
    });
    try {
      const module = await import(new URL('./js/lib/localServer.js', location.href).href);
      result.module = typeof module.checkLocalServer;
    } catch (error) {
      result.module = `error: ${error.message}`;
    }
    result.inlineScriptRan = await new Promise((resolve) => {
      window.recapInlineScriptRan = false;
      const script = document.createElement('script');
      script.textContent = 'window.recapInlineScriptRan = true;';
      document.head.append(script);
      setTimeout(() => resolve(window.recapInlineScriptRan === true), 300);
    });
    return JSON.stringify(result);
    """#
}
