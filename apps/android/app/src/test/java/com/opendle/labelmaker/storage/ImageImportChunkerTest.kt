package com.opendle.labelmaker.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageImportChunkerTest {
    @Test
    fun `a multi-part import stays bounded and reconstructs exactly`() {
        val base64 = "a".repeat(IMAGE_IMPORT_CHUNK_CHARACTERS * 2 + 17)

        val chunks = ImageImportChunker.chunk(base64).toList()

        assertEquals(3, chunks.size)
        assertTrue(chunks.all { it.length <= IMAGE_IMPORT_CHUNK_CHARACTERS })
        assertEquals(base64, chunks.joinToString(""))
    }
}
