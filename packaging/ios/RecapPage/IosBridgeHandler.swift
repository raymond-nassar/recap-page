import Foundation
import UIKit
import WebKit

struct IOSExportRequest {
    static let maximumBytes = 32 * 1024 * 1024
    private static let types = [
        "application/json": ".json",
        "text/markdown": ".md",
        "text/plain": ".txt",
    ]

    let id: String
    let filename: String
    let type: String
    let data: Data

    init?(body: Any) {
        guard let message = body as? [String: Any],
              message["v"] as? Int == 1,
              message["kind"] as? String == "save",
              let id = message["id"] as? String,
              id.range(of: "^[A-Za-z0-9._:-]{1,96}$", options: .regularExpression) != nil,
              let filename = message["filename"] as? String,
              filename.count <= 180,
              filename.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil,
              let type = message["type"] as? String,
              let extensionName = Self.types[type],
              filename.hasSuffix(extensionName),
              let text = message["text"] as? String,
              text.utf8.count <= Self.maximumBytes else {
            return nil
        }
        self.id = id
        self.filename = filename
        self.type = type
        data = Data(text.utf8)
    }

    static func isTrustedPage(_ url: URL?, isMainFrame: Bool, policy: NavigationPolicy) -> Bool {
        guard isMainFrame, let url else { return false }
        return policy.isAppPage(url)
    }
}

struct IOSDataLossState {
    private static let savedDataKey = "recap.ios.savedDataSeen"
    private static let dismissedNoticeKey = "recap.ios.dataLossNoticeDismissed"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var hasPreviouslySavedData: Bool {
        defaults.bool(forKey: Self.savedDataKey)
    }

    var isNoticeDismissed: Bool {
        defaults.bool(forKey: Self.dismissedNoticeKey)
    }

    var pageStateScript: String {
        "window.recapIosHadSavedData = \(hasPreviouslySavedData ? "true" : "false");"
            + "window.recapIosDataLossNoticeDismissed = \(isNoticeDismissed ? "true" : "false");"
    }

    func recordSavedData() {
        defaults.set(true, forKey: Self.savedDataKey)
        defaults.set(false, forKey: Self.dismissedNoticeKey)
    }

    func dismissNotice() {
        defaults.set(true, forKey: Self.dismissedNoticeKey)
    }

    func reset() {
        defaults.removeObject(forKey: Self.savedDataKey)
        defaults.removeObject(forKey: Self.dismissedNoticeKey)
    }
}

enum ExportPickerOutcome {
    case saved
    case cancelled
    case failed(String)
}

