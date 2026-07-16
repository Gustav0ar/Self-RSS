package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** End-to-end Compose journey for fast adjacent-article reader navigation. */
class ArticleReaderFastSwipeE2eTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun showTestActivityWhileDeviceIsLocked() {
        composeRule.runOnUiThread {
            composeRule.activity.setShowWhenLocked(true)
            composeRule.activity.setTurnScreenOn(true)
        }
    }

    @Test
    fun fastForwardAndBackwardSwipesAlwaysShowPrefetchedContent() {
        val articles = (1..6).map(::article)
        val details = articles.associate { item -> item.id to detail(item) }
        var selected by mutableStateOf(details.getValue("article-1"))
        val displayed = mutableListOf<String>()
        val visible = mutableListOf<String>()

        composeRule.setContent {
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selected.id,
                    onCloseArticle = {},
                    listContent = { androidx.compose.material3.Text("Article list") },
                    detailContent = { _, _ ->
                        ArticleReaderPane(
                            articles = articles,
                            selectedArticle = selected,
                            prefetchedArticles = details,
                            onOpenOriginal = {},
                            onBackToList = {},
                            onArticleSelected = { id -> selected = details.getValue(id) },
                            onVisibleArticleChanged = { id -> visible += id },
                            onArticleDisplayed = { id -> displayed += id },
                            // This regression verifies prefetched page transitions using
                            // Compose-visible reader text; Rich-mode WebView rendering is
                            // covered separately by MainActivityHiltUiTest.
                            preferHtml = false,
                        )
                    },
                )
            }
        }

        (2..6).forEach { index ->
            composeRule.onRoot().performTouchInput { swipeLeft() }
            composeRule.waitUntil(timeoutMillis = 5_000) { selected.id == "article-$index" }
            composeRule.onNodeWithTag("reader-loading-article-$index").assertDoesNotExist()
            composeRule.onNodeWithText("Complete body $index").assertIsDisplayed()
            assertEquals("article-$index", visible.last())
        }
        (5 downTo 1).forEach { index ->
            composeRule.onRoot().performTouchInput { swipeRight() }
            composeRule.waitUntil(timeoutMillis = 5_000) { selected.id == "article-$index" }
            composeRule.onNodeWithTag("reader-loading-article-$index").assertDoesNotExist()
            composeRule.onNodeWithText("Complete body $index").assertIsDisplayed()
            assertEquals("article-$index", visible.last())
        }

        assertEquals("article-1", selected.id)
        assertEquals((1..6).map { "article-$it" } + (5 downTo 1).map { "article-$it" }, displayed)
    }

    @Test
    fun readerContinuesAcrossArticlesAppendedWhileItIsOpen() {
        val allArticles = (1..12).map(::article)
        val details = allArticles.associate { item -> item.id to detail(item) }
        var loadedArticles by mutableStateOf(allArticles.take(8))
        var selected by mutableStateOf(details.getValue("article-1"))

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = loadedArticles,
                    selectedArticle = selected,
                    prefetchedArticles = details,
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = { id -> selected = details.getValue(id) },
                    onVisibleArticleChanged = { id ->
                        if (shouldPrefetchNextReaderPage(id, loadedArticles)) {
                            loadedArticles = allArticles
                        }
                    },
                    preferHtml = false,
                )
            }
        }

        (2..12).forEach { index ->
            composeRule.onRoot().performTouchInput { swipeLeft() }
            composeRule.waitUntil(timeoutMillis = 5_000) { selected.id == "article-$index" }
        }

        composeRule.onNodeWithText("Complete body 12").assertIsDisplayed()
        assertEquals(12, loadedArticles.size)
        assertEquals("article-12", selected.id)
    }

    private fun article(index: Int) = ArticleListItem(
        id = "article-$index",
        feedId = "feed-1",
        feedTitle = "Feed $index",
        title = "Article $index",
        excerpt = "Excerpt $index",
        isRead = false,
    )

    private fun detail(item: ArticleListItem) = ArticleDetail(
        id = item.id,
        feedId = item.feedId,
        guid = item.id,
        title = item.title,
        excerpt = item.excerpt,
        contentText = "Complete body ${item.id.substringAfterLast('-')}",
        hash = "hash-${item.id}",
        feedTitle = item.feedTitle,
        isRead = item.isRead,
    )
}
