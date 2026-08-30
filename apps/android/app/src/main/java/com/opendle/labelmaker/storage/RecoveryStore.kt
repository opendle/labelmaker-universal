package com.opendle.labelmaker.storage

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import com.opendle.labelmaker.bridge.BridgeFailure
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONTokener
import org.json.JSONObject
import java.io.File

private const val MAXIMUM_RECOVERY_BYTES = 25 * 1024 * 1024
private const val WRITE_DELAY_MS = 250L

class RecoveryStore(
    context: Context,
    private val handler: Handler = Handler(Looper.getMainLooper()),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    private val atomicFile = AtomicFile(File(context.noBackupFilesDir, "workspace-recovery.json"))
    private val writeScope = CoroutineScope(SupervisorJob() + ioDispatcher)
    private val mutex = Mutex()
    private var pendingData: ByteArray? = null
    private val delayedWrite = Runnable { writeScope.launch { flushPending() } }

    suspend fun load(): Any? {
        flush()
        return mutex.withLock {
            withContext(ioDispatcher) {
                val file = atomicFile.baseFile
                if (!file.isFile || file.length() > MAXIMUM_RECOVERY_BYTES) {
                    null
                } else {
                    runCatching {
                        val data = atomicFile.readFully()
                        if (data.size > MAXIMUM_RECOVERY_BYTES) null
                        else {
                            JSONTokener(data.toString(Charsets.UTF_8)).nextValue()
                                .takeIf { it is JSONObject }
                        }
                    }.getOrNull()
                }
            }
        }
    }

    suspend fun store(value: Any) {
        val data = withContext(ioDispatcher) { value.toString().toByteArray(Charsets.UTF_8) }
        if (data.size > MAXIMUM_RECOVERY_BYTES) {
            throw BridgeFailure("RECOVERY_TOO_LARGE", "The recovery state is too large.")
        }
        mutex.withLock { pendingData = data }
        withContext(mainDispatcher) {
            handler.removeCallbacks(delayedWrite)
            handler.postDelayed(delayedWrite, WRITE_DELAY_MS)
        }
    }

    suspend fun flush(): Boolean {
        withContext(mainDispatcher) { handler.removeCallbacks(delayedWrite) }
        return flushPending()
    }

    fun flushInBackground(): Job {
        handler.removeCallbacks(delayedWrite)
        return writeScope.launch { flushPending() }
    }

    private suspend fun flushPending(): Boolean {
        return mutex.withLock {
            val data = pendingData ?: return@withLock true
            val written = withContext(ioDispatcher) { write(data) }
            if (written && pendingData === data) pendingData = null
            written
        }
    }

    private fun write(data: ByteArray): Boolean {
        return try {
            val stream = atomicFile.startWrite()
            try {
                stream.write(data)
                atomicFile.finishWrite(stream)
                true
            } catch (error: Throwable) {
                runCatching { atomicFile.failWrite(stream) }
                false
            }
        } catch (error: Throwable) {
            false
        }
    }
}
