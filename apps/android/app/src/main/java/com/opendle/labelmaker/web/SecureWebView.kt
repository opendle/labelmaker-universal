package com.opendle.labelmaker.web

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.opendle.labelmaker.BuildConfig
import com.opendle.labelmaker.bridge.NativeBridge

const val APP_ORIGIN = "https://appassets.androidplatform.net"
const val APP_URL = "$APP_ORIGIN/assets/webapp/index.html"
private const val BRIDGE_OBJECT_NAME = "labelmakerAndroid"

@SuppressLint("SetJavaScriptEnabled")
internal fun createSecureWebView(
    context: Context,
    nativeBridge: NativeBridge,
    onPageStarted: () -> Unit = {},
    onPageFinished: () -> Unit = {},
): WebView {
    check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        "The installed Android WebView does not support the secure message bridge."
    }
    val assetLoader = WebViewAssetLoader.Builder()
        .setDomain("appassets.androidplatform.net")
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    return WebView(context).apply {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.mediaPlaybackRequiresUserGesture = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setGeolocationEnabled(false)
        settings.safeBrowsingEnabled = true
        updateWebViewColorScheme(context, settings)
        settings.userAgentString = "${settings.userAgentString} LabelmakerAndroid/${BuildConfig.VERSION_NAME}"

        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        isHorizontalScrollBarEnabled = false
        isVerticalScrollBarEnabled = false
        isLongClickable = false
        overScrollMode = WebView.OVER_SCROLL_NEVER

        webViewClient = LocalOnlyWebViewClient(
            assetLoader = assetLoader,
            onPageStarted = {
                nativeBridge.clearPendingMessages()
                onPageStarted()
            },
            onPageFinished = {
                // A message from the old document can arrive after
                // onPageStarted. Clear only incomplete parts after the new
                // document has finished, without dropping its event sender.
                nativeBridge.clearIncompleteMessages()
                onPageFinished()
            },
        )
        WebViewCompat.addWebMessageListener(
            this,
            BRIDGE_OBJECT_NAME,
            setOf(APP_ORIGIN),
        ) { _, message, sourceOrigin, isMainFrame, replyProxy ->
            if (
                !isMainFrame ||
                sourceOrigin.scheme != "https" ||
                sourceOrigin.host != "appassets.androidplatform.net"
            ) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            nativeBridge.receive(raw) { frame -> post { replyProxy.postMessage(frame) } }
        }
    }
}

@Suppress("DEPRECATION")
internal fun updateWebViewColorScheme(context: Context, settings: WebSettings) {
    if (
        Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2 &&
        WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)
    ) {
        val nightMode = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        val forceDark = if (nightMode == Configuration.UI_MODE_NIGHT_YES) {
            WebSettingsCompat.FORCE_DARK_ON
        } else {
            WebSettingsCompat.FORCE_DARK_OFF
        }
        WebSettingsCompat.setForceDark(settings, forceDark)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
            WebSettingsCompat.setForceDarkStrategy(
                settings,
                WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY,
            )
        }
    }
}

private class LocalOnlyWebViewClient(
    private val assetLoader: WebViewAssetLoader,
    private val onPageStarted: () -> Unit,
    private val onPageFinished: () -> Unit,
) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        assetLoader.shouldInterceptRequest(request.url)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        shouldBlockNavigation(request.url, request.isForMainFrame)

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        onPageStarted()
        if (url != APP_URL) {
            view.stopLoading()
            view.loadUrl(APP_URL)
        }
    }

    override fun onPageFinished(view: WebView, url: String) {
        if (url == APP_URL) onPageFinished()
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean = false

}

internal fun shouldBlockNavigation(url: Uri, isMainFrame: Boolean): Boolean =
    if (isMainFrame) url.toString() != APP_URL else !isLocalAssetUrl(url)

private fun isLocalAssetUrl(url: Uri): Boolean =
    url.scheme == "https" &&
        url.host == "appassets.androidplatform.net" &&
        url.path?.startsWith("/assets/") == true
