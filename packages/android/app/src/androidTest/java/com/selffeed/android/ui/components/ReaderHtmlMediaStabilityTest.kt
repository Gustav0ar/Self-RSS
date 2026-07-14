package com.selffeed.android.ui.components

import android.os.SystemClock
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import com.selffeed.android.ui.ReaderAppearance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Device-level regression coverage for the rich reader's media flicker.
 *
 * Images report several intermediate intrinsic sizes while they decode. The
 * reader used to forward every ResizeObserver notification to Compose, which
 * repeatedly resized the WebView and invalidated its media compositor layer.
 * Text stayed stable, but images visibly flashed. This test uses a real WebView
 * and reproduces that burst of layout changes without depending on the network.
 */
class ReaderHtmlMediaStabilityTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun rapidMediaLayoutChangesAreCoalescedAndThenStop() {
        composeRule.runOnUiThread {
            composeRule.activity.setShowWhenLocked(true)
            composeRule.activity.setTurnScreenOn(true)
        }
        val mediaBurstFinished = CountDownLatch(1)
        val heightCallbacks = AtomicInteger(0)
        lateinit var webView: WebView
        val document = buildReaderHtmlDocument(
            html = """
                <p>Stable article text.</p>
                <div id="media-under-test"></div>
            """.trimIndent(),
            colors = ReaderHtmlColors(
                background = "#FFFFFF",
                text = "#111827",
                surface = "#F3F4F6",
                mutedText = "#6B7280",
                link = "#3345B8",
            ),
            appearance = ReaderAppearance(),
        )

        composeRule.setContent {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        webView = this
                        settings.javaScriptEnabled = true
                        addJavascriptInterface(
                            object {
                                @JavascriptInterface
                                fun updateHeight(@Suppress("UNUSED_PARAMETER") height: Float) {
                                    heightCallbacks.incrementAndGet()
                                }

                                @JavascriptInterface
                                fun mediaBurstFinished() {
                                    mediaBurstFinished.countDown()
                                }
                            },
                            "Android",
                        )
                    }
                },
                onRelease = { it.releaseReaderResources() },
            )
        }

        composeRule.waitForIdle()
        composeRule.runOnUiThread {
            webView.loadDataWithBaseURL(
                DefaultReaderDocumentBaseUrl,
                document,
                "text/html",
                "utf-8",
                DefaultReaderDocumentBaseUrl,
            )
        }
        assertTrue(
            "The attached reader WebView did not initialize its document observers",
            awaitReaderDocumentReady(webView),
        )
        SystemClock.sleep(350)
        heightCallbacks.set(0)

        composeRule.runOnUiThread {
            webView.evaluateJavascript(
                """
                    (() => {
                        const media = document.getElementById('media-under-test');
                        let frame = 0;
                        const updates = setInterval(() => {
                            frame += 1;
                            media.style.height = (120 + frame * 18) + 'px';
                            if (frame === 12) {
                                clearInterval(updates);
                                Android.mediaBurstFinished();
                            }
                        }, 10);
                    })();
                """.trimIndent(),
                null,
            )
        }

        assertTrue(
            "Reader HTML did not finish the media layout burst",
            mediaBurstFinished.await(10, TimeUnit.SECONDS),
        )
        SystemClock.sleep(350)
        val callbacksAfterBurst = heightCallbacks.get()
        assertTrue(
            "Expected one coalesced height update (plus at most the fallback check), " +
                "but received $callbacksAfterBurst callbacks for 12 media layout changes",
            callbacksAfterBurst in 1..3,
        )

        SystemClock.sleep(500)
        assertEquals(
            "Height callbacks continued after media layout settled",
            callbacksAfterBurst,
            heightCallbacks.get(),
        )
    }

    private fun awaitReaderDocumentReady(webView: WebView): Boolean {
        val deadline = SystemClock.uptimeMillis() + 30_000
        while (SystemClock.uptimeMillis() < deadline) {
            val resultReceived = CountDownLatch(1)
            val isReady = AtomicBoolean(false)
            webView.post {
                webView.evaluateJavascript(
                    "Boolean(document.getElementById('content-container') && window.SelfFeedApp)",
                ) { result ->
                    isReady.set(result == "true")
                    resultReceived.countDown()
                }
            }
            if (resultReceived.await(2, TimeUnit.SECONDS) && isReady.get()) {
                return true
            }
            SystemClock.sleep(250)
        }
        return false
    }
}
