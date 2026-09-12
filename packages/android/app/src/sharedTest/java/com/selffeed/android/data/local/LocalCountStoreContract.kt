package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryOrderUpdate
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.StatsResponse
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID

abstract class LocalCountStoreContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "local-counts-${UUID.randomUUID()}"
    private val moshi = NetworkModule.provideMoshi()
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    private fun feed(unread: Int = 10) = FeedWithCounts(
        id = "feed", categoryId = "child", title = "Feed", feedUrl = "https://example.invalid/rss",
        pollingIntervalMinutes = 60, syncStatus = "idle", unreadCount = unread,
    )
    private fun categories(unread: Int = 10): List<CategoryWithCounts> {
        val child = CategoryWithCounts("child", name = "Child", slug = "child", sortOrder = 0, feedCount = 1, unreadCount = unread)
        return listOf(child.copy(id = "root", name = "Root", slug = "root", children = listOf(child)))
    }
    private val article = ArticleListItem(id = "article", feedId = "feed", feedTitle = "Feed", title = "Article", isRead = false, readRevision = 4)

    @Before fun setup() { open() }
    private fun open() {
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        store = LocalStore(database, moshi)
    }
    @After fun close() { database.close(); context.deleteDatabase(name) }

    private suspend fun seed(unread: Int = 10, knownArticle: Boolean = true) {
        store.writeFeeds(listOf(feed(unread)))
        store.writeCategories(categories(unread))
        if (knownArticle) store.reconcileArticleSnapshots(listOf(article))
        store.writeRemoteStats(StatsResponse(unread, 5, 1, 2), store.captureCountSnapshot())
    }
    private suspend fun assertCounts(unread: Int, read: Int = 15 - unread) {
        assertEquals(unread, store.readFeeds().single().unreadCount)
        assertEquals(unread, store.readCategories().single().unreadCount)
        assertEquals(unread, store.readCategories().single().children?.single()?.unreadCount)
        assertEquals(unread, store.readStats()?.totalUnread)
        assertEquals(read, store.readStats()?.totalRead)
    }

    @Test fun searchOnlyEditAndAllCountProjectionsSurviveDatabaseReopen() = runBlocking {
        seed()
        assertNull(database.localStoreDao().readArticle(article.id))
        val pending = store.queueReadStateMutation(article.id, true)
        database.close()
        open()
        assertCounts(9)
        assertEquals(pending, store.readPendingReadStateMutations().single())
        assertEquals(true, store.readArticleState(article.id).isRead)
        val projection = store.observeLibraryCounts().first()
        assertEquals(mapOf("feed" to 9), projection.feedUnread)
        assertEquals(mapOf("root" to 9, "child" to 9), projection.categoryUnread)
    }

    @Test fun fetchSpanningQueueAndAcknowledgmentCannotReplaceCountsEvenAfterQueueEmpties() = runBlocking {
        seed()
        val old = store.captureCountSnapshot()
        val pending = store.queueReadStateMutation(article.id, true)
        store.acknowledgeReadStateMutation(pending, true, 5)
        assertTrue(store.readPendingReadStateMutations().isEmpty())
        store.writeRemoteFeeds(listOf(feed()), old)
        store.writeRemoteCategories(categories(), old)
        store.writeRemoteStats(StatsResponse(10, 5, 1, 2), old)
        assertCounts(9)
        store.writeRemoteStats(StatsResponse(8, 7, 1, 2), store.captureCountSnapshot())
        assertEquals(8, store.readStats()?.totalUnread)
    }

    @Test fun serverAppliedMutationWithLostAcknowledgmentNeverDecrementsCountsTwice() = runBlocking {
        seed()
        val pending = store.queueReadStateMutation(article.id, true)
        val duringDelivery = store.captureCountSnapshot()
        store.writeRemoteFeeds(listOf(feed(9)), duringDelivery)
        store.writeRemoteCategories(categories(9), duringDelivery)
        store.writeRemoteStats(StatsResponse(9, 6, 1, 2), duringDelivery)
        assertCounts(9)
        store.acknowledgeReadStateMutation(pending, true, 5)
        store.acknowledgeReadStateMutation(pending, true, 5)
        assertCounts(9)
    }

    @Test fun olderAcknowledgmentPreservesLatestIntentAndRejectionReversesItsActualContribution() = runBlocking {
        seed()
        val first = store.queueReadStateMutation(article.id, true)
        val second = store.queueReadStateMutation(article.id, false)
        assertCounts(10)
        store.acknowledgeReadStateMutation(first, true, 5)
        assertCounts(10)
        assertEquals(second.mutationId, store.readPendingReadStateMutations().single().mutationId)
        store.discardReadStateMutation(second)
        assertCounts(9)
    }

    @Test fun zeroCountRoundtripRemainsReversibleAcrossMetadataMergeReorderAndReopen() = runBlocking {
        seed(unread = 0)
        val pending = store.queueReadStateMutation(article.id, true)
        assertCounts(0, 6)
        val ticket = store.captureCountSnapshot()
        store.writeRemoteFeeds(listOf(feed().copy(id = "other", categoryId = "other")), ticket, merge = true)
        store.reorderCategories(listOf(CategoryOrderUpdate("root", 2)))
        database.close()
        open()
        store.discardReadStateMutation(pending)
        assertEquals(0, store.readFeeds().first { it.id == "feed" }.unreadCount)
        assertEquals(0, store.readCategories().single().unreadCount)
        assertEquals(0, store.readCategories().single().children?.single()?.unreadCount)
        assertEquals(0, store.readStats()?.totalUnread)
        assertEquals(5, store.readStats()?.totalRead)
    }

    @Test fun metadataIntroducedDuringPendingDeliveryReceivesNoUnmatchedRollbackDelta() = runBlocking {
        store.reconcileArticleSnapshots(listOf(article))
        val pending = store.queueReadStateMutation(article.id, true)
        val ticket = store.captureCountSnapshot()
        store.writeRemoteFeeds(listOf(feed()), ticket)
        store.writeRemoteCategories(categories(), ticket)
        store.discardReadStateMutation(pending)
        assertEquals(10, store.readFeeds().single().unreadCount)
        assertEquals(10, store.readCategories().single().unreadCount)
        assertEquals(10, store.readCategories().single().children?.single()?.unreadCount)
    }

    @Test fun unknownInitialReadStateStaysInertThroughReplacementHydrationAndRejection() = runBlocking {
        seed(knownArticle = false)
        store.queueReadStateMutation(article.id, true)
        val second = store.queueReadStateMutation(article.id, false)
        store.updateArticleReadState(article.id, true, 5)
        store.discardReadStateMutation(second)
        assertCounts(10)
    }

    @Test fun aRebasedReadRetainsTheReversibleCountScopeAndOriginalIntentId() = runBlocking {
        seed()
        val pending = store.queueReadStateMutation(article.id, true)
        store.rebaseReadStateMutation(pending, 5, false)
        val rebased = store.readPendingReadStateMutations().single()
        assertEquals(pending.countScopeJson, rebased.countScopeJson)
        assertTrue(pending.mutationId != rebased.mutationId)
        assertEquals(pending.mutationId, store.readArticleState(article.id).lastReadMutationId)
        store.discardReadStateMutation(rebased)
        assertCounts(10)
    }

    @Test fun roomCountObserverPublishesTheCompleteCommittedEdit() = runBlocking {
        seed()
        val updated = async { withTimeout(5_000) { store.observeLibraryCounts().first { it.feedUnread["feed"] == 9 } } }
        store.queueReadStateMutation(article.id, true)
        val counts = updated.await()
        assertEquals(9, counts.categoryUnread["root"])
        assertEquals(9, counts.categoryUnread["child"])
        assertEquals(9, counts.totalUnread)
        assertEquals(6, counts.totalRead)
    }

    @Test fun aVersionlessBulkHintRejectsAnOlderCountRequestEvenWithVersionedArticles() = runBlocking {
        seed()
        val ticket = store.captureCountSnapshot()
        store.markArticlesReadByFeeds(setOf("feed"))
        store.writeRemoteFeeds(listOf(feed(42)), ticket)
        store.writeRemoteCategories(categories(42), ticket)
        store.writeRemoteStats(StatsResponse(42, 8, 1, 2), ticket)
        assertCounts(10)
    }

    @Test fun countRefreshesWaitForReadsToSettleAndStatsPersistenceCannotCreateARefreshLoop() = runBlocking {
        seed()
        val signals = Channel<Unit>(Channel.UNLIMITED)
        val observer = launch { store.observeCountRefreshRequests().collect { signals.send(Unit) } }
        try {
            withTimeout(5_000) { signals.receive() }
            val mutation = store.queueReadStateMutation(article.id, true)
            assertNull(withTimeoutOrNull(100) { signals.receive() })
            store.acknowledgeReadStateMutation(mutation, true, 5)
            withTimeout(5_000) { signals.receive() }
            store.writeRemoteStats(StatsResponse(9, 6, 1, 2), store.captureCountSnapshot())
            assertNull(withTimeoutOrNull(100) { signals.receive() })
        } finally { observer.cancelAndJoin() }
    }

    @Test fun legacyPendingRowsWithoutAStateRecordRetainRejectionIdentityAfterRemoval() = runBlocking {
        val dao = database.localStoreDao()
        val read = PendingReadStateMutationEntity("read", true, "legacy-read", "manual", null, null, 1)
        val saved = PendingSavedStateMutationEntity("saved", true, "legacy-saved", null, null, 2)
        dao.upsertPendingReadStateMutation(read)
        dao.upsertPendingSavedStateMutation(saved)
        store.discardReadStateMutation(read)
        store.discardSavedStateMutation(saved)
        assertEquals(read.mutationId, store.readArticleState(read.articleId).lastReadMutationId)
        assertEquals(saved.mutationId, store.readArticleState(saved.articleId).lastSavedMutationId)
    }

    @Test fun foregroundObservationRequestsInitialMetadataEvenWhenReadsArePending() = runBlocking {
        seed()
        val mutation = store.queueReadStateMutation(article.id, true)
        val signals = Channel<Unit>(Channel.UNLIMITED)
        val observer = launch { store.observeCountRefreshRequests().collect { signals.send(Unit) } }
        try {
            withTimeout(5_000) { signals.receive() }
            store.acknowledgeReadStateMutation(mutation, true, 5)
            withTimeout(5_000) { signals.receive() }
        } finally { observer.cancelAndJoin() }
    }
}
