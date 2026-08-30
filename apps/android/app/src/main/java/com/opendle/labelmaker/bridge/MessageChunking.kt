package com.opendle.labelmaker.bridge

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.util.UUID

internal const val MAX_FRAME_CHARACTERS = 128 * 1024
internal const val MAX_CHUNK_DATA_CHARACTERS = 60 * 1024
internal const val MAX_MESSAGE_CHARACTERS = 40 * 1024 * 1024
internal const val MESSAGE_EXPIRY_MS = 60_000L
internal const val MAX_INCOMPLETE_MESSAGES = 8
internal const val MAX_INCOMPLETE_CHARACTERS = MAX_MESSAGE_CHARACTERS
internal const val MAX_INCOMPLETE_PART_SLOTS = 4 * 1024
private const val FRAME_ENVELOPE_RESERVE = 512

internal fun interface ScheduledExpiry {
    fun cancel()
}

internal fun interface ExpiryScheduler {
    fun schedule(delayMs: Long, operation: () -> Unit): ScheduledExpiry
}

private class MainThreadExpiryScheduler : ExpiryScheduler {
    private val handler = Handler(Looper.getMainLooper())

    override fun schedule(delayMs: Long, operation: () -> Unit): ScheduledExpiry {
        val runnable = Runnable(operation)
        handler.postDelayed(runnable, delayMs)
        return ScheduledExpiry { handler.removeCallbacks(runnable) }
    }
}

internal sealed interface AssemblyResult {
    data class Complete(val message: String) : AssemblyResult

    data object Incomplete : AssemblyResult
}

internal class MessageChunkAssembler(
    private val now: () -> Long = SystemClock::elapsedRealtime,
    private val scheduler: ExpiryScheduler = MainThreadExpiryScheduler(),
    private val maximumIncompleteMessages: Int = MAX_INCOMPLETE_MESSAGES,
    private val maximumIncompleteCharacters: Int = MAX_INCOMPLETE_CHARACTERS,
    private val maximumIncompletePartSlots: Int = MAX_INCOMPLETE_PART_SLOTS,
) {
    private data class Pending(
        val createdAt: Long,
        val parts: Array<String?>,
        var receivedCharacters: Int = 0,
        var receivedParts: Int = 0,
        var expiry: ScheduledExpiry? = null,
    )

    private val pending = mutableMapOf<String, Pending>()
    private var pendingCharacters = 0
    private var pendingPartSlots = 0

    @Synchronized
    fun accept(rawFrame: String): AssemblyResult {
        expireOldMessages()
        if (rawFrame.length > MAX_FRAME_CHARACTERS) {
            throw BridgeFailure("FRAME_TOO_LARGE", "The native bridge frame is too large.")
        }
        val frame = runCatching { JSONObject(rawFrame) }.getOrElse {
            throw BridgeFailure("INVALID_REQUEST", "The native bridge request is not valid JSON.")
        }
        if (frame.optString("type") != "chunk") {
            return AssemblyResult.Complete(rawFrame)
        }

        val messageId = frame.requireBoundedId("messageId")
        try {
            val index = frame.requireInteger("index", minimum = 0)
            val total = frame.requireInteger("total", minimum = 1)
            val data = frame.requireString("data", allowEmpty = true)
            val maximumParts =
                (MAX_MESSAGE_CHARACTERS + MAX_CHUNK_DATA_CHARACTERS - 1) / MAX_CHUNK_DATA_CHARACTERS
            if (total > maximumParts || index >= total) {
                throw BridgeFailure("INVALID_CHUNK", "The native bridge chunk position is invalid.")
            }
            if (data.length > MAX_FRAME_CHARACTERS) {
                throw BridgeFailure("FRAME_TOO_LARGE", "The native bridge chunk is too large.")
            }

            val message = pending[messageId] ?: run {
                if (pending.size >= maximumIncompleteMessages) {
                    throw BridgeFailure("MESSAGE_BUDGET_EXCEEDED", "Too many native bridge messages are incomplete.")
                }
                if (pendingPartSlots > maximumIncompletePartSlots - total) {
                    throw BridgeFailure("MESSAGE_BUDGET_EXCEEDED", "The native bridge message part budget is full.")
                }
                Pending(createdAt = now(), parts = arrayOfNulls(total)).also { created ->
                    pending[messageId] = created
                    pendingPartSlots += total
                    created.expiry = scheduler.schedule(MESSAGE_EXPIRY_MS) {
                        synchronized(this) {
                            if (pending[messageId] === created) remove(messageId)
                        }
                    }
                }
            }
            if (message.parts.size != total) {
                throw BridgeFailure("INVALID_CHUNK", "The native bridge chunk count changed.")
            }
            val previous = message.parts[index]
            if (previous != null && previous != data) {
                throw BridgeFailure("INVALID_CHUNK", "The native bridge chunk was repeated with different data.")
            }
            if (previous == null) {
                if (pendingCharacters > maximumIncompleteCharacters - data.length) {
                    throw BridgeFailure("MESSAGE_BUDGET_EXCEEDED", "The native bridge message memory budget is full.")
                }
                message.parts[index] = data
                message.receivedCharacters += data.length
                message.receivedParts += 1
                pendingCharacters += data.length
            }
            if (message.receivedCharacters > MAX_MESSAGE_CHARACTERS) {
                throw BridgeFailure("MESSAGE_TOO_LARGE", "The native bridge message is too large.")
            }
            if (message.receivedParts != total) return AssemblyResult.Incomplete

            remove(messageId)
            val complete = buildString(message.receivedCharacters) {
                message.parts.forEach { append(it ?: error("A completed bridge message has a missing part.")) }
            }
            if (complete.length > MAX_MESSAGE_CHARACTERS) {
                throw BridgeFailure("MESSAGE_TOO_LARGE", "The native bridge message is too large.")
            }
            return AssemblyResult.Complete(complete)
        } catch (error: BridgeFailure) {
            remove(messageId)
            throw error
        }
    }

    @Synchronized
    fun clear() {
        pending.values.forEach { it.expiry?.cancel() }
        pending.clear()
        pendingCharacters = 0
        pendingPartSlots = 0
    }

    private fun expireOldMessages() {
        val cutoff = now() - MESSAGE_EXPIRY_MS
        pending.filterValues { it.createdAt <= cutoff }.keys.toList().forEach(::remove)
    }

    private fun remove(messageId: String) {
        pending.remove(messageId)?.let { removed ->
            pendingCharacters -= removed.receivedCharacters
            pendingPartSlots -= removed.parts.size
            removed.expiry?.cancel()
        }
    }
}

