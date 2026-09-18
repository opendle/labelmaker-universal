import UIKit
import XCTest
@testable import Labelmaker

@MainActor
final class WorkspaceCoordinatorTests: XCTestCase {
    func testExportNamesStayInsideTheTemporaryDirectory() {
        for name in ["../outside.lbl", "/outside.lbl", "../../outside.lbl"] {
            XCTAssertEqual(normalizeFileName(name), "outside.lbl")
        }
        XCTAssertEqual(normalizeFileName(""), "Untitled workspace.lbl")
        XCTAssertEqual(normalizeFileName(".."), "Untitled workspace.lbl")
        XCTAssertEqual(normalizeFileName("Label.LBL"), "Label.LBL")
        XCTAssertEqual(normalizeFileName("Label"), "Label.lbl")
    }

    func testBusyPickerRemovesTheNewExportDirectory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = WorkspaceCoordinator(temporaryDirectory: directory)
        let presenter = RecordingPresenter()
        coordinator.setPresentingViewController(presenter)
        coordinator.openWorkspace { _ in }
        var failure: Error?

        coordinator.saveWorkspace(data: Data([0x1f, 0x8b]), suggestedFileName: "Label", saveAs: true) { result in
            if case .failure(let error) = result { failure = error }
        }

        XCTAssertEqual((failure as? NativeBridgeFailure)?.code, "PICKER_BUSY")
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
    }

    func testFailedExportWriteRemovesItsDirectory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = WorkspaceCoordinator(temporaryDirectory: directory)
        var failure: Error?

        coordinator.saveWorkspace(
            data: Data([0x1f, 0x8b]),
            suggestedFileName: String(repeating: "x", count: 300),
            saveAs: true
        ) { result in
            if case .failure(let error) = result { failure = error }
        }

        XCTAssertNotNil(failure)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
    }
}

@MainActor
private final class RecordingPresenter: UIViewController {
    override func present(_ viewControllerToPresent: UIViewController, animated: Bool, completion: (() -> Void)? = nil) {
        completion?()
    }
}
