package com.opendle.labelmaker.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.opendle.labelmaker.bridge.BluetoothTransport
import com.opendle.labelmaker.bridge.BluetoothTransportDevice
import com.opendle.labelmaker.bridge.BridgeFailure
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val MAX_UNREAD_BYTES = 1024 * 1024
private const val MAX_DEVICE_NAME_LENGTH = 128
private const val ID_PREFIX = "android-ble-"
private const val PREFERENCES_NAME = "makeid-bluetooth-devices-v1"
private const val ADDRESS_SUFFIX = ".address"
private const val NAME_SUFFIX = ".name"
private const val CLIENT_CHARACTERISTIC_CONFIGURATION =
    "00002902-0000-1000-8000-00805f9b34fb"

private data class NativeDeviceRecord(val address: String, val name: String?)

@SuppressLint("MissingPermission")
class MakeIdBluetoothTransport(context: Context) : BluetoothTransport {
    private val applicationContext = context.applicationContext
    private val manager = applicationContext.getSystemService(BluetoothManager::class.java)
    private val preferences = applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val transientDevices = ConcurrentHashMap<String, NativeDeviceRecord>()
    private val connections = ConcurrentHashMap<String, GattConnection>()
    private val generation = AtomicLong(0)

    override suspend fun discover(
        timeoutMs: Int,
        includeUnpaired: Boolean,
    ): List<BluetoothTransportDevice> {
        requireTimeout(timeoutMs)
        requirePermission(Manifest.permission.BLUETOOTH_SCAN)
        val adapter = manager?.adapter
            ?: throw BridgeFailure("BLUETOOTH_UNAVAILABLE", "Bluetooth is not available.")
        if (!adapter.isEnabled) throw BridgeFailure("BLUETOOTH_UNAVAILABLE", "Bluetooth is off.")
        val scanner = adapter.bluetoothLeScanner
            ?: throw BridgeFailure("BLUETOOTH_UNAVAILABLE", "Bluetooth scanning is not available.")
        val records = ConcurrentHashMap<String, BluetoothTransportDevice>()
        val failed = CompletableDeferred<Int>()
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                val address = device.address
                if (!includeUnpaired && device.bondState != BluetoothDevice.BOND_BONDED && savedIdForAddress(address) == null) {
                    return
                }
                val name = safeName(result.scanRecord?.deviceName ?: device.name)
                val id = savedIdForAddress(address) ?: transientIdFor(address, name)
                records[id] = BluetoothTransportDevice(id, name)
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
            }

