package com.opendle.labelmaker.bridge

import android.Manifest
import kotlinx.coroutines.CompletableDeferred

class BluetoothPermissionCoordinator(
    private val isGranted: (String) -> Boolean,
    private val requestPermissions: (Array<String>) -> Unit,
) {
    private var pending: CompletableDeferred<Boolean>? = null

    suspend fun ensurePermissions(): Boolean {
        if (requiredPermissions.all(isGranted)) return true
        pending?.let { return it.await() }
        val request = CompletableDeferred<Boolean>()
        pending = request
        requestPermissions(requiredPermissions.copyOf())
        return request.await()
    }

    fun onResult(result: Map<String, Boolean>) {
        val granted = requiredPermissions.all { permission ->
            result[permission] == true || isGranted(permission)
        }
        pending?.complete(granted)
        pending = null
    }

    fun cancel() {
        pending?.complete(false)
        pending = null
    }

    companion object {
        val requiredPermissions = arrayOf(
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
        )
    }
}
