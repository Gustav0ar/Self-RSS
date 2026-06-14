package com.selffeed.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.screens.ArticleTabActions
import com.selffeed.android.ui.screens.ArticleTabState
import com.selffeed.android.ui.screens.ArticlesTab
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ArticlesTabUiTest {
    @get:Rule
    val composeRule = createComposeRule()

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

        composeRule.onNodeWithText("Load more").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals(1, loadMoreCount)
        }
    }

    private fun sampleArticle(id: String, title: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = title,
        excerpt = "Excerpt",
        isRead = false,
    )
}
