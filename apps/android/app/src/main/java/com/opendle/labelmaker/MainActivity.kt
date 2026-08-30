package com.opendle.labelmaker

import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.opendle.labelmaker.bluetooth.MakeIdBluetoothTransport
import com.opendle.labelmaker.bridge.BluetoothPermissionCoordinator
import com.opendle.labelmaker.bridge.NativeBridge
import com.opendle.labelmaker.bridge.NativeUi
import com.opendle.labelmaker.storage.ImageImportChunker
import com.opendle.labelmaker.storage.ImageImportReader
import com.opendle.labelmaker.storage.MAXIMUM_IMAGE_IMPORT_CHARACTERS
import com.opendle.labelmaker.storage.RecoveryStore
import com.opendle.labelmaker.storage.WorkspaceCoordinator
import com.opendle.labelmaker.web.APP_URL
import com.opendle.labelmaker.web.createSecureWebView
import com.opendle.labelmaker.web.updateWebViewColorScheme
import org.json.JSONObject
import java.util.UUID

class MainActivity : ComponentActivity(), NativeUi {
    private lateinit var webView: WebView
    private lateinit var nativeBridge: NativeBridge
    private lateinit var workspace: WorkspaceCoordinator
    private lateinit var recovery: RecoveryStore
    private val bluetooth by lazy { MakeIdBluetoothTransport(applicationContext) }
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val imageImportReader by lazy { ImageImportReader(contentResolver) }
    private val bluetoothPermissions by lazy {
        BluetoothPermissionCoordinator(
            isGranted = ::hasPermission,
            requestPermissions = bluetoothPermissionLauncher::launch,
        )
    }
    private var imageDeliveryGeneration = 0
    private var latestSafeInsets: Insets = Insets.NONE
    private var latestKeyboardInsets: Insets = Insets.NONE

