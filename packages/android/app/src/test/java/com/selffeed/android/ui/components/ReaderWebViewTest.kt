package com.selffeed.android.ui.components

import android.content.Context
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
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

    @Implements(WebView::class)
    class FailingCleanupShadow : ShadowWebView() {
        var destroyCount = 0
        @Implementation fun stopLoading() { throw IllegalStateException("Renderer gone") }
        @Implementation override fun destroy() { destroyCount++; super.destroy() }
    }
}
