package com.selffeed.android.ui.screens

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en-w411dp-h891dp")
class SettingsTabPasswordTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun changePasswordClearsSecureFieldsAfterCompletion() {
        var submitted: Pair<String, String>? = null
        var tabState by mutableStateOf(settingsState())

        composeRule.setContent {
            SelfFeedTheme {
                SettingsTab(
                    state = tabState,
                    actions = noOpSettingsActions().copy(
                        onChangePassword = { current, next ->
                            submitted = current to next
                            tabState = tabState.copy(passwordChangeGeneration = tabState.passwordChangeGeneration + 1)
                        },
                    ),
                )
            }
        }

        composeRule.onNodeWithTag("settings-list").performScrollToNode(hasText("Change password"))
        composeRule.onNodeWithText("Current password").performTextInput("old-password")
        composeRule.onNodeWithText("New password").performTextInput("new-password-123")
        composeRule.onNodeWithText("Confirm password").performTextInput("new-password-123")
        composeRule.onNodeWithText("Update password")
            .assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)

        composeRule.runOnIdle {
            assertEquals("old-password" to "new-password-123", submitted)
        }
        composeRule.onNodeWithText("Update password").assertIsNotEnabled()
    }

    @Test
    fun cancellingAdminResetPasswordDoesNotCarryInputToAnotherUser() {
        val users = listOf(
            User(id = "user-1", email = "one@example.com", role = "user", isActive = true),
            User(id = "user-2", email = "two@example.com", role = "user", isActive = true),
        )
        val state = settingsState().copy(
            adminRegistrationLocked = false,
            adminUsers = users,
        )

        composeRule.setContent {
            SelfFeedTheme {
                SettingsTab(state = state, actions = noOpSettingsActions())
            }
        }

        composeRule.onNodeWithTag("settings-list").performScrollToNode(hasText("two@example.com"))
        composeRule.onAllNodesWithText("Reset password")[0]
            .performSemanticsAction(SemanticsActions.OnClick)
        composeRule.onNode(isDialog()).assertExists()
        composeRule.onAllNodes(hasSetTextAction() and hasText("Password"))
            .fetchSemanticsNodes().size.let { count ->
                composeRule.onAllNodes(hasSetTextAction() and hasText("Password"))[count - 1]
                    .performTextInput("temporary-secret-1")
            }
        composeRule.onNodeWithText("Cancel").performClick()

        composeRule.onAllNodesWithText("Reset password")[1]
            .performSemanticsAction(SemanticsActions.OnClick)
        composeRule.onNode(isDialog()).assertExists()
        composeRule.onAllNodesWithText("Reset password")
            .fetchSemanticsNodes().size.let { count ->
                composeRule.onAllNodesWithText("Reset password")[count - 1]
                    .assertIsNotEnabled()
            }
    }

    private fun settingsState() = SettingsTabState(
        preferences = UserPreferences(
            theme = "dark",
            defaultSort = "latest",
            hideRead = false,
            density = "comfortable",
            textSize = 16,
            fontFamily = "system",
            keyboardShortcutsEnabled = false,
            autoMarkReadMode = "on_navigate",
        ),
        preferencesLoading = false,
        preferencesLoadError = null,
        stats = null,
        authSessions = emptyList(),
        adminRegistrationLocked = null,
        adminUsers = emptyList(),
        isOnline = true,
    )

    private fun noOpSettingsActions() = SettingsTabActions(
        onThemeChanged = {},
        onHideReadChanged = {},
        onSortChanged = {},
        onDensityChanged = {},
        onTextSizeChanged = {},
        onFontChanged = {},
        onAutoMarkReadModeChanged = {},
        onRevokeAuthSession = {},
        onRegistrationLockChanged = {},
        onRetryFeedSync = {},
        onCreateAdminUser = { _, _, _ -> },
        onUpdateAdminUser = { _, _, _ -> },
        onResetAdminPassword = { _, _ -> },
        onChangePassword = { _, _ -> },
        onLogout = {},
        onRetryPreferences = {},
    )
}
