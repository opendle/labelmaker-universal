package com.opendle.labelmaker.bridge

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BluetoothOperationRegistryTest {
    @Test
    fun `cancel before a registered connect body prevents the connect`() = runTest {
        var connectStarted = false
        var closeAllCalled = false
        val registry = BluetoothOperationRegistry { closeAllCalled = true }
        val connect = launch(start = CoroutineStart.LAZY) {
            connectStarted = true
        }
        registry.register(connect)

        registry.cancelAll()
        connect.start()
        testScheduler.runCurrent()

        assertFalse(connectStarted)
        assertTrue(closeAllCalled)
        assertTrue(connect.isCancelled)
    }
}
