package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ArticleStateSnapshot
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID

abstract class LocalArticleObservationContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "article-observation-${UUID.randomUUID()}"
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    private val owner = LocalOwnerEntity(ownerId = "first", apiBaseUrl = "https://example.invalid/api/v1/")
    private fun state(id: String = "article", read: Boolean = false, saved: Boolean = false, revision: Int = 3) =
        ArticleStateSnapshot(id, read, saved, revision, revision)

    @Before fun setup() = runBlocking<Unit> {
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name).build()
        store = LocalStore(database, NetworkModule.provideMoshi())
        store.switchOwner(owner)
    }
    @After fun close() { database.close(); context.deleteDatabase(name) }

    @Test fun observerProjectsPendingFlagsAndKeepsTheirLogicalIdsThroughRetriesAndRejections() = runBlocking<Unit> {
        store.reconcileArticleStates(listOf(state()))
        val updates = Channel<Map<String, com.selffeed.android.data.repository.LocalArticleState>>(Channel.UNLIMITED)
        val collector = launch { store.observeArticleStates(setOf("article"), owner.ownerId).collect { updates.send(it) } }
        try {
            withTimeout(5_000) { assertEquals(false, updates.receive()["article"]?.isRead) }
            val read = store.queueReadStateMutation("article", true)
            val saved = store.queueSavedStateMutation("article", true)
            withTimeout(5_000) {
                while (updates.receive()["article"]?.isSaved != true) Unit
            }
            store.rebaseReadStateMutation(read, 4, false)
            store.rebaseSavedStateMutation(saved, 4, false)
            val rebasedRead = store.readPendingReadStateMutations().single()
            val rebasedSaved = store.readPendingSavedStateMutations().single()
            val pending = store.observeArticleStates(setOf("article"), owner.ownerId).first().getValue("article")
            assertEquals(true, pending.isRead)
            assertEquals(true, pending.isSaved)
            assertEquals(read.mutationId, pending.lastReadMutationId)
            assertEquals(saved.mutationId, pending.lastSavedMutationId)
            assertEquals(rebasedRead.mutationId, pending.pendingReadMutationId)
            assertTrue(read.mutationId != rebasedRead.mutationId)
            assertTrue(saved.mutationId != rebasedSaved.mutationId)
            assertNull(store.discardReadStateMutation(read))
            assertNull(store.discardSavedStateMutation(saved))
            assertEquals(RejectedArticleMutation(read.mutationId, false), store.discardReadStateMutation(rebasedRead))
            assertEquals(RejectedArticleMutation(saved.mutationId, false), store.discardSavedStateMutation(rebasedSaved))
            val settled = withTimeout(5_000) {
                store.observeArticleStates(setOf("article"), owner.ownerId).first { it["article"]?.isSaved == false }
            }.getValue("article")
            assertEquals(false, settled.isRead)
            assertNull(settled.pendingReadMutationId)
            assertNull(settled.pendingSavedMutationId)
            assertEquals(read.mutationId, settled.lastReadMutationId)
            assertEquals(saved.mutationId, settled.lastSavedMutationId)
        } finally { collector.cancelAndJoin(); updates.close() }
    }

    @Test fun aLargeObservedSetPublishesOnlyWholeTransactionsAndNeverAnotherOwnersRows() = runBlocking<Unit> {
        val ids = (0 until 1_101).map { "article-$it" }.toSet()
        database.withTransaction {
            database.localStoreDao().upsertArticleStateRevisions(ids.map { ArticleStateRevisionEntity(it, 1, 1, false, false) })
        }
        val updates = Channel<Map<String, com.selffeed.android.data.repository.LocalArticleState>>(Channel.UNLIMITED)
        val collector = launch { store.observeArticleStates(ids, owner.ownerId).collect { updates.send(it) } }
        try {
            withTimeout(10_000) { assertEquals(ids, updates.receive().keys) }
            database.withTransaction {
                database.localStoreDao().upsertArticleStateRevisions(ids.map { ArticleStateRevisionEntity(it, 2, 2, true, true) })
            }
            val committed = withTimeout(10_000) {
                var value = updates.receive()
                while (value.values.none { it.isRead == true }) value = updates.receive()
                value
            }
            assertEquals(ids, committed.keys)
            assertTrue(committed.values.all { it.isRead == true && it.isSaved == true && it.readRevision == 2 })
            store.switchOwner(owner.copy(ownerId = "second"))
            store.reconcileArticleStates(listOf(state(id = ids.first(), read = true)))
            withTimeout(10_000) { assertTrue(updates.receive().isEmpty()) }
            assertTrue(store.observeArticleStates(ids, owner.ownerId).first().isEmpty())
        } finally { collector.cancelAndJoin(); updates.close() }
    }

    @Test fun legacyPendingOnlyRowsAndPersistedUnknownsRemainNullableWithoutBodyHydration() = runBlocking<Unit> {
        val dao = database.localStoreDao()
        dao.upsertPendingReadStateMutation(PendingReadStateMutationEntity("pending-only", true, "read", "manual", 3, null, 1))
        dao.upsertPendingSavedStateMutation(PendingSavedStateMutationEntity("pending-only", false, "saved", 5, null, 1))
        dao.upsertArticleStateRevision(ArticleStateRevisionEntity("unknown", 8, 8))
        // Invalid JSON proves this observation path does not decode or repair a reader document.
        dao.upsertArticleDetail(ArticleDetailEntity("unknown", payloadJson = "invalid", writtenAt = 1, feedId = "feed"))
        val states = store.observeArticleStates(setOf("pending-only", "unknown", "absent"), owner.ownerId).first()
        assertEquals(setOf("pending-only", "unknown"), states.keys)
        assertEquals(true, states.getValue("pending-only").isRead)
        assertEquals(false, states.getValue("pending-only").isSaved)
        assertEquals("read", states.getValue("pending-only").lastReadMutationId)
        assertNull(states.getValue("unknown").isRead)
        assertNull(states.getValue("unknown").isSaved)
        assertEquals(8, states.getValue("unknown").readRevision)
        assertNull(dao.readArticleStateRevision("pending-only"))
        assertEquals("invalid", dao.readArticleDetail("unknown")?.payloadJson)
    }

    @Test fun staleRefreshCannotRegressEitherRevisionOrOverridePendingChoices() = runBlocking<Unit> {
        store.reconcileArticleStates(listOf(state(read = true, saved = true, revision = 8)))
        val pending = store.queueReadStateMutation("article", false)
        store.reconcileArticleStates(listOf(state(read = false, saved = false, revision = 7)))
        val current = store.observeArticleStates(setOf("article"), owner.ownerId).first().getValue("article")
        assertEquals(false, current.isRead)
        assertEquals(true, current.isSaved)
        assertEquals(8, current.readRevision)
        assertEquals(8, current.savedRevision)
        assertEquals(RejectedArticleMutation(pending.mutationId, true), store.discardReadStateMutation(pending))
    }

    @Test fun emptyInputNeedsNoOpenDatabaseOrObserver() = runBlocking<Unit> {
        database.close()
        assertTrue(store.observeArticleStates(emptySet(), owner.ownerId).first().isEmpty())
    }
}
