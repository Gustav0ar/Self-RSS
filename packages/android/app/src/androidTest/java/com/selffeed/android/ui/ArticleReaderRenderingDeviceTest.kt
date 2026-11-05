package com.selffeed.android.ui

import android.content.ComponentCallbacks2
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.test.platform.app.InstrumentationRegistry
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.theme.SelfFeedTheme
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Pixel checks use the actual window, including Chromium's hardware rendering. */
class ArticleReaderRenderingDeviceTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun failedFetchReplacesLoadingWithAnActionableRetry() {
        var error by mutableStateOf<String?>("Connection unavailable")
        composeRule.setContent {
            SelfFeedTheme(darkTheme = true) {
                Surface(Modifier.fillMaxSize()) {
                    ArticleReaderPane(
                        articles = emptyList(),
                        selectedArticle = ArticleDetail(
                            id = "failed", feedId = "feed", guid = "failed", title = "Uncached article",
                            feedTitle = "Feed", hash = "failed", isRead = true,
                        ),
                        loadError = error,
                        onOpenOriginal = {}, onBackToList = {}, onArticleSelected = { error = null },
                    )
                }
            }
        }
        composeRule.onNodeWithTag("reader-load-error").assertIsDisplayed()
        composeRule.onNodeWithTag("reader-rich-loading").assertDoesNotExist()
        composeRule.onNodeWithText("Retry loading").performClick()
        composeRule.onNodeWithTag("reader-load-error").assertDoesNotExist()
        composeRule.onNodeWithTag("reader-rich-loading").assertIsDisplayed()
    }

    @Test
    fun richBodyDoesNotJumpWhenItsFirstFrameBecomesReady() {
        val tops = mutableListOf<Int>()
        val listener = ViewTreeObserver.OnPreDrawListener {
            findWebView(composeRule.activity.window.decorView)?.let { view ->
                val location = IntArray(2)
                view.getLocationOnScreen(location)
                if (view.width > 0 && location[1] > 0) tops.add(location[1])
            }
            true
        }
        composeRule.runOnUiThread {
            composeRule.activity.window.decorView.viewTreeObserver.addOnPreDrawListener(listener)
        }
        var ready = false
        val article = ArticleDetail(
            id = "loading", feedId = "feed", guid = "loading", title = "An article with a rich body",
            feedTitle = "Feed", hash = "loading", isRead = true,
            contentHtml = (1..20).joinToString("") { "<p>Readable paragraph $it.</p>" },
        )
        try {
            composeRule.setContent {
                SelfFeedTheme(darkTheme = true) {
                    Surface(Modifier.fillMaxSize()) {
                        ArticleReaderPane(
                            articles = emptyList(), selectedArticle = article,
                            onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                            onArticleBodyReady = { ready = true },
                        )
                    }
                }
            }
            composeRule.waitUntil(10_000) { ready }
            composeRule.runOnIdle {
                assertTrue("The real WebView must have been drawn", tops.isNotEmpty())
                assertEquals("Removing the placeholder must not move the rich body: $tops", 1, tops.distinct().size)
            }
        } finally {
            composeRule.runOnUiThread {
                composeRule.activity.window.decorView.viewTreeObserver.removeOnPreDrawListener(listener)
            }
        }
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findWebView(view.getChildAt(index))?.let { return it }
            }
        }
        return null
    }

    @Test
    fun richPagesStayPaintedDuringSwipesAndKeepTheirEdgesBlack() {
        val image = Bitmap.createBitmap(600, 400, Bitmap.Config.ARGB_8888)
        image.eraseColor(Color.BLUE)
        val imageBytes = ByteArrayOutputStream()
        image.compress(Bitmap.CompressFormat.PNG, 100, imageBytes)
        image.recycle()
        val imageUrl = "data:image/png;base64," + Base64.encodeToString(imageBytes.toByteArray(), Base64.NO_WRAP)
        val articles = (1..4).map { index ->
            ArticleListItem(
                id = "article-$index", feedId = "feed", feedTitle = "Feed $index",
                title = "Article $index", isRead = true,
            )
        }
        val details = articles.associate { item ->
            item.id to ArticleDetail(
                id = item.id, feedId = item.feedId, guid = item.id,
                title = item.title, feedTitle = item.feedTitle, hash = item.id, isRead = true,
                contentHtml = if (item.id == "article-1") "<p>A short first article.</p>" else
                    "<img src='$imageUrl' width='600' height='400' />" +
                        (1..20).joinToString("") { "<p>Readable paragraph $it for ${item.title}.</p>" },
            )
        }
        var selected by mutableStateOf(details.getValue("article-1"))
        val ready = ConcurrentHashMap.newKeySet<String>()
        composeRule.setContent {
            SelfFeedTheme(darkTheme = true) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ArticleListDetailNavigation(
                        modifier = Modifier.fillMaxSize(),
                        selectedArticleId = selected.id,
                        onCloseArticle = {},
                        listContent = { androidx.compose.material3.Text("Article list") },
                        detailContent = { _, _ ->
                            ArticleReaderPane(
                                articles = articles, selectedArticle = selected, prefetchedArticles = details,
                                onOpenOriginal = {}, onBackToList = {},
                                onArticleSelected = { selected = details.getValue(it) },
                                onArticleBodyReady = { ready.add(it) },
                            )
                        },
                    )
                }
            }
        }
        composeRule.waitUntil(10_000) { ready.containsAll(listOf("article-1", "article-2")) }
        // UI_HIDDEN is a normal background notification, not low memory.
        composeRule.runOnUiThread {
            composeRule.activity.application.onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN)
        }
        assertBlackReaderEdges()
        composeRule.onRoot().performTouchInput {
            down(Offset(width * 0.9f, height * 0.5f))
            moveTo(Offset(width * 0.8f, height * 0.5f), delayMillis = 32)
            moveTo(Offset(width * 0.6f, height * 0.5f), delayMillis = 160)
        }
        assertIncomingTitleIsPainted()
        assertIncomingImageIsPainted()
        composeRule.onRoot().performTouchInput { cancel() }
        composeRule.waitForIdle()
        for (index in 2..4) {
            composeRule.onRoot().performTouchInput { swipeLeft() }
            composeRule.waitUntil(10_000) { selected.id == "article-$index" && ready.contains(selected.id) }
            assertBlackReaderEdges()
        }
        for (index in 3 downTo 1) {
            composeRule.onRoot().performTouchInput { swipeRight() }
            composeRule.waitUntil(10_000) { selected.id == "article-$index" && ready.contains(selected.id) }
            assertBlackReaderEdges()
        }
    }

    @Test
    fun richSwipesDoNotBuildHiddenTextArticles() {
        val items = (1..5).map { index ->
            ArticleListItem(id = "article-$index", feedId = "feed", feedTitle = "Feed", title = "Article $index", isRead = true)
        }
        val details = items.associate { item ->
            item.id to ArticleDetail(
                id = item.id, feedId = item.feedId, guid = item.id, hash = item.id,
                title = item.title, feedTitle = "Feed", isRead = true,
                contentHtml = (1..150).joinToString("") { "<p>Long article paragraph $it for ${item.id}.</p>" },
            )
        }
        var selected by mutableStateOf(details.getValue("article-1"))
        val ready = ConcurrentHashMap.newKeySet<String>()
        composeRule.setContent {
            SelfFeedTheme(darkTheme = true) {
                Surface(Modifier.fillMaxSize()) {
                    ArticleReaderPane(
                        articles = items, selectedArticle = selected, prefetchedArticles = details,
                        onOpenOriginal = {}, onBackToList = {},
                        onArticleSelected = { selected = details.getValue(it) },
                        onArticleBodyReady = { ready.add(it) },
                    )
                }
            }
        }
        composeRule.waitUntil(10_000) { ready.containsAll(listOf("article-1", "article-2")) }
        for (index in 2..4) {
            composeRule.onRoot().performTouchInput {
                down(Offset(width * 0.9f, height * 0.5f))
                moveTo(Offset(width * 0.7f, height * 0.5f), delayMillis = 80)
                moveTo(Offset(width * 0.2f, height * 0.5f), delayMillis = 350)
            }
            composeRule.waitForIdle()
            composeRule.onAllNodesWithTag("reader-text-content", useUnmergedTree = true).assertCountEquals(0)
            composeRule.onRoot().performTouchInput { up() }
            composeRule.waitUntil(10_000) { selected.id == "article-$index" }
        }
    }

    private fun assertBlackReaderEdges() {
        composeRule.waitForIdle()
        val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try {
            for (x in listOf(2, screenshot.width - 3)) {
                for (y in screenshot.height / 4 until screenshot.height * 3 / 4 step 20) {
                    assertEquals("Offscreen page painted the reader edge at ($x, $y)", Color.BLACK, screenshot.getPixel(x, y))
                }
            }
        } finally {
            screenshot.recycle()
        }
    }

    private fun assertIncomingTitleIsPainted() {
        composeRule.waitForIdle()
        val title = composeRule.onNodeWithText("Article 2").fetchSemanticsNode().boundsInWindow
        val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try {
            var textPixels = 0
            for (x in title.left.toInt().coerceAtLeast(0) until title.right.toInt().coerceAtMost(screenshot.width)) {
                for (y in title.top.toInt().coerceAtLeast(0) until title.bottom.toInt().coerceAtMost(screenshot.height)) {
                    val pixel = screenshot.getPixel(x, y)
                    if (Color.red(pixel) > 180 && Color.green(pixel) > 180 && Color.blue(pixel) > 180) textPixels++
                }
            }
            assertTrue("The incoming title must be painted during the drag, found $textPixels text pixels in $title", textPixels > 30)
        } finally {
            screenshot.recycle()
        }
    }

    private fun assertIncomingImageIsPainted() {
        val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try {
            var bluePixels = 0
            for (x in screenshot.width / 2 until screenshot.width step 4) {
                for (y in screenshot.height / 4 until screenshot.height * 3 / 4 step 4) {
                    val pixel = screenshot.getPixel(x, y)
                    if (Color.blue(pixel) > 200 && Color.red(pixel) < 30 && Color.green(pixel) < 30) bluePixels++
                }
            }
            assertTrue("The incoming article must keep its loaded image during the drag; found $bluePixels blue pixels", bluePixels > 100)
        } finally {
            screenshot.recycle()
        }
    }
}
