import Foundation
import UniformTypeIdentifiers
import UIKit

private let maximumWorkspaceBytes = 25 * 1024 * 1024
private let associationBookmarkKey = "labelmaker.workspace.bookmark.v1"
private let associationFileNameKey = "labelmaker.workspace.filename.v1"

struct SelectedWorkspace {
    let selectionID: String
    let fileName: String
    let data: Data
}

struct SavedWorkspace {
    let fileName: String
    let savedAt: String
}

@MainActor
final class WorkspaceCoordinator: NSObject, UIDocumentPickerDelegate {
    private enum PendingPicker {
        case opening((Result<SelectedWorkspace?, Error>) -> Void)
        case exporting(temporaryURL: URL, completion: (Result<SavedWorkspace?, Error>) -> Void)
    }

    private weak var presentingViewController: UIViewController?
    private var pendingPicker: PendingPicker?
    private var pendingSelections: [String: URL] = [:]

    func setPresentingViewController(_ viewController: UIViewController?) {
        presentingViewController = viewController
    }

    func confirmWorkspaceReplacement(
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        guard let presenter = activePresenter() else {
            completion(.failure(NativeBridgeFailure(code: "NO_PRESENTER", message: "The workspace dialog is not available.")))
            return
        }
        let alert = UIAlertController(
            title: "Unsaved workspace",
            message: "Save changes to this workspace? Unsaved changes will be lost if you discard them.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Save", style: .default) { _ in completion(.success("save")) })
        alert.addAction(UIAlertAction(title: "Discard Changes", style: .destructive) { _ in completion(.success("discard")) })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completion(.success("cancel")) })
        presenter.present(alert, animated: true)
    }

    func openWorkspace(completion: @escaping (Result<SelectedWorkspace?, Error>) -> Void) {
        guard beginPicker(.opening(completion)) else { return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [workspaceType], asCopy: false)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker)
    }

    func acceptSelection(_ selectionID: String) throws {
        guard let url = pendingSelections.removeValue(forKey: selectionID) else {
            throw NativeBridgeFailure(code: "INVALID_SELECTION", message: "The selected workspace is no longer available.")
        }
        try storeAssociation(url)
    }

    func clearAssociation() {
        UserDefaults.standard.removeObject(forKey: associationBookmarkKey)
        UserDefaults.standard.removeObject(forKey: associationFileNameKey)
    }

    var associatedFileName: String? {
        UserDefaults.standard.string(forKey: associationFileNameKey)
    }

    func saveWorkspace(
        data: Data,
        suggestedFileName: String,
        saveAs: Bool,
        completion: @escaping (Result<SavedWorkspace?, Error>) -> Void
    ) {
        guard isGzip(data), data.count <= maximumWorkspaceBytes else {
            completion(.failure(NativeBridgeFailure(code: "INVALID_GZIP", message: "The workspace is not valid gzip data.")))
            return
        }
        if !saveAs, let associatedURL = resolveAssociation() {
            do {
                try write(data, to: associatedURL)
                completion(.success(savedResult(for: associatedURL)))
            } catch {
                completion(.failure(error))
            }
            return
        }
        do {
            let temporaryDirectory = FileManager.default.temporaryDirectory
                .appendingPathComponent("Labelmaker-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
            let temporaryURL = temporaryDirectory.appendingPathComponent(normalizeFileName(suggestedFileName))
            try data.write(to: temporaryURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            guard beginPicker(.exporting(temporaryURL: temporaryURL, completion: completion)) else { return }
            let picker = UIDocumentPickerViewController(forExporting: [temporaryURL], asCopy: true)
            picker.delegate = self
            present(picker)
        } catch {
            completion(.failure(error))
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending = takePendingPicker() else { return }
        guard let url = urls.first else {
            completeCanceled(pending)
            return
        }
        switch pending {
        case .opening(let completion):
            do {
                let data = try read(url)
                guard isGzip(data) else {
                    throw NativeBridgeFailure(code: "INVALID_GZIP", message: "Workspace file is not valid gzip data.")
                }
                let selectionID = UUID().uuidString
                pendingSelections[selectionID] = url
                completion(.success(SelectedWorkspace(
                    selectionID: selectionID,
                    fileName: url.lastPathComponent,
                    data: data
                )))
            } catch {
                completion(.failure(error))
            }
        case .exporting(let temporaryURL, let completion):
            defer { try? FileManager.default.removeItem(at: temporaryURL.deletingLastPathComponent()) }
            do {
                try storeAssociation(url)
                completion(.success(savedResult(for: url)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let pending = takePendingPicker() else { return }
        completeCanceled(pending)
    }

    private func beginPicker(_ picker: PendingPicker) -> Bool {
        guard pendingPicker == nil else {
            let error = NativeBridgeFailure(code: "PICKER_BUSY", message: "Another file picker is already open.")
            switch picker {
            case .opening(let completion): completion(.failure(error))
            case .exporting(_, let completion): completion(.failure(error))
            }
            return false
        }
        pendingPicker = picker
        return true
    }

    private func takePendingPicker() -> PendingPicker? {
        defer { pendingPicker = nil }
        return pendingPicker
    }

    private func completeCanceled(_ pending: PendingPicker) {
        switch pending {
        case .opening(let completion): completion(.success(nil))
        case .exporting(let temporaryURL, let completion):
            try? FileManager.default.removeItem(at: temporaryURL.deletingLastPathComponent())
            completion(.success(nil))
        }
    }

    private func present(_ picker: UIDocumentPickerViewController) {
        guard let presenter = activePresenter() else {
            documentPickerWasCancelled(picker)
            return
        }
        picker.modalPresentationStyle = .formSheet
        presenter.present(picker, animated: true)
    }

    private func activePresenter() -> UIViewController? {
        var current = presentingViewController
        while let presented = current?.presentedViewController { current = presented }
        return current
    }

    private func read(_ url: URL) throws -> Data {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        var coordinatedError: NSError?
        var result: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatedError) { coordinatedURL in
            do {
                let values = try coordinatedURL.resourceValues(forKeys: [.fileSizeKey])
                if let size = values.fileSize, size > maximumWorkspaceBytes {
                    throw NativeBridgeFailure(code: "DOCUMENT_TOO_LARGE", message: "Workspace files must be smaller than 25 MB.")
                }
                result = .success(try Data(contentsOf: coordinatedURL, options: .mappedIfSafe))
            } catch {
                result = .failure(error)
            }
        }
        if let coordinatedError { throw coordinatedError }
        guard let result else { throw CocoaError(.fileReadUnknown) }
        let data = try result.get()
        guard data.count <= maximumWorkspaceBytes else {
            throw NativeBridgeFailure(code: "DOCUMENT_TOO_LARGE", message: "Workspace files must be smaller than 25 MB.")
        }
        return data
    }

    private func write(_ data: Data, to url: URL) throws {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        var coordinatedError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinatedError) { coordinatedURL in
            do {
                try data.write(to: coordinatedURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            } catch {
                writeError = error
            }
        }
        if let coordinatedError { throw coordinatedError }
        if let writeError { throw writeError }
    }

    private func storeAssociation(_ url: URL) throws {
        let bookmark = try url.bookmarkData(
            options: .minimalBookmark,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        UserDefaults.standard.set(bookmark, forKey: associationBookmarkKey)
        UserDefaults.standard.set(url.lastPathComponent, forKey: associationFileNameKey)
    }

    private func resolveAssociation() -> URL? {
        guard let bookmark = UserDefaults.standard.data(forKey: associationBookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: bookmark,
            options: .withoutUI,
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else {
            clearAssociation()
            return nil
        }
        if stale { try? storeAssociation(url) }
        return url
    }

    private func savedResult(for url: URL) -> SavedWorkspace {
        SavedWorkspace(fileName: url.lastPathComponent, savedAt: ISO8601DateFormatter().string(from: Date()))
    }
}

private var workspaceType: UTType {
    UTType(filenameExtension: "lbl") ?? .data
}

private func normalizeFileName(_ value: String) -> String {
    let name = value.lowercased().hasSuffix(".lbl") ? value : "\(value).lbl"
    return name.isEmpty ? "Untitled workspace.lbl" : name
}

private func isGzip(_ data: Data) -> Bool {
    data.count >= 2 && data[data.startIndex] == 0x1f && data[data.startIndex + 1] == 0x8b
}
