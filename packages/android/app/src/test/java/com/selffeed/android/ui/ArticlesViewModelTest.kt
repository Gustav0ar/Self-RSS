package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArticlesViewModelTest {
    private lateinit var repository: RssRepository
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.articles(any(), any(), any(), any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(data = listOf(sampleArticle("a1")), cursor = null, hasMore = false),
        )
        coEvery { repository.article(any(), any()) } returns AppResult.Success(sampleDetail("a1"))
        coEvery { repository.markRead(any(), any()) } returns AppResult.Success(true)
        coEvery { repository.markAllRead(any(), any()) } returns AppResult.Success(0)
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadArticles populates the list and respects hasMore`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()
        val s = viewModel.state.value
        assertEquals(1, s.items.size)
        assertEquals(false, s.hasMoreArticles)
    }

    @Test
    fun `setScope updates selected ids and clears pagination`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.setScope(feedId = "f-1", categoryId = null)
        assertEquals("f-1", viewModel.state.value.selectedFeedId)
        assertNull(viewModel.state.value.selectedCategoryId)
    }

    @Test
    fun `loadMoreArticles is a no-op when hasMore is false`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadMoreArticles()
        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `openArticle sets selectedArticle and marks read locally`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()
        viewModel.openArticle("a1")
        val s = viewModel.state.value
        assertNotNull(s.selectedArticle)
        assertEquals(true, s.items.first().isRead)
        coVerify { repository.article("a1", false) }
        coVerify { repository.markRead("a1", true) }
    }

    @Test
    fun `closeArticle clears the selected article`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()
        viewModel.openArticle("a1")
        viewModel.closeArticle()
        assertNull(viewModel.state.value.selectedArticle)
    }

    @Test
    fun `markRead updates the local list optimistically`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()
        viewModel.markRead("a1", true)
        val s = viewModel.state.value
        assertTrue(s.items.first().isRead)
    }

    @Test
    fun `markAllRead marks loaded articles without reloading`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()
        viewModel.markAllRead()
        val s = viewModel.state.value
        assertTrue(s.items.first().isRead)
        coVerify { repository.markAllRead(null, null) }
        coVerify(exactly = 1) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    private fun sampleArticle(id: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "f-1",
        feedTitle = "F",
        title = "T",
        isRead = false,
    )

    private fun sampleDetail(id: String): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "f-1",
        guid = id,
        canonicalUrl = null,
        title = "T",
        author = null,
        excerpt = null,
        contentHtml = null,
        contentText = null,
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = null,
        hash = id,
        feedTitle = "F",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = emptyList(),
        isRead = false,
        isEnriched = false,
    )
}
