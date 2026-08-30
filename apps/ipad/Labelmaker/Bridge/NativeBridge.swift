import Foundation
import WebKit

struct NativeBridgeFailure: LocalizedError {
    let code: String
    let message: String

    var errorDescription: String? { message }
}

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let workspace: WorkspaceCoordinator
    private let recovery: RecoveryStore
    private let bluetooth: BluetoothTransportHandling

    init(
        workspace: WorkspaceCoordinator,
        recovery: RecoveryStore,
        bluetooth: BluetoothTransportHandling
    ) {
        self.workspace = workspace
        self.recovery = recovery
        self.bluetooth = bluetooth
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler originalReplyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let request = message.body as? [String: Any] else {
            originalReplyHandler([
                "version": 1,
                "id": "invalid-request",
                "ok": false,
                "error": [
                    "code": "INVALID_REQUEST",
                    "message": "The native request is invalid.",
                ],
            ], nil)
            return
        }
        let failureRequestID = (request["id"] as? String).flatMap {
            validBridgeIdentifier($0) ? $0 : nil
        } ?? "invalid-request"
        guard
            let version = request["version"] as? NSNumber,
            CFGetTypeID(version) != CFBooleanGetTypeID(),
            version.intValue == 1,
            version.doubleValue == 1,
            let requestID = request["id"] as? String,
            validBridgeIdentifier(requestID),
            let method = request["method"] as? String,
            validBridgeIdentifier(method),
            let payload = request["payload"] as? [String: Any]
        else {
            originalReplyHandler([
                "version": 1,
                "id": failureRequestID,
                "ok": false,
                "error": [
                    "code": "INVALID_REQUEST",
                    "message": "The native request is invalid.",
                ],
            ], nil)
            return
        }
        let replyHandler: (Any?, String?) -> Void = { value, error in
            guard var reply = value as? [String: Any] else {
                originalReplyHandler(value, error)
                return
            }
            reply["version"] = 1
            reply["id"] = requestID
            originalReplyHandler(reply, error)
        }
        let payloadKeys: [String: Set<String>] = [
            "getHostInfo": [],
            "confirmWorkspaceReplacement": [],
            "openWorkspaceFile": [],
            "acceptOpenedWorkspaceFile": ["selectionId"],
            "saveWorkspaceFile": ["fileName", "gzipBase64", "saveAs"],
            "clearWorkspaceAssociation": [],
            "loadWorkspaceRecovery": [],
            "storeWorkspaceRecovery": ["state"],
            "bluetoothDiscover": ["timeoutMs", "includeUnpaired"],
            "bluetoothConnect": ["deviceId", "protocolFamily"],
            "bluetoothWrite": ["connectionId", "bytesBase64"],
            "bluetoothRead": ["connectionId", "timeoutMs"],
            "bluetoothClose": ["connectionId"],
            "bluetoothPreserve": ["deviceId"],
            "bluetoothRelease": ["deviceId"],
        ]
        if let expectedKeys = payloadKeys[method], Set(payload.keys) != expectedKeys {
            replyFailure(
                NativeBridgeFailure(code: "INVALID_REQUEST", message: "The native request has invalid fields."),
                to: replyHandler
            )
            return
        }

        switch method {
        case "getHostInfo":
            replySuccess([
                "version": 1,
                "platform": "ipados",
                "presentation": "mobile-touch",
                "printerStorageKey": "labelmaker.ipados.printers.v1",
                "jobIdPrefix": "ipados",
            ], to: replyHandler)
        case "confirmWorkspaceReplacement":
            workspace.confirmWorkspaceReplacement { result in
                self.reply(result, to: replyHandler)
            }
        case "openWorkspaceFile":
            workspace.openWorkspace { result in
                self.reply(result.map { selection -> Any in
                    guard let selection else { return ["status": "canceled"] }
                    return [
                        "status": "selected",
                        "selectionId": selection.selectionID,
                        "fileName": selection.fileName,
                        "gzipBase64": selection.data.base64EncodedString(),
                    ]
                }, to: replyHandler)
            }
        case "acceptOpenedWorkspaceFile":
            perform(to: replyHandler) {
                let selectionID = try requiredString(payload, "selectionId")
                try workspace.acceptSelection(selectionID)
                return NSNull()
            }
        case "saveWorkspaceFile":
            do {
                let fileName = try requiredString(payload, "fileName", maximumLength: 255)
                let base64 = try requiredString(payload, "gzipBase64", maximumLength: 40 * 1_024 * 1_024)
                let saveAs = try requiredBool(payload, "saveAs")
                guard let data = Data(base64Encoded: base64) else {
                    throw NativeBridgeFailure(code: "INVALID_BASE64", message: "The workspace data is invalid.")
                }
                workspace.saveWorkspace(data: data, suggestedFileName: fileName, saveAs: saveAs) { result in
                    self.reply(result.map { saved -> Any in
                        guard let saved else { return ["status": "canceled"] }
                        return [
                            "status": "saved",
                            "fileName": saved.fileName,
                            "savedAt": saved.savedAt,
                        ]
                    }, to: replyHandler)
                }
            } catch {
                replyFailure(error, to: replyHandler)
            }
        case "clearWorkspaceAssociation":
            workspace.clearAssociation()
            replySuccess(NSNull(), to: replyHandler)
        case "loadWorkspaceRecovery":
            guard var value = recovery.load() as? [String: Any] else {
                replySuccess(NSNull(), to: replyHandler)
                return
            }
            value["fileName"] = workspace.associatedFileName ?? NSNull()
            replySuccess(value, to: replyHandler)
        case "storeWorkspaceRecovery":
            perform(to: replyHandler) {
                guard let state = payload["state"] else {
                    throw NativeBridgeFailure(code: "INVALID_RECOVERY", message: "The recovery state is missing.")
                }
                try recovery.store(state)
                return NSNull()
            }
        case "bluetoothDiscover":
            do {
                let timeout = try requiredPositiveInteger(payload, "timeoutMs")
                let includeUnpaired = try requiredBool(payload, "includeUnpaired")
                bluetooth.discover(
                    timeoutMilliseconds: timeout,
                    includeUnpaired: includeUnpaired
                ) { result in
                    self.reply(result.map { $0 as Any }, to: replyHandler)
                }
            } catch { replyFailure(error, to: replyHandler) }
        case "bluetoothConnect":
            do {
                let deviceID = try requiredString(payload, "deviceId")
                let protocolFamily = try requiredMakeIDProtocolFamily(payload, "protocolFamily")
                bluetooth.connect(
                    deviceID: deviceID,
                    protocolFamily: protocolFamily
                ) { result in
                    self.reply(result.map { ["connectionId": $0] as Any }, to: replyHandler)
                }
            } catch { replyFailure(error, to: replyHandler) }
        case "bluetoothWrite":
            do {
                let connectionID = try requiredString(payload, "connectionId")
                let base64 = try requiredString(payload, "bytesBase64", maximumLength: 40 * 1_024 * 1_024)
                guard let data = Data(base64Encoded: base64) else {
                    throw NativeBridgeFailure(code: "INVALID_BASE64", message: "The Bluetooth data is invalid.")
                }
                bluetooth.write(connectionID: connectionID, data: data) { result in
                    self.reply(result.map { NSNull() as Any }, to: replyHandler)
                }
            } catch { replyFailure(error, to: replyHandler) }
        case "bluetoothRead":
            do {
                let connectionID = try requiredString(payload, "connectionId")
                let timeout = try requiredPositiveInteger(payload, "timeoutMs")
                bluetooth.read(connectionID: connectionID, timeoutMilliseconds: timeout) { result in
                    self.reply(result.map { ["bytesBase64": $0.base64EncodedString()] as Any }, to: replyHandler)
                }
            } catch { replyFailure(error, to: replyHandler) }
        case "bluetoothClose":
            do {
                let connectionID = try requiredString(payload, "connectionId")
                bluetooth.close(connectionID: connectionID) { result in
                    self.reply(result.map { NSNull() as Any }, to: replyHandler)
                }
            } catch { replyFailure(error, to: replyHandler) }
        case "bluetoothPreserve", "bluetoothRelease":
            do {
                _ = try requiredString(payload, "deviceId")
                replySuccess(NSNull(), to: replyHandler)
            } catch { replyFailure(error, to: replyHandler) }
        default:
            replyFailure(
                NativeBridgeFailure(code: "UNKNOWN_METHOD", message: "The native method is not available."),
                to: replyHandler
            )
        }
    }

    private func perform(to replyHandler: @escaping (Any?, String?) -> Void, operation: () throws -> Any) {
        do { replySuccess(try operation(), to: replyHandler) }
        catch { replyFailure(error, to: replyHandler) }
    }

    private func reply<T>(_ result: Result<T, Error>, to replyHandler: @escaping (Any?, String?) -> Void) {
        switch result {
        case .success(let value): replySuccess(value, to: replyHandler)
        case .failure(let error): replyFailure(error, to: replyHandler)
        }
    }

    private func replySuccess(_ result: Any, to replyHandler: @escaping (Any?, String?) -> Void) {
        replyHandler(["ok": true, "result": result], nil)
    }

    private func replyFailure(_ error: Error, to replyHandler: @escaping (Any?, String?) -> Void) {
        let failure = error as? NativeBridgeFailure
        let code: String
        if let bluetoothError = error as? MakeIDBluetoothError {
            code = bluetoothError.code == .readTimeout
                ? "BLUETOOTH_READ_TIMEOUT"
                : bluetoothError.code.rawValue.uppercased().replacingOccurrences(of: "-", with: "_")
        } else if error is BluetoothTransportError {
            code = "BLUETOOTH_UNAVAILABLE"
        } else if (error as NSError).code == NSUserCancelledError {
            code = "CANCELED"
        } else {
            code = failure?.code ?? "NATIVE_OPERATION_FAILED"
        }
        replyHandler([
            "ok": false,
            "error": [
                "code": code,
                "message": failure?.message ?? error.localizedDescription,
            ],
        ], nil)
    }
}

