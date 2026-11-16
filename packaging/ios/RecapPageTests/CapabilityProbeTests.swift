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

        let value = try await WebTestSupport.evaluate(webView, Self.probe)
        let json = try XCTUnwrap(value as? String)
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

    @MainActor
    func testCloudUploadPermitsRevokeAndRegrantAfterReload() async throws {
        let assets = try AppAssets.bundled()
        let webView = await WebTestSupport.makeWebView(assets: assets)
        defer { webView.removeFromSuperview() }
        for phase in ["launch", "reload"] {
            if phase == "reload" {
                let held = try await WebTestSupport.evaluate(webView, """
                    return !!globalThis.recapPermitProbe
                      && sessionStorage.getItem('recap.test.upload-permit') === globalThis.recapPermitProbe.name
                      && await globalThis.recapPermitProbe.allowed();
                    """)
                XCTAssertEqual(held as? Bool, true, "the previous document holds its permit before reload")
                _ = try await WebTestSupport.evaluate(webView, "globalThis.recapPermitReloading = true;")
            }
            try await WebTestSupport.loadAppPage(webView, assets: assets)
            try await WebTestSupport.waitFor(webView,
                "globalThis.recapPermitReloading !== true && document.readyState === 'complete'",
                timeout: WebTestSupport.pageLoadTimeout)
            let value = try await WebTestSupport.evaluate(webView, Self.uploadPermitProbe)
            let json = try XCTUnwrap(value as? String)
            WebTestSupport.record("cloud-upload-permit-\(phase)", json, in: self)
            let result = try WebTestSupport.object(json)
            XCTAssertEqual(result["hadPrevious"] as? Bool, phase == "reload", "\(phase): previous permit")
            for key in ["fresh", "held", "revoked", "rejected", "absent", "regranted"] {
                XCTAssertEqual(result[key] as? Bool, true, "\(phase): \(key)")
            }
        }
        _ = try await WebTestSupport.evaluate(webView,
            "globalThis.recapPermitProbe.release(); sessionStorage.removeItem('recap.test.upload-permit');")
    }

    private static let uploadPermitProbe = #"""
    const { CloudUploadPermit } = await import(new URL('./js/lib/cloudUploadPermit.js', location.href).href);
    const previous = sessionStorage.getItem('recap.test.upload-permit');
    const state = await navigator.locks.query();
    const fresh = ![...state.held, ...state.pending].some(lock => lock.name === previous);
    let lost = 0;
    let keep = false;
    const older = new CloudUploadPermit({ onLost: () => { lost += 1; } });
    const checking = new CloudUploadPermit();
    try {
      await older.grant();
      const held = await older.allowed();
      await checking.revokeAll();
      const revoked = !await older.allowed();
      const deadline = Date.now() + 2000;
      while (lost === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      const absent = !(await navigator.locks.query()).held.some(lock => lock.name === older.name);
      checking.release();
      await older.grant();
      globalThis.recapPermitProbe = older;
      sessionStorage.setItem('recap.test.upload-permit', older.name);
      keep = true;
      return JSON.stringify({ hadPrevious: previous !== null, fresh, held, revoked, rejected: lost === 1, absent, regranted: await older.allowed(),
        userAgent: navigator.userAgent });
    } finally {
      if (!keep) older.release();
      checking.release();
    }
    """#

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
