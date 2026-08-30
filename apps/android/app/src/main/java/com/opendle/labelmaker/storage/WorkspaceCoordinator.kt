package com.opendle.labelmaker.storage

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.ActivityResultLauncher
import com.opendle.labelmaker.bridge.BridgeFailure
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

private const val MAXIMUM_WORKSPACE_BYTES = 25 * 1024 * 1024
private const val ASSOCIATION_PREFERENCES = "workspace-association"
private const val ASSOCIATION_URI_KEY = "uri-v1"
private const val ASSOCIATION_FILE_NAME_KEY = "file-name-v1"
private const val MAXIMUM_FILE_NAME_CHARACTERS = 255

class WorkspaceCoordinator(
    context: Context,
    private val openLauncher: ActivityResultLauncher<Array<String>>,
    private val createLauncher: ActivityResultLauncher<String>,
    private val scope: CoroutineScope,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private data class PendingSave(
        val data: ByteArray,
        val completion: (Result<JSONObject>) -> Unit,
    )

    private val resolver = context.contentResolver
    private val preferences = context.getSharedPreferences(ASSOCIATION_PREFERENCES, Context.MODE_PRIVATE)
    private val pendingSelections = mutableMapOf<String, Uri>()
    private var pendingOpen: ((Result<JSONObject>) -> Unit)? = null
    private var pendingSave: PendingSave? = null

    val associatedFileName: String?
        get() = preferences.getString(ASSOCIATION_FILE_NAME_KEY, null)?.let(::boundedFileName)

    fun openWorkspace(completion: (Result<JSONObject>) -> Unit) {
        if (pendingOpen != null || pendingSave != null) {
            completion(Result.failure(BridgeFailure("PICKER_BUSY", "Another file picker is already open.")))
            return
        }
        pendingOpen = completion
        openLauncher.launch(arrayOf("application/octet-stream", "application/gzip", "*/*"))
    }

    fun onOpenResult(uri: Uri?) {
        val completion = pendingOpen ?: return
        if (uri == null) {
            pendingOpen = null
            completion(Result.success(JSONObject().put("status", "canceled")))
            return
        }
        scope.launch {
            val result = withContext(ioDispatcher) {
                runCatching {
                    val fileName = displayName(uri)
                    if (!fileName.lowercase().endsWith(".lbl")) {
                        throw BridgeFailure("INVALID_FILE_TYPE", "Select a Label Maker workspace file.")
                    }
                    val data = readBounded(uri)
                    requireGzip(data)
                    JSONObject()
                        .put("status", "selected")
                        .put("selectionId", "selection-${UUID.randomUUID()}")
                        .put("fileName", fileName)
                        .put("gzipBase64", Base64.encodeToString(data, Base64.NO_WRAP))
                }
            }
            pendingOpen = null
            result.onSuccess { selected ->
                val selectionId = selected.getString("selectionId")
                pendingSelections.clear()
                pendingSelections[selectionId] = uri
            }
            completion(result)
        }
    }

    fun acceptSelection(selectionId: String, completion: (Result<Unit>) -> Unit) {
        val uri = pendingSelections.remove(selectionId)
        if (uri == null) {
            completion(
                Result.failure(
                    BridgeFailure("INVALID_SELECTION", "The selected workspace is no longer available."),
                ),
            )
            return
        }
        scope.launch {
            completion(
                withContext(ioDispatcher) {
                    runCatching { persistAssociation(uri, displayName(uri)) }
                },
            )
        }
    }

    fun saveWorkspace(
        data: ByteArray,
        suggestedFileName: String,
        saveAs: Boolean,
        completion: (Result<JSONObject>) -> Unit,
    ) {
        validateWorkspaceData(data)
        if (pendingOpen != null || pendingSave != null) {
            completion(Result.failure(BridgeFailure("PICKER_BUSY", "Another file picker is already open.")))
            return
        }
        if (!saveAs) {
            val associationValue = preferences.getString(ASSOCIATION_URI_KEY, null)
            if (associationValue != null) {
                pendingSave = PendingSave(data, completion)
                scope.launch {
                    val result = withContext(ioDispatcher) {
                        runCatching {
                            val uri = requireWritableAssociation(associationValue)
                            write(uri, data)
                            savedResult(uri)
                        }
                    }
                    pendingSave = null
                    completion(result)
                }
                return
            }
        }
        pendingSave = PendingSave(data, completion)
        createLauncher.launch(normalizeFileName(suggestedFileName))
    }

    fun onCreateResult(uri: Uri?) {
        val pending = pendingSave ?: return
        if (uri == null) {
            pendingSave = null
            pending.completion(Result.success(JSONObject().put("status", "canceled")))
            return
        }
        scope.launch {
            val result = withContext(ioDispatcher) {
                runCatching {
                    write(uri, pending.data)
                    persistAssociation(uri, displayName(uri))
                    savedResult(uri)
                }
            }
            pendingSave = null
            pending.completion(result)
        }
    }

    fun clearAssociation(completion: (Result<Unit>) -> Unit) {
        scope.launch {
            val result = withContext(ioDispatcher) {
                runCatching {
                    associatedUri()?.let { uri ->
                        releasePersistedPermission(uri)
                    }
                    preferences.edit().clear().apply()
                }
            }
            pendingSelections.clear()
            completion(result)
        }
    }

    private fun associatedUri(): Uri? {
        val value = preferences.getString(ASSOCIATION_URI_KEY, null) ?: return null
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return clearInvalidAssociation()
        val permission = resolver.persistedUriPermissions.firstOrNull { it.uri == uri }
            ?: return clearInvalidAssociation()
        if (!permission.isReadPermission) return clearInvalidAssociation()
        return uri
    }

    private fun clearInvalidAssociation(): Uri? {
        preferences.edit().clear().apply()
        return null
    }

    private fun requireWritableAssociation(value: String): Uri {
        val uri = runCatching { Uri.parse(value) }.getOrNull()
            ?: throw lostAssociation()
        val permission = resolver.persistedUriPermissions.firstOrNull { it.uri == uri }
            ?: throw lostAssociation()
        if (!permission.isWritePermission) throw lostAssociation()
        return uri
    }

    private fun lostAssociation(): BridgeFailure =
        BridgeFailure(
            "DOCUMENT_PERMISSION_LOST",
            "Label Maker no longer has access to the saved workspace. Use Save As to select a new location.",
        )

    private fun persistAssociation(uri: Uri, fileName: String) {
        val previousUri = preferences.getString(ASSOCIATION_URI_KEY, null)
            ?.let { runCatching { Uri.parse(it) }.getOrNull() }
        val readAndWrite = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            resolver.takePersistableUriPermission(
                uri,
                readAndWrite,
            )
        } catch (error: SecurityException) {
            try {
                resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (readError: SecurityException) {
                throw BridgeFailure(
                    "DOCUMENT_PERMISSION_FAILED",
                    "Label Maker could not keep access to this workspace.",
                )
            }
        }
        preferences.edit()
            .putString(ASSOCIATION_URI_KEY, uri.toString())
            .putString(ASSOCIATION_FILE_NAME_KEY, boundedFileName(fileName))
            .apply()
        if (previousUri != null && previousUri != uri) {
            releasePersistedPermission(previousUri)
        }
    }

    private fun releasePersistedPermission(uri: Uri) {
        val permission = resolver.persistedUriPermissions.firstOrNull { it.uri == uri }
        val flags =
            (if (permission?.isReadPermission == true) Intent.FLAG_GRANT_READ_URI_PERMISSION else 0) or
                (if (permission?.isWritePermission == true) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
        runCatching {
            if (flags != 0) resolver.releasePersistableUriPermission(uri, flags)
        }
    }

    private fun readBounded(uri: Uri): ByteArray {
        resolver.openInputStream(uri)?.use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > MAXIMUM_WORKSPACE_BYTES) {
                    throw BridgeFailure("DOCUMENT_TOO_LARGE", "Workspace files must be smaller than 25 MB.")
                }
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
        throw BridgeFailure("DOCUMENT_READ_FAILED", "The workspace file could not be read.")
    }

    private fun write(uri: Uri, data: ByteArray) {
        validateWorkspaceData(data)
        resolver.openOutputStream(uri, "rwt")?.use { output ->
            output.write(data)
            output.flush()
            return
        }
        throw BridgeFailure("DOCUMENT_WRITE_FAILED", "The workspace file could not be saved.")
    }

    private fun validateWorkspaceData(data: ByteArray) {
        if (data.size > MAXIMUM_WORKSPACE_BYTES) {
            throw BridgeFailure("DOCUMENT_TOO_LARGE", "Workspace files must be smaller than 25 MB.")
        }
        requireGzip(data)
    }

    private fun requireGzip(data: ByteArray) {
        if (data.size < 2 || data[0] != 0x1f.toByte() || data[1] != 0x8b.toByte()) {
            throw BridgeFailure("INVALID_GZIP", "Workspace file is not valid gzip data.")
        }
    }

    private fun displayName(uri: Uri): String {
        var cursor: Cursor? = null
        try {
            cursor = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor != null && cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    val name = cursor.getString(index)
                    if (!name.isNullOrBlank()) return boundedFileName(name)
                }
            }
        } finally {
            cursor?.close()
        }
        return uri.lastPathSegment
            ?.substringAfterLast('/')
            ?.takeIf { it.isNotBlank() }
            ?.let(::boundedFileName)
            ?: "Untitled workspace.lbl"
    }

    private fun savedResult(uri: Uri): JSONObject =
        JSONObject()
            .put("status", "saved")
            .put("fileName", displayName(uri))
            .put("savedAt", Instant.now().toString())

    private fun normalizeFileName(value: String): String {
        val safe = value
            .replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001f]"), "-")
            .trim()
            .trimEnd('.', ' ')
        val present = safe.ifBlank { "Untitled workspace" }
        val stem = if (present.lowercase().endsWith(".lbl")) present.dropLast(4) else present
        return "${stem.take(MAXIMUM_FILE_NAME_CHARACTERS - 4)}.lbl"
    }

    private fun boundedFileName(value: String): String {
        val safe = value.filterNot { it.isISOControl() }.trim().ifBlank { "Untitled workspace.lbl" }
        if (safe.length <= MAXIMUM_FILE_NAME_CHARACTERS) return safe
        return if (safe.lowercase().endsWith(".lbl")) {
            "${safe.dropLast(4).take(MAXIMUM_FILE_NAME_CHARACTERS - 4)}.lbl"
        } else {
            safe.take(MAXIMUM_FILE_NAME_CHARACTERS)
        }
    }
}
