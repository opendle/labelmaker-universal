import XCTest
@testable import Labelmaker

@MainActor
final class RecoveryStoreTests: XCTestCase {
    func testFlushWaitsForAnOlderWriteAndKeepsTheLatestState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = DispatchQueue(label: "recovery-test")
        let store = RecoveryStore(directoryURL: directory, writeQueue: queue)
        let destination = directory.appendingPathComponent("workspace-recovery.json")
        let oldData = try JSONSerialization.data(withJSONObject: ["revision": 1])
        let started = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        queue.async {
            started.signal()
            release.wait()
            try? oldData.write(to: destination, options: .atomic)
        }
        started.wait()
        try store.store(["revision": 2])
        try store.store(["revision": 3])
        DispatchQueue.global().async { release.signal() }

        store.flush()

        XCTAssertEqual((store.load() as? [String: Int])?["revision"], 3)
        store.flush()
        XCTAssertEqual((store.load() as? [String: Int])?["revision"], 3)
    }

    func testInvalidStateDoesNotReplaceRecovery() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = RecoveryStore(directoryURL: directory)
        try store.store(["revision": 1])
        XCTAssertThrowsError(try store.store(["revision": Double.nan]))
        store.flush()
        XCTAssertEqual((store.load() as? [String: Int])?["revision"], 1)
    }
}
