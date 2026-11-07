import XCTest
@testable import RecapPage

@MainActor
private final class FakeOneDriveTransport: OneDriveTransport {
    var requests: [OneDriveRequest] = []
    var answer: @MainActor (OneDriveRequest) -> OneDriveResponse = { _ in OneDriveResponse(status: 500, headers: [:], body: Data()) }

    func send(_ request: OneDriveRequest) async throws -> OneDriveResponse {
        requests.append(request)
        return answer(request)
    }
}

@MainActor
private final class FakeOneDriveCredentials: OneDriveCredentialStore {
    var record: OneDriveRecord?
    var removed = 0

    func load() -> OneDriveRecord? { record }

    func save(_ record: OneDriveRecord) -> Bool {
        self.record = record
        return true
    }

    func remove() {
        removed += 1
        record = nil
    }
}

@MainActor
private final class FakeOneDriveLauncher: OneDriveSignInLauncher {
    var url: URL?
    var completion: (@MainActor (Result<URL, OneDriveSignInEnding>) -> Void)?
    var opens = true
    var cancelled = 0

    func start(url: URL, completion: @escaping @MainActor (Result<URL, OneDriveSignInEnding>) -> Void) -> Bool {
        guard opens else { return false }
        self.url = url
        self.completion = completion
        return true
    }

    func cancel() {
        cancelled += 1
    }

    func parameter(_ name: String) -> String? {
        url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?.queryItems?.first { $0.name == name }?.value
    }
}

private func json(_ status: Int, _ value: Any, headers: [String: String] = [:]) -> OneDriveResponse {
    OneDriveResponse(status: status, headers: headers, body: try? JSONSerialization.data(withJSONObject: value))
}

private func idToken(_ claims: [String: Any]) -> String {
    let payload = (try? JSONSerialization.data(withJSONObject: claims)) ?? Data()
    return "e30.\(OneDriveRules.base64Url(payload)).signature"
}

final class OneDriveAuthorizationTests: XCTestCase {
    private let authorization = OneDriveAuthorization { count in Data(repeating: 9, count: count) }

    func testOnlyAnAnswerToThisSignInIsRead() throws {
        let redirect = OneDriveAuthorization.redirectUri
        let state = authorization.state
        XCTAssertEqual(redirect, "msauth.io.github.raymondnassar.recappage://auth")
        XCTAssertEqual(authorization.answer("\(redirect)?code=abc&state=\(state)"), .code("abc"))
        XCTAssertEqual(authorization.answer("\(redirect)?error=access_denied&state=\(state)"), .ended("declined"))
        XCTAssertEqual(authorization.answer("\(redirect)?error=server_error&state=\(state)"), .ended("refused"))
        XCTAssertNil(authorization.answer("\(redirect)?code=abc&state=other"))
        XCTAssertNil(authorization.answer("\(redirect)?code=abc&code=def&state=\(state)"))
        XCTAssertNil(authorization.answer("msauth.io.github.raymondnassar.recappage://other?code=abc&state=\(state)"))
        XCTAssertNil(authorization.answer("\(redirect)?code=%zz&state=\(state)"))
    }

    func testTheSignInAddressAsksForTheAppFolderWithPKCE() throws {
        let url = try XCTUnwrap(authorization.url(clientId: "client-1"))
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertTrue(url.absoluteString.hasPrefix("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?"))
        XCTAssertEqual(query["client_id"], "client-1")
        XCTAssertEqual(query["redirect_uri"], OneDriveAuthorization.redirectUri)
        XCTAssertEqual(query["scope"], "openid profile offline_access Files.ReadWrite.AppFolder")
        XCTAssertEqual(query["code_challenge_method"], "S256")
        XCTAssertEqual(query["code_challenge"], authorization.challenge)
        XCTAssertNotEqual(authorization.challenge, authorization.verifier)
        XCTAssertTrue(OneDriveAuthorization.validClientId("abc-123.DEF_4"))
        XCTAssertFalse(OneDriveAuthorization.validClientId(""))
        XCTAssertFalse(OneDriveAuthorization.validClientId("-starts-with-dash"))
    }

