import CryptoKit
import XCTest

/// The app as a person launches it: Home and a list's Preview with every remote load blocked, and saved
/// data that survives the app being ended and opened again.
final class LaunchUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func launch(
        probe: String,
        pickerOutcome: String? = nil,
        unreadableRecovery: Bool = false,
        readHandoffTest: Bool = false,
        recordHandOffs: Bool = false,
        isolateRequests: Bool = true,
        liveCorsCheck: Bool = false,
        restoreTestSeed: Bool = false,
        resetDataLossState: Bool = false,
        clearReadingData: Bool = false,
        failFifthJournalPut: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        if isolateRequests { app.launchEnvironment["RECAP_ISOLATE_REQUESTS"] = "1" }
        app.launchEnvironment["RECAP_PROBE_SCRIPT"] = probe
        if let pickerOutcome { app.launchEnvironment["RECAP_IOS_EXPORT_PICKER"] = pickerOutcome }
        if unreadableRecovery { app.launchEnvironment["RECAP_IOS_UNREADABLE_RECOVERY"] = "1" }
        if readHandoffTest { app.launchEnvironment["RECAP_IOS_READ_HANDOFF_TEST"] = "1" }
        if recordHandOffs { app.launchEnvironment["RECAP_IOS_RECORD_HANDOFFS"] = "1" }
        if liveCorsCheck { app.launchEnvironment["RECAP_IOS_LIVE_CORS_CHECK"] = "1" }
        if restoreTestSeed { app.launchEnvironment["RECAP_IOS_RESTORE_TEST_SEED"] = "1" }
        if resetDataLossState { app.launchEnvironment["RECAP_IOS_DATA_LOSS_RESET"] = "1" }
        if clearReadingData { app.launchEnvironment["RECAP_IOS_CLEAR_READING_DATA"] = "1" }
        if failFifthJournalPut { app.launchEnvironment["RECAP_IOS_FAIL_FIFTH_JOURNAL_PUT"] = "1" }
        app.launch()
        return app
    }

    /// The JSON the app's Debug-only probe interface reports for the script it was launched with.
    @MainActor
    private func probeResult(of app: XCUIApplication, timeout: TimeInterval = 90) throws -> [String: Any] {
        let element = app.staticTexts["recap-probe-result"]
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "the probe interface appeared")
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", "pending"), object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [settled], timeout: timeout), .completed, "the probe finished")
        let label = element.label
        XCTAssertFalse(label.hasPrefix("error:"), label)
        let object = try JSONSerialization.jsonObject(with: Data(label.utf8)) as? [String: Any]
        return try XCTUnwrap(object, label)
    }

    @MainActor
    private func handOffRecord(
        of app: XCUIApplication,
        launches: Int,
        handoffs: Int,
        presentations: Int = 0,
        timeout: TimeInterval = 30
    ) throws -> [String: Any] {
        let element = app.staticTexts["ios-handoff-recorder"]
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "the hand-off recorder appeared")
        let predicate = NSPredicate { object, _ in
            guard let element = object as? XCUIElement,
                  let data = element.label.data(using: .utf8),
                  let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let recordedLaunches = record["launches"] as? Int,
                  let recordedPresentations = record["presentations"] as? Int,
                  let recordedHandOffs = record["handoffs"] as? [String] else { return false }
            return recordedLaunches >= launches
                && recordedPresentations >= presentations
                && recordedHandOffs.count >= handoffs
        }
        let settled = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(
            XCTWaiter().wait(for: [settled], timeout: timeout),
            .completed,
            "the requested hand-offs completed; recorder: \(element.label)")
        let data = try XCTUnwrap(element.label.data(using: .utf8))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any], element.label)
    }

    /// The same record the unit tests write, so the workflow's summary finds UI test measurements too.
    @MainActor
    private func record(_ name: String, _ result: [String: Any]) throws {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)
        print("RECAP_PROBE_RESULT \(name) \(json)")
        let attachment = XCTAttachment(string: json)
        attachment.name = "\(name).json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private static let markAndRemoveReadingData = """
    const key = 'mrt.state.v2';
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 4, issues: {}, read: {}, overrides: {}, notes: {}, ratings: {},
      lists: {}, listOrder: [], active: null
    }));
    const reply = await window.webkit.messageHandlers.recap.postMessage({
      v: 1, kind: 'saved-data-present', present: true
    });
    localStorage.removeItem(key);
    return JSON.stringify({
      recorded: reply?.status === 'recorded',
      readingData: localStorage.getItem(key),
    });
    """

    private static let markAndKeepReadingData = """
    const key = 'mrt.state.v2';
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 4, issues: {}, read: {}, overrides: {}, notes: {}, ratings: {},
      lists: {}, listOrder: [], active: null
    }));
    const reply = await window.webkit.messageHandlers.recap.postMessage({
      v: 1, kind: 'saved-data-present', present: true
    });
    return JSON.stringify({
      recorded: reply?.status === 'recorded',
      readingData: localStorage.getItem(key),
    });
    """

    private static func observeDataLossNotice(openSettings: Bool = false) -> String {
        """
    const waitForElement = async (id, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const element = document.getElementById(id);
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out waiting for required element #${id}`);
    };
    const notice = await waitForElement('ios-data-loss-notice');
    const message = await waitForElement('ios-data-loss-message');
    const settingsLink = await waitForElement('ios-data-loss-settings');
    if (\(openSettings)) {
      settingsLink.click();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const view = document.getElementById('view-data');
        if (view && !view.hidden) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (document.getElementById('view-data')?.hidden) {
        throw new Error('Backup & settings did not open from the data-loss notice link');
      }
    }
    return JSON.stringify({
      readingData: localStorage.getItem('mrt.state.v2'),
      noticeHidden: notice.hidden,
      noticeText: message.textContent,
      settingsLinkHref: settingsLink.getAttribute('href'),
      settingsViewVisible: !document.getElementById('view-data').hidden,
    });
    """
    }

    private static let eraseReadingData = """
    const waitFor = async (findElement, description, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const element = findElement();
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out waiting for ${description}`);
    };
    const settingsLink = await waitFor(() => document.querySelector('[data-view="data"]'), 'Backup & settings navigation');
    settingsLink.click();
    await waitFor(() => {
      const view = document.getElementById('view-data');
      return view && !view.hidden ? view : null;
    }, 'Backup & settings view (#view-data)');
    const wipeButton = await waitFor(() => document.getElementById('btn-wipe'), 'erase button (#btn-wipe)');
    wipeButton.click();
    await waitFor(() => {
      const dialog = document.getElementById('ask');
      return dialog && dialog.open ? dialog : null;
    }, 'erase confirmation dialog (#ask)');
    const confirmButton = await waitFor(() => document.getElementById('ask-ok'), 'confirmation button (#ask-ok)');
    confirmButton.click();
    const report = await waitFor(() => {
      const announcer = document.getElementById('announcer');
      return announcer && announcer.textContent.toLowerCase().includes('erased') ? announcer : null;
    }, 'erase confirmation (#announcer)');
    const notice = await waitFor(() => document.getElementById('ios-data-loss-notice'), 'data-loss notice (#ios-data-loss-notice)');
    return JSON.stringify({
      readingDataPresent: localStorage.getItem('mrt.state.v2') !== null,
      noticeHidden: notice.hidden,
      report: report.textContent,
    });
    """

    @MainActor
    func testFreshInstallDoesNotShowDataLossNotice() throws {
        let app = launch(
            probe: Self.observeDataLossNotice(),
            resetDataLossState: true,
            clearReadingData: true)
        let result = try probeResult(of: app)
        XCTAssertNil(result["readingData"] as? String)
        XCTAssertEqual(result["noticeHidden"] as? Bool, true)
        XCTAssertFalse(app.buttons["Dismiss"].exists)
    }

    @MainActor
    func testMissingSavedDataShowsNoticeWithoutWritingAndDismissalPersists() throws {
        let setup = launch(
            probe: Self.markAndRemoveReadingData,
            resetDataLossState: true,
            clearReadingData: true)
        let setupResult = try probeResult(of: setup)
        XCTAssertEqual(setupResult["recorded"] as? Bool, true)
        XCTAssertNil(setupResult["readingData"] as? String, "the setup simulates removal outside the app")
        setup.terminate()

        let app = launch(probe: Self.observeDataLossNotice(openSettings: true))
        let result = try probeResult(of: app)
        XCTAssertNil(result["readingData"] as? String, "loss detection does not write a replacement state")
        XCTAssertEqual(result["noticeHidden"] as? Bool, false)
        XCTAssertTrue(
            (result["noticeText"] as? String)?.contains("Restore from a backup file") == true,
            "the notice names the supported file-restore route: \(String(describing: result["noticeText"]))")
        XCTAssertEqual(result["settingsLinkHref"] as? String, "#/data")
        XCTAssertEqual(result["settingsViewVisible"] as? Bool, true, "the notice link opens Backup & settings")
        let dismissButton = app.buttons["Dismiss"]
        XCTAssertTrue(dismissButton.waitForExistence(timeout: 30))
        dismissButton.tap()
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: dismissButton)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 30), .completed)

        app.terminate()
        app.launchEnvironment["RECAP_PROBE_SCRIPT"] = Self.observeDataLossNotice()
        app.launch()
        let afterRelaunch = try probeResult(of: app)
        XCTAssertNil(afterRelaunch["readingData"] as? String)
        XCTAssertEqual(afterRelaunch["noticeHidden"] as? Bool, true)
    }

    @MainActor
    func testInAppEraseKeepsAnEmptyReadingDataKeyAndDoesNotShowLossNotice() throws {
        let setup = launch(
            probe: Self.markAndKeepReadingData,
            resetDataLossState: true,
            clearReadingData: true)
        let setupResult = try probeResult(of: setup)
        XCTAssertEqual(setupResult["recorded"] as? Bool, true)
        XCTAssertNotNil(setupResult["readingData"] as? String)
        setup.terminate()

        let app = launch(probe: Self.eraseReadingData)
        let result = try probeResult(of: app)
        XCTAssertEqual(result["readingDataPresent"] as? Bool, true)
        XCTAssertEqual(result["noticeHidden"] as? Bool, true)
        XCTAssertFalse(app.buttons["Dismiss"].exists)
    }

    @MainActor
    func testHomeAndAListPreviewOpenWithEveryRemoteLoadBlocked() throws {
        let app = launch(probe: Self.homeAndPreview)
        // The iOS 18.5 Simulator runs the page at about half the newest runtime's speed, and missed a
        // 90 s wait for this probe that the newest runtime finished in under a minute.
        let result = try probeResult(of: app, timeout: 240)
        try record("home-and-preview", result)
        XCTAssertEqual(result["origin"] as? String, "recappage://localhost")
        XCTAssertEqual(result["home"] as? Bool, true)
        XCTAssertEqual(result["opener"] as? Bool, true, "House of M's card offered Preview")
        XCTAssertEqual(result["previewIssues"] as? Int, 20, "Preview listed all twenty House of M issues")
        XCTAssertEqual(result["routeRequests"] as? Int, 1, "the route fix handles the first catalog request without a retry")
        let routeAttempts = try XCTUnwrap(result["routeAttempts"] as? [[String: Any]])
        XCTAssertFalse(routeAttempts.isEmpty, "at least one catalog route attempt was recorded")
        for attempt in routeAttempts {
            XCTAssertNotNil(attempt["address"])
            XCTAssertNotNil(attempt["branch"])
            XCTAssertNotNil(attempt["addressAfterRequest"])
            XCTAssertNotNil(attempt["branchAfterRequest"])
            XCTAssertNotNil(attempt["replaceStateCalls"] as? [[String: Any]])
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "preview-with-remote-loads-blocked"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    func testSavedDataSurvivesTheAppEndingAndOpeningAgain() throws {
        let token = UUID().uuidString
        let writer = launch(probe: """
        localStorage.setItem('recap-ios-relaunch-probe', '\(token)');
        // WebKit commits stored values in batches, so the write is given time to land before the app ends.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        let persist = 'unavailable';
        try {
          if (navigator.storage?.persist) persist = await navigator.storage.persist();
        } catch (error) {
          persist = `error: ${error.message}`;
        }
        return JSON.stringify({ origin: location.origin, persist, written: localStorage.getItem('recap-ios-relaunch-probe') });
        """)
        let written = try probeResult(of: writer)
        try record("relaunch-writer", written)
        XCTAssertEqual(written["origin"] as? String, "recappage://localhost")
        // Recorded rather than asserted, as the capability probe records it.
        XCTAssertNotNil(written["persist"])
        XCTAssertEqual(written["written"] as? String, token)
        writer.terminate()

        let reader = launch(probe: """
        const found = localStorage.getItem('recap-ios-relaunch-probe');
        localStorage.removeItem('recap-ios-relaunch-probe');
        return JSON.stringify({ found });
        """)
        XCTAssertEqual(try probeResult(of: reader)["found"] as? String, token)
    }

    @MainActor
    func testSavedReadingDataIsWholeAfterForcedTerminationAtEachDelay() throws {
        for afterBackground in [false, true] {
            for delayMs in [0, 250, 750] {
                let writer = launch(
                    probe: Self.writeDurabilityData,
                    resetDataLossState: true,
                    clearReadingData: true)
                let written = try probeResult(of: writer, timeout: 180)
                XCTAssertEqual(written["writeOk"] as? Bool, true)
                let before = try XCTUnwrap(written["before"] as? String)
                let after = try XCTUnwrap(written["after"] as? String)
                let beforeHash = Self.sha256(before)
                let afterHash = Self.sha256(after)
                XCTAssertNotEqual(beforeHash, afterHash, "the save changes canonical reading data")
                let savedAtMs = try XCTUnwrap(written["savedAtMs"] as? Double)

                var backgroundAtMs: Double?
                if afterBackground {
                    XCUIDevice.shared.press(.home)
                    let backgrounded = XCTNSPredicateExpectation(
                        predicate: NSPredicate { _, _ in writer.state == .runningBackground },
                        object: writer)
                    XCTAssertEqual(
                        XCTWaiter.wait(for: [backgrounded], timeout: 10),
                        .completed,
                        "the app moved to the background before the forced termination")
                    backgroundAtMs = Date().timeIntervalSince1970 * 1000
                }
                if delayMs > 0 {
                    Thread.sleep(forTimeInterval: Double(delayMs) / 1000)
                }

                let killRequestedAtMs = Date().timeIntervalSince1970 * 1000
                writer.terminate()
                let killCompletedAtMs = Date().timeIntervalSince1970 * 1000
                let reader = launch(probe: Self.readDurabilityData)
                let found = try probeResult(of: reader, timeout: 180)
                let observed = try XCTUnwrap(found["readingData"] as? String)
                let observedHash = Self.sha256(observed)
                let backgroundDelay: Any = backgroundAtMs.map {
                    Int((killRequestedAtMs - $0).rounded())
                } ?? NSNull()
                try record(
                    "forced-kill-\(afterBackground ? "background" : "foreground")-\(delayMs)",
                    [
                        "requestedDelayMs": delayMs,
                        "elapsedSinceSaveMs": Int((killRequestedAtMs - savedAtMs).rounded()),
                        "elapsedFromBackgroundMs": backgroundDelay,
                        "killDurationMs": Int((killCompletedAtMs - killRequestedAtMs).rounded()),
                        "beforeHash": beforeHash,
                        "afterHash": afterHash,
                        "observedHash": observedHash,
                    ])
                XCTAssertTrue(
                    observedHash == beforeHash || observedHash == afterHash,
                    "the reading data is one whole canonical state, not a partial write")
                reader.terminate()
            }
        }

        let cleanup = launch(
            probe: Self.emptyReadingData,
            resetDataLossState: true,
            clearReadingData: true)
        XCTAssertTrue(try probeResult(of: cleanup)["readingData"] is NSNull)
        cleanup.terminate()
    }

    @MainActor
    func testFifthJournalPutFailureOffersRecoveryAfterForcedTermination() throws {
        let faultDisabled = ProcessInfo.processInfo.environment["RECAP_IOS_DISABLE_FIFTH_JOURNAL_PUT"] == "1"
        let writer = launch(
            probe: Self.startInterruptedCompleteRestore,
            restoreTestSeed: true,
            failFifthJournalPut: !faultDisabled)
        let beforeKill = try probeResult(of: writer, timeout: 180)
        try record("journal-fault-before-kill", beforeKill)
        writer.terminate()
        XCTAssertEqual(
            (beforeKill["restoreLockReadiness"] as? [String: Any])?["ready"] as? Bool,
            true,
            "the restore began only after this page held the sole shared restore lock: \(String(describing: beforeKill["restoreLockReadiness"]))")

        let reader = launch(probe: Self.inspectInterruptedCompleteRestore)
        let recovered = try probeResult(of: reader, timeout: 180)
        try record("journal-fault-after-kill", recovered)
        XCTAssertEqual(
            recovered["stateTableRow"] as? String,
            "none or active / matching / anything else",
            "the fault-disabled mutation must reach the done row: \(String(describing: recovered["stateTableRow"]))")
        XCTAssertTrue((beforeKill["report"] as? String ?? "").contains("stopped part way"))
        XCTAssertTrue((beforeKill["marker"] as? String ?? "").hasPrefix("active:"))
        XCTAssertEqual(beforeKill["journalKind"] as? String, "valid")
        XCTAssertEqual(beforeKill["journalPhase"] as? String, "applying")
        XCTAssertEqual(
            beforeKill["journalWrites"] as? Int,
            2,
            "the fifth journal put fails after two restore writes are checkpointed")
        XCTAssertEqual(beforeKill["decisionKind"] as? String, "recovery")
        XCTAssertEqual(beforeKill["recoveryKind"] as? String, "interrupted")
        XCTAssertTrue(["absent", "active"].contains(recovered["markerState"] as? String ?? ""))
        XCTAssertEqual(recovered["journalKind"] as? String, "valid")
        XCTAssertEqual(recovered["journalMatchesMarker"] as? Bool, true)
        XCTAssertEqual(recovered["decisionKind"] as? String, "recovery")
        XCTAssertEqual(recovered["recoveryKind"] as? String, "interrupted")
        XCTAssertEqual(recovered["finishVisible"] as? Bool, true)
        XCTAssertEqual(recovered["priorCopyVisible"] as? Bool, true)
        XCTAssertNotNil(recovered["data"] as? [String: Any], "the post-kill saved bytes were recorded")

        let finish = reader.buttons["Finish restore"]
        XCTAssertTrue(finish.waitForExistence(timeout: 30))
        revealNativeTarget(finish, in: reader)
        finish.tap()
        let question = reader.staticTexts["Finish the complete restore?"]
        let questionVisible = question.waitForExistence(timeout: 15)
        if !questionVisible {
            try record("journal-fault-confirmation-missing", ["nativeHierarchy": reader.debugDescription])
        }
        XCTAssertTrue(questionVisible, "finishing recovery asks for confirmation before writing")
        let confirm = reader.buttons["Finish restore"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 15))
        let confirmHittable = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in confirm.isHittable },
            object: confirm)
        XCTAssertEqual(XCTWaiter.wait(for: [confirmHittable], timeout: 15), .completed)
        confirm.tap()
        let recoveryClosed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: finish)
        XCTAssertEqual(XCTWaiter.wait(for: [recoveryClosed], timeout: 45), .completed)
        reader.terminate()
    }

    private static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    @MainActor
    func testCancelledAndFailedUnreadableDataExportsDoNotAuthorizeStartingFresh() throws {
        for outcome in ["cancel", "fail"] {
            let app = launch(
                probe: Self.recoveryExport,
                pickerOutcome: outcome,
                unreadableRecovery: true)
            let download = app.buttons["Download a copy of the unreadable data"]
            XCTAssertTrue(download.waitForExistence(timeout: 90), "the unreadable-data export button appeared")
            download.tap()
            let result = try probeResult(of: app)
            try record("recovery-export-\(outcome)", result)
            XCTAssertEqual(result["original"] as? String, "{unreadable")
            XCTAssertEqual(result["after"] as? String, "{unreadable", "the unreadable original remains untouched")
            XCTAssertEqual(result["blocked"] as? Bool, true, "saving remains paused")
            XCTAssertEqual(result["confirmationFound"] as? Bool, true, "the attempted fresh start required confirmation")
            let report = result["exportReport"] as? String ?? ""
            if outcome == "cancel" {
                XCTAssertTrue(report.localizedCaseInsensitiveContains("cancelled"), report)
            } else {
                XCTAssertTrue(report.localizedCaseInsensitiveContains("not confirmed saved"), report)
            }
        }
    }

    @MainActor
    func testReadOpensTwoFreshLaunchersAndHandsOffEachResolvedDestination() throws {
        let app = launch(
            probe: "return JSON.stringify({ origin: location.origin });",
            readHandoffTest: true,
            recordHandOffs: true)
        for expected in 1...2 {
            let read = app.buttons["Open Read test"]
            XCTAssertTrue(read.waitForExistence(timeout: 60), "Read launch \(expected) control appeared")
            read.tap()
            _ = try handOffRecord(
                of: app,
                launches: expected,
                handoffs: expected,
                presentations: expected)
            let close = app.buttons["ios-read-sheet-close"]
            XCTAssertTrue(close.waitForExistence(timeout: 30), "Read launch \(expected) sheet remains for observation")
            close.tap()
            let dismissed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"),
                object: close)
            XCTAssertEqual(
                XCTWaiter.wait(for: [dismissed], timeout: 30),
                .completed,
                "Read launch \(expected) sheet dismissed after the test observed its hand-off")
        }

        let result = try handOffRecord(of: app, launches: 2, handoffs: 2)
        let urls = try XCTUnwrap(result["handoffs"] as? [String])
        XCTAssertEqual(urls.count, 2)
        let destinations = try urls.map { value -> URL in
            let destination = try XCTUnwrap(URL(string: value), value)
            XCTAssertEqual(destination.scheme, "https")
            XCTAssertFalse(destination.host?.isEmpty ?? true)
            return destination
        }
        XCTAssertEqual(destinations[0], destinations[1], "the launcher produced the same destination for each tap")
        try record("read-hand-offs", result)
    }

    @MainActor
    func testFailedReadLookupShowsFallbackBeforeHandingItOff() throws {
        let app = launch(
            probe: "return JSON.stringify({ origin: location.origin });",
            readHandoffTest: true,
            recordHandOffs: true)
        let read = app.buttons["Open failing Read test"]
        XCTAssertTrue(read.waitForExistence(timeout: 30), "the failing-lookup test Read control appeared")
        read.tap()
        XCTAssertTrue(app.staticTexts["Reader lookup failed"].waitForExistence(timeout: 90))
        XCTAssertTrue(app.buttons["ios-read-sheet-close"].exists, "the fallback stays in a sheet with a Close control")
        let fallback = app.links["Continue manually"]
        XCTAssertTrue(fallback.waitForExistence(timeout: 30), "the failed lookup leaves a manual fallback link")
        let close = app.buttons["ios-read-sheet-close"]
        let window = app.windows.element(boundBy: 0)
        print("iOS T02 fallback geometry: link=\(fallback.frame), Close=\(close.frame), window=\(window.frame)")
        let followFallback = app.buttons["ios-test-follow-fallback"]
        XCTAssertTrue(followFallback.waitForExistence(timeout: 30), "the Debug-only fallback trigger appeared")
        followFallback.tap()
        let result = try handOffRecord(of: app, launches: 1, handoffs: 1)
        let urls = try XCTUnwrap(result["handoffs"] as? [String])
        XCTAssertEqual(urls.count, 1)
        XCTAssertEqual(try XCTUnwrap(URL(string: urls[0])).scheme, "https")
        try record("read-failed-lookup-fallback", result)
        XCTAssertTrue(close.waitForExistence(timeout: 30), "the failed-lookup sheet remains for observation")
        close.tap()
    }

    @MainActor
    func testCreditLinkLeavesTheAppAndKeepsTheAboutPageOpen() throws {
        let app = launch(
            probe: """
            document.querySelector('[data-view="about"]').click();
            await new Promise((resolve) => setTimeout(resolve, 250));
            return JSON.stringify({ hash: location.hash });
            """,
            recordHandOffs: true)
        XCTAssertTrue(app.links["Comic Book Herald"].waitForExistence(timeout: 30))
        app.links["Comic Book Herald"].tap()
        let result = try handOffRecord(of: app, launches: 0, handoffs: 1)
        let urls = try XCTUnwrap(result["handoffs"] as? [String])
        XCTAssertEqual(urls.count, 1)
        XCTAssertEqual(try XCTUnwrap(URL(string: urls[0])).scheme, "https")
        XCTAssertTrue(app.staticTexts["Opening the link outside Recap Page."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["About this app"].exists, "the app stayed on its About page")
        XCTAssertTrue(app.links["Comic Book Herald"].exists, "the original credit link remains in the app")
        try record("credit-link-hand-off", result)
    }

    @MainActor
    func testValidReadingBackupRestoresThroughTheFileInput() throws {
        let app = launch(
            probe: Self.validReadingRestore,
            restoreTestSeed: true)
        let result = try probeResult(of: app)
        try record("reading-backup-restore", result)
        XCTAssertTrue((result["report"] as? String ?? "").contains("Reading data restored"))
        XCTAssertEqual(result["restoredList"] as? String, "Restored by iOS file chooser")
    }

    @MainActor
    func testInvalidReadingBackupDoesNotWrite() throws {
        let app = launch(
            probe: Self.invalidReadingRestore,
            restoreTestSeed: true)
        let result = try probeResult(of: app)
        try record("invalid-reading-backup-restore", result)
        XCTAssertEqual(result["before"] as? String, result["after"] as? String)
        XCTAssertTrue((result["report"] as? String ?? "").contains("Reading data is unchanged"))
        XCTAssertEqual(result["dialogOpen"] as? Bool, false)
    }

    @MainActor
    func testManualLiveMetadataCorsFromTheAppOrigin() throws {
        guard ProcessInfo.processInfo.environment["RECAP_RUN_LIVE_CORS"] == "1" else {
            throw XCTSkip("The live metadata CORS check runs only from an opted-in workflow_dispatch.")
        }
        let app = launch(probe: Self.liveCorsProbe, isolateRequests: false, liveCorsCheck: true)
        let result = try probeResult(of: app)
        try record("live-metadata-cors", result)
        XCTAssertEqual(result["origin"] as? String, "recappage://localhost")
        XCTAssertEqual(result["cors"] as? String, "allowed", String(describing: result))
    }

    private static let homeAndPreview = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) return null;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    const home = await until(() => {
      const view = document.getElementById('view-home');
      return Boolean(view) && !view.hidden;
    }, 30000);
    // A named single list, as the desktop checks open one: the first card in the timeline can open a
    // grouped Preview with no issue links. House of M is the smallest fixture, at 20 issues. #963
    // fixes the hash/redraw race that once forced this probe to retry; each attempt records the URL
    // and any replaceState call, and the UI test requires the first request to succeed.
    const catalogShown = () => {
      const view = document.getElementById('view-catalog');
      return Boolean(view) && !view.hidden;
    };
    const replaceStateCalls = [];
    const replaceState = history.replaceState;
    history.replaceState = function (state, title, url) {
      replaceStateCalls.push({ address: location.href, branch: location.hash, url: url ?? null });
      return replaceState.call(this, state, title, url);
    };
    const routeAttempts = [];
    let routeRequests = 0;
    const routeEnd = Date.now() + 60000;
    while (!catalogShown() && Date.now() < routeEnd) {
      routeRequests += 1;
      const replaceStateStart = replaceStateCalls.length;
      const address = location.href;
      const branch = location.hash;
      if (location.hash === '#/catalog') window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = '#/catalog';
      const addressAfterRequest = location.href;
      const branchAfterRequest = location.hash;
      await until(catalogShown, 3000);
      routeAttempts.push({
        address,
        branch,
        addressAfterRequest,
        branchAfterRequest,
        addressAfterWait: location.href,
        branchAfterWait: location.hash,
        replaceStateCalls: replaceStateCalls.slice(replaceStateStart),
      });
    }
    const search = catalogShown() ? document.getElementById('catalog-q') : null;
    if (search) {
      search.value = 'House of M';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const opener = await until(
      () => document.querySelector('#catalog-results [data-story="list:house-of-m"] [data-act="preview"]'), 30000);
    opener?.click();
    await until(() => document.querySelectorAll('#preview[open] .preview-issue-link').length >= 20, 30000);
    const body = document.getElementById('preview-body');
    return JSON.stringify({
      origin: location.origin,
      home: Boolean(home),
      routeRequests,
      routeAttempts,
      hash: location.hash,
      views: [...document.querySelectorAll('.view:not([hidden])')].map((view) => view.id),
      dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
      shellInert: Boolean(document.getElementById('shell')?.inert),
      searched: Boolean(search),
      opener: Boolean(opener),
      previewOpen: Boolean(document.querySelector('#preview[open]')),
      previewIssues: document.querySelectorAll('#preview[open] .preview-issue-link').length,
      previewText: (body?.textContent ?? '').trim().slice(0, 160),
    });
    """#

    private static let recoveryExport = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) return null;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const original = localStorage.getItem('mrt.state.v2');
    const downloadButton = document.getElementById('btn-download-salvage');
    let downloadClickObserved = false;
    downloadButton.addEventListener('click', () => { downloadClickObserved = true; }, { once: true });
    const clickObserved = await until(() => downloadClickObserved, 90000);
    if (!clickObserved) throw new Error('the unreadable-data export button was not tapped');
    const exportReport = await until(() => {
      const text = document.getElementById('ios-report')?.textContent ?? '';
      return /cancelled|not confirmed saved/i.test(text) ? text : null;
    }, 30000);
    const reports = ['ios-report', 'save-report', 'app-report']
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    document.getElementById('btn-start-fresh').click();
    const dialog = await until(() => document.querySelector('dialog[open]'), 10000);
    const confirmation = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent.trim() === 'Start fresh');
    confirmation?.click();
    await until(() => !document.querySelector('dialog[open]'), 10000);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return JSON.stringify({
      original,
      after: localStorage.getItem('mrt.state.v2'),
      blocked: !document.getElementById('blocked-banner').hidden,
      exportReport: exportReport ?? reports.join(' | '),
      nativeExportBridge: typeof window.webkit?.messageHandlers?.recap?.postMessage === 'function',
      iosReportPresent: Boolean(document.getElementById('ios-report')),
      downloadButtonConnected: downloadButton.isConnected,
      downloadButtonDisabled: downloadButton.disabled,
      downloadClickObserved,
      confirmationFound: Boolean(confirmation),
    });
    """#

    private static let liveCorsProbe = #"""
    let settings = JSON.parse(localStorage.getItem('mrt.settings') || '{}');
    let base = String(settings.apiBase || 'https://marvel.emreparker.com/v1').replace(/\/+$/, '');
    const target = new URL(`${base}/issues/6482`);
    try {
      const response = await fetch(target.href, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      await response.text();
      return JSON.stringify({ origin: location.origin, cors: 'allowed', status: response.status });
    } catch (error) {
      return JSON.stringify({ origin: location.origin, cors: 'blocked', error: error.message });
    }
    """#

    private static let validReadingRestore = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for the reading backup restore');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    document.querySelector('[data-view="data"]').click();
    await until(() => !document.getElementById('view-data').hidden, 15000);
    const model = await import(new URL('./js/lib/model.js', location.href).href);
    const storage = await import(new URL('./js/storage.js', location.href).href);
    const state = model.createList(model.createEmptyState(), {
      id: 'ios-picker-restore',
      name: 'Restored by iOS file chooser',
    });
    const file = new File([JSON.stringify(model.exportBackup(state))], 'reading-backup.json', {
      type: 'application/json',
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('restore-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.getElementById('ask').open, 15000);
    let lockReadiness = async () => {
      if (typeof navigator.locks?.query !== 'function') {
        return { available: false, error: 'LockManager.query is unavailable', held: [], pending: [] };
      }
      const state = await navigator.locks.query();
      const relevant = (locks) => locks
        .filter(({ name }) => name === storage.RESTORE_LOCK)
        .map(({ name, mode }) => ({ name, mode }));
      return { available: true, held: relevant(state.held), pending: relevant(state.pending) };
    };
    let readiness = null;
    let ready = false;
    const readinessDeadline = Date.now() + 15000;
    while (Date.now() < readinessDeadline) {
      try {
        readiness = await lockReadiness();
      } catch (error) {
        readiness = { available: false, error: error.message, held: [], pending: [] };
      }
      if (readiness.available
          && readiness.held.length === 1
          && readiness.held[0].mode === 'shared'
          && readiness.pending.length === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      return JSON.stringify({
        report: 'Restore was not started because lock readiness was not established.',
        restoreLockReadiness: { ready, ...readiness },
      });
    }
    document.getElementById('ask-ok').click();
    await until(() => document.getElementById('restore-report').textContent.includes('Reading data restored'), 30000);
    const stored = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return JSON.stringify({
      report: document.getElementById('restore-report').textContent,
      restoredList: stored.lists['ios-picker-restore']?.name ?? null,
    });
    """#

    private static let invalidReadingRestore = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for the invalid-file refusal');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    document.querySelector('[data-view="data"]').click();
    await until(() => !document.getElementById('view-data').hidden, 15000);
    const before = localStorage.getItem('mrt.state.v2');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not a backup'], 'invalid.json', { type: 'application/json' }));
    const input = document.getElementById('restore-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.getElementById('restore-report').textContent.length > 0, 15000);
    return JSON.stringify({
      before,
      after: localStorage.getItem('mrt.state.v2'),
      report: document.getElementById('restore-report').textContent,
      dialogOpen: document.getElementById('ask').open,
    });
    """#

    private static let writeDurabilityData = #"""
    const [storage, model] = await Promise.all([
      import(new URL('./js/storage.js', location.href).href),
      import(new URL('./js/lib/model.js', location.href).href),
    ]);
    const store = new storage.Store({ storage: localStorage });
    store.load();
    const beforeState = model.createList(model.createEmptyState(), {
      id: 'ios-durability-before',
      name: 'Before forced termination',
    });
    const afterState = model.createList(model.createEmptyState(), {
      id: 'ios-durability-after',
      name: 'After forced termination',
    });
    store.update(() => beforeState);
    if (!store.lastUpdateOk) throw new Error(`The prior reading state was not saved: ${store.lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const before = localStorage.getItem(storage.KEY);
    store.update(() => afterState);
    if (!store.lastUpdateOk) throw new Error(`The new reading state was not saved: ${store.lastError}`);
    const after = localStorage.getItem(storage.KEY);
    if (before === null || after === null) throw new Error('The saved reading state was missing.');
    return JSON.stringify({ before, after, savedAtMs: Date.now(), writeOk: true });
    """#

    private static let readDurabilityData = #"""
    return JSON.stringify({ readingData: localStorage.getItem('mrt.state.v2') });
    """#

    private static let emptyReadingData = #"""
    return JSON.stringify({ readingData: localStorage.getItem('mrt.state.v2') });
    """#

    private static let startInterruptedCompleteRestore = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for the interrupted complete restore');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    document.querySelector('[data-view="data"]').click();
    await until(() => !document.getElementById('view-data').hidden, 15000);
    const [storage, model, complete, restore] = await Promise.all([
      import(new URL('./js/storage.js', location.href).href),
      import(new URL('./js/lib/model.js', location.href).href),
      import(new URL('./js/lib/completeBackup.js', location.href).href),
      import(new URL('./js/lib/completeRestore.js', location.href).href),
    ]);
    const store = new storage.Store({ storage: localStorage });
    store.load();
    const prior = model.createList(model.createEmptyState(), {
      id: 'ios-restore-prior',
      name: 'Prior data',
    });
    const restored = model.createList(model.createEmptyState(), {
      id: 'ios-restore-target',
      name: 'Restored data',
    });
    store.update(() => prior);
    if (!store.lastUpdateOk) throw new Error(`The prior data could not be saved: ${store.lastError}`);
    store.update(() => restored);
    if (!store.lastUpdateOk) throw new Error(`The restore target could not be saved: ${store.lastError}`);
    const backup = await complete.captureCompleteBackup({ storage: localStorage });
    store.update(() => prior);
    if (!store.lastUpdateOk) throw new Error(`The prior data could not be restored for the test: ${store.lastError}`);
    const transfer = new DataTransfer();
    transfer.items.add(new File([backup.text], 'interrupted-complete-backup.json', { type: 'application/json' }));
    const input = document.getElementById('restore-complete');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.getElementById('ask').open, 15000);
    let readiness = null;
    let ready = false;
    if (typeof navigator.locks?.query !== 'function') {
      readiness = { available: false, error: 'LockManager.query is unavailable', held: [], pending: [] };
    } else {
      const readinessDeadline = Date.now() + 15000;
      while (Date.now() < readinessDeadline) {
        try {
          const state = await navigator.locks.query();
          const relevant = (locks) => locks
            .filter(({ name }) => name === storage.RESTORE_LOCK)
            .map(({ name, mode }) => ({ name, mode }));
          readiness = { available: true, held: relevant(state.held), pending: relevant(state.pending) };
        } catch (error) {
          readiness = { available: false, error: error.message, held: [], pending: [] };
        }
        if (readiness.available
            && readiness.held.length === 1
            && readiness.held[0].mode === 'shared'
            && readiness.pending.length === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!ready) {
      return JSON.stringify({
        report: 'Restore was not started because lock readiness was not established.',
        restoreLockReadiness: { ready, ...readiness },
      });
    }
    // A restore that finishes reloads the page, and WebKit then drops this probe's completion handler
    // ("Completion handler for function call is no longer reachable", run 41169003243). Settling at
    // the unload keeps that outcome reportable. It carries no report, so the fault-on assertions that
    // require "stopped part way" still fail on it.
    const unloaded = new Promise((resolve) => {
      const settle = (event) => resolve(JSON.stringify({
        report: null,
        unloadedAfterRestore: event.type,
        restoreLockReadiness: { ready, ...readiness },
      }));
      addEventListener('beforeunload', settle, { once: true });
      addEventListener('pagehide', settle, { once: true });
    });
    document.getElementById('ask-ok').click();
    const reported = until(() => {
      const text = document.getElementById('complete-backup-report').textContent;
      return text.length > 0 ? text : null;
    }, 30000);
    const report = await Promise.race([reported, unloaded.then(() => null)]);
    if (report === null) return unloaded;
    const inspector = new restore.CompleteRestore();
    const journal = await inspector.readJournal();
    const marker = restore.readMarker(localStorage);
    const decision = restore.decideRestoreState(marker, journal, localStorage, Date.now());
    const data = Object.fromEntries(complete.RESTORE_KEYS.map((key) => [key, localStorage.getItem(key)]));
    return JSON.stringify({
      report,
      restoreLockReadiness: { ready, ...readiness },
      marker: marker.raw,
      journalKind: journal.kind,
      journalPhase: journal.record?.phase ?? null,
      journalWrites: journal.record?.writes ?? null,
      decisionKind: decision.kind,
      recoveryKind: decision.recovery?.kind ?? null,
      data,
    });
    """#

    private static let inspectInterruptedCompleteRestore = #"""
    const until = async (check, ms) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for recovery after the process kill');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    document.querySelector('[data-view="data"]').click();
    await until(() => !document.getElementById('view-data').hidden, 15000);
    const [complete, restore] = await Promise.all([
      import(new URL('./js/lib/completeBackup.js', location.href).href),
      import(new URL('./js/lib/completeRestore.js', location.href).href),
    ]);
    const inspector = new restore.CompleteRestore();
    const state = await until(async () => {
      const journal = await inspector.readJournal();
      const marker = restore.readMarker(localStorage);
      const decision = restore.decideRestoreState(marker, journal, localStorage, Date.now());
      const recovery = document.getElementById('complete-restore-recovery');
      const interrupted = decision.kind === 'recovery' && recovery && !recovery.hidden;
      const finished = marker.state === 'done'
        && journal.kind === 'valid'
        && marker.id === journal.record.id
        && journal.record.phase === 'done';
      return interrupted || finished ? { journal, marker, decision } : null;
    }, 30000);
    const { journal, marker, decision } = state;
    const matches = journal.kind === 'valid'
      && (marker.state === 'absent' || ['active', 'done'].includes(marker.state) && marker.id === journal.record.id);
    let row = 'unmatched';
    if (matches && decision.kind === 'recovery' && decision.recovery?.kind === 'interrupted') {
      row = 'none or active / matching / anything else';
    } else if (matches && marker.state === 'done' && journal.record.phase === 'done') {
      row = 'done: / matching / any';
    } else if (marker.state === 'absent' && journal.kind === 'absent' && decision.kind === 'none') {
      row = 'none / none / any';
    }
    const data = Object.fromEntries(complete.RESTORE_KEYS.map((key) => [key, localStorage.getItem(key)]));
    return JSON.stringify({
      marker: marker.raw,
      markerState: marker.state,
      journalKind: journal.kind,
      journalPhase: journal.record?.phase ?? null,
      journalWrites: journal.record?.writes ?? null,
      journalMatchesMarker: matches,
      decisionKind: decision.kind,
      recoveryKind: decision.recovery?.kind ?? null,
      stateTableRow: row,
      finishVisible: !document.getElementById('btn-complete-finish').hidden,
      priorCopyVisible: !document.getElementById('btn-complete-prior-copy').hidden,
      recoveryMessage: document.getElementById('complete-restore-recovery-status').textContent,
      data,
    });
    """#
}