            override fun onScanFailed(errorCode: Int) {
                failed.complete(errorCode)
            }
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .build()
        try {
            scanner.startScan(null, settings, callback)
            try {
                withTimeout(timeoutMs.toLong()) { failed.await() }
                throw BridgeFailure("BLUETOOTH_SCAN_FAILED", "Bluetooth discovery failed.")
            } catch (_: TimeoutCancellationException) {
                // A completed scan is represented by its requested time window.
            }
        } finally {
            runCatching { scanner.stopScan(callback) }
        }
        return records.values.sortedWith(compareBy({ it.name?.lowercase() ?: "" }, { it.id }))
    }

    override suspend fun connect(deviceId: String, protocolFamily: String, timeoutMs: Int): String {
        requireTimeout(timeoutMs)
        requirePermission(Manifest.permission.BLUETOOTH_CONNECT)
        val record = findDevice(deviceId)
            ?: throw BridgeFailure("BLUETOOTH_DEVICE_NOT_FOUND", "The saved MakeID printer is not available.")
        val endpoints = MakeIdGattProtocol.endpoints(protocolFamily)
        val adapter = manager?.adapter
            ?: throw BridgeFailure("BLUETOOTH_UNAVAILABLE", "Bluetooth is not available.")
        if (!adapter.isEnabled) throw BridgeFailure("BLUETOOTH_UNAVAILABLE", "Bluetooth is off.")
        val device = try {
            adapter.getRemoteDevice(record.address)
        } catch (_: IllegalArgumentException) {
            throw BridgeFailure("BLUETOOTH_DEVICE_NOT_FOUND", "The saved MakeID printer is invalid.")
        }
        val connectionId = "connection-${UUID.randomUUID()}"
        val connection = GattConnection(
            applicationContext,
            device,
            endpoints,
            generation.incrementAndGet(),
        )
        connections[connectionId] = connection
        try {
            connection.open(timeoutMs)
        } catch (error: Throwable) {
            connections.remove(connectionId, connection)
            connection.close()
            throw error
        }
        return connectionId
    }

    override suspend fun write(connectionId: String, bytes: ByteArray, timeoutMs: Int) {
        requireTimeout(timeoutMs)
        requirePermission(Manifest.permission.BLUETOOTH_CONNECT)
        connection(connectionId).write(bytes, timeoutMs)
    }

    override suspend fun read(connectionId: String, timeoutMs: Int): ByteArray {
        requireTimeout(timeoutMs)
        return connection(connectionId).read(timeoutMs)
    }

    override suspend fun close(connectionId: String) {
        connections.remove(connectionId)?.close()
    }

    override suspend fun preserveDevice(deviceId: String) {
        val record = transientDevices[deviceId] ?: savedDevice(deviceId)
            ?: throw BridgeFailure("BLUETOOTH_DEVICE_NOT_FOUND", "The MakeID printer identity is not available.")
        preferences.edit()
            .putString("$deviceId$ADDRESS_SUFFIX", record.address)
            .apply {
                if (record.name == null) remove("$deviceId$NAME_SUFFIX")
                else putString("$deviceId$NAME_SUFFIX", record.name)
            }
            .apply()
    }

    override suspend fun releaseDevice(deviceId: String) {
        transientDevices.remove(deviceId)
        preferences.edit()
            .remove("$deviceId$ADDRESS_SUFFIX")
            .remove("$deviceId$NAME_SUFFIX")
            .apply()
    }

    override fun closeAll() {
        val active = connections.entries.toList()
        connections.clear()
        active.forEach { (_, connection) -> connection.closeNow() }
    }

    private fun connection(id: String): GattConnection =
        connections[id]
            ?: throw BridgeFailure("INVALID_CONNECTION", "The MakeID Bluetooth connection is closed.")

    private fun transientIdFor(address: String, name: String?): String {
        transientDevices.entries.firstOrNull { it.value.address == address }?.let { return it.key }
        val id = "$ID_PREFIX${UUID.randomUUID()}"
        transientDevices[id] = NativeDeviceRecord(address, name)
        return id
    }

    private fun findDevice(deviceId: String): NativeDeviceRecord? {
        if (!isOpaqueDeviceId(deviceId)) return null
        return transientDevices[deviceId] ?: savedDevice(deviceId)
    }

    private fun savedDevice(deviceId: String): NativeDeviceRecord? {
        if (!isOpaqueDeviceId(deviceId)) return null
        val address = preferences.getString("$deviceId$ADDRESS_SUFFIX", null) ?: return null
        return NativeDeviceRecord(address, safeName(preferences.getString("$deviceId$NAME_SUFFIX", null)))
    }

    private fun savedIdForAddress(address: String): String? =
        preferences.all.entries.firstOrNull { (key, value) ->
            key.endsWith(ADDRESS_SUFFIX) && value == address
        }?.key?.removeSuffix(ADDRESS_SUFFIX)

    private fun requirePermission(permission: String) {
        if (applicationContext.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            throw BridgeFailure("BLUETOOTH_PERMISSION_REQUIRED", "Bluetooth permission is required.")
        }
    }
}

private enum class ConnectionState {
    IDLE,
    CONNECTING,
    DISCOVERING_SERVICES,
    ENABLING_NOTIFICATIONS,
    READY,
    CLOSING,
}