@MainActor
final class IosBridgeHandler: NSObject, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
    static let name = "recap"

    typealias PickerDriver = @MainActor (
        _ fileURL: URL,
        _ completion: @escaping @MainActor (ExportPickerOutcome) -> Void
    ) throws -> Void

    private final class PendingExport {
        let id: String
        let directory: URL
        let reply: (Any?, String?) -> Void
        var picker: UIDocumentPickerViewController?

        init(id: String, directory: URL, reply: @escaping (Any?, String?) -> Void) {
            self.id = id
            self.directory = directory
            self.reply = reply
        }
    }

    private let policy: NavigationPolicy
    private weak var presenter: UIViewController?
    private let temporaryRoot: URL
    private let fileManager: FileManager
    private let pickerDriver: PickerDriver?
    private let dataLossState: IOSDataLossState
    private var pending: PendingExport?
    #if RECAP_ICLOUD || DEBUG
    /// iCloud backup, set only by a build that carries it; without it a cloud request is answered 404,
    /// which the page reads as cloud backup not being part of this build.
    var cloud: ICloudBackupHandler?
    #endif

    init(
        policy: NavigationPolicy,
        presenter: UIViewController?,
        temporaryRoot: URL = FileManager.default.temporaryDirectory,
        fileManager: FileManager = .default,
        pickerDriver: PickerDriver? = nil,
        dataLossState: IOSDataLossState = IOSDataLossState()
    ) {
        self.policy = policy
        self.presenter = presenter
        self.temporaryRoot = temporaryRoot
        self.fileManager = fileManager
        self.pickerDriver = pickerDriver
        self.dataLossState = dataLossState
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard IOSExportRequest.isTrustedPage(
            message.frameInfo.request.url,
            isMainFrame: message.frameInfo.isMainFrame,
            policy: policy
        ) else {
            replyHandler(nil, "The iOS request did not come from the app page.")
            return
        }
        guard let body = message.body as? [String: Any],
              body["v"] as? Int == 1,
              let kind = body["kind"] as? String else {
            replyHandler(nil, "This iOS request is not supported.")
            return
        }
        switch kind {
        case "save":
            guard let request = IOSExportRequest(body: body) else {
                replyHandler(nil, "This download request is not a supported text file.")
                return
            }
            #if DEBUG
            NSLog("Recap Page iOS export handler received a request.")
            #endif
            beginExport(request, reply: replyHandler)
        case "saved-data-present":
            guard body["present"] as? Bool == true else {
                replyHandler(nil, "The saved-data marker requires a positive confirmation.")
                return
            }
            dataLossState.recordSavedData()
            replyHandler(["v": 1, "kind": "data-loss-result", "status": "recorded"], nil)
        case "dismiss-data-loss":
            dataLossState.dismissNotice()
            replyHandler(["v": 1, "kind": "data-loss-result", "status": "dismissed"], nil)
        #if RECAP_ICLOUD || DEBUG
        case "cloud":
            guard let operation = body["op"] as? String, let text = body["body"] as? String else {
                replyHandler(nil, "This cloud request is not supported.")
                return
            }
            guard let cloud else {
                // A null body, as Android sends: the page then reads "not part of this build" rather than a refusal.
                replyHandler(["v": 1, "kind": "cloud-result", "status": 404, "body": "null"], nil)
                return
            }
            Task {
                let reply = await cloud.handle(operation: operation, body: text)
                replyHandler(["v": 1, "kind": "cloud-result", "status": reply.status, "body": reply.body], nil)
            }
        #endif
        default:
            replyHandler(nil, "This iOS request is not supported.")
        }
    }

    func beginExport(_ request: IOSExportRequest, reply: @escaping (Any?, String?) -> Void) {
        guard pending == nil else {
            reply(nil, "Finish or cancel the open Files picker before starting another download.")
            return
        }

        let directory = temporaryRoot.appendingPathComponent("recap-ios-export-\(UUID().uuidString)", isDirectory: true)
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: false)
        } catch {
            reply(nil, "Could not prepare the temporary export file: \(error.localizedDescription)")
            return
        }

        let current = PendingExport(id: request.id, directory: directory, reply: reply)
        pending = current
        let fileURL = directory.appendingPathComponent(request.filename, isDirectory: false)
        Task { [weak self] in
            do {
                try await Task.detached(priority: .userInitiated) {
                    try request.data.write(to: fileURL, options: .atomic)
                }.value
            } catch {
                self?.finish(
                    id: request.id,
                    outcome: .failed("Could not write the temporary export file: \(error.localizedDescription)"))
                return
            }

            guard let self else {
                do {
                    try FileManager.default.removeItem(at: directory)
                } catch {
                    NSLog("Recap Page could not remove an abandoned temporary export: %@", error.localizedDescription)
                }
                return
            }
            guard self.pending?.id == request.id else {
                self.removeTemporaryDirectory(directory, reportFailure: true)
                return
            }
            self.presentPicker(for: request.id, fileURL: fileURL)
        }
    }

    /// A page navigation or process end invalidates the reply's original page context.
    func pageWillEnd() {
        guard let pending else { return }
        finish(id: pending.id, outcome: .failed("The page ended before the file was confirmed saved."))
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending, pending.picker === controller else { return }
        if urls.isEmpty {
            finish(id: pending.id, outcome: .failed("Files did not confirm an exported location."))
        } else {
            finish(id: pending.id, outcome: .saved)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let pending, pending.picker === controller else { return }
        finish(id: pending.id, outcome: .cancelled)
    }

    private func presentPicker(for id: String, fileURL: URL) {
        guard pending?.id == id else { return }
        #if DEBUG
        if let outcome = DebugSupport.exportPickerOutcome {
            finish(id: id, outcome: outcome)
            return
        }
        #endif

        if let pickerDriver {
            do {
                try pickerDriver(fileURL) { [weak self] outcome in
                    self?.finish(id: id, outcome: outcome)
                }
            } catch {
                finish(id: id, outcome: .failed("Could not open the Files picker: \(error.localizedDescription)"))
            }
            return
        }

        guard let presenter, presenter.viewIfLoaded?.window != nil,
              presenter.presentedViewController == nil else {
            finish(id: id, outcome: .failed("The Files picker could not be opened from this screen."))
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
        picker.delegate = self
        pending?.picker = picker
        if let popover = picker.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        presenter.present(picker, animated: true)
    }

    private func finish(id: String, outcome: ExportPickerOutcome) {
        guard let request = pending, request.id == id else { return }
        pending = nil
        if let picker = request.picker {
            picker.delegate = nil
            if picker.presentingViewController != nil { picker.dismiss(animated: true) }
        }

        var finalOutcome = outcome
        var message: String?
        switch outcome {
        case .saved:
            message = "File saved to the location you chose."
        case .cancelled:
            message = "Download cancelled. Your saved reading data is unchanged."
        case .failed(let reason):
            message = reason
        }
        if let cleanupFailure = removeTemporaryDirectory(request.directory, reportFailure: true) {
            finalOutcome = .failed("The temporary export file could not be removed: \(cleanupFailure)")
        }
        if case .failed(let reason) = finalOutcome { message = reason }
        let status: String
        switch finalOutcome {
        case .saved: status = "saved"
        case .cancelled: status = "cancelled"
        case .failed: status = "failed"
        }
        #if DEBUG
        NSLog("Recap Page iOS export outcome: \(status)")
        #endif
        request.reply([
            "v": 1,
            "kind": "save-result",
            "id": request.id,
            "status": status,
            "message": message ?? "",
        ], nil)
    }

    @discardableResult
    private func removeTemporaryDirectory(_ directory: URL, reportFailure: Bool) -> String? {
        guard fileManager.fileExists(atPath: directory.path) else { return nil }
        do {
            try fileManager.removeItem(at: directory)
            return nil
        } catch {
            if reportFailure {
                NSLog("Recap Page could not remove a temporary export: %@", error.localizedDescription)
            }
            return error.localizedDescription
        }
    }
}
