package com.selffeed.android.ui.components

import android.content.Context
import android.net.Uri
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.local.OfflineMediaCache
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowWebView

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], shadows = [ReaderWebViewTest.FailingCleanupShadow::class])
class ReaderWebViewTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun disposalDetachesAndDestroysOnceEvenWhenTheRendererRejectsCleanup() {
        val view = ReaderWebView(context)
        val parent = FrameLayout(context).apply { addView(view) }
        view.releaseReaderResources()
        view.releaseReaderResources()
        assertTrue(view.released)
        assertNull(view.parent)
        assertEquals(0, parent.childCount)
        assertEquals(1, Shadow.extract<FailingCleanupShadow>(view).destroyCount)
        assertTrue(
            view.webViewClient.onRenderProcessGone(
                view,
                io.mockk.mockk<RenderProcessGoneDetail>(relaxed = true),
            ),
        )
    }

    @Test
    fun fullscreenCallbackAndOwnerAreReleasedOnceEvenIfCallbackThrows() {
        val view = View(context)
        val parent = FrameLayout(context).apply { addView(view) }
        var hidden = 0
        var closed = 0
        val media = ReaderFullscreenMedia(view, WebChromeClient.CustomViewCallback {
            hidden++
            throw IllegalStateException("Dead fullscreen client")
        }) { closed++ }
        runCatching { media.close() }
        media.close()
        assertEquals(1, hidden)
        assertEquals(1, closed)
        assertEquals(0, parent.childCount)
    }

    @Test
    fun synchronouslyRejectedFullscreenDoesNotRetainTheClosedOwner() {
        val view = ReaderWebView(context)
        var shown = 0
        var hidden = 0
        view.onFullscreen = { media -> if (media != null) { shown++; media.close() } }
        view.setReaderActive(true)
        repeat(2) {
            view.webChromeClient!!.onShowCustomView(View(context), WebChromeClient.CustomViewCallback { hidden++ })
        }
        assertEquals(2, shown)
        assertEquals(2, hidden)
        view.releaseReaderResources()
        assertEquals(2, hidden)
    }

    @Test
    fun cachedSubresourceImageIsServedOfflineThroughShouldInterceptRequest() = runBlocking {
        val imageBytes = byteArrayOf(7, 8, 9, 10)
        val cacheDir = File(context.cacheDir, "reader-webview-test-${System.nanoTime()}").apply { mkdirs() }
        try {
            val client = OkHttpClient.Builder()
                .addInterceptor { chain ->
                    Response.Builder()
                        .request(chain.request())
                        .protocol(Protocol.HTTP_1_1)
                        .code(200)
                        .message("OK")
                        .header("Content-Type", "image/png")
                        .body(imageBytes.toResponseBody("image/png".toMediaType()))
                        .build()
                }
                .build()
            val mediaCache = OfflineMediaCache(cacheDir, client)
            val imageUrl = "https://cdn.example.com/inline.png"
            mediaCache.prefetch(imageUrl)

            val stats = mediaCache.stats()
            assertEquals(1, stats.fileCount)
            assertEquals(imageBytes.size.toLong(), stats.totalBytes)
            assertNotNull(mediaCache.cachedFile(imageUrl))

            val view = ReaderWebView(context, mediaCache)
            val response = view.webViewClient.shouldInterceptRequest(
                view,
                subresourceRequest(imageUrl, isMainFrame = false),
            )
            assertNotNull(response)
            assertEquals("image/png", response!!.mimeType)
            assertEquals(imageBytes.toList(), response.data.readBytes().toList())

            assertNull(
                view.webViewClient.shouldInterceptRequest(
                    view,
                    subresourceRequest(imageUrl, isMainFrame = true),
                ),
            )
            // Cache miss must return null immediately without blocking Chromium's IO thread.
            assertNull(
                view.webViewClient.shouldInterceptRequest(
                    view,
                    subresourceRequest("https://cdn.example.com/uncached.png", isMainFrame = false),
                ),
            )
            view.releaseReaderResources()
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    private fun subresourceRequest(url: String, isMainFrame: Boolean): WebResourceRequest =
        object : WebResourceRequest {
            override fun getUrl(): Uri = Uri.parse(url)
            override fun isForMainFrame(): Boolean = isMainFrame
            override fun isRedirect(): Boolean = false
            override fun hasGesture(): Boolean = false
            override fun getMethod(): String = "GET"
            override fun getRequestHeaders(): MutableMap<String, String> =
                mutableMapOf("Accept" to "image/webp,image/*,*/*;q=0.8")
        }

    @Implements(WebView::class)
    class FailingCleanupShadow : ShadowWebView() {
        var destroyCount = 0
        @Implementation fun stopLoading() { throw IllegalStateException("Renderer gone") }
        @Implementation override fun destroy() { destroyCount++; super.destroy() }
    }
}
