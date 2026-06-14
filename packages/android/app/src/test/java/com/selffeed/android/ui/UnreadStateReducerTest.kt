package com.selffeed.android.ui

import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.StatsResponse
import org.junit.Assert.assertEquals
import org.junit.Test

class UnreadStateReducerTest {
    @Test
    fun applyFeedDelta_clampsUnreadCountAtZero() {
        val feeds = listOf(sampleFeed(id = "feed-1", unreadCount = 1))

        val updated = UnreadStateReducer.applyFeedDelta(feeds, feedId = "feed-1", delta = -5)

        assertEquals(0, updated.first().unreadCount)
    }

    @Test
    fun applyCategoryDeltas_updatesNestedChildrenWithoutTouchingOtherBranches() {
        val categories = listOf(
            sampleCategory(
                id = "parent",
                unreadCount = 5,
                children = listOf(sampleCategory(id = "child", unreadCount = 3)),
            ),
            sampleCategory(id = "other", unreadCount = 7),
        )

        val updated = UnreadStateReducer.applyCategoryDeltas(
            categories = categories,
            deltas = mapOf("child" to -2),
        )

        assertEquals(5, updated.first { it.id == "parent" }.unreadCount)
        assertEquals(1, updated.first { it.id == "parent" }.children!!.first().unreadCount)
        assertEquals(7, updated.first { it.id == "other" }.unreadCount)
    }

    @Test
    fun applyStatsDelta_clampsTotalsAtZero() {
        val stats = StatsResponse(
            totalUnread = 1,
            totalRead = 1,
            totalFeeds = 0,
            totalCategories = 0,
            recentSyncRuns = emptyList(),
            dailyMetrics = emptyList(),
        )

        val updated = UnreadStateReducer.applyStatsDelta(stats, unreadDelta = -5, readDelta = -5)

        assertEquals(0, updated.totalUnread)
        assertEquals(0, updated.totalRead)
    }

    private fun sampleFeed(
        id: String,
        unreadCount: Int,
    ): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = "category-1",
        title = "Feed",
        feedUrl = "https://example.com/feed.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = unreadCount,
    )

    private fun sampleCategory(
        id: String,
        unreadCount: Int,
        children: List<CategoryWithCounts>? = null,
    ): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = "Category",
        slug = id,
        sortOrder = 0,
        feedCount = 0,
        unreadCount = unreadCount,
        children = children,
    )
}
