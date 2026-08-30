package com.opendle.labelmaker.bridge

import android.util.Base64
import com.opendle.labelmaker.storage.RecoveryStore
import com.opendle.labelmaker.storage.WorkspaceCoordinator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private const val BRIDGE_VERSION = 1
private const val DEFAULT_CONNECT_TIMEOUT_MS = 10_000
private const val DEFAULT_WRITE_TIMEOUT_MS = 30_000
private const val MAXIMUM_TIMEOUT_MS = 60_000

interface NativeUi {
    fun confirmWorkspaceReplacement(completion: (String) -> Unit)

    suspend fun ensureBluetoothPermissions(): Boolean
}

internal class NativeBridge(
    private val scope: CoroutineScope,
    private val ui: NativeUi,
    private val workspace: WorkspaceCoordinator,
    private val recovery: RecoveryStore,
    private val bluetooth: BluetoothTransport,
    private val chunks: MessageChunkAssembler = MessageChunkAssembler(),
) {
    private var eventSender: ((String) -> Unit)? = null
    private var nextEventId = 0
    private val pendingBackEvents = mutableMapOf<String, (Boolean) -> Unit>()

    fun receive(rawFrame: String, send: (String) -> Unit) {
        eventSender = send
        val assembled = try {
            chunks.accept(rawFrame)
        } catch (error: BridgeFailure) {
            sendReply(errorReply(recoverRequestId(rawFrame), error), send)
            return
        }
        if (assembled is AssemblyResult.Incomplete) return
        val request = try {
            JSONObject((assembled as AssemblyResult.Complete).message)
        } catch (error: Exception) {
            sendReply(errorReply("native-invalid", BridgeFailure("INVALID_REQUEST", "The native request is invalid.")), send)
            return
        }
        if (request.optString("type") == "event-result") {
            receiveEventResult(request)
            return
        }
        val requestId = try {
            request.requireBoundedId("id")
        } catch (error: BridgeFailure) {
            sendReply(errorReply("native-invalid", error), send)
            return
        }
        try {
            val version = if (request.has("version")) request.requireInteger("version") else BRIDGE_VERSION
            if (version != BRIDGE_VERSION) {
                throw BridgeFailure("UNSUPPORTED_BRIDGE_VERSION", "The native bridge version is not supported.")
            }
            val method = request.requireString("method")
            val payload = request.opt("payload")
            if (payload !is JSONObject) {
                throw BridgeFailure("INVALID_REQUEST", "The native bridge request payload is invalid.")
            }
            dispatch(requestId, method, payload, send)
        } catch (error: Throwable) {
            sendReply(errorReply(requestId, safeFailure(error)), send)
        }
    }

    fun clearPendingMessages() {
        chunks.clear()
        eventSender = null
        pendingBackEvents.values.forEach { it(false) }
        pendingBackEvents.clear()
    }

    fun clearIncompleteMessages() {
        chunks.clear()
    }

    fun requestSystemBack(completion: (Boolean) -> Unit) {
        val send = eventSender
        if (send == null) {
            completion(false)
            return
        }
        val id = "native-back-${++nextEventId}"
        pendingBackEvents.remove(id)?.invoke(false)
        pendingBackEvents[id] = completion
        val event = JSONObject()
            .put("version", BRIDGE_VERSION)
            .put("type", "event")
            .put("id", id)
            .put("event", "systemBack")
        MessageChunkFramer.frame(event.toString()).forEach(send)
        scope.launch {
            delay(1_000)
            pendingBackEvents.remove(id)?.invoke(false)
        }
    }

    fun notifyConnectionsClosed() {
        val send = eventSender ?: return
        val event = JSONObject()
            .put("version", BRIDGE_VERSION)
            .put("type", "event")
            .put("id", "native-connections-${++nextEventId}")
            .put("event", "nativeConnectionsClosed")
        MessageChunkFramer.frame(event.toString()).forEach(send)
    }

    private fun dispatch(requestId: String, method: String, payload: JSONObject, send: (String) -> Unit) {
        validatePayloadKeys(method, payload)
        when (method) {
            "getHostInfo" -> success(
                requestId,
                JSONObject()
                    .put("version", BRIDGE_VERSION)
                    .put("platform", "android")
                    .put("presentation", "mobile-touch")
                    .put("printerStorageKey", "labelmaker.android.printers.v1")
                    .put("jobIdPrefix", "android"),
                send,
            )

            "confirmWorkspaceReplacement" -> ui.confirmWorkspaceReplacement { choice ->
                success(requestId, choice, send)
            }

            "openWorkspaceFile" -> workspace.openWorkspace { result ->
                result.fold(
                    onSuccess = { success(requestId, it, send) },
                    onFailure = { failure(requestId, it, send) },
                )
            }

            "acceptOpenedWorkspaceFile" -> {
                workspace.acceptSelection(payload.requireBoundedString("selectionId", 300))
                success(requestId, JSONObject.NULL, send)
            }

            "saveWorkspaceFile" -> {
                val fileName = payload.requireBoundedString("fileName", 255)
                val base64 = payload.requireBoundedString("gzipBase64", MAX_MESSAGE_CHARACTERS)
                val saveAs = payload.requireBoolean("saveAs")
                val data = decodeBase64(base64, "The workspace data is invalid.")
                workspace.saveWorkspace(data, fileName, saveAs) { result ->
                    result.fold(
                        onSuccess = { success(requestId, it, send) },
                        onFailure = { failure(requestId, it, send) },
                    )
                }
            }

            "clearWorkspaceAssociation" -> {
                workspace.clearAssociation()
                success(requestId, JSONObject.NULL, send)
            }

            "loadWorkspaceRecovery" -> {
                val state = recovery.load()
                if (state is JSONObject) {
                    state.put("fileName", workspace.associatedFileName ?: JSONObject.NULL)
                }
                success(requestId, state ?: JSONObject.NULL, send)
            }

            "storeWorkspaceRecovery" -> {
                val state = payload.opt("state")
                if (state !is JSONObject) {
                    throw BridgeFailure("INVALID_RECOVERY", "The recovery state is invalid.")
                }
                recovery.store(state)
                success(requestId, JSONObject.NULL, send)
            }

            "bluetoothDiscover" -> launch(requestId, send) {
                requireBluetoothPermissions()
                val devices = bluetooth.discover(
                    timeoutMs = payload.requireInteger("timeoutMs", maximum = MAXIMUM_TIMEOUT_MS),
                    includeUnpaired = payload.requireBoolean("includeUnpaired"),
                )
                JSONArray().also { array ->
                    devices.forEach { device ->
                        array.put(
                            JSONObject()
                                .put("id", device.id)
                                .put("name", device.name ?: JSONObject.NULL)
                                .put("transport", device.transport),
                        )
                    }
                }
            }

            "bluetoothConnect" -> launch(requestId, send) {
                requireBluetoothPermissions()
                val protocolFamily = requireProtocolFamily(payload)
                val connectionId = bluetooth.connect(
                    deviceId = payload.requireBoundedString("deviceId", 300),
                    protocolFamily = protocolFamily,
                    timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
                )
                JSONObject().put("connectionId", connectionId)
            }

            "bluetoothWrite" -> launch(requestId, send) {
                bluetooth.write(
                    connectionId = payload.requireBoundedString("connectionId", 300),
                    bytes = decodeBase64(
                        payload.requireBoundedString("bytesBase64", MAX_MESSAGE_CHARACTERS),
                        "The Bluetooth data is invalid.",
                    ),
                    timeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
                )
                JSONObject.NULL
            }

            "bluetoothRead" -> launch(requestId, send) {
                val bytes = bluetooth.read(
                    connectionId = payload.requireBoundedString("connectionId", 300),
                    timeoutMs = payload.requireInteger("timeoutMs", maximum = MAXIMUM_TIMEOUT_MS),
                )
                JSONObject().put("bytesBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }

            "bluetoothClose" -> launch(requestId, send) {
                bluetooth.close(payload.requireBoundedString("connectionId", 300))
                JSONObject.NULL
            }

            "bluetoothPreserve" -> launch(requestId, send) {
                bluetooth.preserveDevice(payload.requireBoundedString("deviceId", 300))
                JSONObject.NULL
            }

            "bluetoothRelease" -> launch(requestId, send) {
                bluetooth.releaseDevice(payload.requireBoundedString("deviceId", 300))
                JSONObject.NULL
            }

            else -> throw BridgeFailure("UNKNOWN_METHOD", "The native method is not available.")
        }
    }

    private fun launch(requestId: String, send: (String) -> Unit, operation: suspend () -> Any) {
        scope.launch {
            try {
                success(requestId, operation(), send)
            } catch (error: Throwable) {
                failure(requestId, error, send)
            }
        }
    }

    private fun success(requestId: String, result: Any, send: (String) -> Unit) {
        val reply = JSONObject()
            .put("version", BRIDGE_VERSION)
            .put("id", requestId)
            .put("ok", true)
            .put("result", result)
        sendReply(reply, send)
    }

    private fun failure(requestId: String, error: Throwable, send: (String) -> Unit) {
        sendReply(errorReply(requestId, safeFailure(error)), send)
    }

    private fun errorReply(requestId: String, error: BridgeFailure): JSONObject =
        JSONObject()
            .put("version", BRIDGE_VERSION)
            .put("id", requestId)
            .put("ok", false)
            .put(
                "error",
                JSONObject()
                    .put("code", error.code)
                    .put("message", error.message),
            )

    private fun sendReply(reply: JSONObject, send: (String) -> Unit) {
        try {
            MessageChunkFramer.frame(reply.toString()).forEach(send)
        } catch (error: BridgeFailure) {
            send(errorReply(reply.optString("id", "native-invalid"), error).toString())
        }
    }

    private fun requireProtocolFamily(payload: JSONObject): String {
        val family = payload.requireString("protocolFamily")
        if (family != "abf0-66" && family != "ff00-escpos") {
            throw BridgeFailure("INVALID_REQUEST", "The Bluetooth protocol family is invalid.")
        }
        return family
    }

    private suspend fun requireBluetoothPermissions() {
        if (!ui.ensureBluetoothPermissions()) {
            throw BridgeFailure(
                "BLUETOOTH_PERMISSION_REQUIRED",
                "Allow Bluetooth access to find and use a printer.",
            )
        }
    }

    private fun validatePayloadKeys(method: String, payload: JSONObject) {
        val expected = when (method) {
            "getHostInfo",
            "confirmWorkspaceReplacement",
            "openWorkspaceFile",
            "clearWorkspaceAssociation",
            "loadWorkspaceRecovery"
            -> emptySet()
            "acceptOpenedWorkspaceFile" -> setOf("selectionId")
            "saveWorkspaceFile" -> setOf("fileName", "gzipBase64", "saveAs")
            "storeWorkspaceRecovery" -> setOf("state")
            "bluetoothDiscover" -> setOf("timeoutMs", "includeUnpaired")
            "bluetoothConnect" -> setOf("deviceId", "protocolFamily")
            "bluetoothWrite" -> setOf("connectionId", "bytesBase64")
            "bluetoothRead" -> setOf("connectionId", "timeoutMs")
            "bluetoothClose" -> setOf("connectionId")
            "bluetoothPreserve", "bluetoothRelease" -> setOf("deviceId")
            else -> throw BridgeFailure("UNKNOWN_METHOD", "The native method is not available.")
        }
        val actual = payload.keys().asSequence().toSet()
        if (actual != expected) {
            throw BridgeFailure("INVALID_REQUEST", "The native bridge request payload is invalid.")
        }
    }

    private fun decodeBase64(value: String, message: String): ByteArray {
        if (value.length > MAX_MESSAGE_CHARACTERS) {
            throw BridgeFailure("MESSAGE_TOO_LARGE", "The native bridge message is too large.")
        }
        return try {
            if (!isStrictBase64(value)) {
                throw IllegalArgumentException("Invalid base64")
            }
            Base64.decode(value, Base64.NO_WRAP)
        } catch (error: IllegalArgumentException) {
            throw BridgeFailure("INVALID_BASE64", message)
        }
    }

    private fun isStrictBase64(value: String): Boolean {
        if (value.length % 4 != 0) return false
        val firstPadding = value.indexOf('=')
        val dataEnd = if (firstPadding < 0) value.length else firstPadding
        if (value.length - dataEnd > 2) return false
        for (index in value.indices) {
            val character = value[index]
            if (index >= dataEnd) {
                if (character != '=') return false
            } else if (!(character in 'A'..'Z' || character in 'a'..'z' || character in '0'..'9' || character == '+' || character == '/')) {
                return false
            }
        }
        return true
    }

    private fun safeFailure(error: Throwable): BridgeFailure {
        if (error is BridgeFailure) return error
        return BridgeFailure("NATIVE_OPERATION_FAILED", "The operation failed on this device.")
    }

    private fun recoverRequestId(raw: String): String {
        val frame = runCatching { JSONObject(raw) }.getOrNull() ?: return "native-invalid"
        val direct = frame.optString("id").takeIf { it.isNotEmpty() }
        val chunk = frame.optString("messageId")
            .takeIf { it.startsWith("request-") }
            ?.removePrefix("request-")
        return (direct ?: chunk)
            ?.takeIf { it.length in 1..64 && it.matches(Regex("^[A-Za-z0-9._:-]+$")) }
            ?: "native-invalid"
    }

    private fun receiveEventResult(value: JSONObject) {
        val version = runCatching { value.requireInteger("version") }.getOrNull() ?: return
        if (version != BRIDGE_VERSION) return
        val id = runCatching { value.requireBoundedId("id") }.getOrNull() ?: return
        val handled = value.opt("handled") as? Boolean ?: return
        pendingBackEvents.remove(id)?.invoke(handled)
    }
}

private fun JSONObject.requireBoundedString(key: String, maximumLength: Int): String {
    val value = requireString(key)
    if (value.length > maximumLength) {
        throw BridgeFailure("INVALID_REQUEST", "The native bridge request has an invalid $key.")
    }
    return value
}
