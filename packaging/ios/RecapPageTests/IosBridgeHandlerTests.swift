import XCTest
@testable import RecapPage

final class IOSExportRequestTests: XCTestCase {
    private let policy = NavigationPolicy(scheme: "recappage", host: "localhost")

    private func body(text: String = "backup") -> [String: Any] {
        [
            "v": 1,
            "kind": "save",
            "id": "save-1",
            "filename": "backup.json",
            "type": "application/json",
            "text": text,
        ]
    }

    func testAcceptsOnlyAValidatedBoundedTextExport() throws {
        let request = try XCTUnwrap(IOSExportRequest(body: body()))
        XCTAssertEqual(request.id, "save-1")
        XCTAssertEqual(request.filename, "backup.json")
        XCTAssertEqual(request.type, "application/json")
        XCTAssertEqual(request.data, Data("backup".utf8))

        var invalid = body()
        invalid["filename"] = "../backup.json"
        XCTAssertNil(IOSExportRequest(body: invalid))
        invalid = body()
        invalid["filename"] = "backup.txt"
        XCTAssertNil(IOSExportRequest(body: invalid))
        invalid = body()
        invalid["type"] = "image/png"
        XCTAssertNil(IOSExportRequest(body: invalid))
        invalid = body()
        invalid["v"] = 2
        XCTAssertNil(IOSExportRequest(body: invalid))

        invalid = body(text: String(repeating: "é", count: IOSExportRequest.maximumBytes / 2 + 1))
        XCTAssertNil(IOSExportRequest(body: invalid), "the UTF-8 byte limit rejects wide text above 32 MiB")
    }

    func testOnlyTheMainAppPageMayRequestAnExport() throws {
        let appPage = try XCTUnwrap(URL(string: "recappage://localhost/"))
        let otherPage = try XCTUnwrap(URL(string: "https://example.com/"))
        let queriedAppPage = try XCTUnwrap(URL(string: "recappage://localhost/?unexpected=1"))
        XCTAssertTrue(IOSExportRequest.isTrustedPage(appPage, isMainFrame: true, policy: policy))
        XCTAssertFalse(IOSExportRequest.isTrustedPage(appPage, isMainFrame: false, policy: policy))
        XCTAssertFalse(IOSExportRequest.isTrustedPage(otherPage, isMainFrame: true, policy: policy))
        XCTAssertFalse(IOSExportRequest.isTrustedPage(queriedAppPage, isMainFrame: true, policy: policy))
        XCTAssertFalse(IOSExportRequest.isTrustedPage(nil, isMainFrame: true, policy: policy))
    }
}

@MainActor
final class IosBridgeHandlerTests: XCTestCase {
    private let policy = NavigationPolicy(scheme: "recappage", host: "localhost")
    private let fileManager = FileManager.default

    private func temporaryRoot() throws -> URL {
        let root = fileManager.temporaryDirectory.appendingPathComponent("recap-ios-bridge-tests-\(UUID().uuidString)")
        try fileManager.createDirectory(at: root, withIntermediateDirectories: false)
        return root
    }

    private func remove(_ root: URL) {
        do {
            try fileManager.removeItem(at: root)
        } catch {
            XCTFail("Could not remove test export directory: \(error.localizedDescription)")
        }
    }

    private func request() throws -> IOSExportRequest {
        try XCTUnwrap(IOSExportRequest(body: [
            "v": 1,
            "kind": "save",
            "id": "save-1",
            "filename": "backup.json",
            "type": "application/json",
            "text": "{\"saved\":true}",
        ]))
    }

    func testPickerConfirmationCancellationAndFailureReplyWithTheirActualOutcomes() async throws {
        let expected = Data("{\"saved\":true}".utf8)
        for (outcome, status) in [
            (ExportPickerOutcome.saved, "saved"),
            (.cancelled, "cancelled"),
            (.failed("Provider unavailable."), "failed"),
        ] {
            let root = try temporaryRoot()
            defer { remove(root) }
            let pickerReady = expectation(description: "picker driver received the complete temporary file")
            var completePicker: (@MainActor (ExportPickerOutcome) -> Void)?
            let handler = IosBridgeHandler(
                policy: policy,
                presenter: nil,
                temporaryRoot: root,
                fileManager: fileManager,
                pickerDriver: { fileURL, completion in
                    XCTAssertEqual(try? Data(contentsOf: fileURL), expected)
                    completePicker = completion
                    pickerReady.fulfill()
                })
            var replies: [(Any?, String?)] = []
            handler.beginExport(try request()) { value, error in replies.append((value, error)) }
            await fulfillment(of: [pickerReady], timeout: 10)
            var duplicateError: String?
            handler.beginExport(try request()) { _, error in duplicateError = error }
            XCTAssertNotNil(duplicateError, "a second request cannot replace the pending picker")
            completePicker?(outcome)

            XCTAssertEqual(replies.count, 1)
            let reply = try XCTUnwrap(replies.first?.0 as? [String: Any])
            XCTAssertEqual(reply["status"] as? String, status)
            XCTAssertEqual(reply["id"] as? String, "save-1")
            XCTAssertTrue(try fileManager.contentsOfDirectory(atPath: root.path).isEmpty)
        }
    }

    func testEndingThePageSettlesPendingExportAndIgnoresLaterPickerCompletion() async throws {
        let root = try temporaryRoot()
        defer { remove(root) }
        let pickerReady = expectation(description: "picker driver started")
        var completePicker: (@MainActor (ExportPickerOutcome) -> Void)?
        let handler = IosBridgeHandler(
            policy: policy,
            presenter: nil,
            temporaryRoot: root,
            fileManager: fileManager,
            pickerDriver: { _, completion in
                completePicker = completion
                pickerReady.fulfill()
            })
        var replies: [(Any?, String?)] = []
        handler.beginExport(try request()) { value, error in replies.append((value, error)) }
        await fulfillment(of: [pickerReady], timeout: 10)

        handler.pageWillEnd()
        completePicker?(.saved)

        XCTAssertEqual(replies.count, 1)
        let reply = try XCTUnwrap(replies.first?.0 as? [String: Any])
        XCTAssertEqual(reply["status"] as? String, "failed")
        XCTAssertTrue(try fileManager.contentsOfDirectory(atPath: root.path).isEmpty)
    }
}
