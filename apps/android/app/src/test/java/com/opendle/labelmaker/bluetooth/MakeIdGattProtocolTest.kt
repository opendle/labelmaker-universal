package com.opendle.labelmaker.bluetooth

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MakeIdGattProtocolTest {
    @Test
    fun `selects ABF0 endpoints`() {
        val endpoints = MakeIdGattProtocol.endpoints("abf0-66")

        assertEquals("0000abf0-0000-1000-8000-00805f9b34fb", endpoints.service.toString())
        assertEquals("0000abf1-0000-1000-8000-00805f9b34fb", endpoints.write.toString())
        assertEquals("0000abf2-0000-1000-8000-00805f9b34fb", endpoints.reply.toString())
    }

    @Test
    fun `selects FF00 endpoints`() {
        val endpoints = MakeIdGattProtocol.endpoints("ff00-escpos")

        assertEquals("0000ff00-0000-1000-8000-00805f9b34fb", endpoints.service.toString())
        assertEquals("0000ff02-0000-1000-8000-00805f9b34fb", endpoints.write.toString())
        assertEquals("0000ff01-0000-1000-8000-00805f9b34fb", endpoints.reply.toString())
    }

    @Test
    fun `rejects an unknown protocol family`() {
        assertThrows(IllegalArgumentException::class.java) {
            MakeIdGattProtocol.endpoints("unknown")
        }
    }

    @Test
    fun `uses safe twenty byte chunks for the default MTU`() {
        val bytes = ByteArray(45) { it.toByte() }

        val chunks = MakeIdGattProtocol.chunks(bytes, 23)

        assertEquals(listOf(20, 20, 5), chunks.map { it.size })
        assertArrayEquals(bytes, chunks.flatMap { it.asList() }.toByteArray())
    }

    @Test
    fun `uses the negotiated MTU without changing bytes`() {
        val bytes = ByteArray(250) { (it and 0xff).toByte() }

        val chunks = MakeIdGattProtocol.chunks(bytes, 103)

        assertEquals(listOf(100, 100, 50), chunks.map { it.size })
        assertArrayEquals(bytes, chunks.flatMap { it.asList() }.toByteArray())
    }

    @Test
    fun `empty input produces no chunks`() {
        assertTrue(MakeIdGattProtocol.chunks(byteArrayOf(), 23).isEmpty())
    }

    @Test
    fun `an invalid small MTU keeps the safe default chunk size`() {
        val bytes = ByteArray(21) { it.toByte() }

        val chunks = MakeIdGattProtocol.chunks(bytes, 10)

        assertEquals(listOf(20, 1), chunks.map { it.size })
        assertArrayEquals(bytes, chunks.flatMap { it.asList() }.toByteArray())
    }

    @Test
    fun `an exact MTU boundary does not add an empty chunk`() {
        val bytes = ByteArray(40) { it.toByte() }

        val chunks = MakeIdGattProtocol.chunks(bytes, 23)

        assertEquals(listOf(20, 20), chunks.map { it.size })
        assertArrayEquals(bytes, chunks.flatMap { it.asList() }.toByteArray())
    }
}
