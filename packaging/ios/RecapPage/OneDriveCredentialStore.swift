#if RECAP_ICLOUD || DEBUG
import Foundation
import Security

/// What this device keeps of a OneDrive connection, as the Android app's account record holds it. A nil
/// refresh token is a connection whose sign-in has to be made again.
struct OneDriveRecord: Codable, Equatable {
    var version = 1
    var provider = "onedrive"
    var connection: String
    var account: String
    var hint: String?
    var folder: String?
    var refreshToken: String?
    var savedAt: Double
}

@MainActor
protocol OneDriveCredentialStore: AnyObject {
    func load() -> OneDriveRecord?
    /// False when the record could not be kept.
    func save(_ record: OneDriveRecord) -> Bool
    func remove()
}

/// The record in the Keychain, readable after the first unlock and never moved to another device by a
/// backup or a transfer, so Disconnect on one device leaves every other device as it was.
@MainActor
final class OneDriveKeychain: OneDriveCredentialStore {
    private let service: String
    private let account = "connection"

    init(service: String = "io.github.raymondnassar.recappage.onedrive") {
        self.service = service
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> OneDriveRecord? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(search as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let record = try? JSONDecoder().decode(OneDriveRecord.self, from: data),
              record.version == 1, record.provider == "onedrive",
              OneDriveRules.isConnection(record.connection) else { return nil }
        return record
    }

    func save(_ record: OneDriveRecord) -> Bool {
        guard let data = try? JSONEncoder().encode(record) else { return false }
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var add = query
        add.merge(update) { _, new in new }
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    func remove() {
        _ = SecItemDelete(query as CFDictionary)
    }
}
#endif
