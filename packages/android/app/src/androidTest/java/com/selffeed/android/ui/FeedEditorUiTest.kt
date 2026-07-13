package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.selffeed.android.network.CategoryWithCounts
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

    private fun feedState(
        categories: List<CategoryWithCounts> = listOf(category("news", "News"), category("work", "Work")),
    ) = FeedTabState(
        categories = categories,
        feeds = emptyList(),
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
