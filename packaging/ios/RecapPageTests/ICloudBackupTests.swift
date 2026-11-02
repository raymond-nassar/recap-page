import XCTest
@testable import RecapPage

// XCTest's assertions take autoclosures that cannot await, so every request below is made first and its
// answer asserted after.
@MainActor
final class ICloudBackupHandlerTests: XCTestCase {
    private var store: ICloudFakeStore!
    private var defaults: UserDefaults!
    private var suite: String!
    private var minted: [String] = []
    private var handler: ICloudBackupHandler!
    private let name = "recap-page-backup-v1-\(String(repeating: "c", count: 32))-1.json.gz"
    private let first = String(repeating: "a", count: 32)
    private let second = String(repeating: "b", count: 32)
    private let stranger = String(repeating: "d", count: 32)

    override func setUp() async throws {
        store = ICloudFakeStore()
        suite = "recap.ios.icloud.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
        minted = [first, second]
        handler = ICloudBackupHandler(store: store, defaults: defaults) { [unowned self] in self.minted.removeFirst() }
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suite)
    }

    private func call(_ operation: String, _ input: [String: Any] = [:]) async throws -> [String: Any] {
        let body = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
        let reply = await handler.handle(operation: operation, body: body)
        XCTAssertEqual(reply.status, 200, operation)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(reply.body.utf8)) as? [String: Any])
    }

    private func refusal(_ operation: String, _ input: [String: Any] = [:]) async throws -> (code: String?, retry: Int?) {
        let json = try await call(operation, input)
        XCTAssertEqual(json["ok"] as? Bool, false, operation)
        let failure = json["error"] as? [String: Any]
        return (failure?["code"] as? String, failure?["retryAfterMs"] as? Int)
    }

    private func status(_ operation: String = "status") async throws -> [String: Any] {
        let json = try await call(operation)
        XCTAssertEqual(json["ok"] as? Bool, true, operation)
        return try XCTUnwrap(json["status"] as? [String: Any])
    }

    private func connect() async throws -> String {
        let current = try await status("connect")
        return try XCTUnwrap(current["connection"] as? String)
    }

    func testStatusNamesTheProviderAndNeverASignInState() async throws {
        var current = try await status()
        XCTAssertEqual(current["provider"] as? String, "icloud")
        XCTAssertEqual(current["state"] as? String, "not-connected")
        XCTAssertTrue(current["connection"] is NSNull)
        XCTAssertTrue(current["account"] is NSNull)
        XCTAssertNil(current["waitingForUpload"])

        store.identity = nil
        current = try await status()
        XCTAssertEqual(current["state"] as? String, "unavailable")
        XCTAssertEqual(current["message"] as? String, ICloudBackupHandler.signedOut)
        let refused = try await refusal("connect")
        XCTAssertEqual(refused.code, "unavailable")
        XCTAssertNil(defaults.data(forKey: "recap.ios.icloud.connection"), "nothing is recorded without an account")
    }

    func testConnectingRecordsTheAccountOnceAndKeepsItsConnection() async throws {
        let connection = try await connect()
        XCTAssertEqual(connection, first)
        XCTAssertEqual(store.calls, ["prepare", "uploadState"])
        let again = try await connect()
        XCTAssertEqual(again, first, "connecting again to the same account keeps its connection")

        let disconnected = try await status("disconnect")
        XCTAssertEqual(disconnected["state"] as? String, "not-connected")
        let renewed = try await connect()
        XCTAssertEqual(renewed, second, "a new connection after disconnecting")
    }

    func testAFolderThatCannotBeReachedLeavesNothingConnected() async throws {
        store.failures["prepare"] = .iCloudBusy
        let refused = try await refusal("connect")
        XCTAssertEqual(refused.code, "unavailable")
        XCTAssertEqual(refused.retry, 30_000)
        let current = try await status()
        XCTAssertEqual(current["state"] as? String, "not-connected")
    }

    func testAnotherAccountEndsTheConnectionUntilConnectIsChosenAgain() async throws {
        let connection = try await connect()
        store.identity = Data("fake-account-2".utf8)
        var current = try await status()
        XCTAssertEqual(current["state"] as? String, "not-connected")
        XCTAssertEqual(current["reason"] as? String, ICloudBackupHandler.accountChanged)
        var refused = try await refusal("list", ["connection": connection])
        XCTAssertEqual(refused.code, "not-connected")
        XCTAssertFalse(store.calls.contains("list"), "nothing is read from the other account's folder")

        store.identity = Data("fake-account-1".utf8)
        current = try await status()
        XCTAssertEqual(current["state"] as? String, "connected")
        store.identity = nil
        refused = try await refusal("list", ["connection": connection])
        XCTAssertEqual(refused.code, "unavailable")
    }

    func testDataOperationsHoldToTheRecordedConnection() async throws {
        var refused = try await refusal("list")
        XCTAssertEqual(refused.code, "invalid")
        refused = try await refusal("list", ["connection": stranger])
        XCTAssertEqual(refused.code, "not-connected")
        _ = try await connect()
        refused = try await refusal("list", ["connection": stranger.uppercased()])
        XCTAssertEqual(refused.code, "invalid")
        refused = try await refusal("list", ["connection": stranger])
        XCTAssertEqual(refused.code, "needs-consent")
        XCTAssertFalse(store.calls.contains("list"))
    }

    func testABackupRoundTripsAndTheStatusWaitsForTheUpload() async throws {
        let connection = try await connect()
        let bytes = Data([0x1f, 0x8b, 0x08, 0x00, 0x01])
        let created = try await call("create", ["connection": connection, "name": name, "bytes": bytes.base64EncodedString()])
        let item = try XCTUnwrap(created["item"] as? [String: Any])
        XCTAssertEqual(item["id"] as? String, name)
        XCTAssertEqual(item["name"] as? String, name)
        XCTAssertEqual(item["size"] as? Int, bytes.count)
        XCTAssertTrue(item["created"] is NSNull)

        var current = try await status()
        XCTAssertEqual(current["waitingForUpload"] as? Bool, true)
        store.iCloudFull = true
        current = try await status()
        XCTAssertEqual(current["message"] as? String, ICloudBackupHandler.iCloudFull)
        XCTAssertEqual(current["state"] as? String, "unavailable")
        store.iCloudFull = false
        store.finishUploads()
        current = try await status()
        XCTAssertNil(current["waitingForUpload"])
        XCTAssertTrue(current["message"] is NSNull)

        let listed = try await call("list", ["connection": connection])
        let items = try XCTUnwrap(listed["items"] as? [[String: Any]])
        XCTAssertEqual(items.map { $0["id"] as? String }, [name])
        let read = try await call("read", ["connection": connection, "id": name])
        XCTAssertEqual(read["bytes"] as? String, bytes.base64EncodedString())

        let taken = try await refusal("create", ["connection": connection, "name": name, "bytes": "AQID"])
        XCTAssertEqual(taken.code, "exists")
        XCTAssertEqual(store.files[name], bytes, "a backup is never overwritten")

        let deleted = try await call("delete", ["connection": connection, "id": name])
        XCTAssertEqual(deleted["ok"] as? Bool, true)
        let repeated = try await call("delete", ["connection": connection, "id": name])
        XCTAssertEqual(repeated["ok"] as? Bool, true, "a repeated delete succeeds")
        let gone = try await refusal("read", ["connection": connection, "id": name])
        XCTAssertEqual(gone.code, "not-found")
    }

    func testABackupNotYetDownloadedIsRetriedNotLost() async throws {
        let connection = try await connect()
        store.files[name] = Data([1, 2, 3])
        store.notDownloaded.insert(name)
        let listed = try await call("list", ["connection": connection])
        let items = try XCTUnwrap(listed["items"] as? [[String: Any]])
        XCTAssertTrue(items.first?["size"] is NSNull)
        let waiting = try await refusal("read", ["connection": connection, "id": name])
        XCTAssertEqual(waiting.code, "unavailable")
        XCTAssertEqual(waiting.retry, 15_000)
        let read = try await call("read", ["connection": connection, "id": name])
        XCTAssertEqual(read["bytes"] as? String, "AQID")
    }

    func testUploadInspectionFailureIsNotReportedAsUploaded() async throws {
        _ = try await connect()
        store.failures["uploadState"] = .iCloudBusy
        let current = try await status()
        XCTAssertEqual(current["state"] as? String, "unavailable")
        XCTAssertEqual(current["message"] as? String, ICloudStoreError.iCloudBusy.message)
    }

    func testCreateRefusesWhatCloudBackupDoesNotWrite() async throws {
        let connection = try await connect()
        for bad in ["backup.json", "../\(name)", "recap-page-", "Recap-page-x"] {
            let refused = try await refusal("create", ["connection": connection, "name": bad, "bytes": "AQID"])
            XCTAssertEqual(refused.code, "invalid", bad)
        }
        for bytes in ["%%%", ""] {
            let refused = try await refusal("create", ["connection": connection, "name": name, "bytes": bytes])
            XCTAssertEqual(refused.code, "invalid", bytes)
        }
        let outside = try await refusal("read", ["connection": connection, "id": "../x"])
        XCTAssertEqual(outside.code, "invalid")
        XCTAssertTrue(store.files.isEmpty)
    }

    func testRequestsTurnedAwayUnreadUseTheHostsStatuses() async throws {
        var reply = await handler.handle(operation: "rename", body: "{}")
        XCTAssertEqual(reply.status, 404)
        reply = await handler.handle(operation: "status", body: "[1]")
        XCTAssertEqual(reply.status, 400)
        reply = await handler.handle(operation: "status", body: "{")
        XCTAssertEqual(reply.status, 400)
        reply = await handler.handle(operation: "list", body: String(repeating: " ", count: ICloudBackupHandler.smallBody + 1))
        XCTAssertEqual(reply.status, 413)
        reply = await handler.handle(operation: "status", body: "")
        XCTAssertEqual(reply.status, 200, "an empty body is an empty request")
    }
}

