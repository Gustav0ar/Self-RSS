package com.selffeed.android.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ArticleReaderPaneNavigationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun swipeNavigatesWhenSelectedArticleIsMissingFromLiveSnapshot() {
        var selectedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-2", "Second Article")),
                    selectedArticle = sampleDetail("article-1", "First Article", isRead = true),
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = { selectedArticleId = it },
                )
            }
        }

        composeRule.onNodeWithText("First Article").assertIsDisplayed()
        composeRule.onRoot().performTouchInput { swipeLeft() }
        composeRule.waitUntil(timeoutMillis = 5_000) {
            selectedArticleId == "article-2"
        }

        assertEquals("article-2", selectedArticleId)
    }

    @Test
    fun detailViewReportsArticleDisplayedAfterItIsRendered() {
        var displayedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-1", "First Article")),
                    selectedArticle = sampleDetail("article-1", "First Article", isRead = false),
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = {},
                    onArticleDisplayed = { displayedArticleId = it },
                )
            }
        }

        composeRule.onNodeWithText("First Article").assertIsDisplayed()
        composeRule.waitUntil(timeoutMillis = 5_000) {
            displayedArticleId == "article-1"
        }

        assertEquals("article-1", displayedArticleId)
    }

    private fun sampleArticle(id: String, title: String): ArticleListItem =
        ArticleListItem(
            id = id,
            feedId = "feed-1",
            feedTitle = "Test Feed",
            title = title,
            excerpt = "Excerpt for $title",
            isRead = false,
        )

    private fun sampleDetail(id: String, title: String, isRead: Boolean): ArticleDetail =
        ArticleDetail(
            id = id,
            feedId = "feed-1",
            guid = id,
            canonicalUrl = null,
            title = title,
            excerpt = "Excerpt for $title",
            contentHtml = null,
            contentText = "Body for $title",
            heroImageUrl = null,
            publishedAt = null,
            fetchedAt = null,
            hash = "hash-$id",
            feedTitle = "Test Feed",
            feedFaviconUrl = null,
            feedSiteUrl = null,
            media = emptyList(),
            isRead = isRead,
            isEnriched = false,
        )
}
