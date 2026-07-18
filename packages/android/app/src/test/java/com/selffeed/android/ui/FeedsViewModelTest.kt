package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
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
class FeedsViewModelTest {
    private lateinit var repository: RssRepository
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.categories() } returns AppResult.Success(emptyList())
        coEvery { repository.feeds(any()) } returns AppResult.Success(emptyList())
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
    fun `createCategory surfaces status message`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createCategory("Tech")
        assertEquals("Category created", viewModel.state.value.statusMessage)
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
        assertEquals("Category deleted", viewModel.state.value.statusMessage)
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
        val s = viewModel.state.value
        assertEquals(false, s.loading)
        assertEquals(3, s.lastSyncSummary?.syncedFeeds)
        assertEquals(1L, s.syncRevision)
    }

    @Test
    fun `syncAllFeeds increments sync revision when summary is unchanged`() = runTest {
        val viewModel = FeedsViewModel(repository)

        viewModel.syncAllFeeds()
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
        advanceTimeBy(4_000L)
        runCurrent()

        assertEquals(false, viewModel.state.value.loading)
        assertEquals(true, viewModel.state.value.syncInBackground)
        assertEquals("Checking background refresh", viewModel.state.value.statusMessage)
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

        assertEquals(7L, viewModel.state.value.articleRevision)
        assertTrue(viewModel.state.value.syncInBackground)
        assertEquals(4, viewModel.state.value.syncTotalFeeds)
        assertEquals(1, viewModel.state.value.syncCompletedFeeds)
        assertEquals(2, viewModel.state.value.syncNewArticles)
        assertEquals(0L, viewModel.state.value.syncRevision)

        viewModel.syncAllFeeds()

        coVerify(exactly = 1) { repository.syncAllFeeds() }
        assertEquals("Refreshing feeds in background · 1/4", viewModel.state.value.statusMessage)
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
            AppResult.Success(active),
            AppResult.Success(completedSyncStatus().copy(articleRevision = 9)),
        )
        val viewModel = FeedsViewModel(repository)

        viewModel.reconcileSyncStatus()

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

        assertEquals(true, viewModel.state.value.syncInBackground)
        assertEquals("Refreshing feeds in the background", viewModel.state.value.statusMessage)
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
        assertEquals(true, viewModel.state.value.syncInBackground)

        advanceTimeBy(330_000L)
        runCurrent()

        assertEquals(false, viewModel.state.value.syncInBackground)
        assertNull(viewModel.state.value.errorMessage)
        assertEquals(
            "Refresh continues on the server; progress will be checked on the next app status check.",
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

        assertEquals(false, viewModel.state.value.syncInBackground)
        assertNull(viewModel.state.value.errorMessage)
        assertEquals(
            "Refresh progress is stale; the server will reconcile it before another overlapping refresh.",
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

        assertEquals(
            "1 new article · 1 feed failed · 2 feeds skipped",
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
        assertEquals("OPML imported: 3 feeds, 2 categories", viewModel.state.value.statusMessage)
        coVerify { repository.categories() }
        coVerify { repository.feeds(null) }
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
        assertEquals("boom", viewModel.state.value.errorMessage)
    }

    @Test
    fun `applyUnreadDelta keeps feed and category badges in sync`() = runTest {
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(unreadCount = 2)),
        )
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(sampleFeed(unreadCount = 2)),
        )
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()
        viewModel.loadFeeds()

        viewModel.applyUnreadDelta(feedId = "f-1", unreadDelta = -1)

        assertEquals(1, viewModel.state.value.feeds.first().unreadCount)
        assertEquals(1, viewModel.state.value.categories.first().unreadCount)
    }

    @Test
    fun `applyScopeMarkedRead clears only targeted feed badges`() = runTest {
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(unreadCount = 5)),
        )
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(
                sampleFeed(id = "f-1", unreadCount = 2),
                sampleFeed(id = "f-2", unreadCount = 3),
            ),
        )
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()
        viewModel.loadFeeds()

        viewModel.applyScopeMarkedRead(
            feedId = null,
            categoryId = null,
            affectedFeedIds = setOf("f-1"),
        )

        assertEquals(0, viewModel.state.value.feeds.first { it.id == "f-1" }.unreadCount)
        assertEquals(3, viewModel.state.value.feeds.first { it.id == "f-2" }.unreadCount)
        assertEquals(3, viewModel.state.value.categories.first().unreadCount)
    }

    @Test
    fun `applyScopeMarkedRead for all feeds clears category badges even before feeds load`() = runTest {
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(unreadCount = 5)),
        )
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()

        viewModel.applyScopeMarkedRead(
            feedId = null,
            categoryId = null,
            affectedFeedIds = emptySet(),
        )

        assertEquals(0, viewModel.state.value.categories.first().unreadCount)
    }

    @Test
    fun `applyScopeMarkedRead for a parent category includes descendant feed ids`() = runTest {
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(
                sampleCategory(
                    id = "c-parent",
                    unreadCount = 5,
                    children = listOf(sampleCategory(id = "c-child", unreadCount = 3)),
                ),
            ),
        )
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(
                sampleFeed(id = "f-parent", categoryId = "c-parent", unreadCount = 2),
                sampleFeed(id = "f-child", categoryId = "c-child", unreadCount = 3),
                sampleFeed(id = "f-other", categoryId = "c-other", unreadCount = 4),
            ),
        )
        val viewModel = FeedsViewModel(repository)
        viewModel.loadCategories()
        viewModel.loadFeeds()

        viewModel.applyScopeMarkedRead(
            feedId = null,
            categoryId = "c-parent",
            affectedFeedIds = emptySet(),
        )

        assertEquals(0, viewModel.state.value.feeds.first { it.id == "f-parent" }.unreadCount)
        assertEquals(0, viewModel.state.value.feeds.first { it.id == "f-child" }.unreadCount)
        assertEquals(4, viewModel.state.value.feeds.first { it.id == "f-other" }.unreadCount)
        assertEquals(0, viewModel.state.value.categories.first().unreadCount)
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