@SuppressLint("MissingPermission")
@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
private class GattConnection(
    private val context: Context,
    private val device: BluetoothDevice,
    private val endpoints: MakeIdGattEndpoints,
    private val generation: Long,
) {
    private val activeGeneration = AtomicLong(generation)
    private val stateLock = Any()
    private val writeMutex = Mutex()
    private val closeMutex = Mutex()
    private val setupScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val incoming = Channel<ByteArray>(Channel.UNLIMITED)
    private val unreadBytes = AtomicInteger(0)
    private var state = ConnectionState.IDLE
    @Volatile
    private var gatt: BluetoothGatt? = null
    @Volatile
    private var writeCharacteristic: BluetoothGattCharacteristic? = null
    @Volatile
    private var mtu = 23
    private var ready = CompletableDeferred<Unit>()
    private var pendingWrite: CompletableDeferred<Unit>? = null
    private var serviceDiscoveryStarted = false

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (!accept(gatt)) return
            if (status != BluetoothGatt.GATT_SUCCESS || newState != BluetoothProfile.STATE_CONNECTED) {
                fail(BridgeFailure("BLUETOOTH_DISCONNECTED", "The MakeID Bluetooth connection closed."))
                return
            }
            synchronized(stateLock) {
                state = ConnectionState.DISCOVERING_SERVICES
            }
            if (!gatt.requestMtu(517)) {
                discoverServicesOnce(gatt)
            } else {
                setupScope.launch {
                    delay(1_500)
                    if (accept(gatt)) discoverServicesOnce(gatt)
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            if (!accept(gatt)) return
            if (status == BluetoothGatt.GATT_SUCCESS && mtu >= 23) this@GattConnection.mtu = mtu
            discoverServicesOnce(gatt)
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (!accept(gatt)) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail(BridgeFailure("BLUETOOTH_SETUP_FAILED", "The MakeID Bluetooth services are not available."))
                return
            }
            val service = gatt.getService(endpoints.service)
            val write = service?.getCharacteristic(endpoints.write)
            val reply = service?.getCharacteristic(endpoints.reply)
            if (write == null || reply == null) {
                fail(BridgeFailure("BLUETOOTH_SETUP_FAILED", "The MakeID Bluetooth protocol is not available."))
                return
            }
            writeCharacteristic = write
            synchronized(stateLock) { state = ConnectionState.ENABLING_NOTIFICATIONS }
            if (!gatt.setCharacteristicNotification(reply, true)) {
                fail(BridgeFailure("BLUETOOTH_SETUP_FAILED", "The MakeID Bluetooth reply channel is not available."))
                return
            }
            val descriptor = reply.getDescriptor(UUID.fromString(CLIENT_CHARACTERISTIC_CONFIGURATION))
            if (descriptor == null || !writeDescriptor(gatt, descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                fail(BridgeFailure("BLUETOOTH_SETUP_FAILED", "The MakeID Bluetooth reply channel is not available."))
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (!accept(gatt) || descriptor.uuid.toString() != CLIENT_CHARACTERISTIC_CONFIGURATION) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail(BridgeFailure("BLUETOOTH_SETUP_FAILED", "The MakeID Bluetooth reply channel is not available."))
                return
            }
            synchronized(stateLock) { state = ConnectionState.READY }
            ready.complete(Unit)
        }

        @Deprecated("Used on Android 12")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (accept(gatt)) receive(characteristic.value?.clone() ?: return)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            if (accept(gatt)) receive(value.clone())
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (!accept(gatt)) return
            val pending = synchronized(stateLock) {
                pendingWrite.also { pendingWrite = null }
            } ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) pending.complete(Unit)
            else {
                val error = BridgeFailure("BLUETOOTH_WRITE_FAILED", "The MakeID Bluetooth write failed.")
                pending.completeExceptionally(error)
                fail(error)
            }
        }
    }

    suspend fun open(timeoutMs: Int) {
        synchronized(stateLock) { state = ConnectionState.CONNECTING }
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
            ?: throw BridgeFailure("BLUETOOTH_CONNECT_FAILED", "The MakeID Bluetooth connection could not start.")
        try {
            withTimeout(timeoutMs.toLong()) { ready.await() }
        } catch (_: TimeoutCancellationException) {
            throw BridgeFailure("BLUETOOTH_CONNECT_FAILED", "The MakeID Bluetooth connection timed out.")
        }
    }

    suspend fun write(bytes: ByteArray, timeoutMs: Int) = writeMutex.withLock {
        requireReady()
        val characteristic = writeCharacteristic
            ?: throw BridgeFailure("BLUETOOTH_DISCONNECTED", "The MakeID Bluetooth connection is not ready.")
        val supportsWriteWithoutResponse =
            characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0
        val supportsWriteWithResponse =
            characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0
        val writeType = if (
            supportsWriteWithoutResponse
        ) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else if (supportsWriteWithResponse) {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        } else {
            throw BridgeFailure("BLUETOOTH_WRITE_FAILED", "The MakeID Bluetooth write channel is not available.")
        }
        for (chunk in MakeIdGattProtocol.chunks(bytes, mtu)) {
            val pending = CompletableDeferred<Unit>()
            synchronized(stateLock) { pendingWrite = pending }
            val currentGatt = gatt ?: closed()
            var started = writeCharacteristic(currentGatt, characteristic, chunk, writeType)
            if (
                !started &&
                writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE &&
                supportsWriteWithResponse
            ) {
                started = writeCharacteristic(
                    currentGatt,
                    characteristic,
                    chunk,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
                )
            }
            if (!started) {
                synchronized(stateLock) { if (pendingWrite === pending) pendingWrite = null }
                throw BridgeFailure("BLUETOOTH_WRITE_FAILED", "The MakeID Bluetooth write could not start.")
            }
            try {
                withTimeout(timeoutMs.toLong()) { pending.await() }
            } catch (_: TimeoutCancellationException) {
                val error = BridgeFailure("BLUETOOTH_WRITE_FAILED", "The MakeID Bluetooth write timed out.")
                fail(error)
                throw error
            }
        }
    }

    suspend fun read(timeoutMs: Int): ByteArray {
        requireReady()
        return try {
            val value = withTimeout(timeoutMs.toLong()) { incoming.receive() }
            unreadBytes.addAndGet(-value.size)
            value
        } catch (_: TimeoutCancellationException) {
            val error = BridgeFailure("BLUETOOTH_READ_TIMEOUT", "The MakeID Bluetooth read timed out.")
            fail(error)
            throw error
        }
    }

    suspend fun close() = closeMutex.withLock {
        closeNow()
    }

    fun closeNow() {
        if (!activeGeneration.compareAndSet(generation, 0)) return
        synchronized(stateLock) {
            state = ConnectionState.CLOSING
            pendingWrite?.completeExceptionally(BridgeFailure("BLUETOOTH_DISCONNECTED", "The MakeID Bluetooth connection is closed."))
            pendingWrite = null
            ready.completeExceptionally(BridgeFailure("BLUETOOTH_DISCONNECTED", "The MakeID Bluetooth connection is closed."))
        }
        incoming.close(BridgeFailure("BLUETOOTH_DISCONNECTED", "The MakeID Bluetooth connection is closed."))
        val currentGatt = gatt
        gatt = null
        if (currentGatt != null) {
            runCatching { currentGatt.disconnect() }
            currentGatt.close()
        }
        synchronized(stateLock) { state = ConnectionState.IDLE }
    }

    private fun discoverServicesOnce(gatt: BluetoothGatt) {
        val shouldStart = synchronized(stateLock) {
            if (serviceDiscoveryStarted) false
            else {
                serviceDiscoveryStarted = true
                true
            }
        }
        if (!shouldStart) return
        if (!gatt.discoverServices()) {
            fail(BridgeFailure("BLUETOOTH_SETUP_FAILED", "The MakeID Bluetooth service search could not start."))
        }
    }

    private fun receive(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        val total = unreadBytes.addAndGet(bytes.size)
        if (total > MAX_UNREAD_BYTES) {
            unreadBytes.addAndGet(-bytes.size)
            fail(BridgeFailure("BLUETOOTH_REPLY_TOO_LARGE", "The MakeID Bluetooth reply is too large."))
            return
        }
        if (incoming.trySend(bytes).isFailure) unreadBytes.addAndGet(-bytes.size)
    }

    private fun fail(error: Throwable) {
        if (!activeGeneration.compareAndSet(generation, 0)) return
        synchronized(stateLock) {
            pendingWrite?.completeExceptionally(error)
            pendingWrite = null
            ready.completeExceptionally(error)
        }
        incoming.close(error)
        val currentGatt = gatt
        gatt = null
        if (currentGatt != null) {
            runCatching { currentGatt.disconnect() }
            currentGatt.close()
        }
    }

    private fun accept(callbackGatt: BluetoothGatt): Boolean =
        activeGeneration.get() == generation && callbackGatt === gatt

    private fun requireReady() {
        if (
            activeGeneration.get() != generation ||
            synchronized(stateLock) { state } != ConnectionState.READY
        ) {
            closed()
        }
    }

    private fun closed(): Nothing =
        throw BridgeFailure("BLUETOOTH_DISCONNECTED", "The MakeID Bluetooth connection is closed.")
}

@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
private fun writeDescriptor(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, value: ByteArray): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS
    } else {
        descriptor.value = value
        gatt.writeDescriptor(descriptor)
    }

@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
private fun writeCharacteristic(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
    value: ByteArray,
    writeType: Int,
): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    gatt.writeCharacteristic(characteristic, value, writeType) == BluetoothStatusCodes.SUCCESS
} else {
    characteristic.writeType = writeType
    characteristic.value = value
    gatt.writeCharacteristic(characteristic)
}

private fun requireTimeout(timeoutMs: Int) {
    require(timeoutMs in 1..120_000) { "Bluetooth timeout must be from 1 to 120000 ms" }
}

private fun isOpaqueDeviceId(value: String): Boolean =
    value.startsWith(ID_PREFIX) && runCatching { UUID.fromString(value.removePrefix(ID_PREFIX)) }.isSuccess

private fun safeName(value: String?): String? = value
    ?.filterNot { it.isISOControl() }
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?.take(MAX_DEVICE_NAME_LENGTH)
