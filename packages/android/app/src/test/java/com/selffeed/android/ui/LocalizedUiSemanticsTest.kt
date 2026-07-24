package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection.Rtl
import androidx.compose.ui.platform.LocalLayoutDirection
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en")
class LocalizedUiSemanticsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `auth surface keeps localized semantics under RTL and large font scale`() {
        composeRule.setContent {
            CompositionLocalProvider(
                LocalLayoutDirection provides Rtl,
                LocalDensity provides Density(density = 1f, fontScale = 2f),
            ) {
                SelfFeedTheme {
                    AuthScreen(
                        mode = AuthMode.LOGIN,
                        apiBaseUrl = "rss.example.test",
                        registrationEnabled = true,
                        errorMessage = PresentationText.dynamic("Server supplied message"),
                        onModeChange = {},
                        onLogin = { _, _, _ -> },
                        onRegister = { _, _, _ -> },
                    )
                }
            }
        }

        composeRule.onNodeWithContentDescription("SelfFeed app logo").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Server address").assertIsDisplayed()
        composeRule.onNodeWithText("Continue").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Server supplied message").performScrollTo().assertIsDisplayed()
    }
}
