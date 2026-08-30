package com.opendle.labelmaker.storage

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import com.opendle.labelmaker.bridge.BridgeFailure
import org.json.JSONTokener
import org.json.JSONObject
import java.io.File

private const val MAXIMUM_RECOVERY_BYTES = 25 * 1024 * 1024
private const val WRITE_DELAY_MS = 250L

class RecoveryStore(
    context: Context,
    private val handler: Handler = Handler(Looper.getMainLooper()),
) {
    private val atomicFile = AtomicFile(File(context.noBackupFilesDir, "workspace-recovery.json"))
    private var pendingData: ByteArray? = null
    private val delayedWrite = Runnable { flush() }

    @Synchronized
    fun load(): Any? {
        flush()
        val file = atomicFile.baseFile
        if (!file.isFile || file.length() > MAXIMUM_RECOVERY_BYTES) return null
        return runCatching {
            val data = atomicFile.readFully()
            if (data.size > MAXIMUM_RECOVERY_BYTES) return null
            JSONTokener(data.toString(Charsets.UTF_8)).nextValue()
                .takeIf { it is JSONObject }
        }.getOrNull()
    }

    @Synchronized
    fun store(value: Any) {
        val data = value.toString().toByteArray(Charsets.UTF_8)
        if (data.size > MAXIMUM_RECOVERY_BYTES) {
            throw BridgeFailure("RECOVERY_TOO_LARGE", "The recovery state is too large.")
        }
        pendingData = data
        handler.removeCallbacks(delayedWrite)
        handler.postDelayed(delayedWrite, WRITE_DELAY_MS)
    }

    @Synchronized
    fun flush(): Boolean {
        handler.removeCallbacks(delayedWrite)
        val data = pendingData ?: return true
        val stream = atomicFile.startWrite()
        try {
            stream.write(data)
            atomicFile.finishWrite(stream)
            pendingData = null
            return true
        } catch (error: Throwable) {
            atomicFile.failWrite(stream)
            return false
        }
    }
}
