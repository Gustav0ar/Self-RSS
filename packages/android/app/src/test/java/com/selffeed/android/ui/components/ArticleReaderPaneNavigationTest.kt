package com.selffeed.android.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleMedia
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

    @Test
    fun titleOpensOriginalArticleWithoutDedicatedButton() {
        var openedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-1", "First Article")),
                    selectedArticle = sampleDetail(
                        id = "article-1",
                        title = "First Article",
                        isRead = false,
                        canonicalUrl = "https://example.com/articles/first",
                    ),
                    onOpenOriginal = { openedArticleId = it.id },
                    onBackToList = {},
                    onArticleSelected = {},
                )
            }
        }

        composeRule.onNodeWithText("Open original article").assertDoesNotExist()
        composeRule.onNodeWithText("First Article").performClick()

        assertEquals("article-1", openedArticleId)
    }

    @Test
    fun latePartialDetailUpdateDoesNotRemoveRenderedBody() {
        val completeBody = "The complete reader body remains visible after a late partial refresh."
        val complete = sampleDetail(
            id = "article-1",
            title = "First Article",
            isRead = false,
            contentText = completeBody,
            contentVersion = 2,
        )
        val partial = sampleDetail(
            id = "article-1",
            title = "First Article",
            isRead = false,
            contentText = "The complete reader body",
            contentVersion = 1,
        )
        var displayedArticle by mutableStateOf(complete)

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-1", "First Article")),
                    selectedArticle = displayedArticle,
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = {},
                )
            }
        }

        composeRule.onNodeWithText(completeBody).assertIsDisplayed()
        composeRule.runOnUiThread { displayedArticle = partial }
        composeRule.onNodeWithText(completeBody).assertIsDisplayed()
    }

    @Test
    fun textModeDoesNotRenderExtractedMedia() {
        val imageUrl = "https://example.com/hero.jpg"
        val initial = sampleDetail(
            id = "article-1",
            title = "First Article",
            isRead = false,
            contentHtml = "<p>Text mode body.</p><img src=\"$imageUrl\" />",
            contentText = "Text mode body.",
            media = listOf(sampleMedia("initial-media", imageUrl)),
        )

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-1", "First Article")),
                    selectedArticle = initial,
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = {},
                    preferHtml = false,
                )
            }
        }

        composeRule.onNodeWithTag("reader-text-content").assertIsDisplayed()
        composeRule.onNodeWithText("Text mode body.").assertIsDisplayed()
        composeRule.onNodeWithText("Media").assertDoesNotExist()
        composeRule.onAllNodesWithContentDescription("Article image").assertCountEquals(0)
    }

    @Test
    fun htmlOnlyArticleStillOffersCleanTextMode() {
        val article = sampleDetail(
            id = "article-1",
            title = "HTML-only Article",
            isRead = false,
            contentHtml = "<p>HTML-only text remains available in Text mode.</p>",
            contentText = null,
        )

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-1", "HTML-only Article")),
                    selectedArticle = article,
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = {},
                    preferHtml = false,
                )
            }
        }

        composeRule.onNodeWithText("Text").assertIsDisplayed().assertIsSelected()
        composeRule.onNodeWithText("HTML-only text remains available in Text mode.").assertIsDisplayed()
    }

    @Test
    fun richPreferenceWaitsForTheNextArticleHtmlInsteadOfShowingTextMode() {
        val pendingText = "This text must not flash while Rich is selected."
        val pending = sampleDetail(
            id = "article-2",
            title = "Second Article",
            isRead = false,
            contentText = pendingText,
        )
        var displayedArticle by mutableStateOf(pending)
        var preferHtml by mutableStateOf(true)

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = listOf(sampleArticle("article-2", "Second Article")),
                    selectedArticle = displayedArticle,
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = {},
                    preferHtml = preferHtml,
                    onPreferHtmlChanged = { preferHtml = it },
                )
            }
        }

        composeRule.onNodeWithTag("reader-rich-loading").assertIsDisplayed()
        composeRule.onNodeWithText(pendingText).assertDoesNotExist()
        composeRule.runOnUiThread {
            displayedArticle = pending.copy(
                contentHtml = "<p>Rich content is ready.</p>",
                contentVersion = 2,
                fetchedAt = "2026-07-13T00:00:00Z",
            )
        }
        composeRule.onNodeWithText("Rich").assertIsDisplayed().assertIsSelected()
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

    private fun sampleDetail(
        id: String,
        title: String,
        isRead: Boolean,
        canonicalUrl: String? = null,
        contentHtml: String? = null,
        contentText: String? = "Body for $title",
        contentVersion: Int = 1,
        media: List<ArticleMedia> = emptyList(),
    ): ArticleDetail =
        ArticleDetail(
            id = id,
            feedId = "feed-1",
            guid = id,
            canonicalUrl = canonicalUrl,
            title = title,
            excerpt = "Excerpt for $title",
            contentHtml = contentHtml,
            contentText = contentText,
            heroImageUrl = null,
            publishedAt = null,
            fetchedAt = null,
            hash = "hash-$id",
            feedTitle = "Test Feed",
            feedFaviconUrl = null,
            feedSiteUrl = null,
            media = media,
            isRead = isRead,
            isEnriched = false,
            contentVersion = contentVersion,
        )

    private fun sampleMedia(id: String, url: String) = ArticleMedia(
        id = id,
        articleId = "article-1",
        type = "image",
        provider = "unknown",
        url = url,
        position = 0,
    )
}