    func testTheIdTokenMustBeForThisAppThisSignInAndStillCurrent() throws {
        let now = 1_800_000_000_000.0
        let good: [String: Any] = [
            "aud": "client-1", "nonce": "n-1", "exp": now / 1000 + 600, "oid": "subject-1",
            "preferred_username": "reader@example.com",
        ]
        let claims = try OneDriveMicrosoft.idTokenClaims(idToken(good), clientId: "client-1", nonce: "n-1", now: now)
        XCTAssertEqual(claims, OneDriveMicrosoft.Claims(subject: "subject-1", hint: "reader@example.com"))
        var listed = good
        listed["aud"] = ["other", "client-1"]
        XCTAssertNoThrow(try OneDriveMicrosoft.idTokenClaims(idToken(listed), clientId: "client-1", nonce: "n-1", now: now))
        let wrong: [(String, Any)] = [("aud", "other"), ("nonce", "n-2"), ("exp", now / 1000 - 3600)]
        for (key, value) in wrong {
            var bad = good
            bad[key] = value
            XCTAssertThrowsError(try OneDriveMicrosoft.idTokenClaims(idToken(bad), clientId: "client-1", nonce: "n-1", now: now), key)
        }
        XCTAssertThrowsError(try OneDriveMicrosoft.idTokenClaims(nil, clientId: "client-1", nonce: "n-1", now: now))
        XCTAssertThrowsError(try OneDriveMicrosoft.idTokenClaims("one.two", clientId: "client-1", nonce: "n-1", now: now))
    }

    func testOnlyAGrantOfTheAppFolderCounts() {
        XCTAssertTrue(OneDriveMicrosoft.grantsAppFolder("openid Files.ReadWrite.AppFolder offline_access"))
        XCTAssertFalse(OneDriveMicrosoft.grantsAppFolder("openid Files.ReadWrite offline_access"))
        XCTAssertFalse(OneDriveMicrosoft.grantsAppFolder(""))
    }
}

// XCTest's assertions take autoclosures that cannot await, so every request below is made first and its
// answer asserted after.
@MainActor
final class OneDriveBackupHandlerTests: XCTestCase {
    private let clientId = "client-1"
    private let backupName = "recap-page-backup-v1-\(String(repeating: "c", count: 32))-1.json.gz"
    private var transport: FakeOneDriveTransport!
    private var credentials: FakeOneDriveCredentials!
    private var launcher: FakeOneDriveLauncher!
    private var defaults: UserDefaults!
    private var suite: String!
    private var handler: OneDriveBackupHandler!
    private var counter: UInt8 = 0
    private let now = 1_800_000_000_000.0

