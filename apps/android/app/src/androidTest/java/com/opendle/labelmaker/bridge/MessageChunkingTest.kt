package com.opendle.labelmaker.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class MessageChunkingTest {
    @Test
    fun allGeneratedFramesStayWithinTheCompleteFrameLimit() {
        val message = JSONObject()
            .put("version", 1)
            .put("id", "web-1")
            .put("ok", true)
            .put("result", "\\\"".repeat(MAX_FRAME_CHARACTERS))
            .toString()

        val frames = MessageChunkFramer.frame(message).toList()

        assertTrue(frames.size > 1)
        assertTrue(frames.all { it.length <= MAX_FRAME_CHARACTERS })
        assertTrue(frames.all { JSONObject(it).getString("data").length <= MAX_CHUNK_DATA_CHARACTERS })
        val assembler = MessageChunkAssembler(now = { 0L }, scheduler = FakeExpiryScheduler())
        var result: AssemblyResult = AssemblyResult.Incomplete
        frames.forEach { result = assembler.accept(it) }
        assertEquals(message, (result as AssemblyResult.Complete).message)
    }

    @Test
    fun aChunkFrameLargerThanTheCompleteFrameLimitIsRejected() {
        val frame = JSONObject()
            .put("type", "chunk")
            .put("messageId", "message-1")
            .put("index", 0)
            .put("total", 2)
            .put("data", "x".repeat(MAX_FRAME_CHARACTERS))
            .toString()

        val failure = expectBridgeFailure {
            MessageChunkAssembler(now = { 0L }, scheduler = FakeExpiryScheduler()).accept(frame)
        }

        assertEquals("FRAME_TOO_LARGE", failure.code)
    }

    @Test
    fun anIncompleteMessageExpiresWithoutAnotherIncomingFrame() {
        val scheduler = FakeExpiryScheduler()
        var now = 0L
        val assembler = MessageChunkAssembler(now = { now }, scheduler = scheduler)
        val first = chunk(messageId = "message-1", index = 0, total = 2, data = "first")
        val second = chunk(messageId = "message-1", index = 1, total = 2, data = "second")

        assertEquals(AssemblyResult.Incomplete, assembler.accept(first))
        now = MESSAGE_EXPIRY_MS
        scheduler.runAll()

        assertEquals(AssemblyResult.Incomplete, assembler.accept(second))
    }

    @Test
    fun aCompletedMessageCancelsItsExpiry() {
        val scheduler = FakeExpiryScheduler()
        val assembler = MessageChunkAssembler(now = { 0L }, scheduler = scheduler)

        assembler.accept(chunk("message-1", 0, 2, "one"))
        val result = assembler.accept(chunk("message-1", 1, 2, "two"))

        assertEquals("onetwo", (result as AssemblyResult.Complete).message)
        assertTrue(scheduler.entries.single().canceled)
    }

    @Test
    fun clearRemovesIncompleteMessages() {
        val scheduler = FakeExpiryScheduler()
        val assembler = MessageChunkAssembler(now = { 0L }, scheduler = scheduler)
        assembler.accept(chunk("message-1", 0, 2, "one"))

        assembler.clear()

        assertTrue(scheduler.entries.single().canceled)
        assertEquals(
            AssemblyResult.Incomplete,
            assembler.accept(chunk("message-1", 1, 2, "two")),
        )
    }

    @Test
    fun aMalformedLaterChunkReleasesTheIncompleteMessage() {
        val scheduler = FakeExpiryScheduler()
        val assembler = MessageChunkAssembler(now = { 0L }, scheduler = scheduler)
        assembler.accept(chunk("message-1", 0, 2, "one"))

        val failure = expectBridgeFailure {
            assembler.accept(chunk("message-1", 2, 2, "invalid"))
        }

        assertEquals("INVALID_CHUNK", failure.code)
        assertTrue(scheduler.entries.single().canceled)
        assertEquals(
            AssemblyResult.Incomplete,
            assembler.accept(chunk("message-1", 1, 2, "two")),
        )
    }

    @Test
    fun incompleteMessageCountIsBounded() {
        val assembler = MessageChunkAssembler(
            now = { 0L },
            scheduler = FakeExpiryScheduler(),
            maximumIncompleteMessages = 2,
            maximumIncompleteCharacters = 100,
            maximumIncompletePartSlots = 10,
        )
        assembler.accept(chunk("message-1", 0, 2, "one"))
        assembler.accept(chunk("message-2", 0, 2, "two"))

        val failure = expectBridgeFailure {
            assembler.accept(chunk("message-3", 0, 2, "three"))
        }

        assertEquals("MESSAGE_BUDGET_EXCEEDED", failure.code)
    }

    @Test
    fun incompleteMessageCharacterBudgetIsReleasedAfterCompletion() {
        val assembler = MessageChunkAssembler(
            now = { 0L },
            scheduler = FakeExpiryScheduler(),
            maximumIncompleteMessages = 3,
            maximumIncompleteCharacters = 6,
            maximumIncompletePartSlots = 10,
        )
        assembler.accept(chunk("message-1", 0, 2, "1234"))

        val failure = expectBridgeFailure {
            assembler.accept(chunk("message-2", 0, 2, "567"))
        }
        assertEquals("MESSAGE_BUDGET_EXCEEDED", failure.code)

        assertEquals(
            "123456",
            (assembler.accept(chunk("message-1", 1, 2, "56")) as AssemblyResult.Complete).message,
        )
        assertEquals(AssemblyResult.Incomplete, assembler.accept(chunk("message-3", 0, 2, "567")))
    }

    @Test
    fun incompleteMessagePartSlotBudgetIsBoundedAndReleasedOnExpiry() {
        val scheduler = FakeExpiryScheduler()
        val assembler = MessageChunkAssembler(
            now = { 0L },
            scheduler = scheduler,
            maximumIncompleteMessages = 3,
            maximumIncompleteCharacters = 100,
            maximumIncompletePartSlots = 3,
        )
        assembler.accept(chunk("message-1", 0, 2, "one"))

        val failure = expectBridgeFailure {
            assembler.accept(chunk("message-2", 0, 2, "two"))
        }
        assertEquals("MESSAGE_BUDGET_EXCEEDED", failure.code)

        scheduler.runAll()
        assertEquals(AssemblyResult.Incomplete, assembler.accept(chunk("message-3", 0, 2, "three")))
    }

    private fun chunk(messageId: String, index: Int, total: Int, data: String): String =
        JSONObject()
            .put("type", "chunk")
            .put("messageId", messageId)
            .put("index", index)
            .put("total", total)
            .put("data", data)
            .toString()

    private fun expectBridgeFailure(operation: () -> Unit): BridgeFailure {
        try {
            operation()
            fail("Expected a BridgeFailure")
        } catch (error: BridgeFailure) {
            return error
        }
        error("JUnit fail must throw")
    }

    private class FakeExpiryScheduler : ExpiryScheduler {
        data class Entry(
            val operation: () -> Unit,
            var canceled: Boolean = false,
        )

        val entries = mutableListOf<Entry>()

        override fun schedule(delayMs: Long, operation: () -> Unit): ScheduledExpiry {
            assertEquals(MESSAGE_EXPIRY_MS, delayMs)
            val entry = Entry(operation)
            entries += entry
            return ScheduledExpiry { entry.canceled = true }
        }

        fun runAll() {
            entries.filterNot { it.canceled }.forEach { it.operation() }
        }
    }
}
