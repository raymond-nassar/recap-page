#if RECAP_ICLOUD || DEBUG
import Foundation

/// The cloud backup control API for OneDrive, answering the same seven operations in the same JSON as
/// the iCloud handler, the Windows host and the Android app, so the page's shared engine runs unchanged
/// over it. The account rules are the Android app's CloudAccount: a sign-in made in the system's sign-in
/// sheet, a connection that survives a later sign-in to the same drive and folder, a deleted app folder
/// counted as consent withdrawn, and Disconnect forgetting the sign-in on this device only.
@MainActor
final class OneDriveBackupHandler {
    static let notOffered = "That cloud service is not offered by this build of Recap Page."
    static let notConnected = "Cloud backup is not connected on this device."
    static let connectedAgain = "Cloud backup was connected again since this page agreed to it, so it asks again first."
    static let signInAgain = "Sign in to OneDrive again to keep backing up."
    static let refreshRefused = "Microsoft asked for the sign-in to be made again, so cloud backups have stopped until it is."
    static let folderDeleted = "The Recap Page folder was deleted from OneDrive, so cloud backup asks again before it makes a new one."
    static let browserUnavailable = "The browser could not be opened for sign-in."
    static let endings: [String: String] = [
        "declined": "Sign-in was cancelled.",
        "cancelled": "Sign-in was cancelled.",
        "refused": "Microsoft did not complete the sign-in.",
        "expired": "Sign-in did not finish within five minutes. Start it again when you are ready.",
        "invalid": "Sign-in was stopped after answers it did not expect.",
        "failed": "Sign-in stopped unexpectedly.",
    ]
    // Each operation's limit, inside the page's own wait for it.
    private static let deadlines: [String: Int] = ["list": 115, "read": 595, "create": 595, "delete": 25]
    // Set on the first launch of a build that can connect OneDrive. The Keychain outlives deleting the app,
    // so a record found without it belongs to an earlier installation and is forgotten, never reused.
    private static let installedKey = "recap.ios.onedrive.installed"

    /// The providers the card may offer, set by the router when iCloud is offered too.
    var providers = ["onedrive"]

    private struct SignIn {
        let authorization: OneDriveAuthorization
        let expiresAt: Double
        let epoch: UInt64
    }

    private struct AccessToken {
        let token: String
        let expiresAt: Double
        let connection: String
    }

    private final class Once {
        var done = false
    }

    private let clientId: String
    private let transport: OneDriveTransport
    private let credentials: OneDriveCredentialStore
    private let launcher: OneDriveSignInLauncher
    private let store: OneDriveStore
    private let now: () -> Double
    private let random: (Int) -> Data
    private let signInSeconds: Double
    private var record: OneDriveRecord?
    private var accessToken: AccessToken?
    private var refreshing: Task<String, Error>?
    private var signIn: SignIn?
    private var signInTimer: Task<Void, Never>?
    private var message: String?
    private var changed: (connection: String, reason: String)?
    private var epoch: UInt64 = 0
    private var inFlight = 0

