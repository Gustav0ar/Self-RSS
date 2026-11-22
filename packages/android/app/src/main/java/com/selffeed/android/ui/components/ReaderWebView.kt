@file:android.annotation.SuppressLint("SetJavaScriptEnabled", "ViewConstructor")

package com.selffeed.android.ui.components

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.graphics.ColorUtils
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.selffeed.android.data.local.OfflineMediaCache
import com.selffeed.android.ui.utils.isTrustedEmbedUrl
import java.util.UUID

internal val LocalOfflineMediaCache = staticCompositionLocalOf<OfflineMediaCache?> { null }

/** One Activity-bound renderer owns its bridge, posted work, document and fullscreen media. */
internal class ReaderWebView(
    context: Context,
    private val offlineMediaCache: OfflineMediaCache? = null,
    private val customTabsPrewarmer: CustomTabsPrewarmer? = null,
) : WebView(context) {
    private val callbacks = Handler(Looper.getMainLooper())
    private var documentToken = ""
    private var documentKey: Pair<String, String>? = null
    private var active = false
    private var lifecycleApplied = false
    private var fullscreen: ReaderFullscreenMedia? = null
    @Volatile var released = false
        private set
    var onHeight: (Int) -> Unit = {}
    var onReady: () -> Unit = {}
    var onRendererGone: () -> Unit = {}
    var onFullscreen: (ReaderFullscreenMedia?) -> Unit = {}
    var onImageTap: (String) -> Unit = {}

    init {
        settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = true
        }
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = true
        webViewClient = ReaderWebViewClient()
        webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (released || !active || view == null || fullscreen != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                val media = ReaderFullscreenMedia(view, callback) {
                    fullscreen = null
                    onFullscreen(null)
                }
                fullscreen = media
                onFullscreen(media)
            }

            @Deprecated("Compatibility callback for older WebView implementations")
            override fun onShowCustomView(view: View?, requestedOrientation: Int, callback: CustomViewCallback?) =
                onShowCustomView(view, callback)

            override fun onHideCustomView() { fullscreen?.close() }
        }
    }

    // Use token-validated JavascriptInterface rather than WebViewCompat.addWebMessageListener
    // to avoid a Chromium 124 (Android 15) native use-after-free when a WebView is destroyed
    // while its sandboxed renderer is still initializing.
    private fun installDocumentBridge(token: String) {
        addJavascriptInterface(object {
            @JavascriptInterface
            fun updateHeight(height: Float) {
                if (released) return
                // The bridge runs on Chromium's thread. Validate after hopping
                // to main so old documents cannot resize a replacement view.
                callbacks.post {
                    if (!released && token == documentToken && height.isFinite()) {
                        height.toInt().coerceIn(0, 50_000).takeIf { it > 0 }?.let(onHeight)
                    }
                }
            }

            @JavascriptInterface
            fun openImage(url: String?) {
                if (released) return
                val safeUrl = url?.trim()?.takeIf(::isHttpUrl) ?: return
                callbacks.post {
                    if (!released && active && token == documentToken) {
                        onImageTap(safeUrl)
                    }
                }
            }
        }, "Android")
    }

    fun loadDocument(baseUrl: String, html: String, backgroundColor: Int) {
        if (released) return
        val key = baseUrl to html
        if (documentKey == key) return
        runCatching { fullscreen?.close() }
        documentToken = UUID.randomUUID().toString()
        documentKey = key
        setBackgroundColor(backgroundColor)
        applyAlgorithmicDarkening(ColorUtils.calculateLuminance(backgroundColor) < 0.5)
        callbacks.removeCallbacksAndMessages(null)
        removeJavascriptInterface("Android")
        installDocumentBridge(documentToken)
        loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", baseUrl)
    }

    private fun applyAlgorithmicDarkening(isDarkTheme: Boolean) {
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, isDarkTheme)
            }
        }
    }

    /** Activating a page grants permission for a new gesture; it never resumes playback. */
    fun setReaderActive(value: Boolean) {
        if (released || (lifecycleApplied && active == value)) return
        lifecycleApplied = true
        active = value
        evaluateJavascript("window.SelfFeedApp && window.SelfFeedApp.setActive($value);", null)
        if (!value) {
            runCatching { fullscreen?.close() }
        }
    }

    fun releaseReaderResources() {
        if (released) return
        released = true
        active = false
        documentToken = ""
        documentKey = null
        callbacks.removeCallbacksAndMessages(null)
        // Each operation is independent: an unavailable/crashed renderer must
        // not prevent detachment, callback release or the final destroy call.
        runCatching { fullscreen?.close() }
        fullscreen = null
        onFullscreen = {}
        onHeight = {}
        onReady = {}
        onRendererGone = {}
        onImageTap = {}
        runCatching { evaluateJavascript("window.SelfFeedApp && window.SelfFeedApp.cleanup();", null) }
        runCatching { onPause() }
        runCatching { stopLoading() }
        runCatching { removeJavascriptInterface("Android") }
        runCatching { webChromeClient = null }
        runCatching { webViewClient = DetachedWebViewClient }
        runCatching { loadUrl("about:blank") }
        runCatching { (parent as? ViewGroup)?.removeView(this) }
        runCatching { removeAllViews() }
        runCatching { destroy() }
    }

    private inner class ReaderWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? {
            val cache = offlineMediaCache ?: return null
            if (released || request.isForMainFrame) return null
            if (!request.method.equals("GET", ignoreCase = true)) return null
            val url = request.url?.toString() ?: return null
            if (!url.startsWith("https://", ignoreCase = true) && !url.startsWith("http://", ignoreCase = true)) {
                return null
            }
            // Serve cached offline media immediately (0 ms latency both online and offline).
            cache.openCachedResponse(url)?.let { return it }
            // On a cache miss, let Chromium stream the image natively so slow or
            // dead publisher hosts never stall onPageFinished / visualReady, while
            // warming the offline disk cache asynchronously in the background.
            if (isImageSubresourceRequest(request, url)) {
                cache.prefetchInBackground(url)
            }
            return null
        }

        private fun isImageSubresourceRequest(request: WebResourceRequest, url: String): Boolean {
            if (isTrustedEmbedUrl(url)) return false
            val accept = request.requestHeaders?.entries
                ?.firstOrNull { it.key.equals("Accept", ignoreCase = true) }
                ?.value
            if (accept != null && accept.contains("image/", ignoreCase = true) &&
                !accept.contains("text/html", ignoreCase = true)
            ) {
                return true
            }
            return OfflineMediaCache.isLikelyImageUrl(url)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (released) return true
            val url = request.url.toString()
            if (!request.isForMainFrame && isTrustedEmbedUrl(url)) return false
            openExternalUrl(context, url, session = customTabsPrewarmer?.session)
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (released || url == "about:blank") return
            val token = documentToken
            evaluateJavascript(
                "window.SelfFeedApp && window.SelfFeedApp.setActive($active); window.postHeight && window.postHeight();",
                null,
            )
            postVisualStateCallback(0, object : VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    if (!released && token == documentToken) onReady()
                }
            })
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (!released) {
                val notifyGone = onRendererGone
                releaseReaderResources()
                notifyGone()
            }
            return true
        }
    }

    private object DetachedWebViewClient : WebViewClient() {
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean = true
    }

    private companion object {
        fun isHttpUrl(url: String): Boolean =
            url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)
    }
}

