package com.selffeed.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Rule
import org.junit.Test

class AuthFlowUiTest {
    @get:Rule
    val composeRule = createComposeRule()

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
}
