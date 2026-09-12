package com.selffeed.android.ui

import com.selffeed.android.network.FeedWithCounts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleFeatureEventCoordinatorTest {
    private val coordinator = ArticleFeatureEventCoordinator()

    @Test
    fun `article read-state event updates search result`() {
        val sink = RecordingSink()

        coordinator.handle(
            event = ArticleFeatureEvent.ArticleReadStateChanged(
                articleId = "a-1",
                feedId = "f-1",
                read = true,
            ),
            latestFeedsState = FeedsUiState(),
            sink = sink,
        )

        assertEquals(listOf("a-1" to true), sink.articleReadStates)
    }

    @Test
    fun `saved state rejection updates search results`() {
        val sink = RecordingSink()
        coordinator.handle(
            ArticleFeatureEvent.ArticleSavedStateChanged("a-1", false), FeedsUiState(), sink,
        )
        assertEquals(listOf("a-1" to false), sink.articleSavedStates)
    }

    @Test
    fun `category mark-read maps latest feeds into search update`() {
        val sink = RecordingSink()

        coordinator.handle(
            event = ArticleFeatureEvent.ScopeMarkedRead(
                feedId = null,
                categoryId = "c-1",
                affectedFeedIds = emptySet(),
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
            ),
            latestFeedsState = FeedsUiState(feeds = listOf(sampleFeed("f-1", "c-1"))),
            sink = sink,
        )

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
            ),
            latestFeedsState = FeedsUiState(feeds = listOf(sampleFeed("f-derived", "c-1"))),
            sink = sink,
        )

        assertEquals(listOf(setOf("f-explicit")), sink.searchScopeMarkedRead)
    }

    @Test
    fun `bulk reconciliation restores search overrides after clearing the scope`() {
        val sink = RecordingSink()
        coordinator.handle(
            ArticleFeatureEvent.ScopeMarkedRead(
                feedId = null,
                categoryId = null,
                affectedFeedIds = emptySet(),
                retainedUnreadArticleFeeds = mapOf("a-1" to "f-1", "a-2" to "f-1", "a-3" to "f-2"),
            ),
            FeedsUiState(),
            sink,
        )
        assertEquals(listOf(Unit), sink.allSearchMarkedRead)
        assertEquals(listOf("a-1" to false, "a-2" to false, "a-3" to false), sink.articleReadStates)
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
        val articleSavedStates = mutableListOf<Pair<String, Boolean>>()
        val articleReadStates = mutableListOf<Pair<String, Boolean>>()
        val searchScopeMarkedRead = mutableListOf<Set<String>>()
        val allSearchMarkedRead = mutableListOf<Unit>()

        override fun applyArticleReadState(articleId: String, read: Boolean) {
            articleReadStates += articleId to read
        }

        override fun applyArticleSavedState(articleId: String, saved: Boolean) {
            articleSavedStates += articleId to saved
        }

        override fun applySearchScopeMarkedRead(feedIds: Set<String>) {
            searchScopeMarkedRead += feedIds
        }

        override fun applyAllSearchMarkedRead() {
            allSearchMarkedRead += Unit
        }

        override fun refreshArticleContent() = Unit
    }
}
