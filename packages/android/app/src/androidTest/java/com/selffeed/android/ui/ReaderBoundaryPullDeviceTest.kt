package com.selffeed.android.ui

import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.platform.app.InstrumentationRegistry
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.theme.SelfFeedTheme
import java.util.concurrent.ConcurrentHashMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ReaderBoundaryPullDeviceTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private var selected by mutableStateOf("article-1")
    private var endConfirmed by mutableStateOf(true)
    private val ready = ConcurrentHashMap.newKeySet<String>()

    @Test
    fun firstAndLastPullReturnCleanlyWhileIntermediatePagesNavigate() {
        showReader(4)
        assertBoundaryPull(right = true)
        for (index in 2..4) {
            rule.onRoot().performTouchInput { swipeLeft(durationMillis = if (index % 2 == 0) 150 else 650) }
            waitForArticle(index)
        }
        assertBoundaryPull(right = false)
        for (index in 3 downTo 1) {
            rule.onRoot().performTouchInput { swipeRight(durationMillis = if (index % 2 == 0) 650 else 150) }
            waitForArticle(index)
        }
        assertBoundaryPull(right = true, cancel = true)
    }

    @Test
    fun pendingPaginationDoesNotPullButConfirmedEndDoes() {
        endConfirmed = false
        showReader(1)
        val origin = titleLeft()
        holdPull(right = false)
        assertEquals(origin, titleLeft(), 0.5f)
        rule.onRoot().performTouchInput { up() }
        rule.runOnUiThread { endConfirmed = true }
        assertBoundaryPull(right = false)
        assertBoundaryPull(right = true)
    }

    @Test
    fun rtlSingleArticleSupportsBothBoundariesAndReversal() {
        showReader(1, LayoutDirection.Rtl)
        assertBoundaryPull(right = true)
        assertBoundaryPull(right = false, cancel = true)
        val origin = titleLeft()
        holdPull(right = true)
        rule.onRoot().performTouchInput {
            moveTo(Offset(width * 0.15f, height * 0.6f), delayMillis = 350)
        }
        assertTrue("Reversing the gesture must release the previous edge", titleLeft() < origin)
        rule.onRoot().performTouchInput { up() }
        assertEquals(origin, titleLeft(), 0.5f)
    }

    private fun showReader(count: Int, direction: LayoutDirection = LayoutDirection.Ltr) {
        val articles = (1..count).map { index ->
            ArticleListItem(id = "article-$index", feedId = "feed", feedTitle = "Feed", title = "Article $index", isRead = true)
        }
        val details = articles.associate { item ->
            item.id to ArticleDetail(
                id = item.id, feedId = item.feedId, guid = item.id, hash = item.id,
                title = item.title, feedTitle = "Feed", isRead = true,
                contentHtml = "<p>A complete article for swipe testing.</p>" +
                    "<div style='background:#2255ee;height:220px;width:100%'></div>" +
                    (1..15).joinToString("") { "<p>Article paragraph $it.</p>" },
            )
        }
        rule.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides direction) {
                SelfFeedTheme(darkTheme = true) {
                    Surface(Modifier.fillMaxSize()) {
                        ArticleReaderPane(
                            articles = articles, selectedArticle = details.getValue(selected),
                            prefetchedArticles = details, atFeedEnd = endConfirmed,
                            onOpenOriginal = {}, onBackToList = {},
                            onArticleSelected = { selected = it },
                            onArticleBodyReady = { ready.add(it) },
                        )
                    }
                }
            }
        }
        waitForArticle(1)
    }

    private fun waitForArticle(index: Int) {
        rule.waitUntil(10_000) { selected == "article-$index" && ready.contains(selected) }
        rule.waitForIdle()
    }

    private fun titleLeft() = rule.onNodeWithText("Article ${selected.substringAfterLast('-')}")
        .fetchSemanticsNode().boundsInWindow.left

    private fun holdPull(right: Boolean) {
        rule.onRoot().performTouchInput {
            val start = if (right) 0.35f else 0.65f
            val end = if (right) 0.75f else 0.25f
            down(Offset(width * start, height * 0.6f))
            moveTo(Offset(width * (start + end) / 2, height * 0.6f), delayMillis = 80)
            moveTo(Offset(width * end, height * 0.6f), delayMillis = 240)
        }
        rule.waitForIdle()
    }

    private fun assertBoundaryPull(right: Boolean, cancel: Boolean = false) {
        val article = selected
        val origin = titleLeft()
        holdPull(right)
        val movement = titleLeft() - origin
        assertTrue("Expected a resisted ${if (right) "right" else "left"} pull, got $movement", if (right) movement > 2 else movement < -2)
        val density = rule.activity.resources.displayMetrics.density
        assertTrue("Pull must stay within 22 dp", kotlin.math.abs(movement) <= 22 * density + 1)
        assertBlackExposedEdge(right)
        rule.onRoot().performTouchInput { if (cancel) cancel() else up() }
        rule.waitForIdle()
        assertEquals("Boundary must not select an article", article, selected)
        assertEquals("Spring must return exactly to origin", origin, titleLeft(), 0.5f)
    }

    private fun assertBlackExposedEdge(right: Boolean) {
        val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try {
            val x = if (right) 2 else screenshot.width - 3
            for (y in screenshot.height / 4 until screenshot.height * 3 / 4 step 20) {
                assertEquals("Boundary exposed a non-black strip", Color.BLACK, screenshot.getPixel(x, y))
            }
        } finally {
            screenshot.recycle()
        }
    }
}
