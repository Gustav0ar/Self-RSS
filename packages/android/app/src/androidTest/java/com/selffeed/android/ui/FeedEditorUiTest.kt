package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.ui.screens.FeedTabActions
import com.selffeed.android.ui.screens.FeedTabState
import com.selffeed.android.ui.screens.FeedsTab
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class FeedEditorUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun addFeedCategoryPickerShowsExistingCategoriesAndSelectsOne() {
        composeRule.setContent { SelfFeedTheme { FeedsTab(feedState(), noOpActions()) } }

        composeRule.onNodeWithText("Add feed").performClick()
        composeRule.onNodeWithTag("feed-category-picker").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("feed-category-option-work").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Category: Work").assertIsDisplayed()
    }

    @Test
    fun addFeedCategoryPickerCreatesCategoryWithoutClosingFeedDialog() {
        var createdCategory: String? = null
        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(
                    feedState(),
                    noOpActions().copy(onCreateCategory = { name, _ -> createdCategory = name }),
                )
            }
        }

        composeRule.onNodeWithText("Add feed").performClick()
        composeRule.onNodeWithTag("feed-category-picker").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Create new category").performClick()
        composeRule.onNodeWithText("Category name").performTextInput("Reading")
        composeRule.onNodeWithText("Create").performClick()

        composeRule.runOnIdle { assertEquals("Reading", createdCategory) }
        composeRule.onNodeWithText("Feed or website URL").assertIsDisplayed()
    }

    @Test
    fun addFeedCategoryPickerReflectsCategoriesLoadedAfterDialogOpens() {
        val categories = mutableStateListOf<CategoryWithCounts>()

        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(feedState(categories = categories), noOpActions())
            }
        }

        composeRule.onNodeWithText("Add feed").performClick()
        composeRule.runOnIdle { categories += category("blogs", "Blogs") }
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("feed-category-picker").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("feed-category-option-blogs").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Category: Blogs").assertIsDisplayed()
    }

    @Test
    fun editFeedShowsAndSubmitsTheChangedUrl() {
        var submittedUrl: String? = null
        val feed = FeedWithCounts(
            id = "feed-1",
            categoryId = "news",
            title = "News Feed",
            feedUrl = "https://example.com/original.xml",
            pollingIntervalMinutes = 60,
            syncStatus = "idle",
            unreadCount = 0,
        )
        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(
                    feedState(feeds = listOf(feed)),
                    noOpActions().copy(
                        onUpdateFeed = { _, url, _, _, _ -> submittedUrl = url },
                    ),
                )
            }
        }

        composeRule.onNodeWithText("News Feed").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("feed-overflow-feed-1").performClick()
        composeRule.onNodeWithText("Edit").performClick()
        composeRule.onNodeWithTag("feed-url-field")
            .assertTextContains("https://example.com/original.xml")
            .performTextReplacement("https://example.com/replacement.xml")
        composeRule.onNodeWithText("Save").performClick()

        composeRule.runOnIdle {
            assertEquals("https://example.com/replacement.xml", submittedUrl)
        }
    }

    @Test
    fun feedFailureSummaryShowsTheDetailedServerError() {
        val failedFeed = FeedWithCounts(
            id = "failed-feed",
            categoryId = "news",
            title = "Unavailable News",
            feedUrl = "https://example.com/feed.xml",
            pollingIntervalMinutes = 5,
            syncStatus = "error",
            lastSyncError = "The feed server timed out before returning a response",
            lastSyncErrorAt = "2026-07-14T12:00:00.000Z",
            unreadCount = 0,
        )
        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(feedState(feeds = listOf(failedFeed)), noOpActions())
            }
        }

        composeRule.onNodeWithText("1 feed is not updating").performScrollTo().assertIsDisplayed()
        composeRule.onAllNodesWithText(
            "Unavailable News is not updating. The feed server timed out before returning a response.",
            substring = true,
        ).assertCountEquals(2)
    }

    private fun feedState(
        categories: List<CategoryWithCounts> = listOf(category("news", "News"), category("work", "Work")),
        feeds: List<FeedWithCounts> = emptyList(),
    ) = FeedTabState(
        categories = categories,
        feeds = feeds,
        hideRead = false,
        totalUnread = 0,
        selectedCategoryId = null,
        selectedFeedId = null,
    )

    private fun noOpActions() = FeedTabActions(
        onHideReadChanged = {},
        onCategorySelected = {},
        onFeedSelected = {},
    )

    private fun category(id: String, name: String) = CategoryWithCounts(
        id = id,
        name = name,
        slug = id,
        sortOrder = 0,
        feedCount = 0,
        unreadCount = 0,
    )
}
