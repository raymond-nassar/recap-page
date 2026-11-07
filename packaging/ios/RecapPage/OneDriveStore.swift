#if RECAP_ICLOUD || DEBUG
import Foundation

/// The app folder in OneDrive over Microsoft Graph, request for request as the Android app's CloudOneDrive
/// and the Windows host's host/oneDrive.mjs make them; that module records the observations each request
/// rests on. Only this type sets Authorization, and only on a Graph request: an upload session's address
/// and a download's are capabilities in themselves, and never carry the token.
@MainActor
final class OneDriveStore {
    static let graph = "https://graph.microsoft.com/v1.0"
    static let folderGoneMessage = "The Recap Page folder was deleted from OneDrive."
    private static let metadataSeconds: TimeInterval = 30
    private static let maximumPages = 50
    private static let small = 64 * 1024
    private static let json = 1024 * 1024
    private static let page = 8 * 1024 * 1024
    private static let itemFields = "$select=id,name,size,createdDateTime"
    // Only the conflict behavior: a name here would have to equal the path's, which the reference requires.
    private static let createSession = Data(#"{"item":{"@microsoft.graph.conflictBehavior":"fail"}}"#.utf8)

    /// The folder the account recorded answered 404: the person deleted it.
    struct FolderGone: Error {}

    struct Item {
        let id: String
        let name: String
        let size: Int?
        let created: Int?

        var json: [String: Any] {
            [
                "id": id,
                "name": name,
                "size": size.map { $0 as Any } ?? NSNull(),
                "created": created.map { $0 as Any } ?? NSNull(),
            ]
        }
    }

    struct AppFolder: Equatable {
        let id: String?
        let driveId: String?
    }

    /// An access token, renewed when asked.
    typealias Tokens = @MainActor (_ renew: Bool) async throws -> String

    private let transport: OneDriveTransport
    private let now: () -> Double
    // Uploads under way and upload sessions that could not be settled, kept across operations and
    // connections: a list waits for the first and cancels the second, so nothing a reply said had failed can
    // appear in the account after a list that missed it.
    private var creating = 0
    private var idle: [CheckedContinuation<Void, Never>] = []
    private var unsettled: [(name: String, upload: URL)] = []

    init(transport: OneDriveTransport, now: @escaping () -> Double) {
        self.transport = transport
        self.now = now
    }

    // The app folder by its item id once known, so a folder the person deleted answers 404 rather than
    // being made again without a word; until then the special app-root path, which Microsoft resolves.
    private static func base(_ folder: String?) -> String {
        folder.map { "/me/drive/items/\(OneDriveRules.segment($0))" } ?? "/me/drive/special/approot"
    }

    private static func transferSeconds(_ bytes: Int) -> TimeInterval {
        TimeInterval(60 + (bytes + 65_535) / 65_536)
    }

    private func failure(_ response: OneDriveResponse) -> ICloudStoreError {
        let wait = OneDriveRules.retryAfterMs(response.header("retry-after"), now: now())
        switch response.status {
        case 401: return ICloudStoreError(code: "needs-sign-in", message: "OneDrive asked for the sign-in to be made again.")
        case 403: return ICloudStoreError(code: "refused", message: "OneDrive refused access to the app folder.")
        case 404: return ICloudStoreError(code: "not-found", message: "That item is no longer in OneDrive.")
        case 409: return ICloudStoreError(code: "exists", message: "OneDrive already holds an item with that name.")
        case 429, 503:
            return ICloudStoreError(code: "unavailable", message: "OneDrive asked to wait before trying again.", retryAfterMs: wait)
        case 507: return ICloudStoreError(code: "quota", message: "OneDrive is full, so nothing more can be backed up there.")
        case 500...: return ICloudStoreError(code: "unavailable", message: "OneDrive did not answer this time.")
        default:
            return ICloudStoreError(
                code: "invalid", message: "OneDrive answered in a way this version does not expect (\(response.status))."
            )
        }
    }

    private func send(_ request: OneDriveRequest) async throws -> OneDriveResponse {
        do {
            return try await transport.send(request)
        } catch {
            throw OneDriveMicrosoft.networkFailure(error, "OneDrive")
        }
    }

    private func call(
        _ method: String,
        _ path: String,
        headers: [String: String] = [:],
        body: Data? = nil,
        limit: Int,
        tokens: Tokens
    ) async throws -> OneDriveResponse {
        guard let url = URL(string: Self.graph + path) else {
            throw ICloudStoreError(code: "invalid", message: "The request did not name an item.")
        }
        var attempt = 0
        while true {
            let token = try await tokens(attempt > 0)
            var all = headers
            all["Authorization"] = "Bearer \(token)"
            let response = try await send(OneDriveRequest(
                method: method, url: url, headers: all, body: body, timeout: Self.metadataSeconds, limit: limit
            ))
            if response.status == 401 && attempt == 0 {
                attempt += 1
                continue
            }
            return response
        }
    }

    static func item(_ value: Any?) -> Item? {
        guard let map = value as? [String: Any],
              OneDriveRules.isItemId(map["id"]),
              let id = map["id"] as? String,
              let name = map["name"] as? String,
              !name.isEmpty, name.utf16.count <= 1024 else { return nil }
        var created: Int?
        if let when = map["createdDateTime"] as? String {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var date = formatter.date(from: when)
            if date == nil {
                formatter.formatOptions = [.withInternetDateTime]
                date = formatter.date(from: when)
            }
            created = date.map { Int(($0.timeIntervalSince1970 * 1000).rounded()) }
        }
        let size = OneDriveRules.safeInteger(map["size"]).flatMap { $0 >= 0 ? $0 : nil }
        return Item(id: id, name: name, size: size, created: created)
    }

    private static func parent(_ body: [String: Any]?, _ key: String) -> Any? {
        (body?["parentReference"] as? [String: Any])?[key]
    }

    // Cancelling a session makes it unable to complete later. A session that is already gone, because it
    // completed or expired, answers 404, which settles it just as well.
    private func cancel(_ upload: URL) async -> Bool {
        guard let response = try? await transport.send(OneDriveRequest(
            method: "DELETE", url: upload, timeout: Self.metadataSeconds, limit: Self.small
        )) else { return false }
        return response.status == 204 || response.status == 404
    }

    private func lookup(_ name: String, folder: String?, tokens: Tokens) async throws -> Item? {
        let response = try await call(
            "GET", "\(Self.base(folder)):/\(OneDriveRules.segment(name))?\(Self.itemFields)", limit: Self.json, tokens: tokens
        )
        if response.status == 404 { return nil }
        guard response.ok else { throw failure(response) }
        guard let found = Self.item(OneDriveRules.object(response.body)) else {
            throw ICloudStoreError(code: "invalid", message: "OneDrive described the item in a way this version does not expect.")
        }
        return found
    }

    // An upload that got no answer may still have been committed. Its session is cancelled first, so nothing
    // can complete after this reply, and then its name is looked up: the file is there now, or never will be.
    // A session that cannot be cancelled leaves the outcome unknown, which the contract calls a timeout: the
    // next list cancels it first and shows whether it landed. A wait the service asked for is kept when the
    // file is not there.
    private func settle(_ name: String, upload: URL, wait: Int, folder: String?, tokens: Tokens) async throws -> Item {
        guard await cancel(upload) else {
            unsettled.append((name: name, upload: upload))
            throw ICloudStoreError(code: "timeout", message: "OneDrive did not say whether the backup was saved.")
        }
        guard let found = try await lookup(name, folder: folder, tokens: tokens) else {
            throw ICloudStoreError(code: "unavailable", message: "The backup did not reach OneDrive.", retryAfterMs: max(0, wait))
        }
        return found
    }

    /// The new item, and the app folder's id when this create was the one that made the folder.
    func create(name: String, data: Data, folder: String?, tokens: Tokens) async throws -> (item: Item, folder: String?) {
        creating += 1
        defer {
            creating -= 1
            if creating == 0 {
                let waiting = idle
                idle = []
                waiting.forEach { $0.resume() }
            }
        }
        return try await createOnce(name: name, data: data, folder: folder, tokens: tokens)
    }

    private func createOnce(name: String, data: Data, folder: String?, tokens: Tokens) async throws -> (item: Item, folder: String?) {
        let opened = try await call(
            "POST", "\(Self.base(folder)):/\(OneDriveRules.segment(name)):/createUploadSession",
            headers: ["Content-Type": "application/json"], body: Self.createSession, limit: Self.small, tokens: tokens
        )
        if opened.status == 404 && folder != nil { throw FolderGone() }
        guard opened.ok else { throw failure(opened) }
        guard let upload = OneDriveRules.capabilityUrl(OneDriveRules.object(opened.body)?["uploadUrl"]) else {
            throw ICloudStoreError(code: "invalid", message: "OneDrive did not return a usable upload address.")
        }
        let response: OneDriveResponse
        do {
            response = try await transport.send(OneDriveRequest(
                method: "PUT", url: upload, headers: ["Content-Range": "bytes 0-\(data.count - 1)/\(data.count)"],
                body: data, timeout: Self.transferSeconds(data.count), limit: Self.small
            ))
        } catch {
            return (try await settle(name, upload: upload, wait: 0, folder: folder, tokens: tokens), nil)
        }
        if response.status == 200 || response.status == 201 {
            let body = OneDriveRules.object(response.body)
            guard let created = Self.item(body), created.name == name else {
                return (try await settle(name, upload: upload, wait: 0, folder: folder, tokens: tokens), nil)
            }
            // A folder made again by this create, after the old one was deleted, is learned from its answer,
            // so a later deletion is noticed again.
            let made = Self.parent(body, "id")
            return (created, folder == nil && OneDriveRules.isItemId(made) ? made as? String : nil)
        }
        if response.status == 202 {
            return (try await settle(name, upload: upload, wait: 0, folder: folder, tokens: tokens), nil)
        }
        // A timeout or a server failure may come after every byte was committed, so it is settled as a lost
        // reply is: a create refused with any code but timeout must never appear later. Other refusals are
        // definite, and the session is cancelled so its bytes can never be committed under another name.
        if response.status == 408 || (response.status >= 500 && response.status != 507) {
            let wait = OneDriveRules.retryAfterMs(response.header("retry-after"), now: now())
            return (try await settle(name, upload: upload, wait: wait, folder: folder, tokens: tokens), nil)
        }
        let refused = failure(response)
        _ = await cancel(upload)
        throw refused
    }

    // The app folder's own id, and its drive, which names the account: a later sign-in to the same drive
    // and the same folder keeps the connection, so no page has to agree to backups again.
    func appFolder(tokens: Tokens) async throws -> AppFolder {
        let response = try await call("GET", "/me/drive/special/approot?$select=id,parentReference", limit: Self.small, tokens: tokens)
        if response.status == 404 { return AppFolder(id: nil, driveId: nil) }
        guard response.ok else { throw failure(response) }
        let body = OneDriveRules.object(response.body)
        let id = body?["id"]
        let drive = Self.parent(body, "driveId")
        return AppFolder(
            id: OneDriveRules.isItemId(id) ? id as? String : nil,
            driveId: OneDriveRules.isItemId(drive) ? drive as? String : nil
        )
    }

    // Every item in the app folder, all pages. A folder not made yet lists as empty; the folder the account
    // recorded answering 404 means the person deleted it.
    func list(folder: String?, tokens: Tokens) async throws -> [Item] {
        if creating > 0 {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                idle.append(continuation)
            }
        }
        for entry in unsettled {
            if await cancel(entry.upload) {
                unsettled.removeAll { $0.upload == entry.upload }
            }
        }
        var items: [Item] = []
        var path = "\(Self.base(folder))/children?\(Self.itemFields)&$top=200"
        for index in 0..<Self.maximumPages {
            let response = try await call("GET", path, limit: Self.page, tokens: tokens)
            if response.status == 404 && index == 0 {
                if folder != nil { throw FolderGone() }
                return items
            }
            guard response.ok else { throw failure(response) }
            let body = OneDriveRules.object(response.body)
            guard let value = body?["value"] as? [Any] else {
                throw ICloudStoreError(code: "invalid", message: "OneDrive listed the app folder in a way this version does not expect.")
            }
            items += value.compactMap { Self.item($0) }
            guard let body, body.keys.contains("@odata.nextLink") else { return items }
            guard let next = body["@odata.nextLink"] as? String, next.hasPrefix(Self.graph + "/") else {
                throw ICloudStoreError(code: "invalid", message: "OneDrive pointed the next page somewhere this version does not expect.")
            }
            path = String(next.dropFirst(Self.graph.count))
        }
        throw ICloudStoreError(code: "invalid", message: "The app folder holds more items than this version reads.")
    }

