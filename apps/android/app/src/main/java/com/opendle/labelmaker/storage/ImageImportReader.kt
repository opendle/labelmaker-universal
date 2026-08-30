package com.opendle.labelmaker.storage

import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import com.opendle.labelmaker.bridge.BridgeFailure
import java.io.ByteArrayOutputStream
import java.io.InputStream

private const val MAXIMUM_IMAGE_BYTES = 8 * 1024 * 1024

data class ImportedImage(
    val bytes: ByteArray,
    val fileName: String,
    val mimeType: String,
)

class ImageImportReader(private val resolver: ContentResolver) {
    fun read(uri: Uri): ImportedImage {
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
            throw BridgeFailure("INVALID_IMAGE", "The selected image location is not available.")
        }
        val bytes = resolver.openInputStream(uri)?.use(::readBounded)
            ?: throw BridgeFailure("IMAGE_READ_FAILED", "The selected image could not be read.")
        val detectedMimeType = detectMimeType(bytes)
            ?: throw BridgeFailure("INVALID_IMAGE", "Select a PNG, JPEG, GIF, WebP, or BMP image.")
        val reportedMimeType = resolver.getType(uri)
        if (reportedMimeType?.startsWith("image/") == true && reportedMimeType !in allowedMimeTypes) {
            throw BridgeFailure("INVALID_IMAGE", "Select a PNG, JPEG, GIF, WebP, or BMP image.")
        }
        return ImportedImage(
            bytes = bytes,
            fileName = displayName(uri).take(255),
            mimeType = detectedMimeType,
        )
    }

    internal fun readBounded(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > MAXIMUM_IMAGE_BYTES) {
                throw BridgeFailure("IMAGE_TOO_LARGE", "Images must be smaller than 8 MB.")
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun displayName(uri: Uri): String {
        var cursor: Cursor? = null
        try {
            cursor = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor != null && cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    val value = cursor.getString(index)
                    if (!value.isNullOrBlank()) return value
                }
            }
        } finally {
            cursor?.close()
        }
        return "Imported image"
    }

    private fun detectMimeType(bytes: ByteArray): String? = when {
        bytes.startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) -> "image/png"
        bytes.startsWith(0xff, 0xd8, 0xff) -> "image/jpeg"
        bytes.startsWithAscii("GIF87a") || bytes.startsWithAscii("GIF89a") -> "image/gif"
        bytes.startsWithAscii("RIFF") && bytes.size >= 12 &&
            bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP" -> "image/webp"
        bytes.startsWithAscii("BM") -> "image/bmp"
        else -> null
    }

    private fun ByteArray.startsWith(vararg prefix: Int): Boolean =
        size >= prefix.size && prefix.indices.all { index -> this[index].toInt() and 0xff == prefix[index] }

    private fun ByteArray.startsWithAscii(prefix: String): Boolean =
        size >= prefix.length && copyOfRange(0, prefix.length).toString(Charsets.US_ASCII) == prefix

    private companion object {
        val allowedMimeTypes = setOf("image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp")
    }
}
