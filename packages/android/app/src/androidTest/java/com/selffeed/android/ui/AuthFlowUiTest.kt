package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.paging.PagingData
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.theme.SelfFeedTheme
import kotlinx.coroutines.flow.flowOf
import org.junit.Rule
import org.junit.Test

class AuthFlowUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun authScreen_isShown_whenUserIsLoggedOut() {
        composeRule.setAuthContent()

        composeRule.onNodeWithText("SelfFeed").assertIsDisplayed()
        composeRule.onNodeWithText("Login").assertIsDisplayed()
        composeRule.onNodeWithText("Register").assertIsDisplayed()
    }

    @Test
    fun authMode_switchesBetweenLoginAndRegister() {
        composeRule.setAuthContent()

        composeRule.onNodeWithText("Register").performClick()
        composeRule.onNodeWithText("Create account").assertIsDisplayed()

        composeRule.onNodeWithText("Login").performClick()
        composeRule.onNodeWithText("Create account").assertDoesNotExist()
    }

    @Test
    fun appLoadingScreen_showsIndeterminateProgressIndicator() {
        composeRule.setContent {
            SelfFeedTheme {
                SelfFeedApp(
                    state = SelfFeedAppState(
                        auth = AuthUiState(loading = true),
                        chrome = AppChromeState(),
                        feeds = FeedsUiState(),
                        articles = ArticlesUiState(),
                        search = SearchUiState(),
                        settings = SettingsUiState(),
                        isOnline = true,
                    ),
                    actions = noOpAppActions(),
                    articlePagingData = flowOf(PagingData.empty<ArticleListItem>()),
                )
            }
        }

        composeRule.onNodeWithText("Loading your reading workspace").assertIsDisplayed()
        composeRule
            .onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertIsDisplayed()
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.setAuthContent() {
        setContent {
            SelfFeedTheme {
                var mode by remember { mutableStateOf(AuthMode.LOGIN) }
                AuthScreen(
                    mode = mode,
                    registrationEnabled = true,
                    errorMessage = null,
                    onModeChange = { mode = it },
                    onLogin = { _, _ -> },
                    onRegister = { _, _ -> },
                )
            }
        }
    }

    private fun noOpAppActions(): SelfFeedAppActions = SelfFeedAppActions(
        onAuthModeChange = {},
        onLogin = { _, _ -> },
        onRegister = { _, _ -> },
        onLogout = {},
        onTabSelected = {},
        onRefreshVisibleData = {},
        onHideReadChanged = {},
        onCategorySelected = {},
        onFeedSelected = {},
        onRefreshArticles = {},
        onLoadMoreArticles = {},
        onOpenArticle = {},
        onCloseArticle = {},
        onToggleRead = { _, _ -> },
        onMarkAllRead = {},
        onArticleSnapshot = {},
        onSearchQueryChanged = {},
        onSearchRequested = {},
        onLoadMoreSearch = {},
        onThemeChanged = {},
        onSortChanged = {},
        onDensityChanged = {},
        onTextSizeChanged = {},
        onClearMessages = {},
    )
}
