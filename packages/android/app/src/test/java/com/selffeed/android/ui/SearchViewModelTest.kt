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

    @Test
    fun `applyArticleReadState updates matching search result`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(data = listOf(sampleArticle("a1", "f-1")), cursor = null, hasMore = false),
        )
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        viewModel.applyArticleReadState("a1", true)

        assertEquals(true, viewModel.state.value.results.first().isRead)
    }

    @Test
    fun `applyScopeMarkedRead updates only matching feed results`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(
                data = listOf(
                    sampleArticle("a1", "f-1"),
                    sampleArticle("a2", "f-2"),
                ),
                cursor = null,
                hasMore = false,
            ),
        )
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        viewModel.applyScopeMarkedRead(setOf("f-1"))

        assertEquals(true, viewModel.state.value.results.first { it.id == "a1" }.isRead)
        assertEquals(false, viewModel.state.value.results.first { it.id == "a2" }.isRead)
    }

    @Test
    fun `applyScopeMarkedRead with empty feed set leaves results unchanged`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(
                data = listOf(
                    sampleArticle("a1", "f-1"),
                    sampleArticle("a2", "f-2"),
                ),
                cursor = null,
                hasMore = false,
            ),
        )
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        viewModel.applyScopeMarkedRead(emptySet())

        assertEquals(false, viewModel.state.value.results.first { it.id == "a1" }.isRead)
        assertEquals(false, viewModel.state.value.results.first { it.id == "a2" }.isRead)
    }

    @Test
    fun `applyAllMarkedRead updates every search result`() = runTest {
        coEvery { repository.search(any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(
                data = listOf(
                    sampleArticle("a1", "f-1"),
                    sampleArticle("a2", "f-2"),
                ),
                cursor = null,
                hasMore = false,
            ),
        )
        val viewModel = SearchViewModel(repository)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        viewModel.applyAllMarkedRead()

        assertEquals(true, viewModel.state.value.results.first { it.id == "a1" }.isRead)
        assertEquals(true, viewModel.state.value.results.first { it.id == "a2" }.isRead)
    }

    private fun sampleArticle(id: String, feedId: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = feedId,
        feedTitle = "Feed",
        title = id,
        isRead = false,
    )
}
