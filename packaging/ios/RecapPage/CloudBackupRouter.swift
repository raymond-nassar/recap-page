#if RECAP_ICLOUD || DEBUG
import Foundation

/// What the bridge hands a page's cloud request to: the iCloud handler alone, or the router below when the
/// build also carries OneDrive.
@MainActor
protocol CloudBackupHandling: AnyObject {
    func handle(operation: String, body: String) async -> ICloudBackupHandler.Reply
}

extension ICloudBackupHandler: CloudBackupHandling {}

/// iCloud Drive and OneDrive side by side, for a build that carries both. A device holds at most one
/// connection, to one provider, at a time, as on every other host: the card offers the choice only while
/// neither is connected, and a provider is changed by disconnecting the one in use first.
@MainActor
final class CloudBackupRouter: CloudBackupHandling {
    static let otherInUse = "Cloud backup is already set up with another service on this device. Disconnect it first."
    static let providers = ["icloud", "onedrive"]

    private let iCloud: ICloudBackupHandler
    private let oneDrive: OneDriveBackupHandler
    private var inFlight = 0

    init(iCloud: ICloudBackupHandler, oneDrive: OneDriveBackupHandler) {
        self.iCloud = iCloud
        self.oneDrive = oneDrive
        oneDrive.providers = Self.providers
    }

    // OneDrive answers while it is connected, signing in, or has just said why a sign-in ended; otherwise
    // iCloud does, offering both. iCloud signed out is only unavailable to iCloud, so with nothing connected
    // the card is still offered, and OneDrive with it.
    private func status() async -> [String: Any] {
        if oneDrive.isActive || oneDrive.hasMessage { return oneDrive.status() }
        var current = await iCloud.status()
        current["providers"] = Self.providers
        if current["state"] as? String == "unavailable", !(current["connection"] is String) {
            current["state"] = "not-connected"
        }
        return current
    }

    private func iCloudConnected() async -> Bool {
        await iCloud.status()["connection"] is String
    }

    private func reply(_ out: [String: Any]) -> ICloudBackupHandler.Reply {
        var body = out
        body["ok"] = true
        return ICloudBackupHandler.Reply(status: 200, body: OneDriveBackupHandler.encode(body))
    }

    private func account(_ operation: String, _ input: [String: Any]) async -> ICloudBackupHandler.Reply {
        switch operation {
        case "connect":
            let provider = input["provider"]
            if provider == nil || provider as? String == "onedrive" {
                let iCloudInUse = await iCloudConnected()
                guard !iCloudInUse else { return OneDriveBackupHandler.failure("invalid", Self.otherInUse) }
                return reply(["status": oneDrive.connect()])
            }
            guard provider as? String == "icloud" else {
                return OneDriveBackupHandler.failure("invalid", OneDriveBackupHandler.notOffered)
            }
            guard !oneDrive.isActive else { return OneDriveBackupHandler.failure("invalid", Self.otherInUse) }
            oneDrive.forgetMessage()
            do {
                _ = try await iCloud.connect()
                let current = await status()
                return reply(["status": current])
            } catch {
                let refusal = ICloudDriveStore.mapped(error)
                return OneDriveBackupHandler.failure(refusal.code, refusal.message, retryAfterMs: refusal.retryAfterMs)
            }
        case "disconnect":
            _ = oneDrive.disconnect()
            _ = await iCloud.disconnect()
            let current = await status()
            return reply(["status": current])
        default:
            let current = await status()
            return reply(["status": current])
        }
    }

    func handle(operation: String, body: String) async -> ICloudBackupHandler.Reply {
        guard ["status", "connect", "disconnect"].contains(operation) else {
            // Data operations, and an unknown one for its 404, go to the provider in use.
            if oneDrive.isActive { return await oneDrive.handle(operation: operation, body: body) }
            return await iCloud.handle(operation: operation, body: body)
        }
        guard body.utf8.count <= ICloudBackupHandler.smallBody else {
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
        return await account(operation, input)
    }
}
#endif
