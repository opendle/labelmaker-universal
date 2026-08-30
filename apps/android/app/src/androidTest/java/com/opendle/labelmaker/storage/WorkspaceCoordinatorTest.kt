package com.opendle.labelmaker.storage

import android.content.Context
import android.os.Looper
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContract
import androidx.core.app.ActivityOptionsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.opendle.labelmaker.bridge.BridgeFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class WorkspaceCoordinatorTest {
    @Test
    fun lostPersistedGrantFailsNormalSaveWithoutOpeningSaveAs() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("workspace-association", Context.MODE_PRIVATE)
            .edit()
            .putString("uri-v1", "content://missing/workspace.lbl")
            .putString("file-name-v1", "workspace.lbl")
            .commit()
        val openLauncher = RecordingLauncher<Array<String>>()
        val createLauncher = RecordingLauncher<String>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val coordinator = WorkspaceCoordinator(context, openLauncher, createLauncher, scope)
        var result: Result<org.json.JSONObject>? = null
        var callbackWasOnMain = false
        val completed = CountDownLatch(1)

        coordinator.saveWorkspace(
            data = byteArrayOf(0x1f, 0x8b.toByte()),
            suggestedFileName = "workspace.lbl",
            saveAs = false,
        ) {
            result = it
            callbackWasOnMain = Looper.myLooper() == Looper.getMainLooper()
            completed.countDown()
        }

        assertNull(result)
        assertTrue(completed.await(5, TimeUnit.SECONDS))

        val failure = result?.exceptionOrNull() as BridgeFailure
        assertEquals("DOCUMENT_PERMISSION_LOST", failure.code)
        assertTrue(callbackWasOnMain)
        assertFalse(createLauncher.launched)
        assertEquals("workspace.lbl", coordinator.associatedFileName)
        scope.cancel()
    }

    private class RecordingLauncher<I> : ActivityResultLauncher<I>() {
        var launched = false

        override fun launch(input: I, options: ActivityOptionsCompat?) {
            launched = true
        }

        override fun unregister() = Unit

        override val contract: ActivityResultContract<I, *>
            get() = throw UnsupportedOperationException("The fake launcher has no contract.")
    }
}
