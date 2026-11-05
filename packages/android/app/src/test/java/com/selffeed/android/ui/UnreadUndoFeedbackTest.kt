package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.isDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.paging.PagingData
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.articles.ArticleFlags
import com.selffeed.android.ui.theme.SelfFeedTheme
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en-w411dp-h891dp")
class UnreadUndoFeedbackTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val article = ArticleListItem(
        id = "article", feedId = "feed", feedTitle = "Feed", title = "Article", isRead = false,
    )

    @Test
    fun markingReadDoesNotReplayAsUnreadWhenRowReturns() {
        val requests = mutableListOf<Boolean>()
        showArticles(scrollableRows()) { _, read -> requests += read }
        composeRule.mainClock.autoAdvance = false
        swipeArticle(isRead = false)
        composeRule.mainClock.advanceTimeUntil(3_000) { requests.isNotEmpty() }
        assertEquals(listOf(true), requests)

        // Evict the row while its swipe reset is still in progress.
        composeRule.onNodeWithTag("articles-list").performScrollToIndex(35)
        composeRule.mainClock.advanceTimeByFrame()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("articles-list").performScrollToIndex(0)
        composeRule.mainClock.autoAdvance = true
        composeRule.mainClock.advanceTimeBy(1_000)

        assertEquals("Returning to a completed read swipe must not mark it unread", listOf(true), requests)
        composeRule.onNodeWithContentDescription("Read article: Article, from Feed").assertIsDisplayed()
        composeRule.onNodeWithText("Marked as unread").assertDoesNotExist()
    }

    @Test
    fun completedReadSwipeIsAppliedBeforeRowLeavesTheViewport() {
        val requests = mutableListOf<Boolean>()
        showArticles(scrollableRows()) { _, read -> requests += read }
        composeRule.mainClock.autoAdvance = false
        swipeArticle(isRead = false)
        composeRule.mainClock.advanceTimeUntil(3_000) {
            composeRule.onAllNodesWithContentDescription("Read article: Article, from Feed")
                .fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithTag("articles-list").performScrollToIndex(35)
        composeRule.mainClock.advanceTimeByFrame()
        composeRule.waitForIdle()
        composeRule.mainClock.advanceTimeBy(1_000)

        assertEquals("The completed read swipe must survive the row leaving", listOf(true), requests)
    }

    @Test
    fun unreadUndoExpiresWithoutInteraction() {
        val requests = mutableListOf<Boolean>()
        showArticles(listOf(article.copy(isRead = true))) { _, read -> requests += read }
        swipeArticle(isRead = true)
        composeRule.mainClock.advanceTimeUntil(3_000) { requests.isNotEmpty() }
        composeRule.onNodeWithText("Marked as unread").assertIsDisplayed()
        composeRule.mainClock.advanceTimeBy(5_000)
        composeRule.onNodeWithText("Marked as unread").assertDoesNotExist()
        assertEquals(listOf(false), requests)
    }

    @Test
    fun successiveSwipesAndUndoApplyOnceToTheSameArticle() {
        val requests = mutableListOf<Pair<String, Boolean>>()
        showArticles(listOf(article)) { id, read -> requests += id to read }
        swipeArticle(isRead = false)
        composeRule.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf(article.id to true), requests)
        composeRule.onNodeWithContentDescription("Read article: Article, from Feed").assertIsDisplayed()
        composeRule.onNodeWithText("Marked as unread").assertDoesNotExist()

        swipeArticle(isRead = true)
        composeRule.mainClock.advanceTimeBy(1_000)
        composeRule.onNodeWithText("Undo").performClick()
        composeRule.runOnIdle {
            assertEquals(listOf(article.id to true, article.id to false, article.id to true), requests)
        }
        composeRule.onNodeWithText("Marked as unread").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Read article: Article, from Feed").assertIsDisplayed()
    }

    private fun swipeArticle(isRead: Boolean) {
        val label = if (isRead) "Read" else "Unread"
        composeRule.onNodeWithContentDescription("$label article: Article, from Feed")
            .performTouchInput { swipeLeft() }
    }

    private fun scrollableRows() = listOf(article) + (1..50).map {
        article.copy(id = "other-$it", title = "Other $it")
    }

    private fun showArticles(rows: List<ArticleListItem>, onToggleRead: (String, Boolean) -> Unit) {
        var state by mutableStateOf(appState())
        val paging = flowOf(PagingData.from(rows))
        composeRule.setContent {
            SelfFeedTheme {
                SelfFeedApp(
                    state = state,
                    articlePagingData = paging,
                    actions = noOpAppActions().copy(onToggleRead = { id, read ->
                        state = state.copy(
                            articles = state.articles.copy(
                                articleStates = state.articles.articleStates +
                                    (id to ArticleFlags(isRead = read, isSaved = false)),
                            ),
                        )
                        onToggleRead(id, read)
                    }),
                )
            }
        }
        composeRule.mainClock.advanceTimeBy(1_000)
        composeRule.waitUntil(5_000) {
            composeRule.onNodeWithContentDescription(
                "${if (rows.first().isRead) "Read" else "Unread"} article: Article, from Feed",
            ).isDisplayed()
        }
    }

    private fun appState() = SelfFeedAppState(
        auth = AuthUiState(loading = false, isAuthenticated = true),
        chrome = AppChromeState(activeTab = HomeTab.ARTICLES),
        feeds = FeedsUiState(),
        articles = ArticlesUiState(),
        search = SearchUiState(),
        settings = SettingsUiState(),
        isOnline = true,
    )

    private fun noOpAppActions(): SelfFeedAppActions = SelfFeedAppActions(
        onAuthModeChange = {},
        onLogin = { _, _, _ -> },
        onRegister = { _, _, _ -> },
        onLogout = {},
        onTabSelected = {},
        onHideReadChanged = {},
        onCategorySelected = {},
        onFeedSelected = {},
        onRefreshArticles = {},
        onOpenArticle = {},
        onArticleDisplayed = {},
        onCloseArticle = {},
        onToggleRead = { _, _ -> },
        onMarkAllRead = {},
        onArticleSnapshot = {},
        onSearchQueryChanged = {},
        onSearchRequested = {},
        onLoadMoreSearch = {},
        onSearchCurrentCategoryOnlyChanged = {},
        onThemeChanged = {},
        onSortChanged = {},
        onDensityChanged = {},
        onTextSizeChanged = {},
        onRevokeAuthSession = {},
        onClearMessages = {},
    )
}
