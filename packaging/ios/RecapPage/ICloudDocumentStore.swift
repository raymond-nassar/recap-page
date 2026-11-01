#if RECAP_ICLOUD || DEBUG
import Foundation

// iCloud backup keeps its files in the visible Recap Page folder of the reader's iCloud Drive, which is the
// Documents folder of the app's own iCloud container. Nothing here compiles into a Release build unless the
// build switch defines RECAP_ICLOUD, and a repository test holds every line of this file to that condition,
// so a Release build cut while the switch is off ships none of it.

/// A refusal in the words and codes of the cloud backup contract, which the page's engine acts on.
struct ICloudStoreError: Error, Equatable {
    let code: String
    let message: String
    var retryAfterMs = 0

    static let driveOff = ICloudStoreError(
        code: "unavailable",
        message: "iCloud Drive is not available to Recap Page. Sign in to iCloud and turn on iCloud Drive for Recap Page in Settings."
    )
    static let notFound = ICloudStoreError(code: "not-found", message: "That backup is no longer in iCloud Drive.")
    static let exists = ICloudStoreError(code: "exists", message: "A backup with that name is already in iCloud Drive.")
    static let tooLarge = ICloudStoreError(code: "too-large", message: "That backup is larger than cloud backup accepts.")
    static let deviceFull = ICloudStoreError(
        code: "quota",
        message: "This device is out of storage, so the backup could not be saved for iCloud to upload."
    )
    static let iCloudFull = ICloudStoreError(code: "quota", message: "Your iCloud storage is full, so iCloud cannot upload the backup.")
    static let stillDownloading = ICloudStoreError(
        code: "unavailable",
        message: "iCloud is still downloading this backup to this device. It is tried again shortly.",
        retryAfterMs: 15_000
    )
    static let iCloudBusy = ICloudStoreError(
        code: "unavailable",
        message: "iCloud could not be reached. It is tried again shortly.",
        retryAfterMs: 30_000
    )
    static let interrupted = ICloudStoreError(
        code: "unavailable",
        message: "iCloud Drive was busy with this file. It is tried again shortly.",
        retryAfterMs: 5_000
    )
    static let failed = ICloudStoreError(code: "failed", message: "Cloud backup stopped unexpectedly.")
}

/// One backup file in the folder. Its name is its id: iCloud Drive keeps one file per name in a folder.
struct ICloudBackupItem: Equatable {
    let name: String
    let size: Int?
    let isUploaded: Bool
}

/// What iCloud has still to upload, for the card's line about waiting for iCloud.
struct ICloudUploadState: Equatable {
    var waiting = false
    var iCloudFull = false
}

/// The seam between the backup handler and iCloud Drive. The real store needs a signed build with the
/// iCloud entitlement, which no CI runner has, so the handler's tests and the UI tests use a fake.
protocol ICloudDocumentStore: AnyObject {
    /// The signed-in iCloud account as an opaque archive, or nil when no account can use iCloud Drive.
    func currentIdentity() -> Data?
    func isSameIdentity(_ first: Data, _ second: Data) -> Bool
    /// Reaches the folder, which the first use of the container may have to set up.
    func prepare() async throws
    func list() async throws -> [ICloudBackupItem]
    func uploadState() async throws -> ICloudUploadState
    func read(name: String) async throws -> Data
    func create(name: String, data: Data) async throws -> ICloudBackupItem
    func delete(name: String) async throws
}

final class ICloudDriveStore: ICloudDocumentStore {
    static let containerIdentifier = "iCloud.io.github.raymondnassar.recappage"
    static let maximumBytes = 32 * 1024 * 1024
    private static let placeholderSuffix = ".icloud"

    typealias Locator = () -> URL?
    typealias IdentitySource = () -> (any NSCoding & NSObjectProtocol)?

    private let locate: Locator
    private let identity: IdentitySource
    private let downloadWaitNanoseconds: UInt64

    /// The real store: the container's Documents folder, which the Files app shows as Recap Page.
    convenience init(containerIdentifier: String = ICloudDriveStore.containerIdentifier) {
        self.init(
            locate: { FileManager.default.url(forUbiquityContainerIdentifier: containerIdentifier) },
            identity: { FileManager.default.ubiquityIdentityToken }
        )
    }

    /// `locate` names the container's root and is only ever called off the main thread, as Apple requires.
    init(locate: @escaping Locator, identity: @escaping IdentitySource, downloadWaitSeconds: UInt64 = 20) {
        self.locate = locate
        self.identity = identity
        downloadWaitNanoseconds = downloadWaitSeconds * 1_000_000_000
    }