internal class ReaderFullscreenMedia(
    val view: View,
    private var callback: WebChromeClient.CustomViewCallback?,
    private var onClosed: (() -> Unit)?,
) {
    private var closed = false

    fun close() {
        if (closed) return
        closed = true
        val notify = onClosed
        val hidden = callback
        onClosed = null
        callback = null
        runCatching { (view.parent as? ViewGroup)?.removeView(view) }
        try { hidden?.onCustomViewHidden() } finally { notify?.invoke() }
    }
}

@Composable
internal fun ReaderViewLifecycle(view: ReaderWebView?, primary: Boolean) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Adjacent pages must keep rendering while the activity is visible. Pausing
    // their WebViews blanks the incoming page until it crosses the swipe midpoint.
    // Media permission is separate and remains limited to the primary page below.
    DisposableEffect(view, lifecycle) {
        fun updateRendering() {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view?.onResume()
            else view?.onPause()
        }
        val observer = LifecycleEventObserver { _, _ -> updateRendering() }
        lifecycle.addObserver(observer)
        updateRendering()
        onDispose {
            lifecycle.removeObserver(observer)
            view?.onPause()
        }
    }
    DisposableEffect(view, lifecycle, primary) {
        fun update() { view?.setReaderActive(primary && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
        val observer = LifecycleEventObserver { _, _ -> update() }
        lifecycle.addObserver(observer)
        update()
        onDispose {
            lifecycle.removeObserver(observer)
            view?.setReaderActive(false)
        }
    }
}
