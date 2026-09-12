package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleStateSnapshot
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID

/** Runs against both Robolectric SQLite and the device's real Room/SQLite implementation. */
abstract class LocalArticleRetentionContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "article-retention-${UUID.randomUUID()}"
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    private val owner = LocalOwnerEntity(ownerId = "retention-owner", apiBaseUrl = "https://example.invalid/api/v1/")
    private val dao get() = database.localStoreDao()

    @Before fun setup() = runBlocking<Unit> {
        open()
        store.switchOwner(owner)
    }

    @After fun close() {
        database.close()
        context.deleteDatabase(name)
    }

    private fun open() {
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        store = LocalStore(database, NetworkModule.provideMoshi())
    }

    private fun reopen() { database.close(); open() }

    @Test fun versionedEventAndSearchHistoryIsBoundedAfterReopeningAndDoesNotExpandBulkWork() = runBlocking<Unit> {
        repeat(LocalStore.MAX_ORPHAN_ARTICLE_STATES + 20) { index ->
            store.updateArticleReadState("event-$index", true, revision = index + 1)
        }
        assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES, count("article_state_revisions"))
        assertNull(dao.readArticleStateRevision("event-0"))

        store.reconcileArticleSnapshots((0 until LocalStore.MAX_ORPHAN_ARTICLE_STATES + 20).map { index ->
            article("search-$index").copy(readRevision = 30, savedRevision = 40)
        })
        reopen()

        assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES, count("article_state_revisions"))
        assertEquals(0, count("articles"))
        assertEquals(40, dao.readArticleStateRevision("search-${LocalStore.MAX_ORPHAN_ARTICLE_STATES + 19}")?.savedRevision)
        assertTrue(store.markArticlesReadByFeeds(setOf("feed")).affectedArticleIds.isEmpty())
        assertEquals(0, count("article_read_overrides"))
    }

    @Test fun cachedOfflineLegacyAndPendingStatesSurvivePressureAndReopening() = runBlocking<Unit> {
        store.writeArticleRemotePage("cached", ApiListResponse(listOf(article("cached")), null, false), true)
        store.writeArticleDetail(detail("offline").copy(isSaved = true, readRevision = 12, savedRevision = 13))
        store.reconcileArticleStates(listOf(state("pending-read"), state("pending-save"), state("legacy")))
        val read = store.queueReadStateMutation("pending-read", true)
        val saved = store.queueSavedStateMutation("pending-save", true)
        database.openHelper.writableDatabase.execSQL(
            "INSERT INTO legacy_offline_articles(articleId, savedAt) VALUES (?, ?)",
            arrayOf<Any>("legacy", 1L),
        )

        pressure("protected")
        reopen()

        val protected = setOf("cached", "offline", "pending-read", "pending-save", "legacy")
        assertEquals(protected, dao.readArticleStateRevisions(protected.toList()).map { it.articleId }.toSet())
        assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES + protected.size, count("article_state_revisions"))
        assertEquals(read, store.readPendingReadStateMutations().single())
        assertEquals(saved, store.readPendingSavedStateMutations().single())
        assertEquals("Offline text", store.readArticleDetail("offline")?.contentText)
        assertEquals(13, store.readArticleState("offline").savedRevision)

        store.acknowledgeReadStateMutation(read, true, 9)
        store.discardSavedStateMutation(saved)
        assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES + 3, count("article_state_revisions"))
        assertTrue(store.readPendingReadStateMutations().isEmpty())
        assertTrue(store.readPendingSavedStateMutations().isEmpty())
    }

    @Test fun overlappingObserversReleaseTheirFinalReferenceIntoTheBoundedGraceSet() = runBlocking<Unit> {
        store.reconcileArticleStates(listOf(state("observed")))
        val firstReady = CompletableDeferred<Unit>()
        val secondReady = CompletableDeferred<Unit>()
        val first = launch {
            store.observeArticleStates(setOf("observed"), owner.ownerId).collect { firstReady.complete(Unit) }
        }
        val second = launch {
            store.observeArticleStates(setOf("observed"), owner.ownerId).collect { secondReady.complete(Unit) }
        }
        try {
            withTimeout(10_000) { firstReady.await(); secondReady.await() }
            pressure("observed")
            assertEquals(8, dao.readArticleStateRevision("observed")?.readRevision)
            assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES + 1, count("article_state_revisions"))

            first.cancelAndJoin()
            assertNotNull(dao.readArticleStateRevision("observed"))
            second.cancelAndJoin()

            assertEquals(8, dao.readArticleStateRevision("observed")?.readRevision)
            assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES, count("article_state_revisions"))
            pressure("after-release")
            assertNull("The released ID must not retain an observer reference", dao.readArticleStateRevision("observed"))
            assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES, count("article_state_revisions"))
        } finally { first.cancelAndJoin(); second.cancelAndJoin() }
    }

    @Test fun serialObserverReplacementKeepsTheSameArticleStatesWithoutAnotherNetworkRequest() = runBlocking<Unit> {
        val ids = setOf("handoff-first", "handoff-second")
        store.reconcileArticleStates(ids.map(::state))
        val original = dao.readArticleStateRevisions(ids.toList()).associateBy { it.articleId }
        val ready = CompletableDeferred<Unit>()
        val collector = launch {
            store.observeArticleStates(ids, owner.ownerId).collect { ready.complete(Unit) }
        }
        try {
            withTimeout(10_000) { ready.await() }
            pressure("handoff")
        } finally { collector.cancelAndJoin() }

        // collectLatest cancels its previous observer before collecting the next set of visible IDs.
        val replacement = withTimeout(10_000) { store.observeArticleStates(ids, owner.ownerId).first() }

        assertEquals(ids, replacement.keys)
        assertTrue(replacement.values.all { it.isRead == false && it.isSaved == false && it.readRevision == 8 })
        assertEquals(original, dao.readArticleStateRevisions(ids.toList()).associateBy { it.articleId })
        assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES, count("article_state_revisions"))
    }

    @Test fun bulkReceiptsIncludeObservedSearchResultsButDoNotRetainTheirOverridesAfterRelease() = runBlocking<Unit> {
        store.reconcileArticleSnapshots(listOf(article("observed-search"), article("historical-search")))
        val ready = CompletableDeferred<Unit>()
        val collector = launch {
            store.observeArticleStates(setOf("observed-search"), owner.ownerId).collect { ready.complete(Unit) }
        }
        try {
            withTimeout(10_000) { ready.await() }
            assertEquals(setOf("observed-search"), store.markArticlesReadByFeeds(setOf("feed")).affectedArticleIds)
            assertEquals(mapOf("observed-search" to true), store.readArticleReadOverrides())
        } finally { collector.cancelAndJoin() }
        assertTrue(store.readArticleReadOverrides().isEmpty())
        assertEquals(true, dao.readArticleStateRevision("observed-search")?.confirmedReadState)
    }

    @Test fun staleSnapshotTicketCannotExecuteItsCommitAfterWatermarkEviction() = runBlocking<Unit> {
        store.updateArticleReadState("delayed", true, revision = 20)
        val staleEpoch = store.articleStateRetentionEpoch
        pressure("snapshot")
        assertNull(dao.readArticleStateRevision("delayed"))
        assertTrue(store.articleStateRetentionEpoch > staleEpoch)

        var executed = false
        val rejected = store.acceptArticleSnapshot(staleEpoch) {
            executed = true
            store.writeArticleDetail(detail("delayed").copy(readRevision = 19))
            Unit
        }
        assertNull(rejected)
        assertFalse(executed)
        assertNull(dao.readArticleDetail("delayed"))

        assertEquals(Unit, store.acceptArticleSnapshot(store.articleStateRetentionEpoch) {
            assertTrue(database.inTransaction())
            store.writeArticleDetail(detail("delayed").copy(isRead = true, readRevision = 21))
        })
        assertEquals(21, dao.readArticleStateRevision("delayed")?.readRevision)
    }

    @Test fun clearingDetailsReleasesStateProtectionWithoutLosingPendingIntent() = runBlocking<Unit> {
        store.writeArticleDetail(detail("discarded-body").copy(readRevision = 20))
        store.writeArticleDetail(detail("pending-body").copy(readRevision = 20))
        val pending = store.queueReadStateMutation("pending-body", true)
        pressure("details")

        store.clearArticleDetails()

        assertNull(dao.readArticleDetail("discarded-body"))
        assertNull(dao.readArticleStateRevision("discarded-body"))
        assertEquals(20, dao.readArticleStateRevision("pending-body")?.readRevision)
        assertEquals(pending, store.readPendingReadStateMutations().single())
        assertEquals(LocalStore.MAX_ORPHAN_ARTICLE_STATES + 1, count("article_state_revisions"))
    }

    @Test fun clearingQueryMembershipRetiresAnInflightSnapshotAndKeepsOfflineAndPendingState() = runBlocking<Unit> {
        store.writeArticleRemotePage("query", ApiListResponse(listOf(article("cached")), null, false), true)
        store.writeArticleDetail(detail("offline").copy(readRevision = 20))
        val pending = store.queueReadStateMutation("offline", true)
        val previousEpoch = store.articleStateRetentionEpoch

        store.clearArticleLists()

        assertTrue(store.articleStateRetentionEpoch > previousEpoch)
        assertNull(store.acceptArticleSnapshot(previousEpoch) {
            store.writeArticleRemotePage("query", ApiListResponse(listOf(article("cached")), null, false), true)
        })
        assertNull(store.readArticleRemoteKey("query"))
        assertNotNull(store.readArticleDetail("offline"))
        assertEquals(pending, store.readPendingReadStateMutations().single())
    }

    private suspend fun pressure(prefix: String) {
        store.reconcileArticleStates((0 until LocalStore.MAX_ORPHAN_ARTICLE_STATES + 20).map { state("$prefix-$it") })
    }

    private fun count(table: String): Int = database.openHelper.readableDatabase
        .query("SELECT COUNT(*) FROM $table").use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }

    private fun state(id: String) = ArticleStateSnapshot(id, false, false, 8, 8)

    private fun article(id: String) = ArticleListItem(id = id, feedId = "feed", feedTitle = "Feed", title = id, isRead = false)

    private fun detail(id: String) = ArticleDetail(
        id = id, feedId = "feed", guid = id, canonicalUrl = null, title = id, author = null, excerpt = null,
        contentHtml = null, contentText = "Offline text", heroImageUrl = null, publishedAt = null,
        fetchedAt = null, hash = id, feedTitle = "Feed", feedFaviconUrl = null, feedSiteUrl = null,
        media = emptyList(), isRead = false, isEnriched = false,
    )
}
