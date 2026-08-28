import Foundation
import UIKit

@MainActor
final class RecoveryStore {
    private let fileURL: URL
    private var pendingData: Data?
    private var writeTask: Task<Void, Never>?
    private var backgroundObserver: NSObjectProtocol?

    init(fileManager: FileManager = .default) {
        let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? fileManager.createDirectory(at: applicationSupport, withIntermediateDirectories: true)
        fileURL = applicationSupport.appendingPathComponent("workspace-recovery.json", isDirectory: false)
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.flush() }
        }
    }

    deinit {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
    }

    func load() -> Any? {
        guard
            let data = try? Data(contentsOf: fileURL, options: .mappedIfSafe),
            data.count <= 25 * 1024 * 1024,
            let value = try? JSONSerialization.jsonObject(with: data)
        else {
            return nil
        }
        return value
    }

    func store(_ value: Any) throws {
        guard JSONSerialization.isValidJSONObject(value) else {
            throw NativeBridgeFailure(code: "INVALID_RECOVERY", message: "The recovery state is invalid.")
        }
        let data = try JSONSerialization.data(withJSONObject: value)
        guard data.count <= 25 * 1024 * 1024 else {
            throw NativeBridgeFailure(code: "RECOVERY_TOO_LARGE", message: "The recovery state is too large.")
        }
        pendingData = data
        writeTask?.cancel()
        let destination = fileURL
        writeTask = Task.detached(priority: .utility) { [data] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            try? data.write(to: destination, options: [.atomic, .completeFileProtectionUnlessOpen])
        }
    }

    func flush() {
        writeTask?.cancel()
        writeTask = nil
        guard let pendingData else { return }
        try? pendingData.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        self.pendingData = nil
    }
}
