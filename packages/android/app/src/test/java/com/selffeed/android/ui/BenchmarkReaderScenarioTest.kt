package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class BenchmarkReaderScenarioTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun benchmarkReaderJourneyOpensTheProductionReader() {
        composeRule.setContent {
            SelfFeedTheme {
                BenchmarkReaderScenario()
            }
        }

        composeRule
            .onNodeWithContentDescription(BenchmarkArticleCardDescription)
            .performClick()

        composeRule
            .onNodeWithContentDescription(BenchmarkReaderReadyDescription)
            .assertIsDisplayed()
        composeRule
            .onNodeWithContentDescription("Back to list")
            .assertIsDisplayed()
    }

    @Test
    fun syntheticScenarioIsUnavailableToNormalBuilds() {
        assertNull(benchmarkScenarioFor("debug", BenchmarkReaderScenarioName))
        assertNull(benchmarkScenarioFor("release", BenchmarkReaderScenarioName))
        assertEquals(
            BenchmarkScenario.READER,
            benchmarkScenarioFor("benchmarkRelease", BenchmarkReaderScenarioName),
        )
        assertEquals(
            BenchmarkScenario.READER,
            benchmarkScenarioFor("nonMinifiedRelease", BenchmarkReaderScenarioName),
        )
    }
}
