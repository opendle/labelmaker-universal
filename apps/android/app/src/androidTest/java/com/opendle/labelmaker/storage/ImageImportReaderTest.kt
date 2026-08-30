package com.opendle.labelmaker.storage

import android.content.ContentValues
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ImageImportReaderTest {
    @Test
    fun readsASelectedPngThroughTheContentResolver() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val resolver = context.contentResolver
        val png = byteArrayOf(
            0x89.toByte(),
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
            0x00,
        )
        val uri = requireNotNull(
            resolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, "labelmaker-import-test.png")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                },
            ),
        )
        try {
            resolver.openOutputStream(uri, "w")!!.use { it.write(png) }
            val image = ImageImportReader(resolver).read(uri)

            assertEquals("image/png", image.mimeType)
            assertEquals("labelmaker-import-test.png", image.fileName)
            assertArrayEquals(png, image.bytes)
        } finally {
            resolver.delete(uri, null, null)
        }
    }
}
