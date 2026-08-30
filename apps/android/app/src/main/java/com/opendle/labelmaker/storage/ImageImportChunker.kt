package com.opendle.labelmaker.storage

import com.opendle.labelmaker.bridge.BridgeFailure

internal const val IMAGE_IMPORT_CHUNK_CHARACTERS = 64 * 1024
internal const val MAXIMUM_IMAGE_IMPORT_CHARACTERS = 12 * 1024 * 1024

internal object ImageImportChunker {
    fun chunk(base64: String): Sequence<String> {
        if (base64.length > MAXIMUM_IMAGE_IMPORT_CHARACTERS) {
            throw BridgeFailure("IMAGE_TOO_LARGE", "The selected image is too large to import.")
        }
        return sequence {
            var start = 0
            while (start < base64.length) {
                val end = minOf(start + IMAGE_IMPORT_CHUNK_CHARACTERS, base64.length)
                yield(base64.substring(start, end))
                start = end
            }
        }
    }
}
