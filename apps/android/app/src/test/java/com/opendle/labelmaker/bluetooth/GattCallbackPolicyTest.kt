package com.opendle.labelmaker.bluetooth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GattCallbackPolicyTest {
    @Test
    fun `duplicate connected callback does not move a ready connection backward`() {
        assertTrue(GattCallbackPolicy.acceptsConnected(ConnectionState.CONNECTING))
        assertFalse(GattCallbackPolicy.acceptsConnected(ConnectionState.READY))
    }

    @Test
    fun `only the expected descriptor can complete notification setup`() {
        val expected = Any()

        assertTrue(
            GattCallbackPolicy.acceptsDescriptor(
                ConnectionState.ENABLING_NOTIFICATIONS,
                expected,
                expected,
            ),
        )
        assertFalse(
            GattCallbackPolicy.acceptsDescriptor(
                ConnectionState.ENABLING_NOTIFICATIONS,
                expected,
                Any(),
            ),
        )
        assertFalse(GattCallbackPolicy.acceptsDescriptor(ConnectionState.READY, expected, expected))
    }

    @Test
    fun `only the expected reply characteristic can add a notification`() {
        val expected = Any()

        assertTrue(GattCallbackPolicy.acceptsNotification(ConnectionState.READY, expected, expected))
        assertFalse(GattCallbackPolicy.acceptsNotification(ConnectionState.READY, expected, Any()))
        assertFalse(
            GattCallbackPolicy.acceptsNotification(
                ConnectionState.ENABLING_NOTIFICATIONS,
                expected,
                expected,
            ),
        )
    }

    @Test
    fun `only the expected write characteristic can complete a pending write`() {
        val expected = Any()

        assertTrue(GattCallbackPolicy.acceptsWrite(ConnectionState.READY, expected, expected))
        assertFalse(GattCallbackPolicy.acceptsWrite(ConnectionState.READY, expected, Any()))
        assertFalse(GattCallbackPolicy.acceptsWrite(ConnectionState.CLOSING, expected, expected))
    }
}
