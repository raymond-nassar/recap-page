import UIKit
import XCTest

/// Captures the App Store product page screenshots. It runs only when the iOS workflow is dispatched
/// with app_store_screenshots, which supplies the screens; every other run skips it.
@MainActor
final class AppStoreScreenshotUITests: XCTestCase {
    private struct Screen: Decodable {
        let name: String
        let appearance: String
        let seed: String
        let probe: String
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCaptureAppStoreScreens() throws {
        guard let json = ProcessInfo.processInfo.environment["RECAP_APP_STORE_SCREENS"], !json.isEmpty else {
            throw XCTSkip("Runs only for the hand-started App Store screenshot capture")
        }
        guard let set = ProcessInfo.processInfo.environment["RECAP_APP_STORE_SET"] else {
            XCTFail("The screenshot set is missing")
            return
        }
        let screens = try JSONDecoder().decode([Screen].self, from: Data(json.utf8))
        let shared = [
            "01-home", "02-modern-timeline", "03-reading-list", "04-storylines",
            "05-professor-x", "06-library", "07-backup-settings",
        ]
        let expected: [String]
        switch set {
        case "ipad-13":
            expected = shared
        case "iphone-6.3", "iphone-6.9":
            expected = shared + ["08-about-your-data"]
        default:
            XCTFail("Unknown screenshot set: \(set)")
            return
        }
        XCTAssertEqual(screens.map(\.name), expected, "screens for \(set)")
        XCUIDevice.shared.orientation = .portrait
        for screen in screens {
            XCTAssertTrue(["Dark", "Light"].contains(screen.appearance), screen.name)
            let app = XCUIApplication()
            app.launchArguments = [
                "-UIPreferredContentSizeCategoryName", UIContentSizeCategory.large.rawValue,
                "-uiUserInterfaceStyle", screen.appearance,
            ]
            app.launchEnvironment["RECAP_ISOLATE_REQUESTS"] = "1"
            app.launchEnvironment["RECAP_IOS_DATA_LOSS_RESET"] = "1"
            app.launchEnvironment["RECAP_IOS_SCREENSHOT_SEED"] = screen.seed
            app.launchEnvironment["RECAP_PROBE_SCRIPT"] = screen.probe
            app.launch()
            let result = app.staticTexts["recap-probe-result"]
            XCTAssertTrue(result.waitForExistence(timeout: 240), "\(screen.name): the probe appeared")
            let settled = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label != %@", "pending"), object: result)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 240), .completed, "\(screen.name): the probe finished")
            XCTAssertEqual(result.label, "ready", screen.name)
            // Let scroll indicators fade before the capture.
            Thread.sleep(forTimeInterval: 2)
            let attachment = XCTAttachment(
                data: XCUIScreen.main.screenshot().pngRepresentation, uniformTypeIdentifier: "public.png")
            attachment.name = "\(screen.name).png"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
    }
}
