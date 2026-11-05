package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.paging.PagingData
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.theme.SelfFeedTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.Rule
import org.junit.Test

class ReaderFeedbackUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun automaticReadSyncDoesNotInterruptSwipesButOfflineStatusRemainsVisible() {
        val rows = (1..3).map {
            ArticleListItem(id = "$it", feedId = "feed", feedTitle = "Feed", title = "Article $it", isRead = false)
        }
        val details = rows.associate { row ->
            row.id to ArticleDetail(
                id = row.id, feedId = row.feedId, guid = row.id, title = row.title,
                hash = row.id, feedTitle = row.feedTitle, isRead = false, contentHtml = "<p>Article body</p>",
            )
        }
        val paging = flowOf(PagingData.from(rows))
        val pending = MutableStateFlow(0)
        var state by mutableStateOf(SelfFeedAppState(
            auth = AuthUiState(loading = false, isAuthenticated = true),
            chrome = AppChromeState(), feeds = FeedsUiState(),
            articles = ArticlesUiState(
                items = rows, readerQueue = rows, readerDetails = details,
                selectedArticle = details.getValue("1"),
            ),
            search = SearchUiState(), settings = SettingsUiState(), isOnline = true,
        ))
        composeRule.setContent {
            SelfFeedTheme(darkTheme = true) {
                SelfFeedApp(
                    state = state, articlePagingData = paging, pendingArticleChanges = pending,
                    actions = noOpAppActions().copy(
                        onOpenArticle = { id -> state = state.copy(articles = state.articles.copy(selectedArticle = details.getValue(id))) },
                    ),
                )
            }
        }
        composeRule.onNodeWithText("Article 1").assertIsDisplayed()
        for (id in listOf("2", "3")) {
            // A normal automatic read queues a mutation before the server acknowledges it.
            composeRule.runOnIdle { pending.value = 1 }
            composeRule.onNodeWithText("1 change waiting").assertDoesNotExist()
            composeRule.onNodeWithText("Retry").assertDoesNotExist()
            composeRule.onRoot().performTouchInput { swipeLeft() }
            composeRule.waitUntil(5_000) { state.articles.selectedArticle?.id == id }
            composeRule.onNodeWithText("1 change waiting").assertDoesNotExist()
            composeRule.runOnIdle { pending.value = 0 }
        }
        composeRule.runOnIdle { state = state.copy(isOnline = false); pending.value = 1 }
        composeRule.onNodeWithText("1 change waiting").assertIsDisplayed()
        composeRule.onNodeWithText("Syncs when online").assertIsDisplayed()
        composeRule.runOnIdle { state = state.copy(isOnline = true) }
        composeRule.onNodeWithText("1 change waiting").assertDoesNotExist()
        composeRule.runOnIdle { state = state.copy(articles = state.articles.copy(selectedArticle = null)) }
        composeRule.onNodeWithText("1 change waiting").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").assertIsDisplayed()
    }

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
