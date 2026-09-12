package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Rule
import org.junit.Test

/** Uses Chromium's visual callback; Robolectric cannot establish rich-body readiness. */
class AndroidReviewFixtureUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun richReaderBecomesReadyAndCloseRemovesReadiness() {
        composeRule.setContent {
            SelfFeedTheme { BenchmarkReaderScenario() }
        }
        composeRule.onNodeWithContentDescription(BenchmarkReaderReadyDescription).assertDoesNotExist()
        composeRule.onNodeWithContentDescription(BenchmarkArticleCardDescription).performClick()
        composeRule.waitUntil(15_000) {
            composeRule.onAllNodesWithContentDescription(BenchmarkReaderReadyDescription)
                .fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithContentDescription(BenchmarkReaderReadyDescription).assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Back to list").performClick()
        composeRule.onNodeWithContentDescription(BenchmarkReaderReadyDescription).assertDoesNotExist()
    }
}