    func read(id: String, tokens: Tokens) async throws -> Data {
        var content = try await call(
            "GET", "/me/drive/items/\(OneDriveRules.segment(id))/content", limit: OneDriveRules.maximumBytes, tokens: tokens
        )
        if content.status == 302 {
            guard let download = OneDriveRules.capabilityUrl(content.header("location")) else {
                throw ICloudStoreError(code: "invalid", message: "OneDrive pointed the download somewhere this version does not expect.")
            }
            content = try await send(OneDriveRequest(
                method: "GET", url: download, timeout: Self.transferSeconds(OneDriveRules.maximumBytes), limit: OneDriveRules.maximumBytes
            ))
        }
        guard content.status == 200 else { throw failure(content) }
        // Kept to the cap and no further, whatever the response declares, so an item over it is refused
        // without its bytes ever being returned.
        guard let body = content.body else {
            throw ICloudStoreError(code: "too-large", message: "That item is larger than a cloud backup can be.")
        }
        return body
    }

    // An item already gone counts as deleted. OneDrive keeps every deleted item in the person's recycle bin
    // for up to 30 days, because the app-folder permission cannot delete permanently.
    func delete(id: String, tokens: Tokens) async throws {
        let response = try await call("DELETE", "/me/drive/items/\(OneDriveRules.segment(id))", limit: Self.small, tokens: tokens)
        if response.status == 204 || response.status == 404 { return }
        throw failure(response)
    }
}
#endif
