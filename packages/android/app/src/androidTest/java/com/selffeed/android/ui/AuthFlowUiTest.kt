package com.selffeed.android.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.selffeed.android.MainActivity
import org.junit.Rule
import org.junit.Test

class AuthFlowUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun authScreen_isShown_whenUserIsLoggedOut() {
        composeRule.onNodeWithText("SelfFeed").assertIsDisplayed()
        composeRule.onNodeWithText("Login").assertIsDisplayed()
        composeRule.onNodeWithText("Register").assertIsDisplayed()
    }

    @Test
    fun authMode_switchesBetweenLoginAndRegister() {
        composeRule.onNodeWithText("Register").performClick()
        composeRule.onNodeWithText("Create account").assertIsDisplayed()

        composeRule.onNodeWithText("Login").performClick()
        composeRule.onNodeWithText("Create account").assertDoesNotExist()
    }
}
