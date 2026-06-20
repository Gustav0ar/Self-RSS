package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
    fun `search keeps loading true until first page returns`() = runTest {
        val searchResult = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        coEvery { repository.search("selffeed", any(), any()) } coAnswers { searchResult.await() }
        val viewModel = SearchViewModel(repository)

        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        assertTrue(viewModel.state.value.loading)

        searchResult.complete(
            AppResult.Success(ApiListResponse(data = listOf(sampleArticle("a1", "f-1")), cursor = null, hasMore = false)),
        )

        assertFalse(viewModel.state.value.loading)
        assertEquals(listOf("a1"), viewModel.state.value.results.map { it.id })
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
    fun `new first page search clears previous pagination cursor while loading`() = runTest {
        val nextSearch = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        coEvery { repository.search("old", any(), any()) } returns AppResult.Success(
            ApiListResponse(data = listOf(sampleArticle("old-article", "f-1")), cursor = "next", hasMore = true),
        )
        coEvery { repository.search("new", any(), any()) } coAnswers { nextSearch.await() }
        val viewModel = SearchViewModel(repository)

        viewModel.setQuery("old")
        viewModel.search(debounceMs = 0L)
        assertEquals("next", viewModel.state.value.cursor)
        assertTrue(viewModel.state.value.hasMore)

        viewModel.setQuery("new")
        viewModel.search(debounceMs = 0L)

        assertNull(viewModel.state.value.cursor)
        assertFalse(viewModel.state.value.hasMore)
        assertTrue(viewModel.state.value.loading)

        nextSearch.complete(AppResult.Success(ApiListResponse(data = emptyList(), cursor = null, hasMore = false)))
    }

    @Test
    fun `current category scope passes category id to repository`() = runTest {
        val viewModel = SearchViewModel(repository)
        viewModel.setSelectedCategoryId("cat-1")
        viewModel.setCurrentCategoryOnly(true)
        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        coVerify { repository.search("selffeed", "cat-1", null) }
    }

    @Test
    fun `stale search result does not replace latest result`() = runTest {
        val oldResult = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        val latestResult = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        coEvery { repository.search("old", any(), any()) } coAnswers { oldResult.await() }
        coEvery { repository.search("new", any(), any()) } coAnswers { latestResult.await() }
        val viewModel = SearchViewModel(repository)

        viewModel.setQuery("old")
        viewModel.search(debounceMs = 0L)
        viewModel.setQuery("new")
        viewModel.search(debounceMs = 0L)

        latestResult.complete(
            AppResult.Success(ApiListResponse(data = listOf(sampleArticle("new-article", "f-1")), cursor = null, hasMore = false)),
        )
        oldResult.complete(
            AppResult.Success(ApiListResponse(data = listOf(sampleArticle("old-article", "f-1")), cursor = null, hasMore = false)),
        )

        assertEquals(listOf("new-article"), viewModel.state.value.results.map { it.id })
    }

    @Test
    fun `search caps oversized result sets and disables pagination at limit`() = runTest {
        coEvery { repository.search("selffeed", any(), any()) } returns AppResult.Success(
            ApiListResponse(
                data = (1..90).map { sampleArticle("a$it", "f-1") },
                cursor = "next",
                hasMore = true,
            ),
        )
        val viewModel = SearchViewModel(repository)

        viewModel.setQuery("selffeed")
        viewModel.search(debounceMs = 0L)

        assertEquals(SearchViewModel.MAX_RESULTS, viewModel.state.value.results.size)
        assertFalse(viewModel.state.value.hasMore)
        assertTrue(viewModel.state.value.resultLimitReached)
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