internal object MessageChunkFramer {
    fun frame(message: String): Sequence<String> {
        if (message.length > MAX_MESSAGE_CHARACTERS) {
            throw BridgeFailure("MESSAGE_TOO_LARGE", "The native bridge reply is too large.")
        }
        if (message.length <= MAX_FRAME_CHARACTERS) return sequenceOf(message)

        val messageId = "native-${UUID.randomUUID()}"
        val ranges = rangesForFrames(message, messageId)
        val maximumParts =
            (MAX_MESSAGE_CHARACTERS + MAX_CHUNK_DATA_CHARACTERS - 1) / MAX_CHUNK_DATA_CHARACTERS
        if (ranges.size > maximumParts) {
            throw BridgeFailure("MESSAGE_TOO_LARGE", "The native bridge reply needs too many frames.")
        }
        return sequence {
            ranges.forEachIndexed { index, range ->
                val framed = frame(
                    messageId,
                    index,
                    ranges.size,
                    message.substring(range.first, range.second),
                )
                if (framed.length > MAX_FRAME_CHARACTERS) {
                    throw BridgeFailure("FRAME_TOO_LARGE", "The native bridge reply frame is too large.")
                }
                yield(framed)
            }
        }
    }

    private fun rangesForFrames(message: String, messageId: String): List<Pair<Int, Int>> {
        val result = mutableListOf<Pair<Int, Int>>()
        var start = 0
        while (start < message.length) {
            var end = minOf(
                start + minOf(MAX_CHUNK_DATA_CHARACTERS, MAX_FRAME_CHARACTERS - FRAME_ENVELOPE_RESERVE),
                message.length,
            )
            while (end > start && frame(messageId, 999, 999, message.substring(start, end)).length > MAX_FRAME_CHARACTERS) {
                end = start + (end - start) / 2
            }
            if (end == start) {
                throw BridgeFailure("FRAME_TOO_LARGE", "The native bridge reply cannot be framed.")
            }
            result += start to end
            start = end
        }
        return result
    }

    private fun frame(messageId: String, index: Int, total: Int, data: String): String =
        JSONObject()
                .put("type", "chunk")
                .put("messageId", messageId)
                .put("index", index)
                .put("total", total)
                .put("data", data)
                .toString()

}

internal fun JSONObject.requireBoundedId(key: String): String {
    val value = requireString(key)
    if (value.length > 64 || !value.matches(Regex("^[A-Za-z0-9._:-]+$"))) {
        throw BridgeFailure("INVALID_REQUEST", "The native bridge request ID is invalid.")
    }
    return value
}

internal fun JSONObject.requireString(key: String, allowEmpty: Boolean = false): String {
    val value = opt(key)
    if (value !is String || (!allowEmpty && value.isEmpty())) {
        throw BridgeFailure("INVALID_REQUEST", "The native bridge request is missing $key.")
    }
    return value
}

internal fun JSONObject.requireBoolean(key: String): Boolean {
    val value = opt(key)
    if (value !is Boolean) {
        throw BridgeFailure("INVALID_REQUEST", "The native bridge request is missing $key.")
    }
    return value
}

internal fun JSONObject.requireInteger(key: String, minimum: Int = 1, maximum: Int = Int.MAX_VALUE): Int {
    val value = opt(key)
    if (value !is Number) {
        throw BridgeFailure("INVALID_REQUEST", "The native bridge request is missing $key.")
    }
    val integer = value.toInt()
    if (value.toDouble() != integer.toDouble() || integer !in minimum..maximum) {
        throw BridgeFailure("INVALID_REQUEST", "The native bridge request has an invalid $key.")
    }
    return integer
}
