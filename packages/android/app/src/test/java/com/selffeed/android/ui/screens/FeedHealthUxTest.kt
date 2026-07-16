package com.selffeed.android.ui.screens

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class FeedHealthUxTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun summaryDismissesAndEditorOwnsTheDetailedFailure() {
        val failedFeed = FeedWithCounts(
            id = "failed-feed",
            categoryId = "news",
            title = "Unavailable News",
            feedUrl = "https://example.com/feed.xml",
            description = "News from the source",
            pollingIntervalMinutes = 30,
            syncStatus = "error",
            lastSyncError = "The feed server timed out",
            lastSyncErrorAt = "2026-07-14T12:00:00.000Z",
            unreadCount = 0,
        )
        val state = FeedTabState(
            categories = listOf(
                CategoryWithCounts(
                    id = "news",
                    name = "News",
                    slug = "news",
                    sortOrder = 0,
                    feedCount = 1,
                    unreadCount = 0,
                ),
            ),
            feeds = listOf(failedFeed),
            hideRead = false,
            totalUnread = 0,
            selectedCategoryId = null,
            selectedFeedId = null,
        )

        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(
                    state = state,
                    actions = FeedTabActions(
                        onHideReadChanged = {},
                        onCategorySelected = {},
                        onFeedSelected = {},
                    ),
                )
            }
        }

        composeRule.onNodeWithText("1 feed is not updating").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("dismiss-feed-health-summary").performClick()
        composeRule.onNodeWithText("1 feed is not updating").assertDoesNotExist()
        composeRule.onNodeWithTag("feeds-list").performScrollToIndex(4)
        composeRule.onNodeWithText("News from the source").assertIsDisplayed()

        composeRule.onNodeWithTag("feed-overflow-failed-feed").performClick()
        composeRule.onNodeWithText("Edit").performClick()
        composeRule.onNodeWithTag("feed-health-details").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("The feed server timed out.").assertIsDisplayed()
    }
}
