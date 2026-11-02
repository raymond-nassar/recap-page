#if DEBUG
import Foundation

/// iCloud Drive in memory, for the handler's unit tests and the UI tests, since no CI runner has a signed
/// build that can reach iCloud. It keeps the real store's rules: one file per name, a file iCloud has not
/// downloaded yet, uploads iCloud has not finished, and the account the device is signed in to.
final class ICloudFakeStore: ICloudDocumentStore {
    var identity: Data? = Data("fake-account-1".utf8)
    var files: [String: Data] = [:]
    var notUploaded: Set<String> = []
    var notDownloaded: Set<String> = []
    var iCloudFull = false
    var folderAvailable = true
    var automaticallyUpload = true
    var uploadDelaySeconds: TimeInterval = 0
    var uploadWaitSeconds: TimeInterval = 540
    var onUploadWaitPause: (@MainActor () async -> Void)?
    private(set) var elapsed: TimeInterval = 0
    private var uploadAt: [String: TimeInterval] = [:]
    /// The next failure each operation meets, once, by operation name.
    var failures: [String: ICloudStoreError] = [:]
    private(set) var calls: [String] = []

    func currentIdentity() -> Data? { identity }

    func isSameIdentity(_ first: Data, _ second: Data) -> Bool { first == second }

    private func begin(_ operation: String, expectedIdentity: Data?) throws {
        advance(seconds: 0)
        calls.append(operation)
        if let failure = failures.removeValue(forKey: operation) { throw failure }
        guard folderAvailable, identity != nil else { throw ICloudStoreError.driveOff }
        if let expectedIdentity, expectedIdentity != identity { throw ICloudStoreError.driveOff }
    }

    func prepare(expectedIdentity: Data? = nil) async throws {
        try begin("prepare", expectedIdentity: expectedIdentity)
    }

    func list(expectedIdentity: Data? = nil) async throws -> [ICloudBackupItem] {
        try begin("list", expectedIdentity: expectedIdentity)
        return files.keys.sorted().map { name in
            ICloudBackupItem(
                name: name,
                size: notDownloaded.contains(name) ? nil : files[name]?.count,
                isUploaded: !notUploaded.contains(name)
            )
        }
    }

    func uploadState(expectedIdentity: Data? = nil) async throws -> ICloudUploadState {
        try begin("uploadState", expectedIdentity: expectedIdentity)
        return ICloudUploadState(waiting: !notUploaded.isEmpty, iCloudFull: iCloudFull && !notUploaded.isEmpty)
    }

    func read(name: String, expectedIdentity: Data? = nil) async throws -> Data {
        try begin("read", expectedIdentity: expectedIdentity)
        guard let data = files[name] else { throw ICloudStoreError.notFound }
        if notDownloaded.remove(name) != nil { throw ICloudStoreError.stillDownloading }
        guard data.count <= ICloudDriveStore.maximumBytes else { throw ICloudStoreError.tooLarge }
        try await ICloudDriveStore.waitForUpload(
            timeout: uploadWaitSeconds,
            clock: { self.elapsed },
            pause: { nanoseconds in
                if let onPause = self.onUploadWaitPause {
                    self.onUploadWaitPause = nil
                    await onPause()
                }
                self.advance(seconds: Double(nanoseconds) / 1_000_000_000)
                await Task.yield()
            },
            uploaded: {
                try self.checkIdentity(expectedIdentity)
                return !self.notUploaded.contains(name)
            }
        )
        return data
    }

    func create(name: String, data: Data, expectedIdentity: Data? = nil) async throws -> ICloudBackupItem {
        try begin("create", expectedIdentity: expectedIdentity)
        guard files[name] == nil else { throw ICloudStoreError.exists }
        guard notUploaded.isEmpty else { throw ICloudStoreError.stillUploading }
        files[name] = data
        if !automaticallyUpload || uploadDelaySeconds > 0 {
            notUploaded.insert(name)
            if automaticallyUpload { uploadAt[name] = elapsed + uploadDelaySeconds }
        }
        return ICloudBackupItem(name: name, size: data.count, isUploaded: !notUploaded.contains(name))
    }

    func delete(name: String, expectedIdentity: Data? = nil) async throws {
        try begin("delete", expectedIdentity: expectedIdentity)
        files[name] = nil
        notUploaded.remove(name)
        notDownloaded.remove(name)
        uploadAt[name] = nil
    }

    /// What iOS does once the upload finishes.
    func finishUploads() {
        notUploaded.removeAll()
        uploadAt.removeAll()
    }

    func advance(seconds: TimeInterval) {
        elapsed += seconds
        for (name, time) in uploadAt where time <= elapsed {
            notUploaded.remove(name)
            uploadAt[name] = nil
        }
    }

    private func checkIdentity(_ expected: Data?) throws {
        guard identity != nil, expected == nil || expected == identity else { throw ICloudStoreError.driveOff }
    }
}
#endif
