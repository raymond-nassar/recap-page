#if RECAP_ICLOUD || DEBUG
import Foundation

/// The cloud backup control API for iCloud: the seven operations the page's one host transport asks for,
/// status, connect, disconnect, list, read, create and delete, answered in the same JSON the Windows host
/// and the Android app give, so the page's shared engine runs unchanged over it. The contract is under
/// Cloud backup in docs/ARCHITECTURE.md.
///
/// iCloud has no sign-in of its own here: the account is the one the device is signed in to. Connecting
/// records which account that is under a new connection id, and a different account, or none, ends the
/// connection's use until Connect is chosen again, so a backup never lands in someone else's iCloud.
@MainActor
final class ICloudBackupHandler {
    static let operations: Set<String> = ["status", "connect", "disconnect", "list", "read", "create", "delete"]
    static let maximumInFlight = 16
    static let smallBody = 16 * 1024
    static let createBody = (ICloudDriveStore.maximumBytes + 2) / 3 * 4 + 16 * 1024
    private static let recordKey = "recap.ios.icloud.connection"

    static let signedOut = "Sign in to iCloud and turn on iCloud Drive for Recap Page in Settings to back up to iCloud."
    static let accountChanged = "This device is signed in to a different iCloud account than the one cloud backup was connected to, so it asks again first."
    static let connectedAgain = "Cloud backup was connected again since this page agreed to it, so it asks again first."
    static let notConnected = "Cloud backup is not connected."
    static let iCloudFull = "Your iCloud storage is full, so iCloud cannot upload the latest backup."

    struct Reply: Equatable {
        let status: Int
        let body: String
    }

    private struct Record: Codable {
        let connection: String
        let identity: Data
    }

    private let store: ICloudDocumentStore
    private let defaults: UserDefaults
    private let newConnection: () -> String
    private var inFlight = 0

    init(
        store: ICloudDocumentStore,
        defaults: UserDefaults = .standard,
        newConnection: @escaping () -> String = ICloudBackupHandler.randomConnection
    ) {
        self.store = store
        self.defaults = defaults
        self.newConnection = newConnection
    }

