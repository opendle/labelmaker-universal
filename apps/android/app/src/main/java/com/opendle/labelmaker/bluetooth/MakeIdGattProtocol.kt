package com.opendle.labelmaker.bluetooth

import java.util.UUID

internal data class MakeIdGattEndpoints(
    val service: UUID,
    val write: UUID,
    val reply: UUID,
)

internal object MakeIdGattProtocol {
    private const val BLUETOOTH_BASE = "-0000-1000-8000-00805f9b34fb"

    fun endpoints(protocolFamily: String): MakeIdGattEndpoints =
        when (protocolFamily) {
            "abf0-66" -> MakeIdGattEndpoints(uuid16("abf0"), uuid16("abf1"), uuid16("abf2"))
            "ff00-escpos" -> MakeIdGattEndpoints(uuid16("ff00"), uuid16("ff02"), uuid16("ff01"))
            else -> throw IllegalArgumentException("The MakeID protocol family is invalid")
        }

    fun chunks(bytes: ByteArray, negotiatedMtu: Int): List<ByteArray> {
        if (bytes.isEmpty()) return emptyList()
        val chunkSize = (negotiatedMtu - 3).coerceAtLeast(20)
        val chunks = ArrayList<ByteArray>((bytes.size + chunkSize - 1) / chunkSize)
        var offset = 0
        while (offset < bytes.size) {
            val end = (offset + chunkSize).coerceAtMost(bytes.size)
            chunks.add(bytes.copyOfRange(offset, end))
            offset = end
        }
        return chunks
    }

    private fun uuid16(value: String): UUID = UUID.fromString("0000$value$BLUETOOTH_BASE")
}
