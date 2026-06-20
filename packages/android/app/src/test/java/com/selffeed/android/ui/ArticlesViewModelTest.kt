package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.MarkAllReadResponse
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
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
        coEvery { repository.markAllRead(any(), any()) } returns AppResult.Success(
            MarkAllReadResponse(markedCount = 0),
        )
        coEvery { repository.enrichArticle(any(), any()) } returns AppResult.Success(
            com.selffeed.android.network.EnrichArticleResponse(success = false),
        )
        coEvery { repository.prefetchArticle(any()) } returns AppResult.Success(sampleDetail("a2"))
        coEvery { repository.refreshArticleDetail(any()) } returns AppResult.Success(sampleDetail("a2"))
        every { repository.cachedArticleDetail(any()) } returns null
        every { repository.prefetchHeroImages(any()) } just runs
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadArticles populates the list snapshot`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()
        val s = viewModel.state.value
        assertEquals(1, s.items.size)
    }

    @Test
    fun `loadArticles keeps loading true until fetch completes`() = runTest {
        val articlesResult = CompletableDeferred<AppResult<ApiListResponse<ArticleListItem>>>()
        coEvery { repository.articles(any(), any(), any(), any(), any(), any()) } coAnswers {
            articlesResult.await()
        }
        val viewModel = ArticlesViewModel(repository)

        viewModel.loadArticles()
        runCurrent()

        assertEquals(true, viewModel.state.value.loading)

        articlesResult.complete(
            AppResult.Success(
                ApiListResponse(data = listOf(sampleArticle("a2")), cursor = null, hasMore = false),
            ),
        )
        runCurrent()

        assertEquals(false, viewModel.state.value.loading)
        assertEquals("a2", viewModel.state.value.items.single().id)
    }

    @Test
    fun `setScope updates selected ids and refreshes paging without legacy page fetch`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.setScope(feedId = "f-1", categoryId = null)
        assertEquals("f-1", viewModel.state.value.selectedFeedId)
        assertNull(viewModel.state.value.selectedCategoryId)
        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
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
    fun `markRead emits unread and read deltas for sidebar and stats sync`() = runTest {
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()

        val event = backgroundScope.async { viewModel.events.first() }
        runCurrent()
        viewModel.markRead("a1", true)

        val changed = event.await() as ArticleFeatureEvent.ArticleReadStateChanged
        assertEquals("a1", changed.articleId)
        assertEquals("f-1", changed.feedId)
        assertEquals(true, changed.read)
        assertEquals(-1, changed.unreadDelta)
        assertEquals(1, changed.readDelta)
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

    @Test
    fun `markAllRead emits empty feed set for all-feeds scope so consumers clear entire scope`() = runTest {
        coEvery { repository.markAllRead(any(), any()) } returns AppResult.Success(
            MarkAllReadResponse(markedCount = 4),
        )
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()

        val event = backgroundScope.async { viewModel.events.first() }
        runCurrent()
        viewModel.markAllRead()

        val marked = event.await() as ArticleFeatureEvent.ScopeMarkedRead
        assertNull(marked.feedId)
        assertNull(marked.categoryId)
        assertTrue(marked.affectedFeedIds.isEmpty())
        assertEquals(4, marked.markedCount)
    }

    @Test
    fun `markAllRead emits affected feed ids returned by the API`() = runTest {
        coEvery { repository.markAllRead(any(), any()) } returns AppResult.Success(
            MarkAllReadResponse(markedCount = 2, feedIds = listOf("f-child")),
        )
        coEvery { repository.articles(any(), any(), any(), any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(
                data = listOf(sampleArticle("a1", feedId = "f-1"), sampleArticle("a2", feedId = "f-child")),
                cursor = null,
                hasMore = false,
            ),
        )
        val viewModel = ArticlesViewModel(repository)
        viewModel.loadArticles()

        val event = backgroundScope.async { viewModel.events.first() }
        runCurrent()
        viewModel.markAllRead()

        val marked = event.await() as ArticleFeatureEvent.ScopeMarkedRead
        assertEquals(setOf("f-child"), marked.affectedFeedIds)
        assertEquals(false, viewModel.state.value.items.first { it.id == "a1" }.isRead)
        assertEquals(true, viewModel.state.value.items.first { it.id == "a2" }.isRead)
    }

    @Test
    fun `setFilter updates state and refreshes paging without legacy page fetch`() = runTest {
        val viewModel = ArticlesViewModel(repository)

        viewModel.setFilter(sort = "oldest", hideRead = true)

        assertEquals("oldest", viewModel.state.value.sort)
        assertEquals(true, viewModel.state.value.hideRead)
        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `refreshArticles refreshes paging without legacy page fetch`() = runTest {
        val viewModel = ArticlesViewModel(repository)

        viewModel.refreshArticles()

        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    private fun sampleArticle(id: String, feedId: String = "f-1"): ArticleListItem = ArticleListItem(
        id = id,
        feedId = feedId,
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
