package com.selffeed.android.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.selffeed.android.ui.theme.SelfFeedTheme
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en")
class OfflineStatusTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `status waits for Room and retry leaves changes waiting until acknowledged`() {
        val counts = MutableSharedFlow<Int>(replay = 1)
        var online by mutableStateOf(true)
        var retries = 0
        composeRule.setContent {
            SelfFeedTheme {
                ArticleSyncStatusLine(online, counts, onRetry = { retries++ })
            }
        }
        composeRule.onNodeWithText("Up to date").assertDoesNotExist()
        composeRule.runOnIdle { counts.tryEmit(2) }
        composeRule.onNodeWithText("2 changes waiting").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").performClick()
        composeRule.onNodeWithText("2 changes waiting").assertIsDisplayed()
        assertEquals(1, retries)

        composeRule.runOnIdle { online = false }
        composeRule.onNodeWithText("Syncs when online").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").assertDoesNotExist()
        composeRule.runOnIdle { counts.tryEmit(0) }
        composeRule.onNodeWithText("Offline").assertIsDisplayed()
        composeRule.onNodeWithText("Up to date").assertDoesNotExist()
        composeRule.runOnIdle { online = true }
        composeRule.onNodeWithText("Up to date").assertIsDisplayed()
    }

    @Test
    fun `availability starts unknown and resets when account observer changes`() {
        val firstAccount = MutableSharedFlow<Boolean>(replay = 1)
        val nextAccount = MutableSharedFlow<Boolean>(replay = 1)
        var observer by mutableStateOf<(String) -> Flow<Boolean>>({ firstAccount })
        composeRule.setContent {
            SelfFeedTheme { OfflineTextStatus("same-article-id", observer) }
        }
        composeRule.onNodeWithText("Text available offline").assertDoesNotExist()
        composeRule.onNodeWithText("Text not downloaded").assertDoesNotExist()
        composeRule.runOnIdle { firstAccount.tryEmit(true) }
        composeRule.onNodeWithText("Text available offline").assertIsDisplayed()
        composeRule.runOnIdle { observer = { nextAccount } }
        composeRule.onNodeWithText("Text available offline").assertDoesNotExist()
        composeRule.runOnIdle { nextAccount.tryEmit(false) }
        composeRule.onNodeWithText("Text not downloaded").assertIsDisplayed()
    }
}
