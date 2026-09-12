@file:android.annotation.SuppressLint("SetJavaScriptEnabled")

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
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.selffeed.android.ui.utils.isTrustedEmbedUrl
import java.util.UUID

/** One Activity-bound renderer owns its bridge, posted work, document and fullscreen media. */
internal class ReaderWebView(context: Context) : WebView(context) {
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
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (released) return true
                val url = request.url.toString()
                if (!request.isForMainFrame && isTrustedEmbedUrl(url)) return false
                openExternalUrl(context, url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (released || url == "about:blank") return
                val token = documentToken
                evaluateJavascript("window.SelfFeedApp && window.SelfFeedApp.setActive($active); window.postHeight && window.postHeight();", null)
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

            override fun onShowCustomView(view: View?, requestedOrientation: Int, callback: CustomViewCallback?) =
                onShowCustomView(view, callback)

            override fun onHideCustomView() { fullscreen?.close() }
        }
    }

    private fun installHeightBridge(token: String) {
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
        callbacks.removeCallbacksAndMessages(null)
        removeJavascriptInterface("Android")
        installHeightBridge(documentToken)
        loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", baseUrl)
    }

    /** Resuming a view grants permission for a new gesture; it never resumes playback. */
    fun setReaderActive(value: Boolean) {
        if (released || (lifecycleApplied && active == value)) return
        lifecycleApplied = true
        active = value
        if (value) onResume()
        evaluateJavascript("window.SelfFeedApp && window.SelfFeedApp.setActive($value);", null)
        if (!value) {
            runCatching { fullscreen?.close() }
            onPause()
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
        runCatching { evaluateJavascript("window.SelfFeedApp && window.SelfFeedApp.cleanup();", null) }
        runCatching { onPause() }
        runCatching { stopLoading() }
        runCatching { removeJavascriptInterface("Android") }
        runCatching { webChromeClient = null }
        runCatching { webViewClient = WebViewClient() }
        runCatching { loadUrl("about:blank") }
        runCatching { (parent as? ViewGroup)?.removeView(this) }
        runCatching { removeAllViews() }
        runCatching { destroy() }
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