    private val openWorkspaceLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        workspace.onOpenResult(uri)
    }

    private val createWorkspaceLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
            workspace.onCreateResult(uri)
        }

    private val imageChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult
            fileChooserCallback = null
            val selected = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            callback.onReceiveValue(null)
            val uri = selected?.singleOrNull() ?: return@registerForActivityResult
            runCatching { imageImportReader.read(uri) }
                .onSuccess(::deliverImportedImage)
                .onFailure {
                    Toast.makeText(
                        this,
                        "The selected image could not be imported.",
                        Toast.LENGTH_SHORT,
                    ).show()
                }
        }

    private val bluetoothPermissionLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            bluetoothPermissions.onResult(result)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        recovery = RecoveryStore(this)
        workspace = WorkspaceCoordinator(this, openWorkspaceLauncher, createWorkspaceLauncher)
        nativeBridge = NativeBridge(
            scope = lifecycleScope,
            ui = this,
            workspace = workspace,
            recovery = recovery,
            bluetooth = bluetooth,
        )
        webView = createSecureWebView(
            context = this,
            nativeBridge = nativeBridge,
            onPageStarted = ::cancelImageDelivery,
            onPageFinished = ::publishLatestInsets,
        ).apply {
            id = R.id.labelmaker_web_view
            webChromeClient = ImageOnlyWebChromeClient()
        }
        val root = FrameLayout(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(root)
        installInsets()
        installBackHandler()
        webView.loadUrl(APP_URL)
    }

    override fun confirmWorkspaceReplacement(completion: (String) -> Unit) {
        if (isFinishing || isDestroyed) {
            completion("cancel")
            return
        }
        var answered = false
        fun answer(value: String) {
            if (answered) return
            answered = true
            completion(value)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.unsaved_workspace_title)
            .setMessage(R.string.unsaved_workspace_message)
            .setPositiveButton(R.string.save) { _, _ -> answer("save") }
            .setNegativeButton(R.string.discard_changes) { _, _ -> answer("discard") }
            .setNeutralButton(R.string.cancel) { _, _ -> answer("cancel") }
            .setOnCancelListener { answer("cancel") }
            .show()
    }

    override suspend fun ensureBluetoothPermissions(): Boolean {
        return bluetoothPermissions.ensurePermissions()
    }

    override fun onStop() {
        recovery.flush()
        bluetooth.closeAll()
        nativeBridge.notifyConnectionsClosed()
        super.onStop()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::webView.isInitialized) {
            updateWebViewColorScheme(this, webView.settings)
            webView.invalidate()
        }
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        nativeBridge.clearPendingMessages()
        bluetoothPermissions.cancel()
        bluetooth.closeAll()
        webView.stopLoading()
        webView.webChromeClient = null
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun installInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
            val safe = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
            latestSafeInsets = safe
            latestKeyboardInsets = keyboard
            publishLatestInsets()
            view.post { view.requestLayout() }
            windowInsets
        }
        ViewCompat.requestApplyInsets(webView)
    }

    private fun publishLatestInsets() {
        publishInsets(latestSafeInsets, latestKeyboardInsets)
    }

    private fun publishInsets(safe: Insets, keyboard: Insets) {
        if (!::webView.isInitialized) return
        val density = resources.displayMetrics.density
        fun cssPixels(value: Int): Float = value / density
        val script = """
            (() => {
              const root = document.documentElement;
              if (!root) return false;
              root.style.setProperty('--labelmaker-safe-area-top', '${cssPixels(safe.top)}px');
              root.style.setProperty('--labelmaker-safe-area-right', '${cssPixels(safe.right)}px');
              root.style.setProperty('--labelmaker-safe-area-bottom', '${cssPixels(safe.bottom)}px');
              root.style.setProperty('--labelmaker-safe-area-left', '${cssPixels(safe.left)}px');
              root.style.setProperty('--labelmaker-keyboard-height', '${cssPixels(keyboard.bottom)}px');
              window.dispatchEvent(new Event('labelmaker-native-insets'));
              return true;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    private fun installBackHandler() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val script = """
                        (() => {
                          const active = document.activeElement;
                          if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
                            active.blur();
                            return true;
                          }
                          return false;
                        })();
                    """.trimIndent()
                    webView.evaluateJavascript(script) { rawResult ->
                        if (rawResult == "true") {
                            getSystemService<InputMethodManager>()
                                ?.hideSoftInputFromWindow(webView.windowToken, 0)
                        } else nativeBridge.requestSystemBack { handled ->
                            if (!handled) {
                                isEnabled = false
                                onBackPressedDispatcher.onBackPressed()
                                isEnabled = true
                            }
                        }
                    }
                }
            },
        )
    }

    private fun deliverImportedImage(image: com.opendle.labelmaker.storage.ImportedImage) {
        val base64 = Base64.encodeToString(image.bytes, Base64.NO_WRAP)
        val chunks = ImageImportChunker.chunk(base64)
        val token = "image-${UUID.randomUUID()}"
        val generation = ++imageDeliveryGeneration
        val initialize = """
            (() => {
              const input = document.querySelector('input[type="file"][data-labelmaker-native-import="pending"]');
              if (!(input instanceof HTMLInputElement)) return false;
              delete input.dataset.labelmakerNativeImport;
              window.__labelmakerImageImports ??= Object.create(null);
              window.__labelmakerImageImports[${JSONObject.quote(token)}] = {
                input,
                fileName: ${JSONObject.quote(image.fileName)},
                mimeType: ${JSONObject.quote(image.mimeType)},
                parts: [],
              };
              return true;
            })();
        """.trimIndent()
        webView.evaluateJavascript(initialize) { initialized ->
            if (initialized == "true" && generation == imageDeliveryGeneration) {
                deliverImageChunk(token, chunks, 0, generation)
            } else {
                cancelImageDelivery()
            }
        }
    }

    private fun deliverImageChunk(token: String, chunks: List<String>, index: Int, generation: Int) {
        if (generation != imageDeliveryGeneration) return
        if (index < chunks.size) {
            val append = """
                (() => {
                  const entry = window.__labelmakerImageImports?.[${JSONObject.quote(token)}];
                  if (!entry) return false;
                  entry.parts.push(${JSONObject.quote(chunks[index])});
                  return true;
                })();
            """.trimIndent()
            webView.evaluateJavascript(append) { appended ->
                if (appended == "true" && generation == imageDeliveryGeneration) {
                    deliverImageChunk(token, chunks, index + 1, generation)
                } else {
                    cancelImageDelivery(token)
                }
            }
            return
        }
        val complete = """
            (() => {
              const imports = window.__labelmakerImageImports;
              const entry = imports?.[${JSONObject.quote(token)}];
              if (!entry) return false;
              delete imports[${JSONObject.quote(token)}];
              const base64 = entry.parts.join('');
              if (base64.length > $MAXIMUM_IMAGE_IMPORT_CHARACTERS) return false;
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
              const file = new File([bytes], entry.fileName, { type: entry.mimeType });
              const transfer = new DataTransfer();
              transfer.items.add(file);
              entry.input.files = transfer.files;
              entry.input.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })();
        """.trimIndent()
        webView.evaluateJavascript(complete) {
            if (generation == imageDeliveryGeneration) imageDeliveryGeneration += 1
        }
    }

    private fun cancelImageDelivery(token: String? = null) {
        imageDeliveryGeneration += 1
        if (!::webView.isInitialized) return
        val cleanup = if (token == null) {
            "delete window.__labelmakerImageImports;"
        } else {
            "if (window.__labelmakerImageImports) delete window.__labelmakerImageImports[${JSONObject.quote(token)}];"
        }
        webView.evaluateJavascript(cleanup, null)
    }

    private inner class ImageOnlyWebChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf("image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"),
                )
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            }
            webView.evaluateJavascript(
                """
                    (() => {
                      document.querySelectorAll('input[type="file"][data-labelmaker-native-import]')
                        .forEach((input) => delete input.dataset.labelmakerNativeImport);
                      const input = document.activeElement;
                      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return false;
                      input.dataset.labelmakerNativeImport = 'pending';
                      return true;
                    })();
                """.trimIndent(),
            ) { marked ->
                if (marked == "true") imageChooserLauncher.launch(intent)
                else {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                }
            }
            return true
        }

        override fun onCreateWindow(
            view: WebView,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: android.os.Message,
        ): Boolean = false
    }
}
