package com.opendle.labelmaker.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.opendle.labelmaker.bridge.BridgeFailure
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class RecoveryStoreTest {
    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun prepare() {
        File(context.noBackupFilesDir, "workspace-recovery.json").delete()
    }

    @Test
    fun flushStoresPendingRecoveryImmediately() {
        val store = RecoveryStore(context)
        store.store(JSONObject().put("zoom", 100))

        store.flush()

        assertEquals(100, (store.load() as JSONObject).getInt("zoom"))
    }

    @Test
    fun invalidRecoveryDoesNotStopStartup() {
        File(context.noBackupFilesDir, "workspace-recovery.json").writeText("not json")

        assertNull(RecoveryStore(context).load())
    }

    @Test
    fun oversizeRecoveryIsRejected() {
        val store = RecoveryStore(context)
        try {
            store.store(JSONObject().put("value", "x".repeat(25 * 1024 * 1024)))
            fail("Expected oversize recovery to fail")
        } catch (error: BridgeFailure) {
            assertEquals("RECOVERY_TOO_LARGE", error.code)
        }
    }
}