    nonisolated static func randomConnection() -> String {
        var generator = SystemRandomNumberGenerator()
        return (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &generator)) }.joined()
    }

    private var record: Record? {
        get {
            guard let data = defaults.data(forKey: Self.recordKey) else { return nil }
            return try? JSONDecoder().decode(Record.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: Self.recordKey)
            } else {
                defaults.removeObject(forKey: Self.recordKey)
            }
        }
    }

    // MARK: - Account

    private func statusBody(
        state: String,
        connection: String? = nil,
        message: String? = nil,
        reason: String? = nil,
        waitingForUpload: Bool = false
    ) -> [String: Any] {
        var out: [String: Any] = [
            "provider": "icloud",
            "providers": ["icloud"],
            "state": state,
            "connection": connection ?? NSNull(),
            "account": NSNull(),
            "message": message ?? NSNull(),
            "reason": reason ?? NSNull(),
            "signInExpiresAt": NSNull(),
        ]
        if waitingForUpload { out["waitingForUpload"] = true }
        return out
    }

    // Never signing-in or needs-sign-in: those states belong to a provider with its own sign-in.
    func status() async -> [String: Any] {
        guard let identity = store.currentIdentity() else {
            return statusBody(state: "unavailable", message: Self.signedOut)
        }
        guard let current = record else { return statusBody(state: "not-connected") }
        guard store.isSameIdentity(current.identity, identity) else {
            return statusBody(state: "not-connected", message: Self.accountChanged, reason: Self.accountChanged)
        }
        do {
            let uploads = try await store.uploadState(expectedIdentity: current.identity)
            return statusBody(
                state: uploads.iCloudFull ? "unavailable" : "connected",
                connection: current.connection,
                message: uploads.iCloudFull ? Self.iCloudFull : nil,
                waitingForUpload: uploads.waiting
            )
        } catch {
            return statusBody(state: "unavailable", connection: current.connection, message: ICloudDriveStore.mapped(error).message)
        }
    }

    func connect() async throws -> [String: Any] {
        guard let identity = store.currentIdentity() else { throw ICloudStoreError.driveOff }
        try await store.prepare(expectedIdentity: identity)
        // The device may have signed in to another account while the folder was being reached.
        guard let latest = store.currentIdentity(), store.isSameIdentity(latest, identity) else {
            throw ICloudStoreError.driveOff
        }
        if let current = record, store.isSameIdentity(current.identity, identity) {
            return await status()
        }
        record = Record(connection: newConnection(), identity: identity)
        return await status()
    }

    func disconnect() async -> [String: Any] {
        record = nil
        return await status()
    }

    // The connection a data operation names, held to the one this device recorded for the account it is
    // signed in to now.
    private func connected(_ input: [String: Any]) throws -> Data {
        guard let connection = input["connection"] as? String,
              connection.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else {
            throw ICloudStoreError(code: "invalid", message: "The request did not name a connection.")
        }
        guard let identity = store.currentIdentity() else { throw ICloudStoreError.driveOff }
        guard let current = record else { throw ICloudStoreError(code: "not-connected", message: Self.notConnected) }
        guard store.isSameIdentity(current.identity, identity) else {
            throw ICloudStoreError(code: "not-connected", message: Self.accountChanged)
        }
        guard current.connection == connection else {
            throw ICloudStoreError(code: "needs-consent", message: Self.connectedAgain)
        }
        return current.identity
    }

    private static func itemName(_ input: [String: Any], key: String) throws -> String {
        guard let name = input[key] as? String, ICloudDriveStore.isBackupName(name) else {
            throw ICloudStoreError(
                code: "invalid",
                message: key == "id" ? "The request did not name an item." : "That is not a name cloud backup writes."
            )
        }
        return name
    }

    private static func json(_ item: ICloudBackupItem) -> [String: Any] {
        ["id": item.name, "name": item.name, "size": item.size.map { $0 as Any } ?? NSNull(), "created": NSNull()]
    }

    // MARK: - Requests

    private func run(_ operation: String, _ input: [String: Any]) async throws -> [String: Any] {
        switch operation {
        case "status":
            let current = await status()
            return ["status": current]
        case "connect":
            if let provider = input["provider"], provider as? String != "icloud" {
                throw ICloudStoreError(code: "invalid", message: "This app connects cloud backup only to iCloud.")
            }
            let current = try await connect()
            return ["status": current]
        case "disconnect":
            let current = await disconnect()
            return ["status": current]
        case "list":
            let identity = try connected(input)
            let items = try await store.list(expectedIdentity: identity)
            return ["items": items.map(Self.json)]
        case "read":
            let identity = try connected(input)
            let data = try await store.read(name: Self.itemName(input, key: "id"), expectedIdentity: identity)
            guard data.count <= ICloudDriveStore.maximumBytes else { throw ICloudStoreError.tooLarge }
            return ["bytes": data.base64EncodedString()]
        case "create":
            let identity = try connected(input)
            let name = try Self.itemName(input, key: "name")
            guard let text = input["bytes"] as? String, let data = Data(base64Encoded: text) else {
                throw ICloudStoreError(code: "invalid", message: "The backup to upload is not readable.")
            }
            guard !data.isEmpty else { throw ICloudStoreError(code: "invalid", message: "That backup is empty.") }
            guard data.count <= ICloudDriveStore.maximumBytes else { throw ICloudStoreError.tooLarge }
            let item = try await store.create(name: name, data: data, expectedIdentity: identity)
            return ["item": Self.json(item)]
        case "delete":
            let identity = try connected(input)
            try await store.delete(name: Self.itemName(input, key: "id"), expectedIdentity: identity)
            return [:]
        default:
            throw ICloudStoreError(code: "invalid", message: "There is no such cloud operation.")
        }
    }

    static func refuse(_ status: Int, code: String, message: String) -> Reply {
        Reply(status: status, body: encode(["ok": false, "error": ["code": code, "message": message]]))
    }

    private static func encode(_ value: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"ok":false,"error":{"code":"failed","message":"Cloud backup stopped unexpectedly."}}"#
        }
        return text
    }

    /// One request from the page, as the operation's name and its JSON body, answered with an HTTP-like
    /// status and a JSON body in the shapes the Windows host sends: every failure inside an operation is a
    /// 200 with ok false, and a request turned away unread is a 4xx.
    func handle(operation: String, body: String) async -> Reply {
        guard Self.operations.contains(operation) else {
            return Self.refuse(404, code: "operation", message: "There is no such cloud operation.")
        }
        let limit = operation == "create" ? Self.createBody : Self.smallBody
        guard body.utf8.count <= limit else {
            return Self.refuse(413, code: "size", message: "That request is larger than this operation accepts.")
        }
        let parsed: Any?
        if body.isEmpty {
            parsed = [String: Any]()
        } else {
            parsed = try? JSONSerialization.jsonObject(with: Data(body.utf8))
        }
        guard let input = parsed as? [String: Any] else {
            return Self.refuse(400, code: "json", message: "That request is not a JSON object.")
        }
        guard inFlight < Self.maximumInFlight else {
            return Self.refuse(429, code: "unavailable", message: "Too many cloud requests at once.")
        }
        inFlight += 1
        defer { inFlight -= 1 }
        do {
            var out = try await run(operation, input)
            out["ok"] = true
            return Reply(status: 200, body: Self.encode(out))
        } catch {
            let refusal = ICloudDriveStore.mapped(error)
            var failure: [String: Any] = ["code": refusal.code, "message": refusal.message]
            if refusal.retryAfterMs > 0 { failure["retryAfterMs"] = refusal.retryAfterMs }
            return Reply(status: 200, body: Self.encode(["ok": false, "error": failure]))
        }
    }
}
#endif
