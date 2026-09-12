package com.selffeed.android.data

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.repository.AuthenticatedSession
import com.selffeed.android.data.repository.SettingsRepositoryImpl
import com.selffeed.android.data.repository.ArticleRepositoryImpl
import com.selffeed.android.data.repository.SavedStateRejection
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.ArticleDetail
import org.junit.Assert.assertNull
import io.mockk.coVerify
import com.selffeed.android.network.User
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
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.network.ApiEnvelope
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.MarkReadResponse
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.RssApi
import com.selffeed.android.network.SessionRefreshCoordinator
import com.selffeed.android.network.UserPreferences
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.spyk
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class RepositoryAccountOwnershipTest {
    @get:Rule val temporary = TemporaryFolder()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "repository-account-${UUID.randomUUID()}"
    private val preferencesJob = SupervisorJob()
    private lateinit var database: LocalDatabase
    private lateinit var store: SessionStore
    private lateinit var local: LocalStore
    private lateinit var boundary: AccountSessionBoundary
    private val backgroundJob = SupervisorJob()
    private val online = MutableStateFlow(false)
    private val refreshCoordinator = mockk<SessionRefreshCoordinator>(relaxed = true)

    @Before
    fun setUp() {
        val file = temporary.newFolder().resolve("session.preferences_pb")
        val preferences = PreferenceDataStoreFactory.create(
            scope = CoroutineScope(preferencesJob + Dispatchers.IO), produceFile = { file },
        )
        store = spyk(SessionStore(context, dataStore = preferences))
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name).build()
        local = LocalStore(database, NetworkModule.provideMoshi())
        boundary = AccountSessionBoundary(store, local) {}
    }

    @After
    fun tearDown() {
        runBlocking { backgroundJob.cancelAndJoin(); preferencesJob.cancelAndJoin() }
        database.close()
        context.deleteDatabase(name)
    }

    private fun repository(api: RssApi): RssRepository {
        val monitor = mockk<NetworkMonitor> {
            every { online } returns this@RepositoryAccountOwnershipTest.online
            every { unmetered } returns MutableStateFlow(false)
        }
        val moshi = NetworkModule.provideMoshi()
        return RssRepository(
            AuthRemoteDataSource(api), FeedRemoteDataSource(api), ArticleRemoteDataSource(api),
            SearchRemoteDataSource(api), SettingsRemoteDataSource(api), store,
            refreshCoordinator, okhttp3.OkHttpClient(), moshi, local, local, context,
            mockk(relaxed = true), monitor, CoroutineScope(backgroundJob + Dispatchers.IO),
        )
    }

    // AndroidKeyStore encryption is covered on-device. These ownership tests keep
    // real session/lease persistence and supply only a synthetic credential getter.
    private fun provideTestCredential(token: String) {
        val owner = store.currentSession()
        every { store.getAccessToken() } answers { token.takeIf { store.isCurrentSession(owner) } }
    }

    @Test
    fun `a feature created for an old owner cannot dispatch a queued preference edit`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        coEvery { api.updatePreferences(any(), session = any()) } returns ApiEnvelope(preferences("new-owner"))
        val repository = repository(api)
        repository.prepareSession()
        val feature = SettingsRepositoryImpl(repository, repository.accountAccess(store.currentSession().ownerId))
        repository.setApiBaseUrl("new.example")

        val edit = async { feature.updatePreferences(UpdatePreferencesRequest(theme = "dark")) }
        edit.join()

        assertTrue("The old feature must retain its original owner", edit.isCancelled)
        coVerify(exactly = 0) { api.updatePreferences(any(), session = any()) }
    }

    @Test
    fun `an old feature cannot read a replacement account from memory`() = runBlocking {
        val repository = spyk(repository(mockk(relaxed = true)))
        repository.prepareSession()
        val feature = ArticleRepositoryImpl(repository, repository.accountAccess(store.currentSession().ownerId))
        repository.setApiBaseUrl("new.example")
        every { repository.cachedArticleDetail("same-id") } returns mockk<ArticleDetail>()

        assertNull(feature.cachedArticleDetail("same-id"))
    }

    @Test
    fun `an old feature cannot start collecting a new account event flow`() = runBlocking {
        val repository = spyk(repository(mockk(relaxed = true)))
        repository.prepareSession()
        val feature = ArticleRepositoryImpl(repository, repository.accountAccess(store.currentSession().ownerId))
        repository.setApiBaseUrl("new.example")
        every { repository.readStateRejections() } returns kotlinx.coroutines.flow.emptyFlow()
        every { repository.savedStateRejections() } returns kotlinx.coroutines.flow.flowOf(
            SavedStateRejection("same-id", false, "mutation"),
        )

        val collect = async { feature.savedStateRejections().first() }
        collect.join()

        assertTrue("Cold collection must keep the feature's original owner", collect.isCancelled)
    }

    @Test
    fun `state observation is cancelled on replacement and cold old features cannot read new rows`() = runBlocking<Unit> {
        val repository = repository(mockk(relaxed = true))
        repository.prepareSession()
        val feature = ArticleRepositoryImpl(repository, repository.accountAccess(store.currentSession().ownerId))
        val values = kotlinx.coroutines.channels.Channel<AppResult<Map<String, com.selffeed.android.data.repository.LocalArticleState>>>(kotlinx.coroutines.channels.Channel.UNLIMITED)
        val observing = launch { feature.observeArticleStates(setOf("same-id")).collect { values.send(it) } }
        withTimeout(5_000) { assertEquals(AppResult.Success(emptyMap<String, com.selffeed.android.data.repository.LocalArticleState>()), values.receive()) }
        assertTrue(repository.setApiBaseUrl("replacement.example") is AppResult.Success)
        observing.join()
        assertTrue(observing.isCancelled)
        local.reconcileArticleStates(listOf(com.selffeed.android.network.ArticleStateSnapshot("same-id", true, true, 8, 8)))
        val oldCollection = async { feature.observeArticleStates(setOf("same-id")).first() }
        oldCollection.join()
        assertTrue(oldCollection.isCancelled)
        assertTrue(values.tryReceive().isFailure)
        values.close()
    }

    @Test
    fun `account replacement cancels a lookup before commit or the next batch`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        val feature = ArticleRepositoryImpl(repository, repository.accountAccess(store.currentSession().ownerId))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        coEvery { api.articleStates(any(), session = any()) } coAnswers {
            val ids = firstArg<com.selffeed.android.network.ArticleStateLookupRequest>().articleIds
            withContext(NonCancellable) { started.complete(Unit); release.await() }
            ApiEnvelope(com.selffeed.android.network.ArticleStateLookupResponse(
                ids.map { com.selffeed.android.network.ArticleStateSnapshot(it, true, true, 8, 8) }, emptyList(),
            ))
        }
        val refreshing = async { feature.refreshArticleStates((0 until 205).map { "article-$it" }.toSet()) }
        withTimeout(5_000) { started.await() }
        assertTrue(repository.setApiBaseUrl("replacement.example") is AppResult.Success)
        release.complete(Unit)
        withTimeout(5_000) { refreshing.join() }
        assertTrue(refreshing.isCancelled)
        assertNull(database.localStoreDao().readArticleStateRevision("article-0"))
        coVerify(exactly = 1) { api.articleStates(any(), session = any()) }
    }

    @Test
    fun `offline restore admits the original owner without renewing its lease`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("offline-token")
        val now = System.currentTimeMillis()
        val day = 24L * 60 * 60 * 1000
        store.recordAuthenticated(now - 6 * day)
        val owner = store.currentSession()
        coEvery { api.me(session = owner) } throws java.io.IOException("Offline")

        val result = repository.restoreSession()

        assertTrue("Valid cached credentials should restore offline: $result", result is AppResult.Success)
        assertEquals(AppResult.Success(AuthenticatedSession.Offline(owner)), result)
        assertEquals(owner, store.currentSession())
        assertFalse("Offline restore must not extend the lease", store.hasValidOfflineAccessLease(now + 2 * day))
    }

    @Test
    fun `verified restore keeps its original identity after a later replacement`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("original-token")
        val owner = store.currentSession()
        val user = User("original-user", "original@example.com", "reader", true)
        coEvery { api.me(session = owner) } returns ApiEnvelope(user)

        val result = repository.restoreSession()
        assertTrue(repository.setApiBaseUrl("replacement.example") is AppResult.Success)

        assertNotEquals(owner.ownerId, store.currentSession().ownerId)
        assertEquals(AppResult.Success(AuthenticatedSession.Verified(owner, user)), result)
    }

    @Test
    fun `expired offline lease stays expired after failed restoration`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("expired-token")
        store.recordAuthenticated(System.currentTimeMillis() - 8L * 24 * 60 * 60 * 1000)
        val owner = store.currentSession()
        coEvery { api.me(session = owner) } throws java.io.IOException("Offline")

        assertTrue(repository.restoreSession() is AppResult.Error)
        assertFalse(store.hasValidOfflineAccessLease())
        assertEquals(owner, store.currentSession())
    }

    @Test
    fun `confirmed authentication rejection cannot use an otherwise valid offline lease`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("rejected-token")
        store.recordAuthenticated()
        every { refreshCoordinator.hasRecentRefreshRejection() } returns true
        coEvery { api.me(session = any()) } throws retrofit2.HttpException(
            retrofit2.Response.error<Any>(401, "Rejected".toResponseBody()),
        )

        assertTrue(repository.restoreSession() is AppResult.Error)
        assertFalse(repository.isLoggedIn())
    }

    @Test
    fun `failed lease renewal preserves a valid offline session`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("cached-token")
        store.recordAuthenticated(System.currentTimeMillis() - 60_000)
        val owner = store.currentSession()
        coEvery { api.me(session = owner) } returns ApiEnvelope(
            User("original-user", "original@example.com", "reader", true),
        )
        coEvery { store.recordAuthenticated(any()) } throws java.io.IOException("Disk full")

        assertEquals(AppResult.Success(AuthenticatedSession.Offline(owner)), repository.restoreSession())
        assertEquals(owner, store.currentSession())
        assertTrue(store.hasValidOfflineAccessLease())
    }

    @Test
    fun `confirmed rejection during offline analytics prevents offline admission`() = runBlocking {
        val rejected = java.util.concurrent.atomic.AtomicBoolean(false)
        every { refreshCoordinator.hasRecentRefreshRejection() } answers { rejected.get() }
        val api = mockk<RssApi>(relaxed = true)
        coEvery { api.me(session = any()) } throws java.io.IOException("Offline")
        coEvery { api.recordProductAnalyticsEvents(any(), session = any()) } coAnswers {
            rejected.set(true)
            throw retrofit2.HttpException(retrofit2.Response.error<Any>(401, "Rejected".toResponseBody()))
        }
        online.value = true
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("rejected-token")
        store.recordAuthenticated()

        val authLost = async(start = CoroutineStart.UNDISPATCHED) {
            repository.authEvents().first()
        }
        // Resume inline from Room while its transaction child is still finishing.
        // The clear must publish auth loss before returning to this cancelled caller.
        val restore = async(Dispatchers.Unconfined) { repository.restoreSession() }
        try {
            restore.join()
            assertTrue("The analytics request must exercise rejection", rejected.get())
            assertTrue("Confirmed rejection must cancel the enclosing restore", restore.isCancelled)
            assertFalse(repository.isLoggedIn())
            assertEquals("Authentication was lost. Please sign in again.", withTimeout(5_000) { authLost.await() })
        } finally { restore.cancelAndJoin(); authLost.cancelAndJoin() }
    }

    @Test
    fun `incompatible verified user cannot become offline admission`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("original-token")
        store.recordAuthenticated()
        val owner = store.currentSession()
        val localOwner = com.selffeed.android.data.local.LocalOwnerEntity(
            ownerId = owner.ownerId, apiBaseUrl = owner.apiBaseUrl, userId = "original-user",
        )
        local.switchOwner(localOwner)
        coEvery { api.me(session = owner) } returns ApiEnvelope(
            User("different-user", "different@example.com", "reader", true),
        )

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Error)
        assertTrue((result as AppResult.Error).cause is IllegalArgumentException)
        assertEquals(localOwner, local.readOwner())
    }

    @Test
    fun `old restore cannot borrow a replacement account offline lease`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        provideTestCredential("old-token")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        coEvery { api.me(session = any()) } coAnswers {
            entered.complete(Unit)
            withContext(NonCancellable) { release.await() }
            throw java.io.IOException("Offline")
        }
        val restore = async { repository.restoreSession() }
        try {
            entered.await()
            repository.setApiBaseUrl("new.example")
            provideTestCredential("new-token")
            store.recordAuthenticated()
            release.complete(Unit)
            restore.join()
            assertTrue(restore.isCancelled)
            assertEquals("new-token", store.getAccessToken())
        } finally { release.complete(Unit); restore.cancelAndJoin() }
    }

    @Test
    fun `old preferences cannot replace the new account snapshot`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val previous = preferences("account-a")
        val next = preferences("account-b")
        coEvery { api.preferences(session = any()) } coAnswers {
            started.complete(Unit)
            withContext(NonCancellable) { release.await() }
            ApiEnvelope(previous)
        }
        val old = async { repository.preferences() }
        started.await()
        try {
            assertTrue(repository.setApiBaseUrl("https://b.example/api/v1/") is AppResult.Success)
        } finally { release.complete(Unit) }
        old.join()
        coEvery { api.preferences(session = any()) } returns ApiEnvelope(next)
        val result = repository.preferences()
        assertEquals(AppResult.Success(next), result)
        assertEquals(next, local.readPreferences())
        assertTrue("The old request must be cancelled when its account leaves", old.isCancelled)
    }

    @Test
    fun `server replacement archives accepted mutations instead of deleting them`() = runBlocking {
        val repository = repository(mockk(relaxed = true))
        repository.prepareSession()
        val owner = store.currentSession()
        assertTrue(repository.markRead("same-id", true) is AppResult.Success)
        val pending = local.readPendingReadStateMutations().single()
        assertTrue(repository.setApiBaseUrl("https://b.example/api/v1/") is AppResult.Success)
        assertEquals(listOf(pending), database.localStoreDao().readArchivedReadStateMutations(owner.ownerId).map { it.mutation })
        assertTrue(local.readPendingReadStateMutations().isEmpty())
        assertEquals(store.currentSession().ownerId, local.readOwner()?.ownerId)
    }

    @Test
    fun `a retry retains its original owner and stops when that owner leaves`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        val owner = store.currentSession()
        val started = CompletableDeferred<Unit>()
        coEvery { api.stats(session = any()) } coAnswers {
            started.complete(Unit)
            throw java.io.IOException("connection lost")
        }
        val request = async { repository.stats() }
        started.await()
        repository.setApiBaseUrl("https://b.example/api/v1/")
        withTimeout(5_000) { request.join() }
        assertTrue(request.isCancelled)
        io.mockk.coVerify(exactly = 1) { api.stats(session = owner) }
        io.mockk.coVerify(exactly = 1) { api.stats(session = any()) }
    }

    @Test
    fun `a delayed unauthorized response cannot log out the next account`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        every { refreshCoordinator.hasRecentRefreshRejection(any()) } returns true
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        coEvery { api.adminUsers(session = any()) } coAnswers {
            started.complete(Unit)
            withContext(NonCancellable) { release.await() }
            throw retrofit2.HttpException(retrofit2.Response.error<Unit>(
                401, "unauthorized".toResponseBody(),
            ))
        }
        val request = async { repository.adminUsers() }
        started.await()
        val next: ApiSession
        try {
            repository.setApiBaseUrl("https://b.example/api/v1/")
            next = store.currentSession()
            repository.markRead("new-account-intent", false)
        } finally { release.complete(Unit) }
        request.join()
        assertTrue(request.isCancelled)
        assertEquals(next, store.currentSession())
        assertEquals(listOf("new-account-intent"), local.readPendingReadStateMutations().map { it.articleId })
    }

    @Test
    fun `a departed outbox acknowledgement cannot consume the next owners intent for the same article`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        val owner = store.currentSession()
        repository.markRead("shared-id", true)
        val oldMutation = local.readPendingReadStateMutations().single()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        coEvery { api.markRead(any(), any(), session = any()) } coAnswers {
            started.complete(Unit)
            withContext(NonCancellable) { release.await() }
            ApiEnvelope(MarkReadResponse(success = true, read = true, revision = 42))
        }
        online.value = true
        val drain = async { repository.flushPendingArticleStateMutations() }
        started.await()
        val nextMutation: com.selffeed.android.data.local.PendingReadStateMutationEntity
        try {
            withTimeout(5_000) { repository.setApiBaseUrl("https://b.example/api/v1/") }
            online.value = false
            repository.markRead("shared-id", false)
            nextMutation = local.readPendingReadStateMutations().single()
        } finally { release.complete(Unit) }
        drain.join()
        assertTrue(drain.isCancelled)
        assertEquals(listOf(nextMutation), local.readPendingReadStateMutations())
        assertEquals(listOf(oldMutation), database.localStoreDao().readArchivedReadStateMutations(owner.ownerId).map { it.mutation })
        io.mockk.coVerify(exactly = 1) { api.markRead("shared-id", any(), session = owner) }
    }

    @Test
    fun `retained Paging factories cannot read a replacement owners rows`() = runBlocking {
        val owner = boundary.prepare()
        val article = ArticleListItem("same-id", "feed", "Feed", title = "Account A", isRead = false, isSaved = true)
        local.writeArticleRemotePage("same-query", ApiListResponse(listOf(article), null, false), true)
        val normal = { local.articlePagingSource("same-query", owner.ownerId) }
        val saved = { local.savedArticlePagingSource(owner.ownerId) }
        assertEquals(listOf("Account A"), pageTitles(normal()))
        assertEquals(listOf("Account A"), pageTitles(saved()))
        boundary.replace { store.beginAuthentication() }
        val next = store.currentSession()
        local.writeArticleRemotePage("same-query", ApiListResponse(listOf(article.copy(title = "Account B")), null, false), true)
        assertTrue(pageTitles(normal()).isEmpty())
        assertTrue(pageTitles(saved()).isEmpty())
        assertEquals(listOf("Account B"), pageTitles(local.articlePagingSource("same-query", next.ownerId)))
        assertEquals(listOf("Account B"), pageTitles(local.savedArticlePagingSource(next.ownerId)))
    }

    @Test
    fun `permanent read rejection publishes the captured id after restoring local state`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        val article = ArticleListItem("read-rejected", "feed", "Feed", title = "Article", isRead = false, readRevision = 4)
        local.writeArticleRemotePage("read-rejected", ApiListResponse(listOf(article), null, false), true)
        val queued = local.queueReadStateMutation(article.id, true)
        coEvery { api.markRead(any(), any(), session = any()) } throws retrofit2.HttpException(
            retrofit2.Response.error<Unit>(422, "rejected".toResponseBody()),
        )
        val failure = async(start = CoroutineStart.UNDISPATCHED) { repository.readStateRejections().first() }
        try {
            online.value = true
            assertTrue(repository.flushPendingArticleStateMutations())
            val rejected = withTimeout(5_000) { failure.await() }
            assertEquals(queued.mutationId, rejected.mutationId)
            assertEquals(article.id, rejected.articleId)
            assertEquals(false, local.readArticleState(article.id).isRead)
            assertTrue(local.readPendingReadStateMutations().isEmpty())
        } finally { failure.cancelAndJoin() }
    }

    @Test
    fun `a rejected save with unknown prior state still publishes its failure`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        local.queueSavedStateMutation("unknown", true)
        coEvery { api.setSaved(any(), any(), session = any()) } throws retrofit2.HttpException(
            retrofit2.Response.error<Unit>(404, "unavailable".toResponseBody()),
        )
        val failure = async(start = CoroutineStart.UNDISPATCHED) { repository.savedStateRejections().first() }
        try {
            online.value = true
            assertTrue(repository.flushPendingArticleStateMutations())
            val rejected = withTimeout(5_000) { failure.await() }
            assertEquals("unknown", rejected.articleId)
            assertNull(rejected.restoredSaved)
            assertTrue(local.readPendingSavedStateMutations().isEmpty())
            assertNull(local.queueSavedStateMutation("unknown", false).previousState)
        } finally { failure.cancelAndJoin() }
    }

    @Test
    fun `buffered saved rejection does not cross into a replacement account`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        val received = mutableListOf<String>()
        val first = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val current = CompletableDeferred<Unit>()
        val collector = launch(start = CoroutineStart.UNDISPATCHED) {
            repository.savedStateRejections().collect { event ->
                received += event.articleId
                if (received.size == 1) { first.complete(Unit); release.await() }
                if (event.articleId == "current") current.complete(Unit)
            }
        }
        val article = ArticleListItem("old-1", "feed", "Feed", title = "Article", isRead = false)
        coEvery { api.setSaved(any(), any(), session = any()) } throws retrofit2.HttpException(
            retrofit2.Response.error<Unit>(404, "unavailable".toResponseBody()),
        )
        try {
            local.writeArticleRemotePage("query", ApiListResponse(listOf(article, article.copy(id = "old-2")), null, false), true)
            local.queueSavedStateMutation("old-1", true)
            local.queueSavedStateMutation("old-2", true)
            online.value = true
            assertTrue(repository.flushPendingArticleStateMutations())
            first.await()
            repository.setApiBaseUrl("https://b.example/api/v1/")
            release.complete(Unit)
            local.writeArticleRemotePage("query", ApiListResponse(listOf(article.copy(id = "current")), null, false), true)
            local.queueSavedStateMutation("current", true)
            assertTrue(repository.flushPendingArticleStateMutations())
            withTimeout(5_000) { current.await() }
            assertEquals(listOf("old-1", "current"), received)
        } finally { release.complete(Unit); collector.cancelAndJoin() }
    }

    @Test
    fun `buffered authentication loss belongs to the exact cleared session`() = runBlocking {
        val api = mockk<RssApi>(relaxed = true)
        val repository = repository(api)
        repository.prepareSession()
        every { refreshCoordinator.hasRecentRefreshRejection(any()) } returns true
        coEvery { api.adminUsers(session = any()) } throws retrofit2.HttpException(
            retrofit2.Response.error<Unit>(401, "unauthorized".toResponseBody()),
        )
        var received = 0
        val first = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val collector = launch(start = CoroutineStart.UNDISPATCHED) {
            repository.authEvents().collect {
                received++
                if (received == 1) { first.complete(Unit); release.await() }
            }
        }
        try {
            repository.adminUsers()
            first.await()
            repository.adminUsers() // Queued while its subscriber is busy.
            repository.setApiBaseUrl("https://b.example/api/v1/")
            release.complete(Unit)
            yield() // Resume the waiting subscriber on this runBlocking event loop.
            assertEquals(1, received)
            repository.adminUsers()
            yield()
            assertEquals(2, received)
        } finally { release.complete(Unit); collector.cancelAndJoin() }
    }

    private suspend fun pageTitles(source: androidx.paging.PagingSource<Int, ArticleListItem>): List<String> {
        val result = source.load(androidx.paging.PagingSource.LoadParams.Refresh<Int>(null, 30, false))
        check(result is androidx.paging.PagingSource.LoadResult.Page) { result.toString() }
        source.invalidate()
        return result.data.map { it.title }
    }

    private fun preferences(user: String) = UserPreferences(
        userId = user, theme = "dark", fontFamily = "sans", textSize = 100,
        density = "compact", defaultSort = "newest", hideRead = false,
        keyboardShortcutsEnabled = true, autoMarkReadMode = "manual",
    )
}
