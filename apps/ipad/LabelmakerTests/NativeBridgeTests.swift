import XCTest
@testable import Labelmaker

@MainActor
final class NativeBridgeTests: XCTestCase {
    func testHostInformationUsesTheVersionedReplyEnvelope() {
        let bridge = makeBridge()

        let reply = send(bridge, method: "getHostInfo", payload: [:])

        XCTAssertEqual(reply["version"] as? Int, 1)
        XCTAssertEqual(reply["id"] as? String, "test-request")
        XCTAssertEqual(reply["ok"] as? Bool, true)
        let result = reply["result"] as? [String: Any]
        XCTAssertEqual(result?["platform"] as? String, "ipados")
        XCTAssertEqual(result?["presentation"] as? String, "mobile-touch")
    }

    func testInvalidVersionAndExtraPayloadFieldsAreRejected() {
        let bridge = makeBridge()

        let wrongVersion = send(
            bridge,
            method: "getHostInfo",
            payload: [:],
            version: 2
        )
        XCTAssertEqual(wrongVersion["ok"] as? Bool, false)
        XCTAssertEqual(errorCode(wrongVersion), "INVALID_REQUEST")

        let extraField = send(
            bridge,
            method: "getHostInfo",
            payload: ["extra": true]
        )
        XCTAssertEqual(extraField["ok"] as? Bool, false)
        XCTAssertEqual(errorCode(extraField), "INVALID_REQUEST")

        let numericBoolean = send(
            bridge,
            method: "bluetoothDiscover",
            payload: ["timeoutMs": 5000, "includeUnpaired": 1]
        )
        XCTAssertEqual(numericBoolean["ok"] as? Bool, false)
        XCTAssertEqual(errorCode(numericBoolean), "INVALID_REQUEST")
    }

    func testBluetoothDiscoveryAndCancellationUseTheSharedContract() {
        let bluetooth = RecordingBluetoothTransport()
        let bridge = makeBridge(bluetooth: bluetooth)

        let discovery = send(
            bridge,
            method: "bluetoothDiscover",
            payload: ["timeoutMs": 5000, "includeUnpaired": true]
        )
        XCTAssertEqual(discovery["ok"] as? Bool, true)
        let devices = discovery["result"] as? [[String: Any]]
        XCTAssertEqual(devices?.first?["transport"] as? String, "bluetooth-low-energy")

        let cancellation = send(bridge, method: "bluetoothCancel", payload: [:])
        XCTAssertEqual(cancellation["ok"] as? Bool, true)
        XCTAssertEqual(bluetooth.cancelCount, 1)
    }

    private func makeBridge() -> NativeBridge {
        makeBridge(bluetooth: RecordingBluetoothTransport())
    }

    private func makeBridge(
        bluetooth: BluetoothTransportHandling
    ) -> NativeBridge {
        NativeBridge(
            workspace: WorkspaceCoordinator(),
            recovery: RecoveryStore(),
            bluetooth: bluetooth
        )
    }

    private func send(
        _ bridge: NativeBridge,
        method: String,
        payload: [String: Any],
        version: Int = 1
    ) -> [String: Any] {
        var reply: [String: Any]?
        bridge.handleRequest(
            [
                "version": version,
                "id": "test-request",
                "method": method,
                "payload": payload,
            ]
        ) { value, error in
            XCTAssertNil(error)
            reply = value as? [String: Any]
        }
        return reply ?? [:]
    }

    private func errorCode(_ reply: [String: Any]) -> String? {
        (reply["error"] as? [String: Any])?["code"] as? String
    }
}

@MainActor
private final class RecordingBluetoothTransport: BluetoothTransportHandling {
    var cancelCount = 0

    func discover(
        timeoutMilliseconds: Int,
        includeUnpaired: Bool,
        completion: @escaping (Result<[[String: Any]], Error>) -> Void
    ) {
        completion(.success([[
            "id": "ipad-ble-test",
            "name": "MakeID E1",
            "transport": "bluetooth-low-energy",
        ]]))
    }

    func connect(
        deviceID: String,
        protocolFamily: MakeIDBluetoothProtocolFamily,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        completion(.success(deviceID))
    }

    func write(
        connectionID: String,
        data: Data,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        completion(.success(()))
    }

    func read(
        connectionID: String,
        timeoutMilliseconds: Int,
        completion: @escaping (Result<Data, Error>) -> Void
    ) {
        completion(.success(Data()))
    }

    func close(
        connectionID: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        completion(.success(()))
    }

    func cancel(completion: @escaping (Result<Void, Error>) -> Void) {
        cancelCount += 1
        completion(.success(()))
    }
}