    override func setUp() async throws {
        transport = FakeOneDriveTransport()
        credentials = FakeOneDriveCredentials()
        launcher = FakeOneDriveLauncher()
        suite = "recap.ios.onedrive.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
        counter = 0
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suite)
    }

    private func make() -> OneDriveBackupHandler {
        let handler = OneDriveBackupHandler(
            clientId: clientId, transport: transport, credentials: credentials, launcher: launcher,
            defaults: defaults, now: { [unowned self] in self.now },
            random: { [unowned self] count in
                self.counter &+= 1
                return Data(repeating: self.counter, count: count)
            }
        )
        self.handler = handler
        return handler
    }

    private func call(_ operation: String, _ input: [String: Any] = [:]) async throws -> [String: Any] {
        let body = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
        let reply = await handler.handle(operation: operation, body: body)
        XCTAssertEqual(reply.status, 200, operation)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(reply.body.utf8)) as? [String: Any])
    }

    private func status(_ operation: String = "status") async throws -> [String: Any] {
        let json = try await call(operation)
        XCTAssertEqual(json["ok"] as? Bool, true, operation)
        return try XCTUnwrap(json["status"] as? [String: Any])
    }

    private func refusal(_ operation: String, _ input: [String: Any]) async throws -> String? {
        let json = try await call(operation, input)
        XCTAssertEqual(json["ok"] as? Bool, false, operation)
        return (json["error"] as? [String: Any])?["code"] as? String
    }

    private func settled() async throws -> [String: Any] {
        for _ in 0..<200 {
            let current = try await status()
            if current["state"] as? String != "signing-in" { return current }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("the sign-in did not finish")
        return [:]
    }

    private func microsoft(_ request: OneDriveRequest, scope: String = "openid profile offline_access Files.ReadWrite.AppFolder") -> OneDriveResponse? {
        if request.url.absoluteString.hasSuffix("/oauth2/v2.0/token") {
            return json(200, [
                "access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3600, "scope": scope,
                "id_token": idToken([
                    "aud": clientId, "nonce": launcher.parameter("nonce") ?? "", "exp": now / 1000 + 600,
                    "oid": "subject-1", "preferred_username": "reader@example.com",
                ]),
            ])
        }
        if request.url.absoluteString.contains("/me/drive/special/approot?") {
            return json(200, ["id": "FOLDER1", "parentReference": ["driveId": "DRIVE1"]])
        }
        return nil
    }

    private func signIn() async throws -> [String: Any] {
        transport.answer = { [unowned self] request in
            self.microsoft(request) ?? OneDriveResponse(status: 500, headers: [:], body: Data())
        }
        _ = make()
        let started = try await status("connect")
        XCTAssertEqual(started["state"] as? String, "signing-in")
        let state = try XCTUnwrap(launcher.parameter("state"))
        let answer = try XCTUnwrap(URL(string: "\(OneDriveAuthorization.redirectUri)?code=code-1&state=\(state)"))
        launcher.completion?(.success(answer))
        return try await settled()
    }

    func testASignInConnectsTheAppFolderAndTheTokenGoesOnlyToGraph() async throws {
        let connected = try await signIn()
        XCTAssertEqual(connected["provider"] as? String, "onedrive")
        XCTAssertEqual(connected["state"] as? String, "connected")
        XCTAssertEqual(connected["account"] as? String, "reader@example.com")
        let connection = try XCTUnwrap(connected["connection"] as? String)
        XCTAssertEqual(credentials.record?.refreshToken, "refresh-1")
        XCTAssertEqual(credentials.record?.folder, "FOLDER1")
        XCTAssertEqual(credentials.record?.account, "drive:DRIVE1")
        let redeem = try XCTUnwrap(transport.requests.first)
        let form = String(decoding: redeem.body ?? Data(), as: UTF8.self)
        XCTAssertTrue(form.contains("grant_type=authorization_code"))
        XCTAssertTrue(form.contains("code_verifier="))
        XCTAssertNil(redeem.headers["Authorization"])

        transport.requests = []
        transport.answer = { request in
            if request.method == "POST" {
                return json(200, ["uploadUrl": "https://upload.example.net/session-1"])
            }
            if request.method == "PUT" {
                return json(201, ["id": "ITEM1", "name": self.backupName, "size": 3, "parentReference": ["id": "FOLDER1"]])
            }
            return json(200, ["value": [["id": "ITEM1", "name": self.backupName, "size": 3, "createdDateTime": "2026-11-07T10:00:00Z"]]])
        }
        let created = try await call("create", [
            "connection": connection, "name": backupName, "bytes": Data([1, 2, 3]).base64EncodedString(),
        ])
        XCTAssertEqual(created["ok"] as? Bool, true)
        XCTAssertEqual((created["item"] as? [String: Any])?["id"] as? String, "ITEM1")
        let open = try XCTUnwrap(transport.requests.first)
        XCTAssertTrue(open.url.absoluteString.contains("/me/drive/items/FOLDER1:/\(backupName):/createUploadSession"))
        XCTAssertEqual(open.headers["Authorization"], "Bearer access-1")
        // A taken name is refused by the create itself rather than replaced.
        XCTAssertTrue(String(decoding: open.body ?? Data(), as: UTF8.self).contains(#""@microsoft.graph.conflictBehavior":"fail""#))
        let upload = try XCTUnwrap(transport.requests.last)
        XCTAssertEqual(upload.method, "PUT")
        XCTAssertNil(upload.headers["Authorization"])

        let listed = try await call("list", ["connection": connection])
        let items = try XCTUnwrap(listed["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?["name"] as? String, backupName)
        XCTAssertEqual(items.first?["created"] as? Int, 1_794_045_600_000)
    }

    func testASignInWithoutTheAppFolderGrantEndsRefused() async throws {
        transport.answer = { [unowned self] request in
            self.microsoft(request, scope: "openid profile offline_access") ?? OneDriveResponse(status: 500, headers: [:], body: Data())
        }
        _ = make()
        _ = try await status("connect")
        let state = try XCTUnwrap(launcher.parameter("state"))
        let answer = try XCTUnwrap(URL(string: "\(OneDriveAuthorization.redirectUri)?code=code-1&state=\(state)"))
        launcher.completion?(.success(answer))
        let ended = try await settled()
        XCTAssertEqual(ended["state"] as? String, "not-connected")
        XCTAssertNotNil(ended["message"] as? String)
        XCTAssertNil(credentials.record)
    }

    func testACancelledOrUnopenedSignInSaysWhyAndKeepsNothing() async throws {
        _ = make()
        _ = try await status("connect")
        launcher.completion?(.failure(.cancelled))
        let cancelled = try await status()
        XCTAssertEqual(cancelled["state"] as? String, "not-connected")
        XCTAssertEqual(cancelled["message"] as? String, "Sign-in was cancelled.")

        launcher.opens = false
        let unopened = try await status("connect")
        XCTAssertEqual(unopened["state"] as? String, "not-connected")
        XCTAssertEqual(unopened["message"] as? String, OneDriveBackupHandler.browserUnavailable)
        XCTAssertNil(credentials.record)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testADeletedAppFolderCountsAsConsentWithdrawn() async throws {
        let connected = try await signIn()
        let connection = try XCTUnwrap(connected["connection"] as? String)
        transport.answer = { _ in OneDriveResponse(status: 404, headers: [:], body: Data()) }
        let code = try await refusal("list", ["connection": connection])
        XCTAssertEqual(code, "needs-consent")
        let after = try await status()
        XCTAssertEqual(after["state"] as? String, "connected")
        XCTAssertNotEqual(after["connection"] as? String, connection)
        XCTAssertEqual(after["reason"] as? String, OneDriveBackupHandler.folderDeleted)
        XCTAssertNil(credentials.record?.folder)
        let old = try await refusal("list", ["connection": connection])
        XCTAssertEqual(old, "needs-consent")
    }

    func testARefusedRefreshAsksForTheSignInAgain() async throws {
        let connection = String(repeating: "e", count: 32)
        defaults.set(true, forKey: "recap.ios.onedrive.installed")
        credentials.record = OneDriveRecord(
            connection: connection, account: "drive:DRIVE1", hint: "reader@example.com", folder: "FOLDER1",
            refreshToken: "refresh-old", savedAt: now
        )
        transport.answer = { _ in json(400, ["error": "invalid_grant"]) }
        _ = make()
        let code = try await refusal("list", ["connection": connection])
        XCTAssertEqual(code, "needs-sign-in")
        let after = try await status()
        XCTAssertEqual(after["state"] as? String, "needs-sign-in")
        XCTAssertEqual(after["connection"] as? String, connection)
        XCTAssertNotNil(credentials.record)
        XCTAssertNil(credentials.record?.refreshToken)
    }

    func testDisconnectForgetsTheSignInOnThisDeviceOnly() async throws {
        let connected = try await signIn()
        let connection = try XCTUnwrap(connected["connection"] as? String)
        transport.requests = []
        let after = try await status("disconnect")
        XCTAssertEqual(after["state"] as? String, "not-connected")
        XCTAssertNil(credentials.record)
        // Nothing is deleted from OneDrive: the backups stay for every other device.
        XCTAssertTrue(transport.requests.isEmpty)
        let code = try await refusal("list", ["connection": connection])
        XCTAssertEqual(code, "not-connected")
    }

    func testARecordLeftByAnEarlierInstallationIsForgotten() async throws {
        credentials.record = OneDriveRecord(
            connection: String(repeating: "e", count: 32), account: "drive:DRIVE1", hint: nil, folder: "FOLDER1",
            refreshToken: "refresh-old", savedAt: now
        )
        _ = make()
        let current = try await status()
        XCTAssertEqual(current["state"] as? String, "not-connected")
        XCTAssertEqual(credentials.removed, 1)
        XCTAssertTrue(defaults.bool(forKey: "recap.ios.onedrive.installed"))
    }

    func testOnlyOneDriveIsOfferedByItself() async throws {
        _ = make()
        let code = try await refusal("connect", ["provider": "googledrive"])
        XCTAssertEqual(code, "invalid")
        XCTAssertNil(launcher.url)
    }
}

@MainActor
final class CloudBackupRouterTests: XCTestCase {
    private var store: ICloudFakeStore!
    private var transport: FakeOneDriveTransport!
    private var launcher: FakeOneDriveLauncher!
    private var defaults: UserDefaults!
    private var suite: String!
    private var router: CloudBackupRouter!

    override func setUp() async throws {
        store = ICloudFakeStore()
        transport = FakeOneDriveTransport()
        launcher = FakeOneDriveLauncher()
        suite = "recap.ios.router.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
        let iCloud = ICloudBackupHandler(store: store, defaults: defaults)
        let oneDrive = OneDriveBackupHandler(
            clientId: "client-1", transport: transport, credentials: FakeOneDriveCredentials(), launcher: launcher,
            defaults: defaults
        )
        router = CloudBackupRouter(iCloud: iCloud, oneDrive: oneDrive)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suite)
    }

    private func call(_ operation: String, _ input: [String: Any] = [:]) async throws -> [String: Any] {
        let body = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
        let reply = await router.handle(operation: operation, body: body)
        XCTAssertEqual(reply.status, 200, operation)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(reply.body.utf8)) as? [String: Any])
    }

    func testTheCardOffersBothAndADeviceHoldsOneConnectionAtATime() async throws {
        let offered = try await call("status")
        let first = try XCTUnwrap(offered["status"] as? [String: Any])
        XCTAssertEqual(first["providers"] as? [String], ["icloud", "onedrive"])
        XCTAssertEqual(first["state"] as? String, "not-connected")

        let iCloud = try await call("connect", ["provider": "icloud"])
        let iCloudStatus = try XCTUnwrap(iCloud["status"] as? [String: Any])
        XCTAssertEqual(iCloudStatus["provider"] as? String, "icloud")
        XCTAssertEqual(iCloudStatus["state"] as? String, "connected")
        let blocked = try await call("connect", [:])
        XCTAssertEqual((blocked["error"] as? [String: Any])?["message"] as? String, CloudBackupRouter.otherInUse)
        XCTAssertNil(launcher.url)

        _ = try await call("disconnect")
        let oneDrive = try await call("connect", [:])
        let signingIn = try XCTUnwrap(oneDrive["status"] as? [String: Any])
        XCTAssertEqual(signingIn["provider"] as? String, "onedrive")
        XCTAssertEqual(signingIn["state"] as? String, "signing-in")
        XCTAssertEqual(signingIn["providers"] as? [String], ["icloud", "onedrive"])
        let refused = try await call("connect", ["provider": "icloud"])
        XCTAssertEqual((refused["error"] as? [String: Any])?["message"] as? String, CloudBackupRouter.otherInUse)
        let google = try await call("connect", ["provider": "googledrive"])
        XCTAssertEqual((google["error"] as? [String: Any])?["code"] as? String, "invalid")

        // A data operation goes to the provider in use, which here has no connection yet.
        let listed = try await call("list", ["connection": String(repeating: "a", count: 32)])
        XCTAssertEqual((listed["error"] as? [String: Any])?["code"] as? String, "not-connected")
        XCTAssertFalse(store.calls.contains("list"))

        let ended = try await call("disconnect")
        XCTAssertEqual((ended["status"] as? [String: Any])?["state"] as? String, "not-connected")
        XCTAssertEqual(launcher.cancelled, 1)
    }
}
