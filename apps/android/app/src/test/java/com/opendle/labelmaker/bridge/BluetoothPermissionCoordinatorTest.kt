package com.opendle.labelmaker.bridge

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BluetoothPermissionCoordinatorTest {
    @Test
    fun `denial returns false`() = runTest {
        lateinit var requested: Array<String>
        val coordinator = BluetoothPermissionCoordinator(
            isGranted = { false },
            requestPermissions = { requested = it },
        )

        val result = async { coordinator.ensurePermissions() }
        testScheduler.runCurrent()
        coordinator.onResult(requested.associateWith { false })

        assertFalse(result.await())
    }

    @Test
    fun `a later grant succeeds after an earlier denial`() = runTest {
        val granted = mutableSetOf<String>()
        var requestCount = 0
        val coordinator = BluetoothPermissionCoordinator(
            isGranted = granted::contains,
            requestPermissions = { requestCount += 1 },
        )

        val denied = async { coordinator.ensurePermissions() }
        testScheduler.runCurrent()
        coordinator.onResult(emptyMap())
        assertFalse(denied.await())

        granted += BluetoothPermissionCoordinator.requiredPermissions
        assertTrue(coordinator.ensurePermissions())
        assertTrue(requestCount == 1)
    }
}
