package com.selffeed.android.data

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.local.LocalDatabase
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.UUID

abstract class AccountSessionBoundaryContract {
    @get:Rule val temporary = TemporaryFolder()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "account-boundary-${UUID.randomUUID()}"
    private val preferencesJob = SupervisorJob()
    private lateinit var database: LocalDatabase
    private lateinit var store: SessionStore
    private lateinit var local: LocalStore
    private lateinit var boundary: AccountSessionBoundary
    private var replacements = 0

    @Before
    fun setUp() {
        val file = temporary.newFolder().resolve("session.preferences_pb")
        val preferences = PreferenceDataStoreFactory.create(
            scope = CoroutineScope(preferencesJob + Dispatchers.IO), produceFile = { file },
        )
        store = SessionStore(context, dataStore = preferences)
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name).build()
        local = LocalStore(database, NetworkModule.provideMoshi())
        boundary = AccountSessionBoundary(store, local) { replacements++ }
    }

    @After
    fun tearDown() {
        runBlocking { preferencesJob.cancelAndJoin() }
        database.close()
        context.deleteDatabase(name)
    }

    @Test
    fun authenticationLossFirstAdoptsUnownedIntentBeforeRotatingTheSession() = runBlocking {
        val pending = local.queueReadStateMutation("adopt-before-clear", true)
        store.preload()
        val owner = store.currentSession()
        assertTrue(boundary.clearIfCurrent(owner) != null)
        assertTrue(local.readPendingReadStateMutations().isEmpty())
        assertEquals(listOf(pending), database.localStoreDao().readArchivedReadStateMutations(owner.ownerId).map { it.mutation })
    }

    @Test
    fun requestOwnershipLastsUntilItsStructuredChildrenFinish() = runBlocking {
        boundary.prepare()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val operation = async {
            boundary.withSession {
                CoroutineScope(kotlinx.coroutines.currentCoroutineContext()).async {
                    started.complete(Unit)
                    release.await()
                }
                Unit
            }
        }
        started.await()
        try {
            boundary.replace { store.clear() }
            // Completion proves cancellation reached the child that outlived its block body.
            withTimeout(5_000) { operation.join() }
            assertTrue(operation.isCancelled)
        } finally { release.complete(Unit) }
    }

    @Test
    fun firstOperationAdoptsTheExistingQueueBeforeAnyAccountReplacement() = runBlocking {
        val pending = local.queueReadStateMutation("article", true)
        assertEquals(null, store.loadedSession())
        boundary.withSession { owner ->
            assertEquals(owner.ownerId, local.readOwner()?.ownerId)
            assertEquals(listOf(pending), boundary.commit(owner) { local.readPendingReadStateMutations() })
        }
        assertEquals(0, replacements)
    }

    @Test
    fun replacementCancelsOldRequestsWithoutWaitingForUncooperativeWork() = runBlocking {
        val owner = boundary.prepare()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val old = async {
            boundary.withSession { captured ->
                started.complete(Unit)
                withContext(NonCancellable) { release.await() }
                boundary.commit(captured) { local.queueReadStateMutation("stale", true) }
            }
        }
        started.await()
        try {
            withTimeout(5_000) { boundary.replace { store.clear() } }
            assertFalse(old.isCompleted)
            val next = boundary.prepare()
            assertNotEquals(owner.ownerId, next.ownerId)
            boundary.withSession { current -> boundary.commit(current) { local.queueReadStateMutation("current", true) } }
        } finally { release.complete(Unit) }
        old.join()
        assertTrue(old.isCancelled)
        assertEquals(listOf("current"), local.readPendingReadStateMutations().map { it.articleId })
        assertEquals(1, replacements)
    }

    @Test
    fun requestWaitingBehindATransitionRetainsItsOriginalOwner() = runBlocking {
        val owner = boundary.prepare()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val writing = async(start = CoroutineStart.UNDISPATCHED) {
            boundary.commit(owner) { entered.complete(Unit); release.await() }
        }
        entered.await()
        val replacing = async(start = CoroutineStart.UNDISPATCHED) { boundary.replace { store.clear() } }
        var dispatched = false
        val late = async(start = CoroutineStart.UNDISPATCHED) {
            boundary.withSession { dispatched = true }
        }
        release.complete(Unit)
        writing.await()
        replacing.await()
        late.join()
        assertTrue(late.isCancelled)
        assertFalse(dispatched)
    }

    @Test
    fun replacementWaitsForALocalCommitAndArchivesItsAcceptedIntent() = runBlocking {
        val owner = boundary.prepare()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val writing = async(start = CoroutineStart.UNDISPATCHED) {
            boundary.commit(owner) {
                entered.complete(Unit)
                release.await()
                local.queueReadStateMutation("committed", false)
            }
        }
        entered.await()
        val replacing = async(start = CoroutineStart.UNDISPATCHED) { boundary.replace { store.clear() } }
        assertFalse(replacing.isCompleted)
        release.complete(Unit)
        val mutation = writing.await()
        replacing.await()
        assertEquals(listOf(mutation), database.localStoreDao().readArchivedReadStateMutations(owner.ownerId).map { it.mutation })
        assertTrue(local.readPendingReadStateMutations().isEmpty())
    }

    @Test
    fun newBoundaryRepairsAPersistedSessionChangeBeforeExposingRoom() = runBlocking {
        val old = boundary.prepare()
        val pending = local.queueSavedStateMutation("article", true)
        // Represents a crash after the DataStore commit and before Room switches owner.
        store.beginAuthentication()
        val next = store.currentSession()
        assertEquals(old.ownerId, local.readOwner()?.ownerId)
        val recreated = AccountSessionBoundary(store, local) { replacements++ }
        recreated.withSession { owner ->
            assertEquals(next, owner)
            assertEquals(next.ownerId, local.readOwner()?.ownerId)
            assertTrue(recreated.commit(owner) { local.readPendingSavedStateMutations().isEmpty() })
        }
        assertEquals(listOf(pending), database.localStoreDao().readArchivedSavedStateMutations(old.ownerId).map { it.mutation })
    }

    @Test
    fun lateAuthenticationLossCannotClearAReplacementSession() = runBlocking {
        val old = boundary.prepare()
        boundary.replace { store.beginAuthentication() }
        val next = store.currentSession()
        assertEquals(null, boundary.clearIfCurrent(old))
        assertEquals(next, store.currentSession())
        assertEquals(next.ownerId, local.readOwner()?.ownerId)
    }

    @Test
    fun callerCancellationCannotStrandAHalfCompletedLocalReplacement() = runBlocking {
        val old = boundary.prepare()
        val pending = local.queueReadStateMutation("accepted", true)
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val replacing = async {
            boundary.replace {
                store.beginAuthentication()
                entered.complete(Unit)
                release.await()
            }
        }
        entered.await()
        val next = store.currentSession()
        replacing.cancel()
        val waiting = async(start = CoroutineStart.UNDISPATCHED) { boundary.withSession { it } }
        try { assertFalse(waiting.isCompleted) } finally { release.complete(Unit) }
        replacing.join()
        assertEquals(next, waiting.await())
        assertEquals(next.ownerId, local.readOwner()?.ownerId)
        assertEquals(listOf(pending), database.localStoreDao().readArchivedReadStateMutations(old.ownerId).map { it.mutation })
    }
}
