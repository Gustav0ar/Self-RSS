package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
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
class FeedsViewModelTest {
    private lateinit var repository: RssRepository
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.categories() } returns AppResult.Success(emptyList())
        coEvery { repository.feeds(any()) } returns AppResult.Success(emptyList())
        coEvery { repository.createCategory(any(), any()) } returns AppResult.Success(sampleCategory())
        coEvery { repository.updateCategory(any(), any(), any()) } returns AppResult.Success(sampleCategory())
        coEvery { repository.deleteCategory(any()) } returns AppResult.Success(true)
        coEvery { repository.createFeed(any(), any(), any()) } returns AppResult.Success(sampleFeed())
        coEvery { repository.updateFeed(any(), any(), any(), any()) } returns AppResult.Success(sampleFeed())
        coEvery { repository.deleteFeed(any()) } returns AppResult.Success(true)
        coEvery { repository.syncAllFeeds() } returns AppResult.Success(SyncResponse(syncedFeeds = 3, failedFeeds = 0))
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
    fun `createCategory surfaces status message`() = runTest {
        val viewModel = FeedsViewModel(repository)
        viewModel.createCategory("Tech")
        assertEquals("Category created", viewModel.state.value.statusMessage)
        coVerify { repository.createCategory("Tech", null) }
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