    init(
        clientId: String,
        transport: OneDriveTransport,
        credentials: OneDriveCredentialStore,
        launcher: OneDriveSignInLauncher,
        defaults: UserDefaults = .standard,
        now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 },
        random: @escaping (Int) -> Data = OneDriveRules.random,
        signInSeconds: Double = 5 * 60
    ) {
        self.clientId = clientId
        self.transport = transport
        self.credentials = credentials
        self.launcher = launcher
        self.now = now
        self.random = random
        self.signInSeconds = signInSeconds
        store = OneDriveStore(transport: transport, now: now)
        if !defaults.bool(forKey: Self.installedKey) {
            credentials.remove()
            defaults.set(true, forKey: Self.installedKey)
        }
        record = credentials.load()
    }

    /// A connection or a sign-in under way: the provider this device uses for now.
    var isActive: Bool { record != nil || signIn != nil }

    /// Why the last sign-in ended, still to be shown on the card.
    var hasMessage: Bool { message != nil }

    func forgetMessage() {
        message = nil
    }

    // MARK: - Account

    func status() -> [String: Any] {
        let state: String
        if signIn != nil {
            state = "signing-in"
        } else if let record {
            state = record.refreshToken == nil ? "needs-sign-in" : "connected"
        } else {
            state = "not-connected"
        }
        var reason: Any = NSNull()
        if let record, let changed, changed.connection == record.connection { reason = changed.reason }
        return [
            "provider": "onedrive",
            "providers": providers,
            "state": state,
            "connection": record?.connection ?? NSNull(),
            "account": record?.hint ?? NSNull(),
            "message": message ?? NSNull(),
            "reason": reason,
            "signInExpiresAt": signIn.map { Int($0.expiresAt) as Any } ?? NSNull(),
        ]
    }

    // Starts the sign-in and answers at once with signing-in; the page asks for status until it ends.
    func connect() -> [String: Any] {
        if signIn != nil { return status() }
        if let record, record.refreshToken != nil { return status() }
        message = nil
        epoch &+= 1
        let attempt = epoch
        let authorization = OneDriveAuthorization(random: random)
        guard let url = authorization.url(clientId: clientId) else {
            message = Self.browserUnavailable
            return status()
        }
        signIn = SignIn(authorization: authorization, expiresAt: now() + signInSeconds * 1000, epoch: attempt)
        let started = launcher.start(url: url) { [weak self] result in
            self?.signInReturned(result, attempt: attempt)
        }
        guard started else {
            signIn = nil
            message = Self.browserUnavailable
            return status()
        }
        let nanoseconds = UInt64(signInSeconds * 1_000_000_000)
        signInTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled else { return }
            self?.endSignIn(attempt, ending: "expired")
        }
        return status()
    }

    private func endSignIn(_ attempt: UInt64, ending: String, message text: String? = nil) {
        guard let current = signIn, current.epoch == attempt else { return }
        signIn = nil
        signInTimer?.cancel()
        signInTimer = nil
        launcher.cancel()
        message = text ?? Self.endings[ending] ?? Self.endings["failed"]
    }

    private func signInReturned(_ result: Result<URL, OneDriveSignInEnding>, attempt: UInt64) {
        guard let current = signIn, current.epoch == attempt else { return }
        switch result {
        case .failure(let ending):
            endSignIn(attempt, ending: ending == .cancelled ? "cancelled" : "failed")
        case .success(let url):
            switch current.authorization.answer(url.absoluteString) {
            case nil:
                endSignIn(attempt, ending: "invalid")
            case .ended(let reason):
                endSignIn(attempt, ending: reason)
            case .code(let code):
                Task { await self.finishSignIn(code: code, authorization: current.authorization, attempt: attempt) }
            }
        }
    }

    private func finishSignIn(code: String, authorization: OneDriveAuthorization, attempt: UInt64) async {
        do {
            let tokens = try await OneDriveMicrosoft.redeem(
                transport, clientId: clientId, now: now(), code: code, verifier: authorization.verifier
            )
            guard signIn?.epoch == attempt else { return }
            guard let refresh = tokens.refreshToken, OneDriveMicrosoft.grantsAppFolder(tokens.scope) else {
                throw ICloudStoreError(code: "refused", message: "Microsoft did not grant the access cloud backup needs.")
            }
            let claims = try OneDriveMicrosoft.idTokenClaims(
                tokens.idToken, clientId: clientId, nonce: authorization.nonce, now: now()
            )
            let access = tokens.accessToken
            let folder = try await store.appFolder { _ in access }
            guard signIn?.epoch == attempt else { return }
            let account = folder.driveId.map { "drive:\($0)" } ?? "subject:\(claims.subject)"
            // The same drive and the same folder keep the connection, so a page that agreed to back up
            // there is not asked again after a sign-in is renewed.
            let keep = record.map { $0.account == account && ($0.folder == nil || $0.folder == folder.id) } ?? false
            let connection = keep ? record?.connection ?? OneDriveRules.hex(random(16)) : OneDriveRules.hex(random(16))
            let next = OneDriveRecord(
                connection: connection, account: account, hint: claims.hint, folder: folder.id,
                refreshToken: refresh, savedAt: now()
            )
            guard credentials.save(next) else {
                endSignIn(attempt, ending: "failed")
                return
            }
            record = next
            accessToken = AccessToken(token: access, expiresAt: now() + tokens.expiresInMs, connection: connection)
            signIn = nil
            signInTimer?.cancel()
            signInTimer = nil
            message = nil
        } catch let error as ICloudStoreError {
            switch error.code {
            case "refused": endSignIn(attempt, ending: "refused", message: error.message)
            case "invalid": endSignIn(attempt, ending: "invalid")
            default: endSignIn(attempt, ending: "failed", message: error.message)
            }
        } catch {
            endSignIn(attempt, ending: "failed")
        }
    }

    // Forgets the sign-in on this device only: the backups stay in OneDrive and every other device keeps
    // its own sign-in.
    func disconnect() -> [String: Any] {
        epoch &+= 1
        if signIn != nil { launcher.cancel() }
        signIn = nil
        signInTimer?.cancel()
        signInTimer = nil
        refreshing?.cancel()
        refreshing = nil
        accessToken = nil
        credentials.remove()
        record = nil
        message = nil
        changed = nil
        return status()
    }

    // MARK: - Tokens

    private func token(renew: Bool, connection: String) async throws -> String {
        if !renew, let cached = accessToken, cached.connection == connection, cached.expiresAt - 60_000 > now() {
            return cached.token
        }
        if let refreshing { return try await refreshing.value }
        let task = Task { try await self.renewed(connection: connection) }
        refreshing = task
        defer { if refreshing == task { refreshing = nil } }
        return try await task.value
    }

    private func renewed(connection: String) async throws -> String {
        let started = epoch
        guard let current = record, current.connection == connection, let refresh = current.refreshToken else {
            throw ICloudStoreError(code: "needs-sign-in", message: Self.signInAgain)
        }
        let tokens: OneDriveMicrosoft.Tokens
        do {
            tokens = try await OneDriveMicrosoft.refresh(transport, clientId: clientId, now: now(), refreshToken: refresh)
        } catch let error as ICloudStoreError where error.code == "refused" {
            forgetCredential(connection: connection, since: started)
            throw ICloudStoreError(code: "needs-sign-in", message: Self.refreshRefused)
        }
        guard epoch == started, var next = record, next.connection == connection else {
            throw ICloudStoreError(code: "not-connected", message: Self.notConnected)
        }
        if let renewedRefresh = tokens.refreshToken, renewedRefresh != next.refreshToken {
            next.refreshToken = renewedRefresh
            next.savedAt = now()
            record = next
            _ = credentials.save(next)
        }
        accessToken = AccessToken(token: tokens.accessToken, expiresAt: now() + tokens.expiresInMs, connection: connection)
        return tokens.accessToken
    }

    private func forgetCredential(connection: String, since started: UInt64) {
        guard epoch == started, var next = record, next.connection == connection, next.refreshToken != nil else { return }
        next.refreshToken = nil
        next.savedAt = now()
        record = next
        accessToken = nil
        _ = credentials.save(next)
    }

    // MARK: - Data

    private func connected(_ input: [String: Any]) throws -> OneDriveRecord {
        guard OneDriveRules.isConnection(input["connection"]), let connection = input["connection"] as? String else {
            throw ICloudStoreError(code: "invalid", message: "The request did not name a connection.")
        }
        guard let current = record else { throw ICloudStoreError(code: "not-connected", message: Self.notConnected) }
        guard current.connection == connection else {
            let reason = changed.flatMap { $0.connection == current.connection ? $0.reason : nil }
            throw ICloudStoreError(code: "needs-consent", message: reason ?? Self.connectedAgain)
        }
        guard current.refreshToken != nil else { throw ICloudStoreError(code: "needs-sign-in", message: Self.signInAgain) }
        return current
    }

    // One data operation for the connection the request names, held to its deadline, with the account's
    // answers to a deleted folder and a refused sign-in applied.
    private func withAccount<T>(
        _ operation: String,
        _ input: [String: Any],
        _ work: @escaping @MainActor (OneDriveRecord, @escaping OneDriveStore.Tokens) async throws -> T
    ) async throws -> T {
        let current = try connected(input)
        let started = epoch
        let tokens: OneDriveStore.Tokens = { [weak self] renew in
            guard let self else { throw ICloudStoreError(code: "not-connected", message: Self.notConnected) }
            return try await self.token(renew: renew, connection: current.connection)
        }
        do {
            return try await deadline(Self.deadlines[operation] ?? 25) { try await work(current, tokens) }
        } catch is OneDriveStore.FolderGone {
            if epoch == started, var next = record, next.connection == current.connection {
                next.connection = OneDriveRules.hex(random(16))
                next.folder = nil
                next.savedAt = now()
                record = next
                _ = credentials.save(next)
                changed = (connection: next.connection, reason: Self.folderDeleted)
                if let cached = accessToken, cached.connection == current.connection {
                    accessToken = AccessToken(token: cached.token, expiresAt: cached.expiresAt, connection: next.connection)
                }
            }
            throw ICloudStoreError(code: "needs-consent", message: Self.folderDeleted)
        } catch let error as ICloudStoreError where error.code == "needs-sign-in" {
            forgetCredential(connection: current.connection, since: started)
            throw error
        }
    }

    // The work goes on after its deadline, as a request already sent cannot be taken back; only the answer
    // to the page stops waiting for it.
    private func deadline<T>(_ seconds: Int, _ work: @escaping @MainActor () async throws -> T) async throws -> T {
        let once = Once()
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
            let sleeper = Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000)
                guard !Task.isCancelled, !once.done else { return }
                once.done = true
                continuation.resume(throwing: ICloudStoreError(
                    code: "timeout", message: "OneDrive did not finish within \(seconds) seconds."
                ))
            }
            Task { @MainActor in
                do {
                    let value = try await work()
                    sleeper.cancel()
                    guard !once.done else { return }
                    once.done = true
                    continuation.resume(returning: value)
                } catch {
                    sleeper.cancel()
                    guard !once.done else { return }
                    once.done = true
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func backupName(_ input: [String: Any]) throws -> String {
        guard let name = input["name"] as? String, ICloudDriveStore.isBackupName(name) else {
            throw ICloudStoreError(code: "invalid", message: "That is not a name cloud backup writes.")
        }
        return name
    }

    private static func itemId(_ input: [String: Any]) throws -> String {
        guard OneDriveRules.isItemId(input["id"]), let id = input["id"] as? String else {
            throw ICloudStoreError(code: "invalid", message: "The request did not name an item.")
        }
        return id
    }

    private static func backupBytes(_ input: [String: Any]) throws -> Data {
        guard let text = input["bytes"] as? String, let data = Data(base64Encoded: text) else {
            throw ICloudStoreError(code: "invalid", message: "The request did not hold a backup to create.")
        }
        guard !data.isEmpty else { throw ICloudStoreError(code: "invalid", message: "That backup is empty.") }
        guard data.count <= OneDriveRules.maximumBytes else {
            throw ICloudStoreError(code: "too-large", message: "That backup is larger than a cloud backup can be.")
        }
        return data
    }

    // MARK: - Requests

    private func run(_ operation: String, _ input: [String: Any]) async throws -> [String: Any] {
        switch operation {
        case "status":
            return ["status": status()]
        case "connect":
            if let provider = input["provider"], provider as? String != "onedrive" {
                throw ICloudStoreError(code: "invalid", message: Self.notOffered)
            }
            return ["status": connect()]
        case "disconnect":
            return ["status": disconnect()]
        case "list":
            let items = try await withAccount(operation, input) { [store] current, tokens in
                try await store.list(folder: current.folder, tokens: tokens)
            }
            return ["items": items.map(\.json)]
        case "read":
            let id = try Self.itemId(input)
            let data = try await withAccount(operation, input) { [store] _, tokens in
                try await store.read(id: id, tokens: tokens)
            }
            return ["bytes": data.base64EncodedString()]
        case "create":
            let name = try Self.backupName(input)
            let data = try Self.backupBytes(input)
            let item = try await withAccount(operation, input) { [weak self, store] current, tokens in
                let made = try await store.create(name: name, data: data, folder: current.folder, tokens: tokens)
                if let folder = made.folder { self?.learn(folder: folder, connection: current.connection) }
                return made.item
            }
            return ["item": item.json]
        case "delete":
            let id = try Self.itemId(input)
            try await withAccount(operation, input) { [store] _, tokens in
                try await store.delete(id: id, tokens: tokens)
            }
            return [:]
        default:
            throw ICloudStoreError(code: "invalid", message: "There is no such cloud operation.")
        }
    }

    // A folder made again by a create, after the old one was deleted, is recorded, so a later deletion is
    // noticed again.
    private func learn(folder: String, connection: String) {
        guard var next = record, next.connection == connection, next.folder == nil else { return }
        next.folder = folder
        record = next
        _ = credentials.save(next)
    }

    static func encode(_ value: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"ok":false,"error":{"code":"failed","message":"Cloud backup stopped unexpectedly."}}"#
        }
        return text
    }

    static func failure(_ code: String, _ message: String, retryAfterMs: Int = 0) -> ICloudBackupHandler.Reply {
        var error: [String: Any] = ["code": code, "message": message]
        if retryAfterMs > 0 { error["retryAfterMs"] = retryAfterMs }
        return ICloudBackupHandler.Reply(status: 200, body: encode(["ok": false, "error": error]))
    }

    /// One request from the page, checked and answered as the iCloud handler answers it.
    func handle(operation: String, body: String) async -> ICloudBackupHandler.Reply {
        guard ICloudBackupHandler.operations.contains(operation) else {
            return ICloudBackupHandler.refuse(404, code: "operation", message: "There is no such cloud operation.")
        }
        let limit = operation == "create" ? ICloudBackupHandler.createBody : ICloudBackupHandler.smallBody
        guard body.utf8.count <= limit else {
            return ICloudBackupHandler.refuse(413, code: "size", message: "That request is larger than this operation accepts.")
        }
        let parsed: Any? = body.isEmpty ? [String: Any]() : try? JSONSerialization.jsonObject(with: Data(body.utf8))
        guard let input = parsed as? [String: Any] else {
            return ICloudBackupHandler.refuse(400, code: "json", message: "That request is not a JSON object.")
        }
        guard inFlight < ICloudBackupHandler.maximumInFlight else {
            return ICloudBackupHandler.refuse(429, code: "unavailable", message: "Too many cloud requests at once.")
        }
        inFlight += 1
        defer { inFlight -= 1 }
        do {
            var out = try await run(operation, input)
            out["ok"] = true
            return ICloudBackupHandler.Reply(status: 200, body: Self.encode(out))
        } catch let error as ICloudStoreError {
            return Self.failure(error.code, error.message, retryAfterMs: error.retryAfterMs)
        } catch {
            return Self.failure("failed", "Cloud backup stopped unexpectedly.")
        }
    }
}
#endif
