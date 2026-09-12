package com.selffeed.android.ui

import com.selffeed.android.data.repository.LibraryCounts
import kotlinx.coroutines.flow.MutableStateFlow
import com.selffeed.android.R
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.CategoryMoveDirection
import com.selffeed.android.network.CategoryOrderUpdate
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FeedsViewModelTest {
    private lateinit var repository: RssRepository
    private lateinit var countUpdates: MutableStateFlow<LibraryCounts>
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        countUpdates = MutableStateFlow(LibraryCounts())
        every { repository.libraryCounts() } returns countUpdates
        every { repository.categoryUpdates() } answers { flow {
            when (val result = repository.categories()) {
                is AppResult.Success -> emit(AppResult.Success(result.data))
                is AppResult.Error -> emit(result)
            }
        } }
        every { repository.feedUpdates() } answers { flow {
            when (val result = repository.refreshFeeds(null)) {
                is AppResult.Success -> emit(AppResult.Success(result.data))
                is AppResult.Error -> emit(result)
            }
        } }
        coEvery { repository.categories() } returns AppResult.Success(emptyList())
        coEvery { repository.refreshFeeds(any()) } returns AppResult.Success(emptyList())
        coEvery { repository.refreshFeeds(any()) } returns AppResult.Success(emptyList())
        coEvery { repository.createCategory(any(), any()) } returns AppResult.Success(sampleCategory())
        coEvery { repository.updateCategory(any(), any(), any()) } returns AppResult.Success(sampleCategory())
        coEvery { repository.deleteCategory(any()) } returns AppResult.Success(true)
        coEvery { repository.createFeed(any(), any(), any()) } returns AppResult.Success(sampleFeed())
        coEvery { repository.updateFeed(any(), any(), any(), any(), any()) } returns AppResult.Success(sampleFeed())
        coEvery { repository.deleteFeed(any()) } returns AppResult.Success(true)
        coEvery { repository.syncAllFeeds() } returns AppResult.Success(SyncResponse(syncedFeeds = 3, failedFeeds = 0))
        coEvery { repository.syncAllFeedsStatus() } returns AppResult.Success(completedSyncStatus())
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `moving a nested category updates only siblings and preserves concurrent unread counts`() = runTest {
        coEvery { repository.refreshFeeds(any()) } returns AppResult.Success(listOf(sampleFeed("f", "b")))
        val children = listOf(sampleCategory("a"), sampleCategory("b")).map { it.copy(parentCategoryId = "parent") }
        val original = listOf(sampleCategory("parent", children = children), sampleCategory("other"))
        coEvery { repository.categories() } returns AppResult.Success(original)
        val pending = CompletableDeferred<AppResult<Unit>>()
        coEvery { repository.reorderCategories(any()) } coAnswers { pending.await() }
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()

        viewModel.loadFeeds()
        viewModel.moveCategory("b", CategoryMoveDirection.UP)
        viewModel.moveCategory("a", CategoryMoveDirection.DOWN)
        assertTrue(viewModel.state.value.reorderingCategories)
        assertEquals(original, viewModel.state.value.categories)
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeLibraryCounts() }
        countUpdates.value = LibraryCounts(mapOf("f" to 3), mapOf("b" to 3, "parent" to 3))
        pending.complete(AppResult.Success(Unit))
        runCurrent()

        assertFalse(viewModel.state.value.reorderingCategories)
        assertEquals(listOf("parent", "other"), viewModel.state.value.categories.map { it.id })
        val reordered = viewModel.state.value.categories.first().children.orEmpty()
        assertEquals(listOf("b", "a"), reordered.map { it.id })
        assertEquals(3, reordered.first().unreadCount)
        coVerify(exactly = 1) { repository.reorderCategories(listOf(CategoryOrderUpdate("b", 0), CategoryOrderUpdate("a", 1))) }
    }

    @Test
    fun `category boundaries and failed requests leave the existing order intact`() = runTest {
        val original = listOf(sampleCategory("a"), sampleCategory("b"))
        coEvery { repository.categories() } returns AppResult.Success(original)
        coEvery { repository.reorderCategories(any()) } returns AppResult.Error("Offline")
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()

        viewModel.moveCategory("a", CategoryMoveDirection.UP)
        viewModel.moveCategory("b", CategoryMoveDirection.DOWN)
        viewModel.moveCategory("missing", CategoryMoveDirection.UP)
        coVerify(exactly = 0) { repository.reorderCategories(any()) }
        viewModel.moveCategory("b", CategoryMoveDirection.UP)

        assertEquals(original, viewModel.state.value.categories)
        assertFalse(viewModel.state.value.reorderingCategories)
        assertEquals(PresentationText.dynamic("Offline"), viewModel.state.value.errorMessage)
    }

    @Test
    fun `category load started before a move cannot undo the saved order`() = runTest {
        val original = listOf(sampleCategory("a"), sampleCategory("b"))
        coEvery { repository.categories() } returns AppResult.Success(original)
        coEvery { repository.reorderCategories(any()) } returns AppResult.Success(Unit)
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()
        val oldLoad = CompletableDeferred<AppResult<List<CategoryWithCounts>>>()
        coEvery { repository.categories() } coAnswers { oldLoad.await() }
        viewModel.loadCategories()
        viewModel.moveCategory("b", CategoryMoveDirection.UP)
        oldLoad.complete(AppResult.Success(original))
        runCurrent()

        assertEquals(listOf("b", "a"), viewModel.state.value.categories.map { it.id })
    }

    @Test
    fun `loadCategories populates the state`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()
        assertNotNull(viewModel.state.value.categories)
    }

    @Test
    fun `loadFeeds populates the state`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.loadFeeds()
        assertNotNull(viewModel.state.value.feeds)
    }

    @Test
    fun `refreshFeedHealth publishes fresh server feed failures`() = runTest {
        val failedFeed = sampleFeed().copy(
            syncStatus = "error",
            lastSyncError = "HTTP 503: Service Unavailable",
        )
        coEvery { repository.refreshFeeds(null) } returns AppResult.Success(listOf(failedFeed))
        val viewModel = FeedsViewModel(repository)

        viewModel.refreshFeedHealth()

        assertEquals("HTTP 503: Service Unavailable", viewModel.state.value.feeds.single().lastSyncError)
        coVerify { repository.refreshFeeds(null) }
    }

    @Test
    fun `cancelling the health read caller cancels its actual repository request`() = runTest {
        val cancelled = CompletableDeferred<Unit>()
        coEvery { repository.refreshFeeds(null) } coAnswers {
            try { awaitCancellation() } finally { cancelled.complete(Unit) }
        }
        val viewModel = FeedsViewModel(repository)
        val caller = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            viewModel.refreshFeedHealth()
            awaitCancellation()
        }
        caller.cancelAndJoin()
        try {
            assertTrue("Health I/O must belong to its caller", cancelled.isCompleted)
        } finally {
            viewModel.viewModelScope.cancel()
        }
    }

    @Test
    fun `a queued user refresh does not start interactive polling without a visible host`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.syncAllFeeds()

        coVerify(exactly = 1) { repository.syncAllFeeds() }
        coVerify(exactly = 0) { repository.syncAllFeedsStatus() }
        assertTrue(viewModel.state.value.syncInBackground)
    }

    @Test
    fun `foreground cancellation stops blocked status and health requests before restarting`() = runTest {
        var statusCalls = 0
        var activeStatus = 0
        var healthCalls = 0
        var activeHealth = 0
        coEvery { repository.syncAllFeedsStatus() } coAnswers {
            statusCalls++
            activeStatus++
            try { awaitCancellation() } finally { activeStatus-- }
        }
        coEvery { repository.refreshFeeds(null) } coAnswers {
            healthCalls++
            activeHealth++
            try { awaitCancellation() } finally { activeHealth-- }
        }
        val viewModel = FeedsViewModel(repository)
        val first = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(1, activeStatus)
        assertEquals(1, activeHealth)
        first.cancelAndJoin()
        assertEquals(0, activeStatus)
        assertEquals(0, activeHealth)
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(1, statusCalls)
        assertEquals(1, healthCalls)

        val resumed = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        assertEquals(2, statusCalls)
        assertEquals(1, activeStatus)
        resumed.cancelAndJoin()
        assertEquals(0, activeStatus)
    }

    @Test
    fun `late queue submission survives foreground cancellation and wakes resume only once`() = runTest {
        val queued = CompletableDeferred<AppResult<SyncResponse>>()
        coEvery { repository.syncAllFeeds() } coAnswers { queued.await() }
        val viewModel = FeedsViewModel(repository)
        val first = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        viewModel.syncAllFeeds()
        first.cancelAndJoin()
        assertFalse(queued.isCancelled)
        queued.complete(AppResult.Success(SyncResponse(status = "queued")))
        runCurrent()
        coVerify(exactly = 1) { repository.syncAllFeedsStatus() }
        assertTrue(viewModel.state.value.syncInBackground)

        val resumed = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        runCurrent()
        coVerify(exactly = 2) { repository.syncAllFeedsStatus() }
        assertFalse(viewModel.state.value.syncInBackground)
        assertEquals(1L, viewModel.state.value.syncRevision)
        resumed.cancelAndJoin()
    }

    @Test
    fun `resuming during a slow queue submission cannot declare its refresh completed`() = runTest {
        val queued = CompletableDeferred<AppResult<SyncResponse>>()
        coEvery { repository.syncAllFeeds() } coAnswers { queued.await() }
        val viewModel = FeedsViewModel(repository)
        viewModel.syncAllFeeds()
        advanceTimeBy(4_000)
        runCurrent()
        assertFalse(viewModel.state.value.loading)
        val foreground = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        assertEquals(0L, viewModel.state.value.syncRevision)
        assertTrue(viewModel.state.value.syncInBackground)
        coVerify(exactly = 0) { repository.syncAllFeedsStatus() }

        queued.complete(AppResult.Success(SyncResponse(status = "queued")))
        runCurrent()
        assertEquals(1L, viewModel.state.value.syncRevision)
        coVerify(exactly = 1) { repository.syncAllFeedsStatus() }
        foreground.cancelAndJoin()
    }

    @Test
    fun `status requested before a pending submission cannot complete that submission`() = runTest {
        val oldStatus = CompletableDeferred<AppResult<FeedSyncAllStatus>>()
        val queued = CompletableDeferred<AppResult<SyncResponse>>()
        var statusCalls = 0
        coEvery { repository.syncAllFeedsStatus() } coAnswers {
            if (statusCalls++ == 0) oldStatus.await() else AppResult.Success(completedSyncStatus())
        }
        coEvery { repository.syncAllFeeds() } coAnswers { queued.await() }
        val viewModel = FeedsViewModel(repository)
        val foreground = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        viewModel.syncAllFeeds()
        advanceTimeBy(4_000)
        runCurrent()
        oldStatus.complete(AppResult.Success(completedSyncStatus()))
        runCurrent()
        assertEquals(0L, viewModel.state.value.syncRevision)
        assertTrue(viewModel.state.value.syncInBackground)

        queued.complete(AppResult.Success(SyncResponse(status = "queued")))
        runCurrent()
        assertEquals(1L, viewModel.state.value.syncRevision)
        assertEquals(2, statusCalls)
        foreground.cancelAndJoin()
    }

    @Test
    fun `status requested before a completed submission cannot resume an obsolete monitor`() = runTest {
        val oldStatus = CompletableDeferred<AppResult<FeedSyncAllStatus>>()
        var statusCalls = 0
        coEvery { repository.syncAllFeedsStatus() } coAnswers {
            if (statusCalls++ == 0) oldStatus.await() else AppResult.Success(completedSyncStatus())
        }
        val viewModel = FeedsViewModel(repository)
        val foreground = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        viewModel.syncAllFeeds()
        oldStatus.complete(AppResult.Success(completedSyncStatus().copy(active = true, running = true)))
        runCurrent()

        assertEquals(1L, viewModel.state.value.syncRevision)
        assertEquals(2, statusCalls)
        assertFalse(viewModel.state.value.syncInBackground)
        foreground.cancelAndJoin()
    }

    @Test
    fun `read changes during snapshot requests preserve nested counts and accept new metadata`() = runTest {
        for (markScope in listOf(false, true)) {
            val child = sampleCategory("child").copy(unreadCount = 2)
            val parent = sampleCategory("parent", children = listOf(child)).copy(unreadCount = 2)
            val feed = sampleFeed("feed", "child").copy(unreadCount = 2)
            coEvery { repository.categories() } returns AppResult.Success(listOf(parent))
            coEvery { repository.refreshFeeds(null) } returns AppResult.Success(listOf(feed))
            val model = FeedsViewModel(repository)
            model.refreshCategories()
            model.refreshFeedHealth()
            val categoryResponse = CompletableDeferred<AppResult<List<CategoryWithCounts>>>()
            val feedResponse = CompletableDeferred<AppResult<List<FeedWithCounts>>>()
            coEvery { repository.categories() } coAnswers { categoryResponse.await() }
            coEvery { repository.refreshFeeds(null) } coAnswers { feedResponse.await() }
            val categories = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.refreshCategories() }
            val feeds = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.refreshFeedHealth() }
            val observer = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.observeLibraryCounts() }
            val storedCount = if (markScope) 0 else 1
            countUpdates.value = LibraryCounts(mapOf("feed" to storedCount), mapOf("parent" to storedCount, "child" to storedCount))
            categoryResponse.complete(AppResult.Success(listOf(parent.copy(name = "Updated parent"))))
            feedResponse.complete(AppResult.Success(listOf(feed.copy(title = "Updated feed"))))
            categories.join()
            feeds.join()

            val expectedCount = if (markScope) 0 else 1
            assertEquals("Updated feed", model.state.value.feeds.single().title)
            assertEquals(expectedCount, model.state.value.feeds.single().unreadCount)
            val updatedParent = model.state.value.categories.single()
            assertEquals("Updated parent", updatedParent.name)
            assertEquals(expectedCount, updatedParent.unreadCount)
            assertEquals(expectedCount, updatedParent.children!!.single().unreadCount)
            observer.cancelAndJoin()
            countUpdates.value = LibraryCounts()
        }
    }

    @Test
    fun `feed creation receives delayed replacement metadata without waiting for polling`() = runTest {
        val original = sampleFeed("original")
        val created = sampleFeed("created")
        coEvery { repository.refreshFeeds(null) } returns AppResult.Success(listOf(original))
        val viewModel = FeedsViewModel(repository)
        viewModel.loadFeeds()
        val response = CompletableDeferred<AppResult<List<FeedWithCounts>>>()
        coEvery { repository.refreshFeeds(null) } coAnswers { response.await() }
        coEvery { repository.createFeed(any(), any(), any()) } returns AppResult.Success(created)
        viewModel.createFeed("https://example.invalid/rss", "c-1", null)
        assertEquals(listOf("original"), viewModel.state.value.feeds.map { it.id })
        response.complete(AppResult.Success(listOf(original, created)))
        runCurrent()
        assertEquals(listOf("original", "created"), viewModel.state.value.feeds.map { it.id })
    }

    @Test
    fun `createCategory surfaces status message`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createCategory("Tech")
        assertEquals(
            PresentationText.resource(R.string.feeds_category_created),
            viewModel.state.value.statusMessage,
        )
        coVerify { repository.createCategory("Tech", null) }
    }

    @Test
    fun `createCategory preserves the selected parent`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createCategory("Android", parentCategoryId = "tech")

        coVerify { repository.createCategory("Android", "tech") }
    }

    @Test
    fun `createCategory with blank name is a no-op`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createCategory("   ")
        coVerify(exactly = 0) { repository.createCategory(any(), any()) }
    }

    @Test
    fun `deleteCategory surfaces status and reloads`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.deleteCategory("c-1")
        assertEquals(
            PresentationText.resource(R.string.feeds_category_deleted),
            viewModel.state.value.statusMessage,
        )
        coVerify { repository.deleteCategory("c-1") }
    }

    @Test
    fun `createFeed with blank url is a no-op`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createFeed("", "c-1", "Title")
        coVerify(exactly = 0) { repository.createFeed(any(), any(), any()) }
    }

    @Test
    fun `updateFeed trims and forwards the edited URL`() = runTest {
        val viewModel = FeedsViewModel(repository)

        viewModel.updateFeed(
            id = "f-1",
            feedUrl = "  https://example.com/replacement.xml  ",
            title = "Replacement",
            categoryId = "c-1",
            pollingIntervalMinutes = 60,
        )

        coVerify {
            repository.updateFeed(
                "f-1",
                "https://example.com/replacement.xml",
                "c-1",
                "Replacement",
                60,
            )
        }
    }

    @Test
    fun `syncAllFeeds sets loading flag and populates lastSyncSummary`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        val s = viewModel.state.value
        assertEquals(false, s.loading)
        assertEquals(3, s.lastSyncSummary?.syncedFeeds)
        assertEquals(1L, s.syncRevision)
    }

    @Test
    fun `syncAllFeeds increments sync revision when summary is unchanged`() = runTest {
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        val firstRevision = viewModel.state.value.syncRevision
        val firstSummary = viewModel.state.value.lastSyncSummary

        viewModel.syncAllFeeds()

        assertEquals(firstSummary, viewModel.state.value.lastSyncSummary)
        assertEquals(firstRevision + 1, viewModel.state.value.syncRevision)
    }

    @Test
    fun `queue response timeout releases foreground loading without cancelling the refresh`() = runTest {
        val delayedResponse = CompletableDeferred<AppResult<SyncResponse>>()
        coEvery { repository.syncAllFeeds() } coAnswers { delayedResponse.await() }
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        advanceTimeBy(4_000L)
        runCurrent()

        assertEquals(false, viewModel.state.value.loading)
        assertEquals(true, viewModel.state.value.syncInBackground)
        assertEquals(
            PresentationText.resource(R.string.feeds_sync_checking),
            viewModel.state.value.statusMessage,
        )
        coVerify(exactly = 0) { repository.syncAllFeedsStatus() }

        delayedResponse.complete(AppResult.Success(SyncResponse(status = "queued")))
        runCurrent()

        assertEquals(1L, viewModel.state.value.syncRevision)
        coVerify { repository.syncAllFeedsStatus() }
    }

    @Test
    fun `syncAllFeeds forwards the selected scope`() = runTest {
        coEvery { repository.syncAllFeeds("feed-1", "category-1") } returns
            AppResult.Success(SyncResponse(status = "queued"))
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds(feedId = "feed-1", categoryId = "category-1")

        coVerify { repository.syncAllFeeds("feed-1", "category-1") }
    }

    @Test
    fun `active sync publishes article revision before bulk completion`() = runTest {
        coEvery { repository.syncAllFeedsStatus() } returnsMany listOf(
            AppResult.Success(
                FeedSyncAllStatus(
                    queued = false,
                    running = true,
                    active = true,
                    stale = false,
                    totalFeeds = 4,
                    completedFeeds = 1,
                    newArticles = 2,
                    articleRevision = 7,
                ),
            ),
            AppResult.Success(completedSyncStatus().copy(articleRevision = 7)),
        )
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }

        assertEquals(7L, viewModel.state.value.articleRevision)
        assertTrue(viewModel.state.value.syncInBackground)
        assertEquals(4, viewModel.state.value.syncTotalFeeds)
        assertEquals(1, viewModel.state.value.syncCompletedFeeds)
        assertEquals(2, viewModel.state.value.syncNewArticles)
        assertEquals(0L, viewModel.state.value.syncRevision)

        viewModel.syncAllFeeds()

        coVerify(exactly = 1) { repository.syncAllFeeds() }
        assertEquals(
            PresentationText.resource(R.string.feeds_sync_background_progress, 1, 4),
            viewModel.state.value.statusMessage,
        )
    }

    @Test
    fun `reconcileSyncStatus restores loading UX for a backend refresh`() = runTest {
        val active = FeedSyncAllStatus(
            queued = false,
            running = true,
            active = true,
            stale = false,
            totalFeeds = 6,
            completedFeeds = 2,
            newArticles = 3,
            articleRevision = 9,
        )
        coEvery { repository.syncAllFeedsStatus() } returnsMany listOf(
            AppResult.Success(active),
            AppResult.Success(completedSyncStatus().copy(articleRevision = 9)),
        )
        val viewModel = FeedsViewModel(repository)

        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }

        assertEquals(true, viewModel.state.value.syncInBackground)
        assertEquals(6, viewModel.state.value.syncTotalFeeds)
        assertEquals(2, viewModel.state.value.syncCompletedFeeds)
        assertEquals(9L, viewModel.state.value.articleRevision)

        advanceTimeBy(750L)
        runCurrent()

        assertEquals(false, viewModel.state.value.syncInBackground)
        assertEquals(1L, viewModel.state.value.syncRevision)
    }

    @Test
    fun `transient status failure keeps the backend refresh animation visible`() = runTest {
        val active = FeedSyncAllStatus(
            queued = false,
            running = true,
            active = true,
            stale = false,
            totalFeeds = 2,
            completedFeeds = 1,
        )
        coEvery { repository.syncAllFeedsStatus() } returnsMany listOf(
            AppResult.Error("temporary status failure"),
            AppResult.Success(active),
            AppResult.Success(completedSyncStatus()),
        )
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }

        assertEquals(true, viewModel.state.value.syncInBackground)
        assertEquals(
            PresentationText.resource(R.string.feeds_sync_background),
            viewModel.state.value.statusMessage,
        )
        assertNull(viewModel.state.value.errorMessage)

        advanceTimeBy(750L)
        runCurrent()
        assertEquals(true, viewModel.state.value.syncInBackground)
        assertEquals(1, viewModel.state.value.syncCompletedFeeds)

        advanceTimeBy(750L)
        runCurrent()
        assertEquals(false, viewModel.state.value.syncInBackground)
    }

    @Test
    fun `status monitoring is bounded when status requests keep failing`() = runTest {
        coEvery { repository.syncAllFeedsStatus() } returns AppResult.Error("status unavailable")
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }
        assertEquals(true, viewModel.state.value.syncInBackground)

        advanceTimeBy(330_000L)
        runCurrent()

        assertEquals(false, viewModel.state.value.syncInBackground)
        assertNull(viewModel.state.value.errorMessage)
        assertEquals(
            PresentationText.resource(R.string.feeds_sync_continues),
            viewModel.state.value.statusMessage,
        )
    }

    @Test
    fun `stale backend status stops the animation with an actionable error`() = runTest {
        coEvery { repository.syncAllFeedsStatus() } returns AppResult.Success(
            completedSyncStatus().copy(stale = true),
        )
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }

        assertEquals(false, viewModel.state.value.syncInBackground)
        assertNull(viewModel.state.value.errorMessage)
        assertEquals(
            PresentationText.resource(R.string.feeds_sync_stale),
            viewModel.state.value.statusMessage,
        )
    }

    @Test
    fun `completed sync reports failures and skipped feeds instead of claiming up to date`() = runTest {
        coEvery { repository.syncAllFeedsStatus() } returns AppResult.Success(
            completedSyncStatus().copy(
                newArticles = 1,
                syncedFeeds = 2,
                failedFeeds = 1,
                skippedFeeds = 2,
            ),
        )
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.observeForeground() }

        assertEquals(
            PresentationText.joined(
                listOf(
                    PresentationText.plural(R.plurals.feeds_sync_new_articles, 1),
                    PresentationText.plural(R.plurals.feeds_sync_failed_feeds, 1),
                    PresentationText.plural(R.plurals.feeds_sync_skipped_feeds, 2),
                ),
            ),
            viewModel.state.value.statusMessage,
        )
        assertEquals(false, viewModel.state.value.syncInBackground)
    }

    @Test
    fun `importOpml exposes a result summary and refreshes subscription data`() = runTest {
        coEvery { repository.importOpml(any(), any()) } returns AppResult.Success(
            OpmlImportSummary(
                createdCategories = 2,
                createdFeeds = 3,
                skippedDuplicates = 1,
                invalidEntries = 0,
            ),
        )
        val viewModel = FeedsViewModel(repository)

        viewModel.importOpml("feeds.opml", "<opml/>".encodeToByteArray())

        assertEquals(3, viewModel.state.value.lastImportSummary?.createdFeeds)
        assertEquals(
            PresentationText.resource(R.string.feeds_import_status, 3, 2),
            viewModel.state.value.statusMessage,
        )
        coVerify { repository.categories() }
        coVerify { repository.refreshFeeds(null) }
    }

    @Test
    fun `clearMessages wipes error and status`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createCategory("Tech")
        viewModel.clearMessages()
        assertNull(viewModel.state.value.statusMessage)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `failure paths surface error messages`() = runTest {
        coEvery { repository.categories() } returns AppResult.Error("boom")
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()
        assertEquals(PresentationText.dynamic("boom"), viewModel.state.value.errorMessage)
    }

    private fun sampleCategory(
        id: String = "c-1",
        unreadCount: Int = 0,
        children: List<CategoryWithCounts>? = null,
    ): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = "Tech",
        slug = "tech",
        sortOrder = 0,
        feedCount = 0,
        unreadCount = unreadCount,
        children = children,
    )

    private fun sampleFeed(
        id: String = "f-1",
        categoryId: String = "c-1",
        unreadCount: Int = 0,
    ): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed",
        feedUrl = "https://example.com/feed.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = unreadCount,
    )
}

private fun completedSyncStatus() = FeedSyncAllStatus(
    queued = false,
    running = false,
    active = false,
    stale = false,
)
