package com.selffeed.android.ui.screens

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performScrollTo
import com.selffeed.android.data.CategoryMoveDirection
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CategoryOrderUiTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun categoryMenuMovesOnlyWithinItsSiblingBoundaries() {
        var moved: Pair<String, CategoryMoveDirection>? = null
        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(
                    feedState(categories = listOf(category("first", "First"), category("last", "Last"))),
                    noOpActions().copy(onMoveCategory = { id, direction -> moved = id to direction }),
                )
            }
        }
        composeRule.onNodeWithText("First").performScrollTo()
        composeRule.onNodeWithTag("category-overflow-first").performClick()
        composeRule.onNodeWithText("Move up").assertIsNotEnabled()
        composeRule.onNodeWithText("Move down").assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals("first" to CategoryMoveDirection.DOWN, moved) }

        composeRule.onNodeWithTag("feeds-list").performScrollToNode(hasText("Last"))
        composeRule.onNodeWithTag("category-overflow-last").performClick()
        composeRule.onNodeWithText("Move up").assertIsEnabled()
        composeRule.onNodeWithText("Move down").assertIsNotEnabled()
        composeRule.onNodeWithText("Edit").assertIsEnabled()
        composeRule.onNodeWithText("Remove").assertIsEnabled()
    }

    @Test
    fun categoryMenuDisablesMovesWhileSaving() {
        composeRule.setContent {
            SelfFeedTheme {
                FeedsTab(feedState().copy(reorderingCategories = true), noOpActions())
            }
        }
        composeRule.onNodeWithText("News").performScrollTo()
        composeRule.onNodeWithTag("category-overflow-news").performClick()
        composeRule.onNodeWithText("Move up").assertIsNotEnabled()
        composeRule.onNodeWithText("Move down").assertIsNotEnabled()
    }

    private fun feedState(
        categories: List<CategoryWithCounts> = listOf(category("news", "News"), category("work", "Work")),
    ) = FeedTabState(
        categories = categories, feeds = emptyList(), hideRead = false, totalUnread = 0,
        selectedCategoryId = null, selectedFeedId = null,
    )

    private fun noOpActions() = FeedTabActions(
        onHideReadChanged = {}, onCategorySelected = {}, onFeedSelected = {},
    )

    private fun category(id: String, name: String) = CategoryWithCounts(
        id = id, name = name, slug = id, sortOrder = 0, feedCount = 0, unreadCount = 0,
    )
}
