import XCTest
import WebKit
@testable import Labelmaker

@MainActor
final class NativeBridgeTests: XCTestCase {
    func testWebViewAllowsTheAppFrameAndRejectsAnEmbeddedFrame() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BridgeTestPage(), forURLScheme: "labelmaker")
        configuration.userContentController.addScriptMessageHandler(makeBridge(), contentWorld: .page, name: "labelmaker")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let loaded = expectation(description: "The app page loaded")
        let navigation = BridgeTestNavigation(loaded: loaded)
        webView.navigationDelegate = navigation
        webView.load(URLRequest(url: URL(string: "labelmaker://app/index.html")!))
        await fulfillment(of: [loaded], timeout: 10)

        let reply = try await webView.callAsyncJavaScript(
            "return await window.webkit.messageHandlers.labelmaker.postMessage({version:1,id:'main',method:'getHostInfo',payload:{}})",
            arguments: [:], in: nil, contentWorld: .page
        ) as? [String: Any]
        XCTAssertEqual(reply?["ok"] as? Bool, true)

        let rejected = try await webView.callAsyncJavaScript(
            """
            return await new Promise(resolve => {
                window.addEventListener('message', event => resolve(event.data), {once:true});
                const frame = document.createElement('iframe');
                frame.srcdoc = '<script>window.webkit.messageHandlers.labelmaker.postMessage({version:1,id:"child",method:"getHostInfo",payload:{}}).then(() => parent.postMessage(false,"*"), () => parent.postMessage(true,"*"))<\\/script>';
                document.body.append(frame);
            });
            """,
            arguments: [:], in: nil, contentWorld: .page
        ) as? Bool
        XCTAssertEqual(rejected, true)
    }

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
private final class BridgeTestPage: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let data = Data("<!doctype html><html><body>Bridge test</body></html>".utf8)
        urlSchemeTask.didReceive(URLResponse(url: urlSchemeTask.request.url!, mimeType: "text/html", expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

@MainActor
private final class BridgeTestNavigation: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation

    init(loaded: XCTestExpectation) { self.loaded = loaded }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded.fulfill()
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
