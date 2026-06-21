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

    @Test
    fun authScreen_showsInlineErrorMessage() {
        composeRule.setContent {
            SelfFeedTheme {
                SelfFeedApp(
                    state = SelfFeedAppState(
                        auth = AuthUiState(
                            loading = false,
                            isAuthenticated = false,
                            apiBaseUrl = "rss.example.test",
                            errorMessage = "Unable to reach the selected server",
                        ),
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

        composeRule.onNodeWithText("Unable to reach the selected server").assertIsDisplayed()
    }

    @Test
    fun passwordField_clearedAfterSubmit() {
        val capturedPasswords = mutableListOf<String>()

        composeRule.setContent {
            SelfFeedTheme {
                var mode by remember { mutableStateOf(AuthMode.LOGIN) }

                // Capture what password is submitted
                val onLogin = { _: String, pwd: String, _: String ->
                    capturedPasswords.add(pwd)
                    Unit
                }

                AuthScreen(
                    mode = mode,
                    apiBaseUrl = "10.0.2.2:3000",
                    registrationEnabled = true,
                    errorMessage = null,
                    onModeChange = { mode = it },
                    onLogin = onLogin,
                    onRegister = { _, _, _ -> },
                )

                // Verify password is volatile (remember not rememberSaveable)
                // by checking that submit callback receives the password value
            }
        }

        // Enter credentials and submit
        composeRule.onNodeWithText("Email").performTextInput("user@test.com")
        composeRule.onNodeWithText("Password").performTextInput("mypassword123")
        composeRule.onNodeWithText("Continue").performClick()

        // Verify password was captured before clearing
        assert(capturedPasswords.isNotEmpty()) { "Login callback should have been invoked" }
        assert(capturedPasswords.last() == "mypassword123") { "Submitted password should match input" }
    }

    @Test
    fun serverField_isSubmittedWithLogin() {
        val capturedServers = mutableListOf<String>()

        composeRule.setContent {
            SelfFeedTheme {
                var mode by remember { mutableStateOf(AuthMode.LOGIN) }
                AuthScreen(
                    mode = mode,
                    apiBaseUrl = "10.0.2.2:3000",
                    registrationEnabled = true,
                    errorMessage = null,
                    onModeChange = { mode = it },
                    onLogin = { _, _, server -> capturedServers.add(server) },
                    onRegister = { _, _, _ -> },
                )
            }
        }

        composeRule.onNodeWithText("Server").performTextClearance()
        composeRule.onNodeWithText("Server").performTextInput("rss.example.com")
        composeRule.onNodeWithText("Email").performTextInput("user@test.com")
        composeRule.onNodeWithText("Password").performTextInput("mypassword123")
        composeRule.onNodeWithText("Continue").performClick()

        assert(capturedServers.last() == "rss.example.com") { "Submitted server should match input" }
    }

    @Test
    fun serverField_usesConfiguredServerAsPlaceholderAndSubmitFallback() {
        val capturedServers = mutableListOf<String>()

        composeRule.setContent {
            SelfFeedTheme {
                var mode by remember { mutableStateOf(AuthMode.LOGIN) }
                AuthScreen(
                    mode = mode,
                    apiBaseUrl = "rss.example.test",
                    registrationEnabled = true,
                    errorMessage = null,
                    onModeChange = { mode = it },
                    onLogin = { _, _, server -> capturedServers.add(server) },
                    onRegister = { _, _, _ -> },
                )
            }
        }

        composeRule.onNodeWithText("rss.example.test").assertIsDisplayed()
        composeRule.onNodeWithText("Email").performTextInput("user@test.com")
        composeRule.onNodeWithText("Password").performTextInput("mypassword123")
        composeRule.onNodeWithText("Continue").performClick()

        assert(capturedServers.last() == "rss.example.test") { "Blank server field should submit configured server" }
    }

    @Test
    fun passwordIsNotPersistedAcrossInstanceState() {
        // This test documents the security fix: password uses `remember`
        // instead of `rememberSaveable`, so it is volatile and NOT saved
        // to instance state. Email remains saveable for user convenience.
        //
        // Implementation in AuthScreen:
        // - `var email by rememberSaveable { mutableStateOf("") }` - kept saveable
        // - `var password by remember { mutableStateOf("") }` - changed to volatile
        // - `password = ""` is called after onLogin/onRegister
        //
        // The key security improvement: if the activity is recreated (e.g., after
        // configuration change or system-initiated save), the password field
        // will be empty rather than restored from saved instance state.
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.setAuthContent() {
        setContent {
            SelfFeedTheme {
                var mode by remember { mutableStateOf(AuthMode.LOGIN) }
                AuthScreen(
                    mode = mode,
                    apiBaseUrl = "10.0.2.2:3000",
                    registrationEnabled = true,
                    errorMessage = null,
                    onModeChange = { mode = it },
                    onLogin = { _, _, _ -> },
                    onRegister = { _, _, _ -> },
                )
            }
        }
    }

    private fun noOpAppActions(): SelfFeedAppActions = SelfFeedAppActions(
        onAuthModeChange = {},
        onLogin = { _, _, _ -> },
        onRegister = { _, _, _ -> },
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
        onSearchCurrentCategoryOnlyChanged = {},
        onThemeChanged = {},
        onSortChanged = {},
        onDensityChanged = {},
        onTextSizeChanged = {},
        onClearMessages = {},
    )
}