final class ICloudDriveStoreTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("recap-icloud-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func store(located: Bool = true) -> ICloudDriveStore {
        let root = root!
        return ICloudDriveStore(locate: { located ? root : nil }, identity: { "account" as NSString }, downloadWaitSeconds: 0)
    }

    private let name = "recap-page-backup-v1-\(String(repeating: "e", count: 32))-2.json.gz"

    func testWritesIntoTheVisibleFolderAndNeverOverwrites() async throws {
        let store = store()
        try await store.prepare()
        let item = try await store.create(name: name, data: Data([9, 8, 7]))
        XCTAssertEqual(item, ICloudBackupItem(name: name, size: 3, isUploaded: false))
        let file = root.appendingPathComponent("Documents/\(name)")
        XCTAssertEqual(try Data(contentsOf: file), Data([9, 8, 7]))
        do {
            _ = try await store.create(name: name, data: Data([1]))
            XCTFail("a second backup of the same name was written")
        } catch {
            XCTAssertEqual(error as? ICloudStoreError, .exists)
        }
        XCTAssertEqual(try Data(contentsOf: file), Data([9, 8, 7]))
        let read = try await store.read(name: name)
        XCTAssertEqual(read, Data([9, 8, 7]))
    }

    func testListsOnlyBackupsAndCountsAPlaceholderAsOne() async throws {
        let store = store()
        try await store.prepare()
        let documents = root.appendingPathComponent("Documents", isDirectory: true)
        try Data([1]).write(to: documents.appendingPathComponent(name))
        try Data([1]).write(to: documents.appendingPathComponent("notes.txt"))
        let other = "recap-page-backup-v1-\(String(repeating: "f", count: 32))-1.json.gz"
        try Data([1]).write(to: documents.appendingPathComponent(".\(other).icloud"))
        try Data([1]).write(to: documents.appendingPathComponent(".\(name).icloud"))
        let items = try await store.list()
        XCTAssertEqual(items.map(\.name), [name, other])
        XCTAssertEqual(items.first?.size, 1)
        XCTAssertNil(items.last?.size, "a backup not downloaded has no size yet")
        let state = try await store.uploadState()
        XCTAssertTrue(state.waiting, "a local file not yet recognized by iCloud is not an uploaded backup")
    }

    func testAMissingBackupIsNotFoundAndDeletingItTwiceSucceeds() async throws {
        let store = store()
        try await store.prepare()
        do {
            _ = try await store.read(name: name)
            XCTFail("a missing backup was read")
        } catch {
            XCTAssertEqual(error as? ICloudStoreError, .notFound)
        }
        _ = try await store.create(name: name, data: Data([1]))
        try await store.delete(name: name)
        try await store.delete(name: name)
        let items = try await store.list()
        XCTAssertTrue(items.isEmpty)
    }

    func testNoContainerMeansICloudDriveIsOff() async throws {
        do {
            try await store(located: false).prepare()
            XCTFail("a store without a container was prepared")
        } catch {
            XCTAssertEqual(error as? ICloudStoreError, .driveOff)
        }
    }

    func testIdentityComparesTheAccountNotTheArchiveBytes() throws {
        let store = store()
        let first = try XCTUnwrap(store.currentIdentity())
        let second = try XCTUnwrap(store.currentIdentity())
        XCTAssertTrue(store.isSameIdentity(first, second))
        let other = try NSKeyedArchiver.archivedData(withRootObject: "another" as NSString, requiringSecureCoding: false)
        XCTAssertFalse(store.isSameIdentity(first, other))
        XCTAssertFalse(store.isSameIdentity(first, Data("not an archive".utf8)))
    }

    func testCocoaErrorsBecomeTheContractsCodes() {
        func code(_ number: Int) -> ICloudStoreError { ICloudDriveStore.mapped(NSError(domain: NSCocoaErrorDomain, code: number)) }
        XCTAssertEqual(code(NSFileWriteFileExistsError), .exists)
        XCTAssertEqual(code(NSFileReadNoSuchFileError), .notFound)
        XCTAssertEqual(code(NSFileWriteOutOfSpaceError).code, "quota")
        XCTAssertEqual(code(NSUbiquitousFileNotUploadedDueToQuotaError).code, "quota")
        XCTAssertEqual(code(NSUbiquitousFileUbiquityServerNotAvailable).retryAfterMs, 30_000)
        XCTAssertEqual(code(NSUserCancelledError).retryAfterMs, 5_000)
        XCTAssertEqual(ICloudDriveStore.mapped(NSError(domain: NSPOSIXErrorDomain, code: 1)), .failed)
    }
}
