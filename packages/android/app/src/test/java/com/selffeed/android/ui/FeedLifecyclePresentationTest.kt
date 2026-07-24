package com.selffeed.android.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.FeedSyncScope
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class FeedLifecyclePresentationTest {
    private val resources
        get() = ApplicationProvider.getApplicationContext<Context>().resources

    @Test
    fun `pending and discovery feeds cannot enqueue duplicate refreshes`() {
        val pending = feedLifecyclePresentation(feed(lifecycleStatus = "pending"))
        val discovery = feedLifecyclePresentation(feed(lifecycleStatus = "discovery_required"))

        assertTrue(pending?.refreshBlocked == true)
        assertTrue(discovery?.refreshBlocked == true)
        assertTrue(discovery?.discoveryRequired == true)
    }

    @Test
    fun `backoff remains blocked only until server eligibility`() {
        val waiting = feedLifecyclePresentation(
            feed(lifecycleStatus = "backoff", nextEligibleFetchAt = "2026-07-18T13:00:00Z"),
            nowEpochMillis = java.time.Instant.parse("2026-07-18T12:00:00Z").toEpochMilli(),
        )
        val eligible = feedLifecyclePresentation(
            feed(lifecycleStatus = "backoff", nextEligibleFetchAt = "2026-07-18T11:00:00Z"),
            nowEpochMillis = java.time.Instant.parse("2026-07-18T12:00:00Z").toEpochMilli(),
        )

        assertTrue(waiting?.refreshBlocked == true)
        assertTrue(waiting?.refreshGuidance?.resolve(resources)?.startsWith("Available after ") == true)
        assertTrue(waiting?.detail?.resolve(resources)?.contains("Existing articles remain") == true)
        assertFalse(eligible?.refreshBlocked == true)
    }

    @Test
    fun `replacement explains old articles remain and can be cancelled`() {
        val lifecycle = feedLifecyclePresentation(feed(lifecycleStatus = "replacement_pending"))

        assertTrue(lifecycle?.detail?.resolve(resources)?.contains("Existing articles remain") == true)
        assertTrue(lifecycle?.canCancelReplacement == true)
    }

    @Test
    fun `active refresh blocks only overlapping scopes`() {
        val feeds = listOf(
            feed(lifecycleStatus = "active"),
            feed(lifecycleStatus = "active").copy(id = "feed-2", categoryId = "category-2"),
        )
        val active = FeedSyncAllStatus(
            queued = false,
            running = true,
            active = true,
            stale = false,
            scope = FeedSyncScope(feedId = "feed-1"),
        )

        assertTrue(refreshScopesOverlap("feed-1", null, active, feeds))
        assertFalse(refreshScopesOverlap("feed-2", null, active, feeds))
        assertTrue(refreshScopesOverlap(null, null, active, feeds))
    }

    private fun feed(lifecycleStatus: String, nextEligibleFetchAt: String? = null) = FeedWithCounts(
        id = "feed-1",
        categoryId = "category-1",
        title = "Example",
        feedUrl = "https://example.com/feed.xml",
        pollingIntervalMinutes = 60,
        syncStatus = lifecycleStatus,
        lifecycleStatus = lifecycleStatus,
        nextEligibleFetchAt = nextEligibleFetchAt,
        unreadCount = 0,
    )
}
