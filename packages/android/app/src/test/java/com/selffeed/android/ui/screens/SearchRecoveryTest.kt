package com.selffeed.android.ui.screens

import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SearchRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.SearchViewModel
import com.selffeed.android.ui.theme.SelfFeedTheme
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class SearchRecoveryTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun firstPageFailureRetriesThroughLoadingToNoMatches() {
        val repository = mockk<SearchRepository>()
        coEvery { repository.search("Android", null, null) } returns AppResult.Error("Couldn't search. Try again.")
        val viewModel = SearchViewModel(repository)
        showSearch(viewModel)

        composeRule.onNodeWithText("Couldn't search. Try again.").assertIsDisplayed()
        composeRule.onNodeWithText("No matching articles").assertDoesNotExist()
        val retry = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        coEvery { repository.search("Android", null, null) } coAnswers { retry.await() }
        composeRule.onNodeWithText("Retry").performClick()

        composeRule.onNodeWithText("Searching…").assertIsDisplayed()
        composeRule.onNodeWithText("Couldn't search. Try again.").assertDoesNotExist()
        composeRule.onAllNodes(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate)).assertCountEquals(0)
        composeRule.runOnIdle {
            retry.complete(AppResult.Success(ApiListResponse(emptyList(), null, false)))
        }
        composeRule.onNodeWithText("No matching articles").assertIsDisplayed()
        composeRule.onNodeWithText("Searching…").assertDoesNotExist()
        coVerify(exactly = 2) { repository.search("Android", null, null) }
    }

    @Test
    fun paginationFailureRetriesNextPageWithoutReplacingCurrentResults() {
        val repository = mockk<SearchRepository>()
        val first = ArticleListItem(id = "first", feedId = "feed", feedTitle = "Feed", title = "First article", isRead = false)
        coEvery { repository.search("Android", null, null) } returns AppResult.Success(
            ApiListResponse(listOf(first), "next", true),
        )
        coEvery { repository.search("Android", null, "next") } returns AppResult.Error("Couldn't load more results.")
        val viewModel = SearchViewModel(repository)
        showSearch(viewModel)
        composeRule.onNodeWithText("Load more results").performClick()

        composeRule.onNodeWithText("First article").assertIsDisplayed()
        composeRule.onNodeWithText("Couldn't load more results.").assertIsDisplayed()
        val retry = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        coEvery { repository.search("Android", null, "next") } coAnswers { retry.await() }
        composeRule.onNodeWithText("Retry").performClick()
        composeRule.onNodeWithText("Loading more results…").assertIsDisplayed()
        composeRule.onNodeWithText("First article").assertIsDisplayed()
        composeRule.runOnIdle {
            retry.complete(AppResult.Success(ApiListResponse(listOf(first.copy(id = "second", title = "Second article")), null, false)))
        }
        composeRule.onNodeWithText("First article").assertIsDisplayed()
        composeRule.onNodeWithText("Second article").assertIsDisplayed()
        composeRule.onNodeWithText("Couldn't load more results.").assertDoesNotExist()
        coVerify(exactly = 1) { repository.search("Android", null, null) }
        coVerify(exactly = 2) { repository.search("Android", null, "next") }
    }

    private fun showSearch(viewModel: SearchViewModel) {
        composeRule.runOnUiThread {
            viewModel.setQuery("Android")
            viewModel.search(debounceMs = 0L)
        }
        composeRule.setContent {
            val state by viewModel.state.collectAsState()
            SelfFeedTheme {
                SearchTab(
                    state = SearchTabState(
                        query = state.query,
                        results = state.results,
                        selectedArticleId = null,
                        hasMoreResults = state.hasMore,
                        loadingResults = state.loading,
                        loadingMoreResults = state.loadingMore,
                        currentCategoryAvailable = false,
                        currentCategoryOnly = false,
                        resultLimitReached = state.resultLimitReached,
                        errorMessage = state.errorMessage,
                    ),
                    actions = SearchTabActions(
                        onQueryChanged = viewModel::setQuery,
                        onSearchRequested = { viewModel.search(debounceMs = 0L) },
                        onOpenArticle = {},
                        onLoadMore = viewModel::loadMore,
                        onCurrentCategoryOnlyChanged = viewModel::setCurrentCategoryOnly,
                    ),
                )
            }
        }
    }
}
