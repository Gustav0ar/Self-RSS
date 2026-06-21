package com.selffeed.android.ui

import com.selffeed.android.network.FeedWithCounts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleFeatureEventCoordinatorTest {
    private val coordinator = ArticleFeatureEventCoordinator()

    @Test
    fun `article read-state event updates feed stats and search result`() {
        val sink = RecordingSink()

        coordinator.handle(
            event = ArticleFeatureEvent.ArticleReadStateChanged(
                articleId = "a-1",
                feedId = "f-1",
                read = true,
                unreadDelta = -1,
                readDelta = 1,
            ),
            latestFeedsState = FeedsUiState(),
            sink = sink,
        )

        assertEquals(listOf("f-1" to -1), sink.unreadDeltas)
        assertEquals(listOf(-1 to 1), sink.statsDeltas)
        assertEquals(listOf("a-1" to true), sink.articleReadStates)
    }

    @Test
    fun `category mark-read maps latest feeds into search update`() {
        val sink = RecordingSink()

        coordinator.handle(
            event = ArticleFeatureEvent.ScopeMarkedRead(
                feedId = null,
                categoryId = "c-1",
                affectedFeedIds = emptySet(),
                markedCount = 3,
            ),
            latestFeedsState = FeedsUiState(
                feeds = listOf(
                    sampleFeed("f-1", "c-1"),
                    sampleFeed("f-2", "c-2"),
                    sampleFeed("f-3", "c-1"),
                ),
            ),
            sink = sink,
        )

        assertEquals(listOf(Triple(null, "c-1", emptySet<String>())), sink.scopeMarkedRead)
        assertEquals(listOf(-3 to 3), sink.statsDeltas)
        assertEquals(listOf(setOf("f-1", "f-3")), sink.searchScopeMarkedRead)
        assertTrue(sink.allSearchMarkedRead.isEmpty())
    }

    @Test
    fun `all-feeds mark-read updates every search result`() {
        val sink = RecordingSink()

        coordinator.handle(
            event = ArticleFeatureEvent.ScopeMarkedRead(
                feedId = null,
                categoryId = null,
                affectedFeedIds = emptySet(),
                markedCount = 5,
            ),
            latestFeedsState = FeedsUiState(feeds = listOf(sampleFeed("f-1", "c-1"))),
            sink = sink,
        )

        assertEquals(listOf(Triple(null, null, emptySet<String>())), sink.scopeMarkedRead)
        assertEquals(listOf(-5 to 5), sink.statsDeltas)
        assertEquals(listOf(Unit), sink.allSearchMarkedRead)
        assertTrue(sink.searchScopeMarkedRead.isEmpty())
    }

    @Test
    fun `affected feed ids take precedence over category lookup`() {
        val sink = RecordingSink()

        coordinator.handle(
            event = ArticleFeatureEvent.ScopeMarkedRead(
                feedId = null,
                categoryId = "c-1",
                affectedFeedIds = setOf("f-explicit"),
                markedCount = 1,
            ),
            latestFeedsState = FeedsUiState(feeds = listOf(sampleFeed("f-derived", "c-1"))),
            sink = sink,
        )

        assertEquals(listOf(setOf("f-explicit")), sink.searchScopeMarkedRead)
    }

    private fun sampleFeed(id: String, categoryId: String): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed $id",
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = 1,
    )

    private class RecordingSink : ArticleFeatureEventSink {
        val unreadDeltas = mutableListOf<Pair<String?, Int>>()
        val statsDeltas = mutableListOf<Pair<Int, Int>>()
        val articleReadStates = mutableListOf<Pair<String, Boolean>>()
        val scopeMarkedRead = mutableListOf<Triple<String?, String?, Set<String>>>()
        val searchScopeMarkedRead = mutableListOf<Set<String>>()
        val allSearchMarkedRead = mutableListOf<Unit>()

        override fun applyUnreadDelta(feedId: String?, unreadDelta: Int) {
            unreadDeltas += feedId to unreadDelta
        }

        override fun applyStatsDelta(unreadDelta: Int, readDelta: Int) {
            statsDeltas += unreadDelta to readDelta
        }

        override fun applyArticleReadState(articleId: String, read: Boolean) {
            articleReadStates += articleId to read
        }

        override fun applyScopeMarkedRead(
            feedId: String?,
            categoryId: String?,
            affectedFeedIds: Set<String>,
        ) {
            scopeMarkedRead += Triple(feedId, categoryId, affectedFeedIds)
        }

        override fun applySearchScopeMarkedRead(feedIds: Set<String>) {
            searchScopeMarkedRead += feedIds
        }

        override fun applyAllSearchMarkedRead() {
            allSearchMarkedRead += Unit
        }
    }
}
