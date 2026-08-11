package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import androidx.paging.PagingData
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleMedia
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.ArticlesNewEvent
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
import io.mockk.verify
import io.mockk.runs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
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
    private lateinit var repository: ArticleRepository
    private lateinit var readStateManager: ReadStateManager
    private lateinit var enrichmentManager: EnrichmentManager
    private lateinit var articleWarmingManager: ArticleWarmingManager
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.article(any(), any()) } returns AppResult.Success(sampleDetail("a1"))
        coEvery { repository.markRead(any(), any(), any()) } coAnswers {
            AppResult.Success(secondArg<Boolean>())
        }
        coEvery { repository.updateCachedReadState(any(), any()) } just runs
        coEvery { repository.updateCachedSavedState(any(), any()) } just runs
        coEvery { repository.setSaved(any(), any()) } coAnswers {
            AppResult.Success(secondArg<Boolean>())
        }
        coEvery { repository.markAllRead(any(), any()) } returns AppResult.Success(
            MarkAllReadResponse(markedCount = 0),
        )
        coEvery { repository.enrichArticle(any(), any()) } returns AppResult.Success(
            com.selffeed.android.network.EnrichArticleResponse(success = false),
        )
        coEvery { repository.prefetchArticle(any()) } answers {
            AppResult.Success(sampleDetail(firstArg()))
        }
        coEvery { repository.refreshArticleDetail(any()) } returns AppResult.Success(sampleDetail("a2"))
        every { repository.cachedArticleDetail(any()) } returns null
        every { repository.articlePagingData(any(), any()) } returns flowOf(PagingData.empty())
        every { repository.prefetchHeroImages(any()) } just runs
        every { repository.readStateEvents() } returns kotlinx.coroutines.flow.flowOf()
        every { repository.clientId() } returns "test-client"
        coEvery { repository.invalidateReadStateCaches(any()) } just runs
        coEvery { repository.invalidateArticleContentCaches(any()) } just runs
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
        return ArticlesViewModel(
            repository,
            readStateManager,
            enrichmentManager,
            articleWarmingManager
        )
    }

    @Test
    fun `setScope clears the retained visible queue`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)
        viewModel.setScope(feedId = "f-1", categoryId = null)
        assertEquals("f-1", viewModel.state.value.selectedFeedId)
        assertNull(viewModel.state.value.selectedCategoryId)
        assertTrue(viewModel.state.value.items.isEmpty())
    }

    @Test
    fun `selecting the current scope again preserves the list session`() = runTest {
        val viewModel = createViewModel()
        viewModel.setScope(feedId = "f-1", categoryId = null)
        primeArticleQueue(viewModel)
        val collection = backgroundScope.launch { viewModel.articlePagingData.collect {} }
        runCurrent()

        viewModel.setScope(feedId = "f-1", categoryId = null)
        runCurrent()

        assertEquals(listOf("a1"), viewModel.state.value.items.map { it.id })
        verify(exactly = 1) { repository.articlePagingData(any(), any()) }
        collection.cancel()
    }

    @Test
    fun `empty settled paging snapshot clears stale visible articles`() = runTest {
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(sampleArticle("old-article", title = "Stale Article")),
        )

        viewModel.updateArticleQueueSnapshot(emptyList())

        assertTrue(viewModel.state.value.items.isEmpty())
    }

    @Test
    fun `empty visible snapshot does not discard the open reader queue`() = runTest {
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(
                sampleArticle("a1", title = "First Article"),
                sampleArticle("a2", title = "Second Article"),
            ),
        )
        viewModel.openArticle("a1")
        runCurrent()

        viewModel.updateArticleQueueSnapshot(emptyList())

        assertTrue(viewModel.state.value.items.isEmpty())
        assertEquals(listOf("a1", "a2"), viewModel.state.value.readerQueue.map { it.id })
        assertEquals("a1", viewModel.state.value.selectedArticle?.id)
    }

    @Test
    fun `openArticle marks unread article when auto-mark is set to navigate`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)
        viewModel.openArticle("a1")
        val s = viewModel.state.value
        assertNotNull(s.selectedArticle)
        assertEquals(true, s.items.first().isRead)
        coVerify { repository.article("a1", false) }
        coVerify { repository.markRead("a1", true, "auto_open") }
    }

    @Test
    fun `onArticleDisplayed marks selected unread article only in on-open mode`() = runTest {
        val viewModel = createViewModel()
        viewModel.setAutoMarkReadMode(AutoMarkReadPreference.ON_OPEN.apiValue)
        primeArticleQueue(viewModel)
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
        coVerify { repository.markRead("a2", true, "auto_open") }

        detailResult.complete(
            AppResult.Success(
                sampleDetail(
                    "a2",
                    title = "Fetched Second Article"
                )
            )
        )
        runCurrent()

        assertEquals("a2", viewModel.state.value.selectedArticle?.id)
        assertEquals("Fetched Second Article", viewModel.state.value.selectedArticle?.title)
        coVerify { repository.markRead("a2", true, "auto_open") }
    }

    @Test
    fun `warmed article detail is retained and selected without a loading content swap`() =
        runTest {
            val queue = listOf(
                sampleArticle("a1", title = "First Article"),
                sampleArticle("a2", title = "Second Article"),
                sampleArticle("a3", title = "Third Article"),
            )
            coEvery { repository.prefetchArticle(any()) } answers {
                val id = firstArg<String>()
                AppResult.Success(
                    sampleDetail(
                        id = id,
                        title = "Warmed $id",
                        contentText = "Complete prefetched body for $id",
                        contentVersion = 2,
                    ),
                )
            }
            val pendingDetail = CompletableDeferred<AppResult<ArticleDetail>>()
            coEvery { repository.article("a2", false) } coAnswers { pendingDetail.await() }
            val viewModel = createViewModel()
            viewModel.updateArticleQueueSnapshot(queue)

            viewModel.warmVisibleArticles(queue)
            runCurrent()
            assertEquals(
                "Complete prefetched body for a2",
                viewModel.state.value.readerDetails["a2"]?.contentText
            )

            viewModel.openArticle("a2")
            runCurrent()

            assertEquals("a2", viewModel.state.value.selectedArticle?.id)
            assertEquals(
                "Complete prefetched body for a2",
                viewModel.state.value.selectedArticle?.contentText
            )
            pendingDetail.complete(AppResult.Success(sampleDetail("a2", title = "Fetched a2")))
        }

    @Test
    fun `openArticleFromQueue publishes tapped article before canonical detail work starts`() =
        runTest {
            val detailResult = CompletableDeferred<AppResult<ArticleDetail>>()
            lateinit var viewModel: ArticlesViewModel
            var selectedWhenDetailFetchStarted: ArticleDetail? = null
            coEvery { repository.article("a2", false) } coAnswers {
                selectedWhenDetailFetchStarted = viewModel.state.value.selectedArticle
                detailResult.await()
            }
            viewModel = createViewModel()
            val tappedArticle = sampleArticle("a2", title = "Visible during reconciliation")

            viewModel.updateArticleQueueSnapshot(emptyList())
            viewModel.openArticleFromQueue("a2", listOf(tappedArticle))

            assertEquals("a2", viewModel.state.value.selectedArticle?.id)
            assertEquals(
                "Visible during reconciliation",
                viewModel.state.value.selectedArticle?.title
            )
            assertEquals("a2", selectedWhenDetailFetchStarted?.id)
            assertEquals("Visible during reconciliation", selectedWhenDetailFetchStarted?.title)
            detailResult.complete(AppResult.Success(sampleDetail("a2")))
        }

    @Test
    fun `openArticle ignores stale detail response from an older tap`() = runTest {
        val firstDetailResult = CompletableDeferred<AppResult<ArticleDetail>>()
        coEvery { repository.article("a1", false) } coAnswers { firstDetailResult.await() }
        coEvery { repository.article("a2", false) } returns AppResult.Success(
            sampleDetail(
                "a2",
                title = "Fetched Second"
            )
        )
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
    fun `late partial detail refresh does not regress the open reader content`() = runTest {
        val complete = sampleDetail(
            "a1",
            contentText = "The complete article body must remain visible while refreshes finish.",
            media = listOf(sampleMedia("hero")),
            contentVersion = 2,
        )
        val partial = sampleDetail(
            "a1",
            contentText = "The complete article body",
            media = emptyList(),
            contentVersion = 1,
        )
        coEvery { repository.article("a1", false) } returns AppResult.Success(complete)
        coEvery { repository.article("a1", true) } returns AppResult.Success(partial)
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)

        viewModel.openArticle("a1")
        runCurrent()
        viewModel.openArticle("a1", forceRefresh = true)
        runCurrent()

        val displayed = viewModel.state.value.selectedArticle
        assertEquals(complete.contentText, displayed?.contentText)
        assertEquals(listOf("hero"), displayed?.media?.map { it.id })
        assertEquals(2, displayed?.contentVersion)
    }

    @Test
    fun `openAdjacentArticle uses retained article queue`() = runTest {
        coEvery { repository.article("a1", false) } returns AppResult.Success(
            sampleDetail(
                "a1",
                title = "First Article"
            )
        )
        coEvery { repository.article("a2", false) } returns AppResult.Success(
            sampleDetail(
                "a2",
                title = "Second Article"
            )
        )
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
    fun `paging append extends an open feed reader beyond the original page`() = runTest {
        coEvery { repository.article(any(), false) } answers {
            val id = firstArg<String>()
            AppResult.Success(sampleDetail(id, title = "Detail $id"))
        }
        val firstPage = (1..30).map { index ->
            sampleArticle("a$index", title = "Article $index")
        }
        val secondPage = (31..60).map { index ->
            sampleArticle("a$index", title = "Article $index")
        }
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(firstPage)
        viewModel.openArticleFromQueue(
            id = "a30",
            queue = firstPage,
            tracksPaging = true,
        )
        runCurrent()

        viewModel.updateArticleQueueSnapshot(firstPage + secondPage)
        viewModel.openAdjacentArticle(1)
        runCurrent()

        assertEquals(60, viewModel.state.value.readerQueue.size)
        assertEquals("a31", viewModel.state.value.selectedArticle?.id)
        assertEquals("Detail a31", viewModel.state.value.selectedArticle?.title)
    }

    @Test
    fun `paging snapshots do not contaminate a search reader queue`() = runTest {
        val searchQueue = listOf(
            sampleArticle("search-1", title = "Search One"),
            sampleArticle("search-2", title = "Search Two"),
        )
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(listOf(sampleArticle("feed-1")))
        viewModel.openArticleFromQueue("search-1", searchQueue)

        viewModel.updateArticleQueueSnapshot(
            listOf(sampleArticle("feed-1"), sampleArticle("feed-2")),
        )

        assertEquals(searchQueue.map { it.id }, viewModel.state.value.readerQueue.map { it.id })
        assertEquals(false, viewModel.state.value.readerQueueTracksPaging)
    }

    @Test
    fun `visible reader page tracks the current feed immediately in both directions`() = runTest {
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(
                sampleArticle("a1", title = "First Article", feedTitle = "First Feed"),
                sampleArticle("a2", title = "Second Article", feedTitle = "Second Feed"),
            ),
        )
        viewModel.openArticle("a1")
        runCurrent()

        viewModel.onReaderPageChanged("a2")
        assertEquals("a2", viewModel.state.value.visibleReaderArticleId)
        assertEquals("Second Feed", viewModel.state.value.currentReaderFeedTitle())

        viewModel.onReaderPageChanged("a1")
        assertEquals("a1", viewModel.state.value.visibleReaderArticleId)
        assertEquals("First Feed", viewModel.state.value.currentReaderFeedTitle())
    }

    @Test
    fun `search article opens from its own queue without flashing the previous reader`() = runTest {
        coEvery { repository.article("search-1", false) } returns
                AppResult.Success(sampleDetail("search-1", title = "Fetched Search One"))
        coEvery { repository.article("search-2", false) } returns
                AppResult.Success(sampleDetail("search-2", title = "Fetched Search Two"))
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(
                sampleArticle(
                    "feed-article",
                    title = "Feed Article"
                )
            )
        )
        viewModel.openArticle("feed-article")
        val searchQueue = listOf(
            sampleArticle("search-1", title = "Search One"),
            sampleArticle("search-2", title = "Search Two"),
        )

        viewModel.openArticleFromQueue("search-1", searchQueue)
        assertEquals("search-1", viewModel.state.value.selectedArticle?.id)
        assertEquals(searchQueue.map { it.id }, viewModel.state.value.readerQueue.map { it.id })

        viewModel.openAdjacentArticle(1)
        assertEquals("search-2", viewModel.state.value.selectedArticle?.id)
    }

    @Test
    fun `closeArticle clears the selected article`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)
        viewModel.openArticle("a1")
        viewModel.closeArticle()
        assertNull(viewModel.state.value.selectedArticle)
    }

    @Test
    fun `reading and closing an article preserves the active paging generation`() = runTest {
        val viewModel = createViewModel()
        val collection = backgroundScope.launch { viewModel.articlePagingData.collect {} }
        runCurrent()
        primeArticleQueue(viewModel)

        viewModel.openArticle("a1")
        viewModel.closeArticle()
        runCurrent()

        assertEquals(listOf("a1"), viewModel.state.value.items.map { it.id })
        assertEquals(true, viewModel.state.value.items.single().isRead)
        verify(exactly = 1) { repository.articlePagingData(any(), any()) }
        collection.cancel()
    }

    @Test
    fun `background article availability does not replace the active paging generation`() =
        runTest {
            val remoteEvents = MutableSharedFlow<ReadStateSyncEvent>()
            every { repository.readStateEvents() } returns remoteEvents
            val viewModel = createViewModel()
            val collection = backgroundScope.launch { viewModel.articlePagingData.collect {} }
            runCurrent()
            primeArticleQueue(viewModel)
            viewModel.startReadStateSync()
            runCurrent()

            remoteEvents.emit(
                ArticlesNewEvent(
                    eventId = "new-1",
                    feedId = "f-1",
                    articleIds = listOf("a-new"),
                    count = 1,
                    updatedAt = "2026-07-14T00:00:00.000Z",
                ),
            )
            runCurrent()

            assertEquals(listOf("a1"), viewModel.state.value.items.map { it.id })
            verify(exactly = 1) { repository.articlePagingData(any(), any()) }
            coVerify { repository.invalidateArticleContentCaches() }
            viewModel.stopReadStateSync()
            collection.cancel()
        }

    @Test
    fun `markRead updates the local list optimistically`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)
        viewModel.markRead("a1", true)
        val s = viewModel.state.value
        assertTrue(s.items.first().isRead)
    }

    @Test
    fun `markRead refreshes unread-only paging after server confirmation`() = runTest {
        val viewModel = createViewModel()
        val collection = backgroundScope.launch { viewModel.articlePagingData.collect {} }
        runCurrent()
        viewModel.setFilter(sort = null, hideRead = true)
        runCurrent()
        primeArticleQueue(viewModel)

        viewModel.markRead("a1", true)
        runCurrent()

        verify(exactly = 3) { repository.articlePagingData(any(), any()) }
        collection.cancel()
    }

    @Test
    fun `manual unread is preserved when opening the article again`() = runTest {
        val viewModel = createViewModel()
        viewModel.setAutoMarkReadMode(AutoMarkReadPreference.DISABLED.apiValue)
        primeArticleQueue(viewModel)

        viewModel.markRead("a1", false)
        runCurrent()
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
        primeArticleQueue(viewModel)

        viewModel.markRead("a1", true)
        runCurrent()

        assertEquals(false, viewModel.state.value.items.first().isRead)
        assertEquals(false, viewModel.readStateOverrides.value["a1"])
    }

    @Test
    fun `markRead emits unread and read deltas for sidebar and stats sync`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)

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
        primeArticleQueue(viewModel)

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
        primeArticleQueue(viewModel)

        viewModel.startReadStateSync()
        runCurrent()
        remoteEvents.emit(event)
        runCurrent()
        viewModel.stopReadStateSync()

        assertEquals(listOf("a1"), viewModel.state.value.items.map { it.id })
        assertEquals(true, viewModel.state.value.items.first().isRead)
        assertEquals(true, viewModel.readStateOverrides.value["a1"])
    }

    @Test
    fun `markAllRead marks loaded articles without reloading`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)
        viewModel.markAllRead()
        val s = viewModel.state.value
        assertTrue(s.items.first().isRead)
        coVerify { repository.markAllRead(null, null) }
    }

    @Test
    fun `markAllRead emits empty feed set for all-feeds scope so consumers clear entire scope`() =
        runTest {
            coEvery { repository.markAllRead(any(), any()) } returns AppResult.Success(
                MarkAllReadResponse(markedCount = 4),
            )
            val viewModel = createViewModel()
            primeArticleQueue(viewModel)

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
        val viewModel = createViewModel()
        viewModel.updateArticleQueueSnapshot(
            listOf(sampleArticle("a1", feedId = "f-1"), sampleArticle("a2", feedId = "f-child")),
        )

        val event = backgroundScope.async { viewModel.events.first() }
        runCurrent()
        viewModel.markAllRead()

        val marked = event.await() as ArticleFeatureEvent.ScopeMarkedRead
        assertEquals(setOf("f-child"), marked.affectedFeedIds)
        assertEquals(false, viewModel.state.value.items.first { it.id == "a1" }.isRead)
        assertEquals(true, viewModel.state.value.items.first { it.id == "a2" }.isRead)
    }

    @Test
    fun `setFilter updates state and invalidates the Room-backed pager`() = runTest {
        val viewModel = createViewModel()

        viewModel.setFilter(sort = "oldest", hideRead = true)

        assertEquals("oldest", viewModel.state.value.sort)
        assertEquals(true, viewModel.state.value.hideRead)
    }

    @Test
    fun `saved destination uses an exclusive saved-only paging scope`() = runTest {
        val viewModel = createViewModel()
        viewModel.setScope(feedId = "f-1", categoryId = null)
        viewModel.setSavedOnly(true)
        val collection = backgroundScope.launch { viewModel.articlePagingData.collect {} }
        runCurrent()

        assertTrue(viewModel.state.value.savedOnly)
        assertNull(viewModel.state.value.selectedFeedId)
        assertNull(viewModel.state.value.selectedCategoryId)
        verify { repository.articlePagingData(match { it.savedOnly }, any()) }
        collection.cancel()
    }

    @Test
    fun `setSaved updates the list and reader optimistically`() = runTest {
        val viewModel = createViewModel()
        primeArticleQueue(viewModel)
        viewModel.openArticle("a1")
        runCurrent()

        viewModel.setSaved("a1", true)
        runCurrent()

        assertTrue(viewModel.state.value.items.single().isSaved)
        assertTrue(viewModel.state.value.selectedArticle?.isSaved == true)
        coVerify { repository.updateCachedSavedState("a1", true) }
        coVerify { repository.setSaved("a1", true) }
    }

    @Test
    fun `refreshArticles refreshes the Room-backed pager`() = runTest {
        val viewModel = createViewModel()

        viewModel.refreshArticles()
    }

    private fun primeArticleQueue(viewModel: ArticlesViewModel) {
        viewModel.updateArticleQueueSnapshot(listOf(sampleArticle("a1")))
    }

    private fun sampleArticle(
        id: String,
        feedId: String = "f-1",
        title: String = "T",
        feedTitle: String = "F",
    ): ArticleListItem = ArticleListItem(
        id = id,
        feedId = feedId,
        feedTitle = feedTitle,
        title = title,
        isRead = false,
    )

    private fun sampleDetail(
        id: String,
        title: String = "T",
        contentText: String? = null,
        media: List<ArticleMedia> = emptyList(),
        contentVersion: Int = 1,
    ): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "f-1",
        guid = id,
        canonicalUrl = null,
        title = title,
        author = null,
        excerpt = null,
        contentHtml = null,
        contentText = contentText,
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = null,
        hash = id,
        feedTitle = "F",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = media,
        isRead = false,
        isEnriched = contentVersion > 1,
        contentVersion = contentVersion,
    )

    private fun sampleMedia(id: String) = ArticleMedia(
        id = id,
        articleId = "a1",
        type = "image",
        provider = "unknown",
        url = "https://example.com/$id.jpg",
        position = 0,
    )
}