private func requiredString(
    _ payload: [String: Any],
    _ key: String,
    maximumLength: Int = 300
) throws -> String {
    guard
        let value = payload[key] as? String,
        !value.isEmpty,
        value.count <= maximumLength
    else {
        throw NativeBridgeFailure(code: "INVALID_REQUEST", message: "The native request is missing \(key).")
    }
    return value
}

private func validBridgeIdentifier(_ value: String) -> Bool {
    guard !value.isEmpty, value.count <= 64 else { return false }
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-")
    return value.unicodeScalars.allSatisfy { allowed.contains($0) }
}

private func requiredBool(_ payload: [String: Any], _ key: String) throws -> Bool {
    guard let value = payload[key] as? Bool else {
        throw NativeBridgeFailure(code: "INVALID_REQUEST", message: "The native request is missing \(key).")
    }
    return value
}

private func requiredPositiveInteger(_ payload: [String: Any], _ key: String) throws -> Int {
    guard let number = payload[key] as? NSNumber else {
        throw NativeBridgeFailure(code: "INVALID_REQUEST", message: "The native request is missing \(key).")
    }
    guard CFGetTypeID(number) != CFBooleanGetTypeID() else {
        throw NativeBridgeFailure(code: "INVALID_REQUEST", message: "The native request has an invalid \(key).")
    }
    let value = number.intValue
    guard value > 0, value <= 60_000, Double(value) == number.doubleValue else {
        throw NativeBridgeFailure(code: "INVALID_REQUEST", message: "The native request has an invalid \(key).")
    }
    return value
}

private func requiredMakeIDProtocolFamily(
    _ payload: [String: Any],
    _ key: String
) throws -> MakeIDBluetoothProtocolFamily {
    let value = try requiredString(payload, key)
    guard let family = MakeIDBluetoothProtocolFamily(rawValue: value) else {
        throw NativeBridgeFailure(
            code: "INVALID_REQUEST",
            message: "The native request has an invalid \(key)."
        )
    }
    return family
}
