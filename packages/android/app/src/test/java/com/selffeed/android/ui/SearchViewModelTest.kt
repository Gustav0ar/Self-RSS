package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {
    private lateinit var repository: RssRepository
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.search(any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(data = emptyList(), cursor = null, hasMore = false),
        )
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `setQuery shorter than 2 chars clears results immediately`() = runTest {
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("s")
        assertTrue(viewModel.state.value.results.isEmpty())
    }

    @Test
    fun `search below minimum length does nothing`() = runTest {
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("a")
        viewModel.search(debounceMs = 0L)
        coVerify(exactly = 0) { repository.search(any(), any(), any()) }
    }

    @Test
    fun `search with valid query hits repository once after debounce`() = runTest {
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)
        coVerify { repository.search("selffeed", null, null) }
    }

    @Test
    fun `rapid successive queries only execute the latest`() = runTest {
        coEvery { repository.search("self", any(), any()) } returns AppResult.Success(
            ApiListResponse(emptyList(), null, false),
        )
        coEvery { repository.search("selffeed", any(), any()) } returns AppResult.Success(
            ApiListResponse(emptyList(), null, false),
        )
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("self")
        viewModel.search(debounceMs = 100L)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 100L)
        advanceTimeBy(200L)
        // Only the latest query was sent.
        coVerify(exactly = 0) { repository.search("self", any(), any()) }
        coVerify { repository.search("selffeed", null, null) }
    }

    @Test
    fun `loadMore is a no-op when no cursor`() = runTest {
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("selffeed")
        viewModel.loadMore()
        coVerify(exactly = 0) { repository.search(any(), any(), any()) }
    }

    @Test
    fun `clearMessages wipes the error`() = runTest {
        val viewModel = SearchViewModel(repository)
        viewModel.clearMessages()
        assertEquals(null, viewModel.state.value.errorMessage)
    }
}
