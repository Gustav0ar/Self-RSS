package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.screens.ArticleTabActions
import com.selffeed.android.ui.screens.ArticleTabState
import com.selffeed.android.ui.screens.ArticlesTab
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ArticlesTabUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun articlesTab_showsRowsAndTriggersActions() {
        var openedArticleId: String? = null
        var loadMoreCount = 0

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = listOf(sampleArticle("article-1", "Visible Article")),
                        selectedArticleId = null,
                        hasMoreArticles = true,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = { loadMoreCount += 1 },
                        onOpenArticle = { openedArticleId = it },
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        composeRule.onNodeWithText("Visible Article").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals("article-1", openedArticleId)
        }

        composeRule.waitForIdle()
        val loadMoreCountBeforeClick = loadMoreCount
        composeRule.onNodeWithText("Load more").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertTrue(loadMoreCount > loadMoreCountBeforeClick)
        }
    }

    @Test
    fun articlesTab_showsRefreshIndicatorWithoutHidingCurrentRows() {
        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = listOf(sampleArticle("article-1", "Visible Article")),
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = true,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = {},
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        composeRule.onNodeWithText("Visible Article").assertIsDisplayed()
        composeRule
            .onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertIsDisplayed()
    }

    @Test
    fun articlesTab_keepsTopPositionWhenRefreshPrependsArticles() {
        val initialArticles = (1..40).map { index ->
            sampleArticle("old-$index", "Old Article $index")
        }
        var updateState: (ArticleTabState) -> Unit = {}

        composeRule.setContent {
            var state by remember {
                mutableStateOf(
                    ArticleTabState(
                        articles = initialArticles,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                )
            }
            updateState = { state = it }

            SelfFeedTheme {
                ArticlesTab(
                    state = state,
                    actions = noOpArticleActions(),
                )
            }
        }

        composeRule.onNodeWithText("Old Article 1").assertIsDisplayed()

        composeRule.runOnIdle {
            updateState(
                ArticleTabState(
                    articles = initialArticles,
                    selectedArticleId = null,
                    hasMoreArticles = false,
                    loadingMoreArticles = false,
                    isSyncingFeeds = true,
                ),
            )
        }
        composeRule.waitForIdle()
        composeRule.runOnIdle {
            updateState(
                ArticleTabState(
                    articles = listOf(sampleArticle("fresh-1", "Fresh Article")) + initialArticles,
                    selectedArticleId = null,
                    hasMoreArticles = false,
                    loadingMoreArticles = false,
                    isSyncingFeeds = false,
                ),
            )
        }
        composeRule.waitForIdle()

        composeRule.onNodeWithText("Fresh Article").assertIsDisplayed()
    }

    private fun noOpArticleActions(): ArticleTabActions = ArticleTabActions(
        onRefresh = {},
        onLoadMore = {},
        onOpenArticle = {},
        onToggleRead = { _, _ -> },
        onArticleSnapshot = {},
    )

    private fun sampleArticle(id: String, title: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = title,
        excerpt = "Excerpt",
        isRead = false,
    )
}
