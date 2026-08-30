package com.opendle.labelmaker.bridge

data class BluetoothTransportDevice(
    val id: String,
    val name: String?,
    val transport: String = "bluetooth-low-energy",
)

interface BluetoothTransport {
    suspend fun discover(timeoutMs: Int, includeUnpaired: Boolean): List<BluetoothTransportDevice>

    suspend fun connect(deviceId: String, protocolFamily: String, timeoutMs: Int): String

    suspend fun write(connectionId: String, bytes: ByteArray, timeoutMs: Int)

    suspend fun read(connectionId: String, timeoutMs: Int): ByteArray

    suspend fun close(connectionId: String)

    suspend fun preserveDevice(deviceId: String)

    suspend fun releaseDevice(deviceId: String)

    fun closeAll()
}

class UnavailableBluetoothTransport : BluetoothTransport {
    private fun unavailable(): Nothing =
        throw BridgeFailure(
            code = "BLUETOOTH_UNAVAILABLE",
            message = "Bluetooth printer support is not available on this device.",
        )

    override suspend fun discover(timeoutMs: Int, includeUnpaired: Boolean): List<BluetoothTransportDevice> =
        unavailable()

    override suspend fun connect(deviceId: String, protocolFamily: String, timeoutMs: Int): String =
        unavailable()

    override suspend fun write(connectionId: String, bytes: ByteArray, timeoutMs: Int): Unit = unavailable()

    override suspend fun read(connectionId: String, timeoutMs: Int): ByteArray = unavailable()

    override suspend fun close(connectionId: String) = Unit

    override suspend fun preserveDevice(deviceId: String): Unit = unavailable()

    override suspend fun releaseDevice(deviceId: String) = Unit

    override fun closeAll() = Unit
}
