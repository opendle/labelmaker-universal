package com.opendle.labelmaker.storage

import com.opendle.labelmaker.bridge.BridgeFailure

internal const val IMAGE_IMPORT_CHUNK_CHARACTERS = 64 * 1024
internal const val MAXIMUM_IMAGE_IMPORT_CHARACTERS = 40 * 1024 * 1024

internal object ImageImportChunker {
    fun chunk(base64: String): List<String> {
        if (base64.length > MAXIMUM_IMAGE_IMPORT_CHARACTERS) {
            throw BridgeFailure("IMAGE_TOO_LARGE", "The selected image is too large to import.")
        }
        return base64.chunked(IMAGE_IMPORT_CHUNK_CHARACTERS)
    }
}
