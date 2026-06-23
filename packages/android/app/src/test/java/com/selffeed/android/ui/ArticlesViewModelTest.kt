package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.MarkAllReadResponse
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.ReadStateScope
import com.selffeed.android.ui.articles.ArticleWarmingManager
import com.selffeed.android.ui.articles.EnrichmentManager
import com.selffeed.android.ui.articles.ReadStateManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
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
    private lateinit var readStateManager: ReadStateManager
    private lateinit var enrichmentManager: EnrichmentManager
    private lateinit var articleWarmingManager: ArticleWarmingManager
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.articles(any(), any(), any(), any(), any(), any()) } returns AppResult.Success(
            ApiListResponse(data = listOf(sampleArticle("a1")), cursor = null, hasMore = false),
        )
        coEvery { repository.article(any(), any()) } returns AppResult.Success(sampleDetail("a1"))
        coEvery { repository.markRead(any(), any(), any()) } coAnswers {
            AppResult.Success(secondArg<Boolean>())
        }
        coEvery { repository.updateCachedReadState(any(), any()) } just runs
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
        every { repository.readStateEvents() } returns kotlinx.coroutines.flow.flowOf()
        every { repository.clientId() } returns "test-client"
        coEvery { repository.invalidateReadStateCaches(any()) } just runs
        coEvery { repository.markCachedArticlesReadByFeeds(any()) } just runs

        // Create real managers with mocked repository
        readStateManager = ReadStateManager(repository)
        enrichmentManager = EnrichmentManager(repository)
        articleWarmingManager = ArticleWarmingManager(repository)
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): ArticlesViewModel {
        // Need to set scope before using managers
        val scope = CoroutineScope(testDispatcher)
        readStateManager.setScope(scope)
        enrichmentManager.setScope(scope)
        articleWarmingManager.setScope(scope)
        return ArticlesViewModel(repository, readStateManager, enrichmentManager, articleWarmingManager)
    }

    @Test
    fun `loadArticles populates the list snapshot`() = runTest {
        val viewModel = createViewModel()
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
        val viewModel = createViewModel()

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
        val viewModel = createViewModel()
        viewModel.setScope(feedId = "f-1", categoryId = null)
        assertEquals("f-1", viewModel.state.value.selectedFeedId)
        assertNull(viewModel.state.value.selectedCategoryId)
        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `loadMoreArticles is a no-op when hasMore is false`() = runTest {
        val viewModel = createViewModel()
        viewModel.loadMoreArticles()
        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `openArticle sets selectedArticle without marking read before display`() = runTest {
        val viewModel = createViewModel()
        viewModel.loadArticles()
        viewModel.openArticle("a1")
        val s = viewModel.state.value
        assertNotNull(s.selectedArticle)
        assertEquals(false, s.items.first().isRead)
        coVerify { repository.article("a1", false) }
        coVerify(exactly = 0) { repository.markRead("a1", true, "auto_open") }
    }

    @Test
    fun `onArticleDisplayed marks selected unread article as read`() = runTest {
        val viewModel = createViewModel()
        viewModel.loadArticles()
        viewModel.openArticle("a1")
        runCurrent()

        viewModel.onArticleDisplayed("a1")
        runCurrent()

        val s = viewModel.state.value
        assertEquals(true, s.items.first().isRead)
        assertEquals(true, s.selectedArticle?.isRead)
        coVerify { repository.markRead("a1", true, "auto_open") }
    }

    @Test
    fun `openArticle selects retained row immediately while detail fetch is pending`() = runTest {
        val detailResult = CompletableDeferred<AppResult<ArticleDetail>>()
        coEvery { repository.article("a2", false) } coAnswers { detailResult.await() }
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(
                sampleArticle("a1", title = "First Article"),
                sampleArticle("a2", title = "Second Article"),
            ),
        )

        viewModel.openArticle("a2")
        runCurrent()

        assertEquals("a2", viewModel.state.value.selectedArticle?.id)
        assertEquals("Second Article", viewModel.state.value.selectedArticle?.title)
        coVerify(exactly = 0) { repository.markRead("a2", true, "auto_open") }

        detailResult.complete(AppResult.Success(sampleDetail("a2", title = "Fetched Second Article")))
        runCurrent()

        assertEquals("a2", viewModel.state.value.selectedArticle?.id)
        assertEquals("Fetched Second Article", viewModel.state.value.selectedArticle?.title)
        coVerify(exactly = 0) { repository.markRead("a2", true, "auto_open") }
    }

    @Test
    fun `openArticle ignores stale detail response from an older tap`() = runTest {
        val firstDetailResult = CompletableDeferred<AppResult<ArticleDetail>>()
        coEvery { repository.article("a1", false) } coAnswers { firstDetailResult.await() }
        coEvery { repository.article("a2", false) } returns AppResult.Success(sampleDetail("a2", title = "Fetched Second"))
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(
                sampleArticle("a1", title = "First Article"),
                sampleArticle("a2", title = "Second Article"),
            ),
        )

        viewModel.openArticle("a1")
        runCurrent()
        viewModel.openArticle("a2")
        runCurrent()
        firstDetailResult.complete(AppResult.Success(sampleDetail("a1", title = "Fetched First")))
        runCurrent()

        assertEquals("a2", viewModel.state.value.selectedArticle?.id)
        assertEquals("Fetched Second", viewModel.state.value.selectedArticle?.title)
    }

    @Test
    fun `openAdjacentArticle uses retained article queue`() = runTest {
        coEvery { repository.article("a1", false) } returns AppResult.Success(sampleDetail("a1", title = "First Article"))
        coEvery { repository.article("a2", false) } returns AppResult.Success(sampleDetail("a2", title = "Second Article"))
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(
                sampleArticle("a1", title = "First Article"),
                sampleArticle("a2", title = "Second Article"),
            ),
        )

        viewModel.openArticle("a1")
        runCurrent()
        viewModel.openAdjacentArticle(1)
        runCurrent()

        assertEquals("a2", viewModel.state.value.selectedArticle?.id)
        assertEquals("Second Article", viewModel.state.value.selectedArticle?.title)
    }

    @Test
    fun `closeArticle clears the selected article`() = runTest {
        val viewModel = createViewModel()
        viewModel.loadArticles()
        viewModel.openArticle("a1")
        viewModel.closeArticle()
        assertNull(viewModel.state.value.selectedArticle)
    }

    @Test
    fun `markRead updates the local list optimistically`() = runTest {
        val viewModel = createViewModel()
        viewModel.loadArticles()
        viewModel.markRead("a1", true)
        val s = viewModel.state.value
        assertTrue(s.items.first().isRead)
    }

    @Test
    fun `manual unread is preserved when opening the article again`() = runTest {
        val viewModel = createViewModel()
        viewModel.loadArticles()

        viewModel.markRead("a1", false)
        viewModel.openArticle("a1")
        viewModel.onArticleDisplayed("a1")
        runCurrent()

        assertEquals(false, viewModel.state.value.selectedArticle?.isRead)
        assertEquals(false, viewModel.readStateOverrides.value["a1"])
        coVerify(exactly = 0) { repository.markRead("a1", true, "auto_open") }
    }

    @Test
    fun `markRead failure rolls back the visible override`() = runTest {
        coEvery { repository.markRead(any(), any(), any()) } returns AppResult.Error("nope")
        val viewModel = createViewModel()
        viewModel.loadArticles()

        viewModel.markRead("a1", true)
        runCurrent()

        assertEquals(false, viewModel.state.value.items.first().isRead)
        assertEquals(false, viewModel.readStateOverrides.value["a1"])
    }

    @Test
    fun `markRead emits unread and read deltas for sidebar and stats sync`() = runTest {
        val viewModel = createViewModel()
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
    fun `remote read event updates local article state and published overrides`() = runTest {
        val remoteEvents = MutableSharedFlow<ReadStateSyncEvent>()
        every { repository.readStateEvents() } returns remoteEvents
        val event = ArticleReadStateChangedEvent(
            eventId = "event-1",
            articleId = "a1",
            feedId = "f-1",
            isRead = true,
            source = "manual",
            clientId = "other-client",
            updatedAt = "2026-06-21T00:00:00.000Z",
        )
        val viewModel = createViewModel()
        viewModel.loadArticles()

        viewModel.startReadStateSync()
        runCurrent()
        remoteEvents.emit(event)
        runCurrent()
        viewModel.stopReadStateSync()

        assertEquals(true, viewModel.state.value.items.first().isRead)
        assertEquals(true, viewModel.readStateOverrides.value["a1"])
        coVerify { repository.updateCachedReadState("a1", true) }
    }

    @Test
    fun `remote mark-all event greys retained rows without refreshing them away`() = runTest {
        val remoteEvents = MutableSharedFlow<ReadStateSyncEvent>()
        every { repository.readStateEvents() } returns remoteEvents
        val event = ArticlesMarkedReadEvent(
            eventId = "event-1",
            feedIds = listOf("f-1"),
            scope = ReadStateScope(feedId = "f-1"),
            markedCount = 1,
            clientId = "other-client",
            updatedAt = "2026-06-21T00:00:00.000Z",
        )
        val viewModel = createViewModel()
        viewModel.loadArticles()

        viewModel.startReadStateSync()
        runCurrent()
        remoteEvents.emit(event)
        runCurrent()
        viewModel.stopReadStateSync()

        assertEquals(listOf("a1"), viewModel.state.value.items.map { it.id })
        assertEquals(true, viewModel.state.value.items.first().isRead)
        assertEquals(true, viewModel.readStateOverrides.value["a1"])
        coVerify(exactly = 1) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `markAllRead marks loaded articles without reloading`() = runTest {
        val viewModel = createViewModel()
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
        val viewModel = createViewModel()
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
        val viewModel = createViewModel()
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
        val viewModel = createViewModel()

        viewModel.setFilter(sort = "oldest", hideRead = true)

        assertEquals("oldest", viewModel.state.value.sort)
        assertEquals(true, viewModel.state.value.hideRead)
        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `refreshArticles refreshes paging without legacy page fetch`() = runTest {
        val viewModel = createViewModel()

        viewModel.refreshArticles()

        coVerify(exactly = 0) { repository.articles(any(), any(), any(), any(), any(), any()) }
    }

    private fun sampleArticle(id: String, feedId: String = "f-1", title: String = "T"): ArticleListItem = ArticleListItem(
        id = id,
        feedId = feedId,
        feedTitle = "F",
        title = title,
        isRead = false,
    )

    private fun sampleDetail(id: String, title: String = "T"): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "f-1",
        guid = id,
        canonicalUrl = null,
        title = title,
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
