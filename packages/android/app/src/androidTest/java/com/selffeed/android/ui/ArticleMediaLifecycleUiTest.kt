package com.selffeed.android.ui

import android.os.SystemClock
import android.os.ParcelFileDescriptor
import android.util.Base64
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.components.ReaderWebView
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Playback is observed inside Chromium with local media and actual input gestures. */
class ArticleMediaLifecycleUiTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun primaryPageChangePausesAudioBeforeSelectedDetailChangesAndReturnDoesNotResume() {
        verifyNavigationPause("audio")
    }

    @Test
    fun primaryPageChangePausesVideoBeforeSelectedDetailChangesAndReturnDoesNotResume() {
        verifyNavigationPause("video")
    }

    private fun verifyNavigationPause(type: String) {
        val fixture = showReader(type)
        val reader = mediaReader(fixture)
        play(reader)
        composeRule.onRoot().performTouchInput { swipeLeft() }
        composeRule.waitUntil(5_000) { fixture.visible == "media-2" }
        composeRule.waitUntil(3_000) { paused(reader) }
        composeRule.onRoot().performTouchInput { swipeRight() }
        composeRule.waitUntil(5_000) { fixture.visible == "media-1" }
        assertTrue(paused(reader))
    }

    @Test
    fun backgroundAndHiddenTabPauseVideoAndTextModeReleasesTheRenderer() {
        val fixture = showReader("video")
        val reader = mediaReader(fixture)
        play(reader)
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        composeRule.waitUntil(3_000) { paused(reader) }
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        assertTrue(paused(reader))
        play(reader)
        composeRule.runOnIdle { fixture.windowVisible = false }
        composeRule.waitUntil(3_000) { paused(reader) }
        composeRule.runOnIdle { fixture.windowVisible = true }
        assertTrue(paused(reader))
        composeRule.runOnIdle { fixture.rich = false }
        composeRule.waitUntil(3_000) { reader.released }
        assertEquals(0, composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).count() })
    }

    @Test
    fun rendererCrashRecreatesOnceThenFallsBackWithoutDestroyingTheApp() {
        val fixture = showReader("audio", count = 1)
        val original = mediaReader(fixture)
        // Enrichment keeps the View but replaces remembered document state.
        composeRule.runOnIdle { fixture.extraHtml = "<p id='enriched'>Additional complete content</p>" }
        composeRule.waitUntil(5_000) { javascript(original, "!!document.getElementById('enriched')") == "true" }
        composeRule.waitUntil(5_000) { (fixture.ready["media-1"] ?: 0) >= 2 }
        val readyBeforeCrash = fixture.ready.getValue("media-1")
        composeRule.runOnUiThread { original.loadUrl("chrome://crash") }
        composeRule.waitUntil(15_000) { original.released && (fixture.ready["media-1"] ?: 0) > readyBeforeCrash }
        val replacement = mediaReader(fixture)
        assertTrue(original.released)
        assertTrue(original !== replacement)
        composeRule.runOnUiThread { replacement.loadUrl("chrome://crash") }
        composeRule.waitUntil(5_000) { replacement.released }
        composeRule.onNodeWithTag("reader-text-content").assertIsDisplayed()
        assertEquals(0, composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).count() })
    }

    @Test
    fun fullscreenVideoStopsOnBackgroundAndRestoresWindowOrientation() {
        val fixture = showReader("video", count = 1)
        val reader = mediaReader(fixture)
        val orientation = composeRule.activity.requestedOrientation
        play(reader)
        tapDocumentButton(reader, "document.getElementById('fixture-media').requestFullscreen()", fullscreen = true)
        composeRule.waitUntil(5_000) { javascript(reader, "!!document.fullscreenElement") == "true" }
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        composeRule.waitUntil(3_000) { paused(reader) }
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        composeRule.waitUntil(5_000) { javascript(reader, "!!document.fullscreenElement") == "false" }
        assertTrue(paused(reader))
        composeRule.waitUntil(3_000) { composeRule.activity.requestedOrientation == orientation }
        assertEquals(orientation, composeRule.activity.requestedOrientation)
    }

    @Test
    fun adjacentRendererWindowIsBoundedAndClosingDisposesEveryView() {
        val fixture = showReader("audio", count = 8)
        mediaReader(fixture)
        val seen = mutableSetOf<ReaderWebView>()
        repeat(7) { index ->
            seen += composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).filterIsInstance<ReaderWebView>().toList() }
            composeRule.onRoot().performTouchInput { swipeLeft() }
            composeRule.waitUntil(5_000) { fixture.visible == "media-${index + 2}" }
            val count = composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).count() }
            assertTrue("At most three live renderers, found $count", count <= 3)
        }
        seen += composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).filterIsInstance<ReaderWebView>().toList() }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val target = instrumentation.targetContext.packageName
        check(target == "com.selffeed.android.devicetest")
        ParcelFileDescriptor.AutoCloseInputStream(
            instrumentation.uiAutomation.executeShellCommand("am send-trim-memory $target RUNNING_LOW"),
        ).use { stream -> check(stream.bufferedReader().readText().isBlank()) }
        composeRule.waitUntil(5_000) {
            composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).count() == 1 }
        }
        composeRule.runOnIdle { fixture.show = false }
        composeRule.waitUntil(3_000) { seen.all { it.released } }
        assertEquals(0, composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).count() })
    }

    private class Fixture {
        var visible by mutableStateOf("media-1")
        var windowVisible by mutableStateOf(true)
        var rich by mutableStateOf(true)
        var show by mutableStateOf(true)
        var extraHtml by mutableStateOf("")
        val ready = ConcurrentHashMap<String, Int>()
    }

    private fun showReader(type: String, count: Int = 2): Fixture {
        val fixture = Fixture()
        val asset = if (type == "audio") "tone.wav" else "motion.mp4"
        val mime = if (type == "audio") "audio/wav" else "video/mp4"
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("android-review/$asset").use { it.readBytes() }
        val source = "data:$mime;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        val items = (1..count).map { ArticleListItem(id = "media-$it", feedId = "local", feedTitle = "Local", title = "Media $it", isRead = false) }
        val details = items.associate { item ->
            item.id to ArticleDetail(
                id = item.id, feedId = item.feedId, guid = item.id, canonicalUrl = null,
                title = item.title, excerpt = "Local playback fixture",
                contentHtml = if (item.id == "media-1") "<p>Local playback fixture</p><$type id='fixture-media' controls loop src='$source'></$type>" else "<p>Second local page</p>",
                contentText = "Local playback fixture", heroImageUrl = null,
                publishedAt = null, fetchedAt = "2026-01-01T00:00:00Z", hash = item.id,
                feedTitle = item.feedTitle, isRead = false,
            )
        }
        composeRule.setContent {
            SelfFeedTheme {
                if (fixture.show) ArticleReaderPane(
                    articles = items, selectedArticle = details.getValue("media-1").let {
                        it.copy(contentHtml = it.contentHtml + fixture.extraHtml)
                    },
                    isVisible = fixture.windowVisible, preferHtml = fixture.rich,
                    onPreferHtmlChanged = { fixture.rich = it },
                    prefetchedArticles = details, onOpenOriginal = {}, onBackToList = {},
                    // Hold the selected detail at A while the pager advances to B.
                    onArticleSelected = {}, onVisibleArticleChanged = { fixture.visible = it },
                    onArticleBodyReady = { fixture.ready.merge(it, 1, Int::plus) },
                )
            }
        }
        return fixture
    }

    private fun mediaReader(fixture: Fixture): ReaderWebView {
        composeRule.waitUntil(15_000) { (fixture.ready["media-1"] ?: 0) > 0 }
        val views = composeRule.runOnIdle { webViews(composeRule.activity.window.decorView).toList() }
        return views.first { javascript(it, "!!document.getElementById('fixture-media')") == "true" } as ReaderWebView
    }

    private fun play(view: WebView) {
        tapDocumentButton(view, "document.getElementById('fixture-media').play()")
        composeRule.waitUntil(5_000) {
            javascript(view, "!document.getElementById('fixture-media').paused && document.getElementById('fixture-media').currentTime > 0") == "true"
        }
    }

    private fun paused(view: WebView): Boolean = javascript(view, "document.getElementById('fixture-media').paused") == "true"

    private fun tapDocumentButton(view: WebView, action: String, fullscreen: Boolean = false) {
        val id = if (fullscreen) "fixture-fullscreen" else "fixture-play"
        val left = if (fullscreen) 170 else 0
        javascript(view, """
            var button = document.getElementById('$id') || document.createElement('button');
            button.id = '$id';
            button.textContent = 'Local media action';
            button.style.cssText = 'position:fixed;top:0;left:${left}px;width:160px;height:48px;z-index:2147483647';
            window.fixtureGesture = { clicked: false, completed: false, error: null };
            button.onclick = function() {
                window.fixtureGesture.clicked = true;
                try {
                    Promise.resolve($action)
                        .then(function() { window.fixtureGesture.completed = true; })
                        .catch(function(error) { window.fixtureGesture.error = String(error); });
                } catch (error) { window.fixtureGesture.error = String(error); }
            };
            document.body.prepend(button);
        """.trimIndent())
        composeRule.waitForIdle()
        val painted = CountDownLatch(1)
        composeRule.runOnUiThread {
            view.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { painted.countDown() }
            })
        }
        check(painted.await(5, TimeUnit.SECONDS)) { "Media action was not drawn by Chromium" }
        val point = JSONArray(javascript(view, "(function(){var r=document.getElementById('$id').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()"))
        assertEquals("Media gesture target is obscured", "\"$id\"", javascript(
            view, "document.elementFromPoint(${point.getDouble(0)}, ${point.getDouble(1)}).id",
        ))
        val location = IntArray(2)
        composeRule.runOnUiThread { view.getLocationOnScreen(location) }
        val density = composeRule.activity.resources.displayMetrics.density
        val x = location[0] + point.getDouble(0).toFloat() * density
        val y = location[1] + point.getDouble(1).toFloat() * density
        val time = SystemClock.uptimeMillis()
        for (actionType in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(time, SystemClock.uptimeMillis(), actionType, x, y, 0)
            try { InstrumentationRegistry.getInstrumentation().sendPointerSync(event) } finally { event.recycle() }
        }
        try {
            composeRule.waitUntil(5_000) {
                val gesture = JSONObject(javascript(view, "window.fixtureGesture"))
                check(gesture.isNull("error")) { "Media action rejected: ${gesture.getString("error")}" }
                gesture.getBoolean("completed")
            }
        } catch (failure: Exception) {
            throw AssertionError(
                "Media gesture $id: ${javascript(view, "window.fixtureGesture")}, " +
                    "released=${(view as? ReaderWebView)?.released}, activity=${composeRule.activity}",
                failure,
            )
        }
    }

    private fun javascript(view: WebView, script: String): String {
        val complete = CountDownLatch(1)
        var result = ""
        composeRule.runOnUiThread { view.evaluateJavascript(script) { result = it; complete.countDown() } }
        check(complete.await(3, TimeUnit.SECONDS)) { "Chromium callback timed out" }
        return result
    }

    private fun webViews(view: View): Sequence<WebView> = sequence {
        if (view is WebView) yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(webViews(view.getChildAt(index)))
    }
}