    func currentIdentity() -> Data? {
        guard let token = identity() else { return nil }
        return try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: false)
    }

    // Apple's guidance compares identity tokens with isEqual, so two archives are unarchived and compared
    // that way rather than byte for byte, which an archive does not promise to keep stable.
    func isSameIdentity(_ first: Data, _ second: Data) -> Bool {
        if first == second { return true }
        guard let one = Self.unarchive(first), let other = Self.unarchive(second) else { return false }
        return one.isEqual(other)
    }

    private static func unarchive(_ data: Data) -> NSObject? {
        guard let reader = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
        reader.requiresSecureCoding = false
        defer { reader.finishDecoding() }
        return reader.decodeObject(forKey: NSKeyedArchiveRootObjectKey) as? NSObject
    }

    static func isBackupName(_ name: String) -> Bool {
        name.range(of: "^recap-page-[a-z0-9][a-z0-9.-]{0,118}$", options: .regularExpression) != nil
    }

    // A file iCloud knows of but has not downloaded may sit in the folder as a hidden placeholder, a dot,
    // the name and ".icloud", until it is downloaded.
    private static func placeholder(for url: URL) -> URL {
        url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent)\(placeholderSuffix)")
    }

    private static func name(ofEntry entry: String) -> (name: String, isPlaceholder: Bool) {
        if entry.hasPrefix("."), entry.hasSuffix(placeholderSuffix), entry.count > 1 + placeholderSuffix.count {
            return (String(entry.dropFirst().dropLast(placeholderSuffix.count)), true)
        }
        return (entry, false)
    }

    private func offMain<T: Sendable>(_ work: @escaping () throws -> T) async throws -> T {
        do {
            return try await Task.detached(priority: .userInitiated) { try work() }.value
        } catch {
            throw Self.mapped(error)
        }
    }

    private func folder() throws -> URL {
        guard let root = locate() else { throw ICloudStoreError.driveOff }
        let documents = root.appendingPathComponent("Documents", isDirectory: true)
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        return documents
    }

    func prepare() async throws {
        _ = try await offMain { try self.folder() }
    }

    func list() async throws -> [ICloudBackupItem] {
        try await offMain { try self.listed() }
    }

    private func listed() throws -> [ICloudBackupItem] {
        let documents = try folder()
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .isUbiquitousItemKey, .ubiquitousItemIsUploadedKey]
        let entries = try FileManager.default.contentsOfDirectory(
            at: documents,
            includingPropertiesForKeys: keys,
            options: []
        )
        var byName: [String: ICloudBackupItem] = [:]
        for entry in entries {
            let (name, isPlaceholder) = Self.name(ofEntry: entry.lastPathComponent)
            guard Self.isBackupName(name) else { continue }
            let values = try? entry.resourceValues(forKeys: Set(keys))
            if values?.isDirectory == true { continue }
            // A file outside iCloud has nothing to upload, which is the case in the tests' plain folders.
            let uploaded = values?.isUbiquitousItem == true ? values?.ubiquitousItemIsUploaded ?? false : true
            let item = ICloudBackupItem(name: name, size: isPlaceholder ? nil : values?.fileSize, isUploaded: uploaded)
            if isPlaceholder, byName[name] != nil { continue }
            byName[name] = item
        }
        return byName.values.sorted { $0.name < $1.name }
    }

    func uploadState() async throws -> ICloudUploadState {
        try await offMain {
            let documents = try self.folder()
            let keys: [URLResourceKey] = [.isUbiquitousItemKey, .ubiquitousItemIsUploadedKey, .ubiquitousItemUploadingErrorKey]
            var state = ICloudUploadState()
            for entry in try FileManager.default.contentsOfDirectory(at: documents, includingPropertiesForKeys: keys, options: []) {
                guard Self.isBackupName(entry.lastPathComponent),
                      let values = try? entry.resourceValues(forKeys: Set(keys)),
                      values.isUbiquitousItem == true,
                      values.ubiquitousItemIsUploaded != true else { continue }
                state.waiting = true
                if let problem = values.ubiquitousItemUploadingError,
                   problem.code == NSUbiquitousFileNotUploadedDueToQuotaError {
                    state.iCloudFull = true
                }
            }
            return state
        }
    }

    func read(name: String) async throws -> Data {
        let url = try await offMain { try self.folder().appendingPathComponent(name, isDirectory: false) }
        try await waitForDownload(url)
        return try await offMain {
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            if let size = values.fileSize, size > Self.maximumBytes { throw ICloudStoreError.tooLarge }
            return try Self.coordinated(reading: url) { try Data(contentsOf: $0) }
        }
    }

    // Asks iCloud for a file this device has not downloaded, and waits a little while for it. A file still
    // downloading after that is refused as worth retrying, so a slow download never holds a restore open.
    private func waitForDownload(_ url: URL) async throws {
        let present = try await offMain { () -> Bool? in
            let manager = FileManager.default
            let isLocal = manager.fileExists(atPath: url.path)
            guard isLocal || manager.fileExists(atPath: Self.placeholder(for: url).path) else { return nil }
            let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
            guard values?.isUbiquitousItem == true else { return isLocal }
            if values?.ubiquitousItemDownloadingStatus == .current { return true }
            try manager.startDownloadingUbiquitousItem(at: url)
            return false
        }
        guard let present else { throw ICloudStoreError.notFound }
        if present { return }
        let step: UInt64 = 500_000_000
        var waited: UInt64 = 0
        while waited < downloadWaitNanoseconds {
            try await Task.sleep(nanoseconds: step)
            waited += step
            let current = try await offMain { () -> Bool in
                var url = url
                url.removeAllCachedResourceValues()
                return (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
                    .ubiquitousItemDownloadingStatus == .current
            }
            if current { return }
        }
        throw ICloudStoreError.stillDownloading
    }

    func create(name: String, data: Data) async throws -> ICloudBackupItem {
        guard data.count <= Self.maximumBytes else { throw ICloudStoreError.tooLarge }
        return try await offMain {
            let url = try self.folder().appendingPathComponent(name, isDirectory: false)
            try Self.coordinated(writing: url, options: []) { target in
                let manager = FileManager.default
                if manager.fileExists(atPath: target.path) || manager.fileExists(atPath: Self.placeholder(for: target).path) {
                    throw ICloudStoreError.exists
                }
                try data.write(to: target, options: [.withoutOverwriting])
            }
            return ICloudBackupItem(name: name, size: data.count, isUploaded: false)
        }
    }

    // A file already gone counts as deleted, as a delete that is repeated after an interruption must.
    func delete(name: String) async throws {
        try await offMain {
            let url = try self.folder().appendingPathComponent(name, isDirectory: false)
            let manager = FileManager.default
            let target: URL
            if manager.fileExists(atPath: url.path) {
                target = url
            } else if manager.fileExists(atPath: Self.placeholder(for: url).path) {
                target = Self.placeholder(for: url)
            } else {
                return
            }
            do {
                try Self.coordinated(writing: target, options: .forDeleting) { try manager.removeItem(at: $0) }
            } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
                return
            }
        }
    }

    private static func coordinated<T>(reading url: URL, _ work: (URL) throws -> T) throws -> T {
        var coordination: NSError?
        var result: Result<T, Error> = .failure(ICloudStoreError.failed)
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordination) { actual in
            result = Result { try work(actual) }
        }
        if let coordination { throw coordination }
        return try result.get()
    }

    private static func coordinated(
        writing url: URL,
        options: NSFileCoordinator.WritingOptions,
        _ work: (URL) throws -> Void
    ) throws {
        var coordination: NSError?
        var result: Result<Void, Error> = .failure(ICloudStoreError.failed)
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordination) { actual in
            result = Result { try work(actual) }
        }
        if let coordination { throw coordination }
        try result.get()
    }

    static func mapped(_ error: Error) -> ICloudStoreError {
        if let known = error as? ICloudStoreError { return known }
        let error = error as NSError
        guard error.domain == NSCocoaErrorDomain else { return .failed }
        switch error.code {
        case NSFileWriteFileExistsError: return .exists
        case NSFileNoSuchFileError, NSFileReadNoSuchFileError: return .notFound
        case NSFileWriteOutOfSpaceError: return .deviceFull
        case NSUbiquitousFileNotUploadedDueToQuotaError: return .iCloudFull
        case NSUbiquitousFileUbiquityServerNotAvailable, NSUbiquitousFileUnavailableError: return .iCloudBusy
        // A coordination wait that iOS cancels, as it does when the app is suspended.
        case NSUserCancelledError: return .interrupted
        default: return .failed
        }
    }
}
#endif
