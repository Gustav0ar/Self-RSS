package com.selffeed.android.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import coil3.ImageLoader
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineReadStore
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.data.repository.AuthenticatedSession
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleStateLookupRequest
import com.selffeed.android.network.ArticleStateLookupResponse
import com.selffeed.android.network.ArticleStateSnapshot
import com.selffeed.android.network.ApiEnvelope
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.MarkAllReadResponse
import com.selffeed.android.network.MarkReadResponse
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.RssApi
import com.selffeed.android.network.SessionRefreshCoordinator
import com.selffeed.android.network.SessionRefreshResult
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.ui.ArticlesViewModel
import com.selffeed.android.ui.FeedsViewModel
import com.selffeed.android.ui.MainDispatcherRule
import com.selffeed.android.ui.articles.ArticleWarmingManager
import com.selffeed.android.ui.articles.EnrichmentManager
import com.selffeed.android.ui.articles.ReadStateManager
import com.squareup.moshi.Moshi
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkObject
import io.mockk.unmockkObject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

/**
 * Focused unit tests for the [RssRepository] behavior that doesn't depend on
 * a real network: in-memory cache eviction, optimistic markRead roll-back,
 * and the debug resilience metrics.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@OptIn(ExperimentalCoroutinesApi::class)
class RssRepositoryTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()
    private lateinit var context: Context
    private lateinit var api: RssApi
    private lateinit var sessionStore: SessionStore
    private lateinit var sessionRefreshCoordinator: SessionRefreshCoordinator
    private lateinit var localStore: LocalStore
    private lateinit var database: com.selffeed.android.data.local.LocalDatabase
    private val databaseName = "repository-test-${java.util.UUID.randomUUID()}"
    private lateinit var offlineReadStore: OfflineReadStore
    private lateinit var imageLoader: ImageLoader
    private lateinit var networkMonitor: NetworkMonitor
    private lateinit var onlineState: MutableStateFlow<Boolean>
    private lateinit var repository: RssRepository
    private val backgroundJob = kotlinx.coroutines.SupervisorJob()
    private val backgroundScope = kotlinx.coroutines.CoroutineScope(backgroundJob + Dispatchers.Unconfined)

    @After
    fun closeBackgroundJobs() {
        runBlocking { backgroundJob.cancel(); backgroundJob.join() }
        database.close()
        context.deleteDatabase(databaseName)
    }

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        api = mockk(relaxed = true)
        sessionStore = mockk(relaxed = true)
        var owner = ApiSession(0, "https://a.example/api/v1/", java.util.UUID.randomUUID().toString())
        every { sessionStore.currentSession() } answers { owner }
        every { sessionStore.loadedSession() } answers { owner }
        every { sessionStore.getApiBaseUrl() } answers { owner.apiBaseUrl }
        every { sessionStore.isCurrentSession(any()) } answers { firstArg<ApiSession>() == owner }
        coEvery { sessionStore.clear() } coAnswers {
            owner = owner.copy(generation = owner.generation + 1, ownerId = java.util.UUID.randomUUID().toString())
        }
        coEvery { sessionStore.beginAuthentication() } coAnswers {
            owner = owner.copy(generation = owner.generation + 1, ownerId = java.util.UUID.randomUUID().toString())
            owner
        }
        coEvery { sessionStore.setAccessTokenIfCurrent(any(), any()) } coAnswers { firstArg<ApiSession>() == owner }
        coEvery { sessionStore.setApiBaseUrl(any()) } coAnswers {
            owner = ApiSession(owner.generation + 1, firstArg(), java.util.UUID.randomUUID().toString())
            owner.apiBaseUrl
        }
        sessionRefreshCoordinator = mockk(relaxed = true)
        // The production Moshi includes the reflective
        // KotlinJsonAdapterFactory as a fallback for DTOs whose generated
        // adapters aren't on the test classpath. The test suite uses the
        // same Moshi so writes through LocalStore can encode payloads.
        val moshi = com.selffeed.android.network.NetworkModule.provideMoshi()
        database = androidx.room.Room.databaseBuilder(
            context, com.selffeed.android.data.local.LocalDatabase::class.java, databaseName,
        ).build()
        localStore = LocalStore(database, moshi)
        offlineReadStore = localStore
        imageLoader = mockk(relaxed = true)
        networkMonitor = mockk(relaxed = true)
        onlineState = MutableStateFlow(true)
        every { networkMonitor.online } returns onlineState
        every { networkMonitor.unmetered } returns onlineState
        repository = RssRepository(
            authRemote = AuthRemoteDataSource(api),
            feedRemote = FeedRemoteDataSource(api),
            articleRemote = ArticleRemoteDataSource(api),
            searchRemote = SearchRemoteDataSource(api),
            settingsRemote = SettingsRemoteDataSource(api),
            sessionStore = sessionStore,
            sessionRefreshCoordinator = sessionRefreshCoordinator,
            okHttpClient = OkHttpClient(),
            moshi = moshi,
            localStore = localStore,
            offlineReadStore = offlineReadStore,
            imageRequestContext = context,
            imageLoader = imageLoader,
            networkMonitor = networkMonitor,
            refreshScope = backgroundScope,
        )
    }

    @Test
    fun `worker cancellation releases a blocked poll without reporting success`() = runTest {
        every { sessionStore.getAccessToken() } returns "worker-access-token"
        val polling = CompletableDeferred<Unit>()
        val released = CompletableDeferred<Unit>()
        coEvery { api.syncAllFeeds(any(), any(), any(), any()) } returns ApiEnvelope(SyncResponse(status = "queued"))
        coEvery { api.syncAllFeedsStatus(any(), any()) } coAnswers {
            polling.complete(Unit)
            try { awaitCancellation() } finally { released.complete(Unit) }
        }
        var completed = false
        val running = launch {
            FeedSyncWorker(context, mockk<WorkerParameters>(relaxed = true), repository).doWork()
            completed = true
        }
        polling.await()
        running.cancelAndJoin()
        released.await()
        assertTrue(running.isCancelled)
        assertEquals(false, completed)
        coVerify(exactly = 1) { api.syncAllFeedsStatus(any(), any()) }
    }

    @Test
    fun `feed worker cannot adopt a replacement account between status polls`() = runTest {
        every { sessionStore.getAccessToken() } returns "worker-access-token"
        val firstOwner = sessionStore.currentSession()
        val firstPoll = CompletableDeferred<Unit>()
        val owners = mutableListOf<ApiSession>()
        coEvery { api.syncAllFeeds(any(), any(), any(), any()) } returns
            com.selffeed.android.network.ApiEnvelope(SyncResponse(status = "queued"))
        coEvery { api.syncAllFeedsStatus(any(), any()) } coAnswers {
            val owner = secondArg<ApiSession>()
            owners += owner
            firstPoll.complete(Unit)
            com.selffeed.android.network.ApiEnvelope(FeedSyncAllStatus(
                queued = false, running = owner == firstOwner, active = owner == firstOwner, stale = false,
            ))
        }
        val worker = FeedSyncWorker(context, mockk<WorkerParameters>(relaxed = true), repository)
        val running = async { worker.doWork() }
        firstPoll.await()
        runCurrent()

        repository.setApiBaseUrl("https://replacement.example/api/v1/")
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(ListenableWorker.Result.success(), running.await())
        assertEquals(listOf(firstOwner), owners)
    }

    @Test
    fun `foreground subscriptions emit Room snapshots before freshness and cancel their real refresh calls`() = runTest {
        repository.prepareSession()
        val storedCategory = sampleCategory("stored-category")
        val storedFeed = sampleFeed("stored-feed")
        localStore.writeCategories(listOf(storedCategory))
        localStore.writeFeeds(listOf(storedFeed))
        val queued = localStore.queueReadStateMutation("pending-article", true)
        val categoryStarted = CompletableDeferred<Unit>()
        val feedStarted = CompletableDeferred<Unit>()
        val categoryCancelled = CompletableDeferred<Unit>()
        val feedCancelled = CompletableDeferred<Unit>()
        coEvery { api.categories(any()) } coAnswers {
            categoryStarted.complete(Unit)
            try { awaitCancellation() } finally { categoryCancelled.complete(Unit) }
        }
        coEvery { api.feeds(any(), any()) } coAnswers {
            feedStarted.complete(Unit)
            try { awaitCancellation() } finally { feedCancelled.complete(Unit) }
        }
        val categories = mutableListOf<AppResult<List<CategoryWithCounts>>>()
        val feeds = mutableListOf<AppResult<List<FeedWithCounts>>>()
        val categoryRead = launch { repository.categoryUpdates().toList(categories) }
        val feedRead = launch { repository.feedUpdates().toList(feeds) }
        categoryStarted.await()
        feedStarted.await()
        assertEquals(listOf(AppResult.Success(listOf(storedCategory))), categories)
        assertEquals(listOf(AppResult.Success(listOf(storedFeed))), feeds)
        assertEquals(listOf(queued), localStore.readPendingReadStateMutations())

        categoryRead.cancelAndJoin()
        feedRead.cancelAndJoin()
        assertTrue(categoryCancelled.isCompleted)
        assertTrue(feedCancelled.isCompleted)
        assertEquals(listOf(queued), localStore.readPendingReadStateMutations())
    }

    @Test
    fun `foreground snapshots preserve pending unread counts while accepting fresh metadata`() = runTest {
        repository.prepareSession()
        val storedCategory = sampleCategory("c-local").copy(unreadCount = 2)
        val storedFeed = sampleFeed("f-local").copy(unreadCount = 2)
        val storedArticle = sampleArticle("pending-count").copy(feedId = "f-local")
        localStore.writeCategories(listOf(storedCategory))
        localStore.writeFeeds(listOf(storedFeed))
        localStore.writeArticleRemotePage("count-test", ApiListResponse(listOf(storedArticle), null, false), true)
        coEvery { api.categories(any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.CategoryTreeResponse(listOf(storedCategory), totalUnread = 2),
        )
        coEvery { api.feeds(any(), any()) } returns com.selffeed.android.network.ApiEnvelope(listOf(storedFeed))
        val model = FeedsViewModel(repository)
        model.refreshCategories()
        model.refreshFeedHealth()
        val counts = backgroundScope.launch { model.observeLibraryCounts() }
        val queued = localStore.queueReadStateMutation(storedArticle.id, true)
        coEvery { api.feeds(any(), any()) } returns com.selffeed.android.network.ApiEnvelope(
            listOf(storedFeed.copy(title = "Updated metadata")),
        )

        model.refreshFeedHealth()
        model.refreshCategories()

        assertEquals("Updated metadata", model.state.value.feeds.single().title)
        assertEquals(1, model.state.value.feeds.single().unreadCount)
        assertEquals(1, model.state.value.categories.single().unreadCount)
        assertEquals(listOf(queued), localStore.readPendingReadStateMutations())
    }

    @Test
    fun `a subscription fetch cannot claim current counts when pending reads drain during it`() = runTest {
        repository.prepareSession()
        val storedFeed = sampleFeed("f-local").copy(unreadCount = 2)
        localStore.writeFeeds(listOf(storedFeed))
        val queued = localStore.queueReadStateMutation("pending-count", true)
        val started = CompletableDeferred<Unit>()
        val response = CompletableDeferred<com.selffeed.android.network.ApiEnvelope<List<FeedWithCounts>>>()
        coEvery { api.feeds(any(), any()) } coAnswers {
            started.complete(Unit)
            response.await()
        }
        val snapshots = async { repository.feedUpdates().toList() }
        started.await()
        localStore.acknowledgeReadStateMutation(queued, true, 1)
        response.complete(com.selffeed.android.network.ApiEnvelope(listOf(storedFeed)))

        val result = snapshots.await().last() as AppResult.Success
        assertEquals(2, result.data.single().unreadCount)
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
    }

    @Test
    fun `foreground subscription snapshots remain usable when freshness fails offline`() = runTest {
        repository.prepareSession()
        val storedCategory = sampleCategory("offline-category")
        val storedFeed = sampleFeed("offline-feed")
        localStore.writeCategories(listOf(storedCategory))
        localStore.writeFeeds(listOf(storedFeed))
        coEvery { api.categories(any()) } throws java.io.IOException("Offline")
        coEvery { api.feeds(any(), any()) } throws java.io.IOException("Offline")

        assertEquals(listOf(AppResult.Success(listOf(storedCategory))), repository.categoryUpdates().toList())
        assertEquals(listOf(AppResult.Success(listOf(storedFeed))), repository.feedUpdates().toList())
    }

    @Test
    fun `analytics persistence failure cannot turn a successful login into an error`() = runTest {
        coEvery { api.login(any(), any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.AuthResponse(sampleUser(), com.selffeed.android.network.AccessTokenOnly("new-token")),
        )
        coEvery { sessionStore.enqueueProductAnalyticsEvent(any()) } throws java.io.IOException("storage unavailable")
        val result = repository.login("reader@example.com", "password")
        assertEquals(AppResult.Success(AuthenticatedSession.Verified(sessionStore.currentSession(), sampleUser())), result)
        coVerify { sessionStore.recordAuthenticated(any()) }
    }

    @Test
    fun `login response after logout cannot restore the access token`() = runTest {
        val session = ApiSession(0, "rss.example.com", "test-owner")
        val response = CompletableDeferred<com.selffeed.android.network.ApiEnvelope<com.selffeed.android.network.AuthResponse>>()
        coEvery { sessionStore.setAccessTokenIfCurrent(session, any()) } returns false
        coEvery { api.login(any(), any()) } coAnswers { response.await() }

        val login = async { repository.login("reader@example.com", "password") }
        runCurrent()
        repository.logout()
        response.complete(com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.AuthResponse(sampleUser(), com.selffeed.android.network.AccessTokenOnly("late-token")),
        ))

        login.join()
        assertTrue(login.isCancelled)
        coVerify(exactly = 0) { sessionStore.setAccessToken(any()) }
        coVerify(exactly = 0) { sessionStore.recordAuthenticated(any()) }
    }

    @Test
    fun `committed actions return their receipts while work scheduling is suspended`() = runTest {
        onlineState.value = false
        mockkObject(ArticleStateSyncWorker.Companion)
        try {
            for (saved in listOf(false, true)) {
                val started = CompletableDeferred<Unit>()
                val release = CompletableDeferred<Unit>()
                coEvery { ArticleStateSyncWorker.kickOnce(any()) } coAnswers {
                    started.complete(Unit)
                    release.await()
                }
                val action = async {
                    if (saved) repository.setSaved("scheduled", false)
                    else repository.markRead("scheduled", true)
                }
                try {
                    started.await()
                    // Room completes on its own executor, outside the test scheduler.
                    // Await the receipt while WorkManager is still held at the gate.
                    val result = withContext(Dispatchers.Default) {
                        withTimeout(5_000) { action.await() }
                    }
                    assertTrue("WorkManager must still be suspended", !release.isCompleted)
                    val receipt = (result as AppResult.Success).data
                    val pendingId = if (saved) localStore.readPendingSavedStateMutations().single().mutationId
                        else localStore.readPendingReadStateMutations().single().mutationId
                    assertEquals(pendingId, receipt.mutationId)
                } finally {
                    release.complete(Unit)
                    action.join()
                }
            }
        } finally { unmockkObject(ArticleStateSyncWorker.Companion) }
    }

    @Test
    fun `optional image prefetch failure cannot reject a committed bookmark receipt`() = runTest {
        val detail = sampleArticleDetail("bookmark-image-failure", false).copy(
            heroImageUrl = "https://example.invalid/hero.jpg", isEnriched = true,
        )
        coEvery { api.article(detail.id, session = any()) } returns ApiEnvelope(detail)
        assertTrue(repository.article(detail.id) is AppResult.Success)
        every { imageLoader.enqueue(any()) } throws IllegalStateException("Image loader unavailable")
        onlineState.value = false

        val result = repository.setSaved(detail.id, true)

        assertTrue(result is AppResult.Success)
        assertEquals(localStore.readPendingSavedStateMutations().single().mutationId,
            (result as AppResult.Success).data.mutationId)
        assertEquals(true, localStore.readArticleDetail(detail.id)?.isSaved)
    }

    @Test
    fun `worker rejection restores saved state through the real ViewModel repository and Room`() = runTest {
        val articleId = "saved-rollback"
        val detail = sampleArticleDetail(articleId, isRead = false).copy(isEnriched = true)
        every { sessionStore.getAccessToken() } returns "test-session"
        coEvery { api.article(articleId, session = any()) } returns com.selffeed.android.network.ApiEnvelope(detail)
        coEvery { api.setSaved(articleId, any(), session = any()) } throws httpError(404, "Article unavailable")
        onlineState.value = false
        val viewModel = ArticlesViewModel(
            repository, ReadStateManager(repository), EnrichmentManager(repository), ArticleWarmingManager(repository),
        )
        val viewModelStore = androidx.lifecycle.ViewModelStore().apply { put("articles", viewModel) }
        try {
            backgroundScope.launch { viewModel.observeReadStateSync() }
            viewModel.openArticle(articleId)
            viewModel.state.first { it.selectedArticle?.contentHtml != null }
            viewModel.setSaved(articleId, true)
            localStore.invalidations.first { localStore.readPendingSavedStateMutations().isNotEmpty() }
            assertEquals(true, viewModel.state.value.selectedArticle?.isSaved)

            onlineState.value = true
            assertTrue(repository.flushPendingArticleStateMutations())
            runCurrent()

            assertTrue(localStore.readPendingSavedStateMutations().isEmpty())
            assertEquals(false, localStore.readArticleDetail(articleId)?.isSaved)
            assertEquals(false, repository.cachedArticleDetail(articleId)?.isSaved)
            withContext(Dispatchers.Default) {
                withTimeout(5_000) { viewModel.state.first { it.selectedArticle?.isSaved == false && it.errorMessage != null } }
            }
            assertEquals(false, viewModel.state.value.selectedArticle?.isSaved)
            assertNotNull(viewModel.state.value.errorMessage)
        } finally {
            viewModelStore.clear()
        }
    }

    @Test
    fun `trimMemoryCaches clears the in-memory map and reports an invalidation`() {
        // Populate the cache via a successful call.
        coEvery { api.me(session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            data = com.selffeed.android.network.User(
                id = "u-1",
                email = "x@x.com",
                role = "user",
                isActive = true,
            ),
        )
        every { sessionStore.getAccessToken() } returns null
        every { sessionStore.getClientId() } returns "client-1"
        runTest {
            val meResult = repository.me()
            assertTrue(meResult is AppResult.Success)
        }

        // Cache should have one entry. Trim and verify.
        repository.trimMemoryCaches()
        val snapshot = repository.getDebugResilienceSnapshot()
        assertTrue(
            "expected at least one cache invalidation after trim",
            (snapshot["cacheInvalidationCount"] ?: 0) > 0L,
        )
    }

    @Test
    fun `markRead retains optimistic state and durable intent on transient failure`() = runTest {
        val articleId = "article-1"
        val detail = sampleArticleDetail(id = articleId, isRead = false)
        // Pre-seed the in-memory cache.
        repository.cachedArticleDetail(articleId) // returns null on first read
        // Force a cached entry by running me() first then re-populating via
        // cachedArticleDetail through a manual cache put via the public API
        // (we don't expose putCached, so we exercise the path via a successful
        // article fetch).
        coEvery { api.article(articleId, session = any()) } returns com.selffeed.android.network.ApiEnvelope(detail)
        every { sessionStore.getAccessToken() } returns "token"

        val fetched = repository.article(articleId)
        assertTrue(fetched is AppResult.Success)
        val cachedBefore = repository.cachedArticleDetail(articleId)
        assertNotNull(cachedBefore)
        assertEquals(false, cachedBefore!!.isRead)

        // A transient delivery failure must not roll back an action that is
        // already durable in the local outbox.
        coEvery {
            api.markRead(
                articleId,
                match { it.read && it.source == "manual" && it.mutationId != null },
                session = any(),
            )
        } throws
            java.net.SocketTimeoutException("simulated timeout")
        val result = repository.markRead(articleId, true)
        assertTrue(result is AppResult.Success)

        assertEquals(false, repository.flushPendingArticleStateMutations())
        val cachedAfter = repository.cachedArticleDetail(articleId)
        assertNotNull(cachedAfter)
        assertEquals(true, cachedAfter!!.isRead)
        assertEquals(1, localStore.readPendingReadStateMutations().size)
    }

    @Test
    fun `markRead with successful server response retains the warmed article cache`() = runTest {
        val articleId = "article-2"
        val detail = sampleArticleDetail(id = articleId, isRead = false)
        coEvery { api.article(articleId, session = any()) } returns com.selffeed.android.network.ApiEnvelope(detail)
        every { sessionStore.getAccessToken() } returns "token"
        coEvery {
            api.markRead(
                articleId,
                match { it.read && it.source == "manual" && it.mutationId != null },
                session = any(),
            )
        } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.MarkReadResponse(success = true, read = true, revision = 1),
        )

        // Seed cache.
        repository.article(articleId)
        assertNotNull(repository.cachedArticleDetail(articleId))

        val result = repository.markRead(articleId, true)
        assertTrue(result is AppResult.Success)

        assertTrue(repository.flushPendingArticleStateMutations())
        assertEquals(true, repository.cachedArticleDetail(articleId)?.isRead)
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        coVerify {
            api.markRead(articleId, match { it.read && it.source == "manual" && it.mutationId != null }, session = any())
        }
    }

    @Test
    fun `old read acknowledgment cannot replace a newer cached intent`() = runTest {
        val articleId = "article-read-replaced"
        val detail = sampleArticleDetail(articleId, isRead = false)
        every { sessionStore.getAccessToken() } returns "token"
        coEvery { api.article(articleId, session = any()) } returns com.selffeed.android.network.ApiEnvelope(detail)
        repository.article(articleId)

        val oldDeliveryStarted = CompletableDeferred<Unit>()
        val releaseOldDelivery = CompletableDeferred<Unit>()
        val newDeliveryStarted = CompletableDeferred<Unit>()
        val releaseNewDelivery = CompletableDeferred<Unit>()
        coEvery { api.markRead(articleId, any(), session = any()) } coAnswers {
            if (secondArg<com.selffeed.android.network.MarkReadRequest>().read) {
                oldDeliveryStarted.complete(Unit)
                releaseOldDelivery.await()
                com.selffeed.android.network.ApiEnvelope(MarkReadResponse(success = true, read = true, revision = 1))
            } else {
                newDeliveryStarted.complete(Unit)
                releaseNewDelivery.await()
                com.selffeed.android.network.ApiEnvelope(MarkReadResponse(success = true, read = false, revision = 2))
            }
        }

        assertTrue(repository.markRead(articleId, true) is AppResult.Success)
        val delivery = async { repository.flushPendingArticleStateMutations() }
        oldDeliveryStarted.await()
        assertTrue(repository.markRead(articleId, false) is AppResult.Success)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                localStore.invalidations.first {
                    localStore.readPendingReadStateMutations().singleOrNull()?.read == false
                }
            }
        }
        releaseOldDelivery.complete(Unit)
        newDeliveryStarted.await()
        try {
            assertEquals(false, repository.cachedArticleDetail(articleId)?.isRead)
            assertEquals(false, (repository.article(articleId) as AppResult.Success).data.isRead)
        } finally {
            releaseNewDelivery.complete(Unit)
            assertTrue(delivery.await())
        }
    }

    @Test
    fun `old saved acknowledgment cannot replace a newer cached intent`() = runTest {
        val articleId = "article-save-replaced"
        val detail = sampleArticleDetail(articleId, isRead = false)
        every { sessionStore.getAccessToken() } returns "token"
        coEvery { api.article(articleId, session = any()) } returns com.selffeed.android.network.ApiEnvelope(detail)
        repository.article(articleId)

        val oldDeliveryStarted = CompletableDeferred<Unit>()
        val releaseOldDelivery = CompletableDeferred<Unit>()
        val newDeliveryStarted = CompletableDeferred<Unit>()
        val releaseNewDelivery = CompletableDeferred<Unit>()
        coEvery { api.setSaved(articleId, any(), session = any()) } coAnswers {
            if (secondArg<com.selffeed.android.network.SaveArticleRequest>().saved) {
                oldDeliveryStarted.complete(Unit)
                releaseOldDelivery.await()
                com.selffeed.android.network.ApiEnvelope(MarkReadResponse(success = true, saved = true, revision = 1))
            } else {
                newDeliveryStarted.complete(Unit)
                releaseNewDelivery.await()
                com.selffeed.android.network.ApiEnvelope(MarkReadResponse(success = true, saved = false, revision = 2))
            }
        }

        assertTrue(repository.setSaved(articleId, true) is AppResult.Success)
        val delivery = async { repository.flushPendingArticleStateMutations() }
        oldDeliveryStarted.await()
        assertTrue(repository.setSaved(articleId, false) is AppResult.Success)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                localStore.invalidations.first {
                    localStore.readPendingSavedStateMutations().singleOrNull()?.saved == false
                }
            }
        }
        releaseOldDelivery.complete(Unit)
        newDeliveryStarted.await()
        try {
            assertEquals(false, repository.cachedArticleDetail(articleId)?.isSaved)
            assertEquals(false, (repository.article(articleId) as AppResult.Success).data.isSaved)
        } finally {
            releaseNewDelivery.complete(Unit)
            assertTrue(delivery.await())
        }
    }

    @Test
    fun `automatic markRead sends auto source to the API`() = runTest {
        val articleId = "article-auto"
        every { sessionStore.getAccessToken() } returns "token"
        coEvery {
            api.markRead(
                articleId,
                match { it.read && it.source == "auto_open" && it.mutationId != null },
                session = any(),
            )
        } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.MarkReadResponse(success = true, read = true, revision = 1),
        )

        val result = repository.markRead(articleId, true, source = "auto_open")

        assertTrue(result is AppResult.Success)
        assertTrue(repository.flushPendingArticleStateMutations())
        coVerify {
            api.markRead(articleId, match { it.read && it.source == "auto_open" && it.mutationId != null }, session = any())
        }
    }

    @Test
    fun `feed deletion invalidates cached query membership while retaining queued count baselines`() = runTest {
        repository.prepareSession()
        localStore.writeFeeds(listOf(sampleFeed("f-local").copy(unreadCount = 2)))
        val article = sampleArticle("deleted-feed-article").copy(feedId = "f-local")
        localStore.writeArticleRemotePage("deleted-feed-query", ApiListResponse(listOf(article), null, false), true)
        val queued = localStore.queueReadStateMutation(article.id, true)
        coEvery { api.deleteFeed("f-local", session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.SuccessResponse(true),
        )
        assertTrue(repository.deleteFeed("f-local") is AppResult.Success)
        val page = localStore.articlePagingSource("deleted-feed-query", ownerId = null).load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(null, 30, false),
        ) as androidx.paging.PagingSource.LoadResult.Page<Int, ArticleListItem>
        assertTrue(page.data.isEmpty())
        assertEquals(1, localStore.readFeeds().single().unreadCount)
        assertEquals(listOf(queued), localStore.readPendingReadStateMutations())
    }

    @Test
    fun `acknowledged realtime read state updates the canonical Room row`() = runTest {
        val articleId = "article-retained"
        val queryKey = ArticlePageQuery(unreadOnly = true).remoteKey()
        localStore.writeArticleRemotePage(
            queryKey = queryKey,
            payload = ApiListResponse(data = listOf(sampleArticle(articleId)), cursor = null, hasMore = false),
            clearExisting = true,
        )

        val pagingSource = localStore.articlePagingSource(queryKey, ownerId = null)
        pagingSource.load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val invalidated = CompletableDeferred<Unit>()
        pagingSource.registerInvalidatedCallback { invalidated.complete(Unit) }
        repository.updateCachedReadState(articleId, read = true)
        repository.invalidateReadStateCaches(articleId)

        // Room notifies Paging from its executor after the transaction commits.
        withContext(Dispatchers.Default) { withTimeout(5_000) { invalidated.await() } }
        assertEquals(true, pagingSource.invalid)
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        val page = localStore.articlePagingSource(queryKey, ownerId = null).load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page<Int, ArticleListItem>
        assertEquals(listOf(articleId), page.data.map { it.id })
        assertEquals(true, page.data.first().isRead)
    }

    @Test
    fun `realtime content invalidation retains the active Room queue`() = runTest {
        val queryKey = ArticlePageQuery(unreadOnly = true).remoteKey()
        localStore.writeArticleRemotePage(
            queryKey = queryKey,
            payload = ApiListResponse(
                data = listOf(sampleArticle("article-visible")),
                cursor = null,
                hasMore = false,
            ),
            clearExisting = true,
        )
        val pagingSource = localStore.articlePagingSource(queryKey, ownerId = null)

        repository.invalidateArticleContentCaches()

        assertEquals(false, pagingSource.invalid)
        val page = pagingSource.load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page<Int, ArticleListItem>
        assertEquals(listOf("article-visible"), page.data.map { it.id })
    }

    @Test
    fun `markAllRead marks cached feed rows read without clearing the paging query`() = runTest {
        val queryKey = ArticlePageQuery(feedId = "f-local", unreadOnly = true).remoteKey()
        localStore.writeArticleRemotePage(
            queryKey = queryKey,
            payload = ApiListResponse(data = listOf(sampleArticle("article-bulk-read")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        coEvery {
            api.markAllRead(com.selffeed.android.network.MarkAllReadRequest(feedId = "f-local"), session = any())
        } returns com.selffeed.android.network.ApiEnvelope(
            MarkAllReadResponse(markedCount = 1, feedIds = listOf("f-local")),
        )

        val result = repository.markAllRead(feedId = "f-local", categoryId = null)

        assertTrue(result is AppResult.Success)
        val page = localStore.articlePagingSource(queryKey, ownerId = null).load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page<Int, ArticleListItem>
        assertEquals(listOf("article-bulk-read"), page.data.map { it.id })
        assertEquals(false, page.data.first().isRead)
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
    }

    @Test
    fun `offline markRead survives online reads until explicit delivery`() = runTest {
        val articleId = "article-pending"
        onlineState.value = false
        localStore.writeArticleRemotePage(
            queryKey = ArticlePageQuery().remoteKey(),
            payload = ApiListResponse(data = listOf(sampleArticle(articleId)), cursor = null, hasMore = false),
            clearExisting = true,
        )

        val queuedResult = repository.markRead(articleId, true)

        assertEquals(localStore.readPendingReadStateMutations().single().mutationId,
            (queuedResult as AppResult.Success).data.mutationId)
        assertEquals(1, localStore.readPendingReadStateMutations().size)
        coVerify(exactly = 0) { api.markRead(any(), any(), session = any()) }

        onlineState.value = true
        coEvery {
            api.markRead(articleId, match { it.read && it.mutationId != null }, session = any())
        } returns com.selffeed.android.network.ApiEnvelope(
            MarkReadResponse(success = true, read = true, revision = 1),
        )
        coEvery { api.categories(session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.CategoryTreeResponse(categories = emptyList(), totalUnread = 0),
        )

        val readResult = repository.categories()

        assertTrue(readResult is AppResult.Success)
        assertEquals(1, localStore.readPendingReadStateMutations().size)
        coVerify(exactly = 0) { api.markRead(any(), any(), session = any()) }
        assertTrue(repository.flushPendingArticleStateMutations())
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        coVerify(exactly = 1) { api.markRead(articleId, match { it.read && it.mutationId != null }, session = any()) }
    }

    @Test
    fun `reconnect invalidation preserves pending intent without delivering it`() = runTest {
        val articleId = "article-reconnect"
        localStore.queueReadStateMutation(articleId, read = true)
        coEvery {
            api.markRead(articleId, match { it.read && it.mutationId != null }, session = any())
        } returns com.selffeed.android.network.ApiEnvelope(
            MarkReadResponse(success = true, read = true, revision = 1),
        )

        repository.invalidateReadStateCaches()

        assertEquals(listOf(articleId), localStore.readPendingReadStateMutations().map { it.articleId })
        assertEquals(mapOf(articleId to true), localStore.readArticleReadOverrides())
        coVerify(exactly = 0) { api.markRead(any(), any(), session = any()) }
        assertTrue(repository.flushPendingArticleStateMutations())
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        coVerify(exactly = 1) { api.markRead(articleId, match { it.read && it.mutationId != null }, session = any()) }
    }

    @Test
    fun `reconnect invalidation preserves pending read state when the server flush fails`() = runTest {
        val articleId = "article-reconnect-failure"
        localStore.queueReadStateMutation(articleId, read = true)
        coEvery { api.markRead(articleId, match { it.read && it.mutationId != null }, session = any()) } throws
            java.net.SocketTimeoutException("still offline")

        repository.invalidateReadStateCaches()

        assertEquals(listOf(articleId), localStore.readPendingReadStateMutations().map { it.articleId })
        assertEquals(mapOf(articleId to true), localStore.readArticleReadOverrides())
    }

    @Test
    fun `unauthorized mutation remains queued when token refresh is unavailable`() = runTest {
        val articleId = "article-refresh-unavailable"
        localStore.queueReadStateMutation(articleId, read = true)
        coEvery { api.markRead(articleId, match { it.mutationId != null }, session = any()) } throws
            httpError(401, "expired")
        every { sessionRefreshCoordinator.hasRecentRefreshRejection() } returns false

        val flushed = repository.flushPendingArticleStateMutations()

        assertEquals(false, flushed)
        assertEquals(articleId, localStore.readPendingReadStateMutations().single().articleId)
    }

    @Test
    fun `confirmed outbox authentication rejection clears its account through normal handling`() = runTest {
        every { sessionStore.getAccessToken() } returns "worker-token"
        val owner = sessionStore.currentSession()
        val mutation = localStore.queueReadStateMutation("rejected-owner", true)
        coEvery { api.markRead(any(), any(), session = any()) } throws httpError(401, "rejected")
        every { sessionRefreshCoordinator.hasRecentRefreshRejection() } returns true
        val result = ArticleStateSyncWorker(context, mockk<WorkerParameters>(relaxed = true), repository).doWork()

        assertEquals(ListenableWorker.Result.success(), result)
        coVerify(exactly = 1) { sessionStore.clear() }
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        assertEquals(listOf(mutation), database.localStoreDao()
            .readArchivedReadStateMutations(owner.ownerId).map { it.mutation })
    }

    @Test
    fun `sync invalidation preserves pending offline read state mutations`() = runTest {
        val articleId = "article-pending-sync"
        onlineState.value = false
        localStore.writeArticleRemotePage(
            queryKey = ArticlePageQuery().remoteKey(),
            payload = ApiListResponse(data = listOf(sampleArticle(articleId)), cursor = null, hasMore = false),
            clearExisting = true,
        )

        val queuedResult = repository.markRead(articleId, true)
        assertEquals(localStore.readPendingReadStateMutations().single().mutationId,
            (queuedResult as AppResult.Success).data.mutationId)
        assertEquals(1, localStore.readPendingReadStateMutations().size)

        onlineState.value = true
        coEvery {
            api.syncAllFeeds(match { it.isNotBlank() }, null, null, session = any())
        } returns com.selffeed.android.network.ApiEnvelope(
            SyncResponse(status = "queued", totalFeeds = 1),
        )

        val syncResult = repository.syncAllFeeds()

        assertTrue(syncResult is AppResult.Success)
        val pending = localStore.readPendingReadStateMutations()
        assertEquals(1, pending.size)
        assertEquals(articleId, pending.first().articleId)
        coVerify(exactly = 0) { api.markRead(any(), any(), session = any()) }
    }

    @Test
    fun `sync completion does not clear the visible Room paging queue`() = runTest {
        val queryKey = ArticlePageQuery().remoteKey()
        localStore.writeArticleRemotePage(
            queryKey = queryKey,
            payload = ApiListResponse(
                data = listOf(sampleArticle("article-visible")),
                cursor = null,
                hasMore = false,
            ),
            clearExisting = true,
        )
        val pagingSource = localStore.articlePagingSource(queryKey, ownerId = null)
        coEvery { api.syncAllFeedsStatus(any(), session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            FeedSyncAllStatus(
                queued = false,
                running = false,
                active = false,
                stale = false,
            ),
        )

        val result = repository.syncAllFeedsStatus()

        assertTrue(result is AppResult.Success)
        assertEquals(false, pagingSource.invalid)
        val page = pagingSource.load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page<Int, ArticleListItem>
        assertEquals(listOf("article-visible"), page.data.map { it.id })
    }

    @Test
    fun `missing persisted refresh request falls back to latest status once`() = runTest {
        every { sessionStore.getFeedRefreshRequestId() } returns "old-request"
        coEvery { api.syncAllFeedsStatus("old-request", session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            FeedSyncAllStatus(
                requestId = null,
                status = "completed",
                queued = false,
                running = false,
                active = false,
                stale = false,
            ),
        )
        coEvery { api.syncAllFeedsStatus(null, session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            FeedSyncAllStatus(
                requestId = "latest-request",
                status = "running",
                queued = false,
                running = true,
                active = true,
                stale = false,
            ),
        )

        val result = repository.syncAllFeedsStatus()

        assertEquals("latest-request", (result as AppResult.Success).data.requestId)
        coVerify { api.syncAllFeedsStatus("old-request", session = any()) }
        coVerify(exactly = 1) { api.syncAllFeedsStatus(null, session = any()) }
        coVerify { sessionStore.setFeedRefreshRequestId("latest-request") }
    }

    @Test
    fun `prefetchHeroImages is a no-op when offline`() {
        onlineState.value = false
        val urls = listOf("https://example.com/a.jpg", "https://example.com/b.jpg")
        repository.prefetchHeroImages(urls)
        // ImageLoader.enqueue is never called when offline.
        io.mockk.verify(exactly = 0) { imageLoader.enqueue(any()) }
    }

    @Test
    fun `prefetchHeroImages dispatches to the image loader when online`() {
        onlineState.value = true
        val urls = listOf("https://example.com/a.jpg")
        repository.prefetchHeroImages(urls)
        io.mockk.verify(atLeast = 1) { imageLoader.enqueue(any()) }
    }

    @Test
    fun `prefetchHeroImages dedupes and trims to the configured cap`() {
        onlineState.value = true
        val urls = (1..20).map { "https://example.com/$it.jpg" } +
            // Duplicates that should be collapsed by distinct().
            (1..5).map { "https://example.com/$it.jpg" } +
            // Blank / null entries that should be filtered.
            listOf("", null, "   ")
        repository.prefetchHeroImages(urls)
        // We can't directly assert the cap was applied, but we can verify
        // the image loader was called exactly once per unique non-blank URL,
        // up to the prefetch limit.
        val captured = mutableListOf<coil3.request.ImageRequest>()
        io.mockk.verify(exactly = 5) { imageLoader.enqueue(capture(captured)) }
    }

    @Test
    fun `debug snapshot resets counters`() = runTest {
        coEvery { api.me(session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.User("u", "x@x.com", "user", true),
        )
        every { sessionStore.getAccessToken() } returns null
        every { sessionStore.getClientId() } returns "client"
        repository.me()
        val before = repository.getDebugResilienceSnapshot()
        assertTrue(before["cacheMissCount"]!! >= 1L)

        repository.resetDebugResilienceMetrics()
        val after = repository.getDebugResilienceSnapshot()
        assertEquals(0L, after["retryCount"])
        assertEquals(0L, after["cacheMissCount"])
        assertEquals(0L, after["cacheHitCount"])
    }

    @Test
    fun `category reorder persists the new order without discarding cached category counts`() = runTest {
        val original = listOf(sampleCategory("first").copy(unreadCount = 4), sampleCategory("second"))
        offlineReadStore.writeCategories(original)
        val updates = listOf(
            com.selffeed.android.network.CategoryOrderUpdate("second", 0),
            com.selffeed.android.network.CategoryOrderUpdate("first", 1),
        )
        val request = com.selffeed.android.network.ReorderCategoriesRequest(updates)
        coEvery { api.reorderCategories(request, session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.ReorderCategoriesResponse(2),
        )

        assertEquals(AppResult.Success(Unit), repository.reorderCategories(updates))
        assertEquals(listOf("second", "first"), localStore.readCategories().map { it.id })
        assertEquals(4, localStore.readCategories().last().unreadCount)
        coVerify(exactly = 1) { api.reorderCategories(request, session = any()) }
    }

    @Test
    fun `cold category response cannot restore an order replaced while it was loading`() = runTest {
        val original = listOf(sampleCategory("first"), sampleCategory("second"))
        val updated = listOf(sampleCategory("second"), sampleCategory("first").copy(sortOrder = 1))
        val pending = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        var requests = 0
        coEvery { api.categories(session = any()) } coAnswers {
            requests++
            val response = if (requests == 1) {
                started.complete(Unit)
                pending.await()
                original
            } else updated
            com.selffeed.android.network.ApiEnvelope(com.selffeed.android.network.CategoryTreeResponse(response, 0))
        }
        coEvery { api.reorderCategories(any(), session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.ReorderCategoriesResponse(2),
        )
        val loading = async { repository.categories() }
        started.await()
        repository.reorderCategories(listOf(
            com.selffeed.android.network.CategoryOrderUpdate("second", 0),
            com.selffeed.android.network.CategoryOrderUpdate("first", 1),
        ))
        pending.complete(Unit)

        assertEquals(AppResult.Success(updated), loading.await())
        assertEquals(listOf("second", "first"), localStore.readCategories().map { it.id })
        coVerify(exactly = 2) { api.categories(session = any()) }
    }

    @Test
    fun `categories return sqlite data before network refresh`() = runTest {
        localStore.writeCategories(listOf(sampleCategory("c-local")))
        coEvery { api.categories(session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.CategoryTreeResponse(
                categories = listOf(sampleCategory("c-network")),
                totalUnread = 0,
            ),
        )

        val result = repository.categories()

        assertTrue(result is AppResult.Success)
        assertEquals("c-local", (result as AppResult.Success).data.first().id)
    }

    @Test
    fun `feeds return sqlite data before network refresh`() = runTest {
        localStore.writeFeeds(listOf(sampleFeed("f-local")))
        coEvery { api.feeds(null, session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            listOf(sampleFeed("f-network")),
        )

        val result = repository.feeds(null)

        assertTrue(result is AppResult.Success)
        assertEquals("f-local", (result as AppResult.Success).data.first().id)
    }

    @Test
    fun `refreshFeeds bypasses stale sqlite feed health`() = runTest {
        localStore.writeFeeds(listOf(sampleFeed("f-local")))
        coEvery { api.feeds(null, session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            listOf(
                sampleFeed("f-network").copy(
                    syncStatus = "error",
                    lastSyncError = "The feed server timed out before returning a response",
                ),
            ),
        )

        val result = repository.refreshFeeds(null)

        assertTrue(result is AppResult.Success)
        val feed = (result as AppResult.Success).data.single()
        assertEquals("f-network", feed.id)
        assertEquals("error", feed.syncStatus)
        assertEquals(listOf("f-network"), localStore.readFeeds().map { it.id })
        coVerify(exactly = 1) { api.feeds(null, session = any()) }
    }

    @Test
    fun `foreign read event preserves pending intent in Room reader and counts until delivery`() = runTest {
        val article = sampleArticle("pending-read").copy(isRead = false)
        localStore.writeArticleRemotePage("pending-read", ApiListResponse(listOf(article), null, false), true)
        onlineState.value = false
        repository.markRead(article.id, true)
        val remoteEvents = MutableSharedFlow<com.selffeed.android.network.ReadStateSyncEvent>()
        val articleRepository = object : ArticleRepository by repository {
            override fun readStateEvents() = remoteEvents
        }
        val viewModel = ArticlesViewModel(
            articleRepository, ReadStateManager(articleRepository), EnrichmentManager(articleRepository),
            ArticleWarmingManager(articleRepository),
        )
        val store = androidx.lifecycle.ViewModelStore().apply { put("articles", viewModel) }
        try {
            viewModel.updateArticleQueueSnapshot(listOf(article.copy(isRead = true)))
            backgroundScope.launch { viewModel.observeReadStateSync() }
            runCurrent()
            remoteEvents.emit(com.selffeed.android.network.ArticleReadStateChangedEvent(
                eventId = "foreign-unread", articleId = article.id, feedId = article.feedId,
                isRead = false, source = "manual", clientId = "another-device",
                updatedAt = "2026-09-05T00:00:00Z", revision = 3,
            ))
            withContext(Dispatchers.Default) {
                withTimeout(5_000) { viewModel.state.first { it.articleStates[article.id]?.isRead == true } }
            }
            assertEquals(true, viewModel.state.value.articleStates[article.id]?.isRead)
            assertEquals(true, localStore.readPendingReadStateMutations().single().read)

            coEvery { api.markRead(article.id, any(), session = any()) } returns com.selffeed.android.network.ApiEnvelope(
                MarkReadResponse(success = true, read = true, revision = 4),
            )
            onlineState.value = true
            assertTrue(repository.flushPendingArticleStateMutations())
            assertTrue(localStore.readPendingReadStateMutations().isEmpty())
            assertEquals(true, viewModel.state.value.articleStates[article.id]?.isRead)
        } finally {
            store.clear()
        }
    }

    @Test
    fun `local unread queued during a bulk receipt remains unread in UI and counts`() =
        assertLocalChoiceDuringBulk(initiallyRead = true)

    @Test
    fun `local read queued during a bulk receipt is not counted twice`() =
        assertLocalChoiceDuringBulk(initiallyRead = false)

    private fun assertLocalChoiceDuringBulk(initiallyRead: Boolean) = runTest {
        val article = sampleArticle("bulk-interleaving").copy(isRead = initiallyRead)
        localStore.writeArticleRemotePage("bulk-interleaving", ApiListResponse(listOf(article), null, false), true)
        onlineState.value = false
        val remoteEvents = MutableSharedFlow<com.selffeed.android.network.ReadStateSyncEvent>()
        val reconciled = CompletableDeferred<Unit>()
        val resumeReceipt = CompletableDeferred<Unit>()
        val articleRepository = object : ArticleRepository by repository {
            override fun readStateEvents() = remoteEvents
            override suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>): com.selffeed.android.data.repository.BulkReadReconciliation {
                val snapshot = repository.markCachedArticlesReadByFeeds(feedIds)
                reconciled.complete(Unit)
                resumeReceipt.await()
                return snapshot
            }
        }
        val viewModel = ArticlesViewModel(
            articleRepository, ReadStateManager(articleRepository), EnrichmentManager(articleRepository),
            ArticleWarmingManager(articleRepository),
        )
        val store = androidx.lifecycle.ViewModelStore().apply { put("articles", viewModel) }
        try {
            viewModel.updateArticleQueueSnapshot(listOf(article))
            backgroundScope.launch { viewModel.observeReadStateSync() }
            val bulk = async {
                viewModel.events.first { it is com.selffeed.android.ui.ArticleFeatureEvent.ArticleStateRefreshRequested }
                    as com.selffeed.android.ui.ArticleFeatureEvent.ArticleStateRefreshRequested
            }
            runCurrent()
            remoteEvents.emit(com.selffeed.android.network.ArticlesMarkedReadEvent(
                eventId = "bulk-interleaving", feedIds = listOf(article.feedId), markedCount = if (initiallyRead) 0 else 1,
                scope = com.selffeed.android.network.ReadStateScope(feedId = article.feedId),
                clientId = "another-device", updatedAt = "2026-09-07T00:00:00Z",
            ))
            reconciled.await()
            viewModel.markRead(article.id, !initiallyRead)
            withContext(Dispatchers.Default) {
                withTimeout(5_000) {
                    localStore.observeArticleStates(setOf(article.id), sessionStore.currentSession().ownerId)
                        .first { it[article.id]?.pendingReadMutationId != null }
                }
            }
            assertEquals(!initiallyRead, localStore.readPendingReadStateMutations().single().read)
            resumeReceipt.complete(Unit)
            bulk.await()
            assertEquals(!initiallyRead, localStore.readPendingReadStateMutations().single().read)
            assertEquals(!initiallyRead, viewModel.state.value.articleStates[article.id]?.isRead)
        } finally {
            resumeReceipt.complete(Unit)
            store.clear()
        }
    }

    @Test
    fun `foreign bulk read preserves pending unread while updating the rest of its scope`() = runTest {
        val pending = sampleArticle("pending-unread").copy(isRead = true)
        val unread = sampleArticle("ordinary-unread").copy(isRead = false)
        val other = sampleArticle("other-feed").copy(feedId = "other-feed", isRead = false)
        localStore.writeArticleRemotePage("bulk", ApiListResponse(listOf(pending, unread, other), null, false), true)
        localStore.writeArticleDetail(sampleArticleDetail(pending.id, true).copy(isEnriched = true))
        onlineState.value = false
        repository.markRead(pending.id, false)
        val remoteEvents = MutableSharedFlow<com.selffeed.android.network.ReadStateSyncEvent>()
        val articleRepository = object : ArticleRepository by repository {
            override fun readStateEvents() = remoteEvents
        }
        val viewModel = ArticlesViewModel(
            articleRepository, ReadStateManager(articleRepository), EnrichmentManager(articleRepository),
            ArticleWarmingManager(articleRepository),
        )
        val store = androidx.lifecycle.ViewModelStore().apply { put("articles", viewModel) }
        try {
            viewModel.setAutoMarkReadMode("disabled")
            viewModel.updateArticleQueueSnapshot(listOf(pending.copy(isRead = false), unread, other))
            viewModel.openArticle(pending.id)
            viewModel.state.first { it.selectedArticle?.contentHtml != null }
            backgroundScope.launch { viewModel.observeReadStateSync() }
            val received = async { viewModel.events.first() }
            runCurrent()
            remoteEvents.emit(com.selffeed.android.network.ArticlesMarkedReadEvent(
                eventId = "foreign-bulk", feedIds = listOf(pending.feedId), markedCount = 1,
                scope = com.selffeed.android.network.ReadStateScope(feedId = pending.feedId),
                clientId = "another-device", updatedAt = "2026-09-05T00:00:00Z",
            ))
            val event = received.await() as com.selffeed.android.ui.ArticleFeatureEvent.ArticleStateRefreshRequested
            withContext(Dispatchers.Default) {
                withTimeout(5_000) { viewModel.state.first { state -> state.articleStates[unread.id]?.isRead == true } }
            }
            assertEquals(mapOf(pending.id to false, unread.id to true, other.id to false),
                viewModel.state.value.articleStates.mapValues { it.value.isRead })
            assertEquals(false, viewModel.state.value.articleStates[pending.id]?.isRead)
            assertEquals(false, viewModel.state.value.selectedArticle?.isRead)
            assertEquals(false, viewModel.state.value.readerDetails[pending.id]?.isRead)
            assertEquals(false, localStore.readArticleDetail(pending.id)?.isRead)
            assertEquals(false, repository.cachedArticleDetail(pending.id)?.isRead)
            assertEquals(false, localStore.readArticleReadOverrides()[pending.id])
            assertEquals(false, localStore.readPendingReadStateMutations().single().read)
        } finally {
            store.clear()
        }
    }

    @Test
    fun `scoped feed refresh merges into the complete offline snapshot`() = runTest {
        localStore.writeFeeds(listOf(sampleFeed("f-existing", categoryId = "c-other")))
        coEvery { api.feeds("c-target", session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            listOf(sampleFeed("f-target", categoryId = "c-target")),
        )

        val result = repository.refreshFeeds("c-target")

        assertTrue(result is AppResult.Success)
        assertEquals(
            setOf("f-existing", "f-target"),
            localStore.readFeeds().map { it.id }.toSet(),
        )
        assertEquals(
            setOf("f-existing", "f-target"),
            localStore.readFeeds().map { it.id }.toSet(),
        )
    }

    @Test
    fun `offline parent category includes feeds from descendant categories`() = runTest {
        val child = sampleCategory("c-child", parentCategoryId = "c-root")
        localStore.writeCategories(
            listOf(sampleCategory("c-root", children = listOf(child))),
        )
        localStore.writeFeeds(
            listOf(
                sampleFeed("f-root", categoryId = "c-root"),
                sampleFeed("f-child", categoryId = "c-child"),
                sampleFeed("f-unrelated", categoryId = "c-other"),
            ),
        )

        val result = repository.feeds("c-root")

        assertTrue(result is AppResult.Success)
        assertEquals(
            setOf("f-root", "f-child"),
            (result as AppResult.Success).data.map { it.id }.toSet(),
        )
    }

    @Test
    fun `restoreSession uses saved access token before refreshing`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns "access-token"
        coEvery { api.me(session = any()) } returns com.selffeed.android.network.ApiEnvelope(sampleUser())

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Success)
        io.mockk.verify(exactly = 0) { sessionRefreshCoordinator.refreshAccessToken(any()) }
    }

    @Test
    fun `restoreSession refreshes through the shared coordinator when only a refresh cookie exists`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns null
        every { sessionRefreshCoordinator.refreshAccessToken(any()) } returns
            SessionRefreshResult.Success("new-access-token")
        coEvery { api.me(session = any()) } returns com.selffeed.android.network.ApiEnvelope(sampleUser())

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Success)
        io.mockk.verify(exactly = 1) { sessionRefreshCoordinator.refreshAccessToken(any()) }
        coVerify(exactly = 1) { api.me(session = any()) }
    }

    @Test
    fun `restoreSession clears the local session when refresh session is rejected`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns null
        every { sessionRefreshCoordinator.refreshAccessToken(any()) } returns SessionRefreshResult.Rejected

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Error)
        assertEquals("Authentication was lost. Please sign in again.", (result as AppResult.Error).message)
        coVerify(exactly = 1) { sessionStore.clear() }
        coVerify(exactly = 0) { api.me(session = any()) }
    }

    @Test
    fun `restoreSession keeps the local session when refresh is temporarily unavailable`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns null
        every { sessionRefreshCoordinator.refreshAccessToken(any()) } returns
            SessionRefreshResult.Unavailable(java.io.IOException("network unavailable"))

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Error)
        assertEquals("Unable to refresh session. Please check your connection.", (result as AppResult.Error).message)
        coVerify(exactly = 0) { sessionStore.clear() }
        coVerify(exactly = 0) { api.me(session = any()) }
    }

    @Test
    fun `cached subscriptions and articles return while queued delivery is blocked`() = runTest {
        val articleId = "cached-during-sync"
        val detail = sampleArticleDetail(articleId, isRead = false)
        every { sessionStore.getAccessToken() } returns "test-session"
        localStore.writeArticleDetail(detail)
        val category = sampleCategory("cache-category")
        val feed = sampleFeed("cache-feed")
        localStore.writeCategories(listOf(category))
        localStore.writeFeeds(listOf(feed))
        coEvery { api.categories(any()) } returns ApiEnvelope(
            com.selffeed.android.network.CategoryTreeResponse(listOf(category), totalUnread = 0),
        )
        coEvery { api.feeds(any(), any()) } returns ApiEnvelope(listOf(feed))
        localStore.queueReadStateMutation(articleId, read = true)
        localStore.queueSavedStateMutation(articleId, saved = true)
        val deliveryStarted = CompletableDeferred<Unit>()
        val releaseDelivery = CompletableDeferred<Unit>()
        coEvery { api.markRead(articleId, any(), session = any()) } coAnswers {
            deliveryStarted.complete(Unit)
            releaseDelivery.await()
            com.selffeed.android.network.ApiEnvelope(MarkReadResponse(success = true, read = true, revision = 1))
        }
        coEvery { api.setSaved(articleId, any(), session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            MarkReadResponse(success = true, saved = true, revision = 1),
        )
        coEvery { api.article(articleId, session = any()) } returns com.selffeed.android.network.ApiEnvelope(detail)
        val worker = ArticleStateSyncWorker(context, mockk<WorkerParameters>(relaxed = true), repository)
        val delivery = async { worker.doWork() }
        deliveryStarted.await()
        try {
            // Use a real-clock deadline because Room runs outside the test dispatcher.
            withContext(Dispatchers.Default) {
                withTimeout(5_000) {
                    val expected = AppResult.Success(detail.copy(isRead = true, isSaved = true))
                    assertEquals(expected, repository.article(articleId))
                    assertEquals(expected, repository.prefetchArticle(articleId))
                    assertEquals(AppResult.Success(listOf(category)), repository.categories())
                    assertEquals(AppResult.Success(listOf(feed)), repository.feeds(null))
                }
            }
            assertEquals(articleId, localStore.readPendingReadStateMutations().single().articleId)
            assertEquals(articleId, localStore.readPendingSavedStateMutations().single().articleId)
        } finally {
            releaseDelivery.complete(Unit)
            assertEquals(ListenableWorker.Result.success(), delivery.await())
        }
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        assertTrue(localStore.readPendingSavedStateMutations().isEmpty())
        coVerify(exactly = 1) { api.markRead(articleId, any(), session = any()) }
        coVerify(exactly = 1) { api.setSaved(articleId, any(), session = any()) }
    }

    @Test
    fun `read and saved actions return durable intent without delivering on the caller`() = runTest {
        val articleId = "local-intent"
        localStore.writeArticleDetail(sampleArticleDetail(articleId, isRead = false))
        val readTransport = CompletableDeferred<Unit>()
        val savedTransport = CompletableDeferred<Unit>()
        coEvery { api.markRead(articleId, any(), session = any()) } coAnswers {
            readTransport.complete(Unit)
            awaitCancellation()
        }
        coEvery { api.setSaved(articleId, any(), session = any()) } coAnswers {
            savedTransport.complete(Unit)
            awaitCancellation()
        }

        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                assertTrue(repository.markRead(articleId, true) is AppResult.Success)
                assertTrue(repository.setSaved(articleId, true) is AppResult.Success)
            }
        }

        assertEquals(true, localStore.readPendingReadStateMutations().single().read)
        assertEquals(true, localStore.readPendingSavedStateMutations().single().saved)
        assertEquals(false, readTransport.isCompleted)
        assertEquals(false, savedTransport.isCompleted)
    }

    @Test
    fun `manual retry cannot block account replacement while scheduling waits`() = runTest {
        every { sessionStore.getAccessToken() } returns "test-token"
        val scheduling = CompletableDeferred<Unit>()
        mockkObject(ArticleStateSyncWorker.Companion)
        coEvery { ArticleStateSyncWorker.kickOnce(any()) } coAnswers {
            scheduling.complete(Unit)
            awaitCancellation()
        }
        val retry = launch { repository.retryPendingArticleChanges() }
        try {
            scheduling.await()
            withContext(Dispatchers.Default) {
                withTimeout(5_000) {
                    assertTrue(repository.setApiBaseUrl("https://replacement.example/api/v1/") is AppResult.Success)
                }
            }
            retry.join()
            assertTrue(retry.isCancelled)
        } finally {
            retry.cancelAndJoin()
            unmockkObject(ArticleStateSyncWorker.Companion)
        }
    }

    @Test
    fun `overlapping outbox drains deliver each mutation once`() = runTest {
        val articleId = "one-delivery"
        localStore.queueReadStateMutation(articleId, read = true)
        val deliveryStarted = CompletableDeferred<Unit>()
        val duplicateStarted = CompletableDeferred<Unit>()
        val releaseDelivery = CompletableDeferred<Unit>()
        coEvery { api.markRead(articleId, any(), session = any()) } coAnswers {
            if (!deliveryStarted.complete(Unit)) duplicateStarted.complete(Unit)
            releaseDelivery.await()
            com.selffeed.android.network.ApiEnvelope(MarkReadResponse(success = true, read = true, revision = 1))
        }
        val first = async { repository.flushPendingArticleStateMutations() }
        deliveryStarted.await()
        val second = async(start = CoroutineStart.UNDISPATCHED) { repository.flushPendingArticleStateMutations() }
        try {
            val duplicate = withContext(Dispatchers.Default) {
                withTimeoutOrNull(500) { duplicateStarted.await() }
            }
            assertNull("The same mutation must not be sent while its first delivery is pending", duplicate)
        } finally {
            releaseDelivery.complete(Unit)
            assertTrue(first.await())
            assertTrue(second.await())
        }
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        coVerify(exactly = 1) { api.markRead(articleId, any(), session = any()) }
    }

    @Test
    fun `worker retries a durable mutation after transient delivery failure`() = runTest {
        val articleId = "worker-retry"
        every { sessionStore.getAccessToken() } returns "test-session"
        localStore.writeArticleDetail(sampleArticleDetail(articleId, isRead = false))
        localStore.queueSavedStateMutation(articleId, saved = true)
        coEvery { api.setSaved(articleId, any(), session = any()) } throws java.net.SocketTimeoutException("temporarily offline")
        val worker = ArticleStateSyncWorker(context, mockk<WorkerParameters>(relaxed = true), repository)

        assertEquals(ListenableWorker.Result.retry(), worker.doWork())
        assertEquals(articleId, localStore.readPendingSavedStateMutations().single().articleId)
        assertEquals(true, localStore.readArticleDetail(articleId)?.isSaved)

        coEvery { api.setSaved(articleId, any(), session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            MarkReadResponse(success = true, saved = true, revision = 1),
        )
        assertEquals(ListenableWorker.Result.success(), worker.doWork())
        assertTrue(localStore.readPendingSavedStateMutations().isEmpty())
        assertEquals(true, localStore.readArticleDetail(articleId)?.isSaved)
    }

    @Test
    fun `logout clears local state without waiting for remote revocation`() = runTest {
        every { sessionStore.getAccessToken() } returns "access"
        every { sessionStore.getRefreshCookie() } returns "rss_refresh_token=refresh; Path=/"
        val remoteResponse = CompletableDeferred<com.selffeed.android.network.ApiEnvelope<com.selffeed.android.network.SuccessResponse>>()
        coEvery {
            api.logout("Bearer access", "rss_refresh_token=refresh", session = any())
        } coAnswers { remoteResponse.await() }

        val result = repository.logout()

        assertTrue(result is AppResult.Success)
        coVerify(exactly = 1) { sessionStore.clear() }
        remoteResponse.complete(
            com.selffeed.android.network.ApiEnvelope(
                com.selffeed.android.network.SuccessResponse(success = true),
            ),
        )
    }

    @Test
    fun `unauthorized protected call without auth lost signal does not clear the local session`() = runTest {
        coEvery { api.me(session = any()) } throws httpError(
            code = 401,
            message = "Invalid or expired token",
        )
        every { sessionRefreshCoordinator.hasRecentRefreshRejection() } returns false

        val result = repository.me()

        assertTrue(result is AppResult.Error)
        assertEquals("Session could not be refreshed. Please try again.", (result as AppResult.Error).message)
        coVerify(exactly = 0) { sessionStore.clear() }
    }

    @Test
    fun `auth lost response without refresh rejection keeps the local session`() = runTest {
        coEvery { api.me(session = any()) } throws httpError(
            code = 401,
            message = "Authentication was lost. Please sign in again.",
        )
        every { sessionRefreshCoordinator.hasRecentRefreshRejection() } returns false

        val result = repository.me()

        assertTrue(result is AppResult.Error)
        assertEquals("Session could not be refreshed. Please try again.", (result as AppResult.Error).message)
        coVerify(exactly = 0) { sessionStore.clear() }
    }

    @Test
    fun `auth lost response after refresh rejection clears the local session`() = runTest {
        coEvery { api.me(session = any()) } throws httpError(
            code = 401,
            message = "Authentication was lost. Please sign in again.",
        )
        every { sessionRefreshCoordinator.hasRecentRefreshRejection() } returns true

        val result = repository.me()

        assertTrue(result is AppResult.Error)
        assertEquals("Authentication was lost. Please sign in again.", (result as AppResult.Error).message)
        coVerify(exactly = 1) { sessionStore.clear() }
    }

    @Test
    fun `isLoggedIn mirrors the access token presence`() {
        every { sessionStore.getRefreshCookie() } returns null
        every { sessionStore.getAccessToken() } returns null
        assertEquals(false, repository.isLoggedIn())
        every { sessionStore.getAccessToken() } returns "token"
        assertEquals(true, repository.isLoggedIn())
        every { sessionStore.getAccessToken() } returns ""
        assertEquals(false, repository.isLoggedIn())
    }

    private fun sampleUser(): com.selffeed.android.network.User =
        com.selffeed.android.network.User("u", "x@x.com", "user", true)

    private fun httpError(code: Int, message: String): HttpException {
        val body = """
            {
              "error": {
                "code": "UNAUTHORIZED",
                "message": "$message"
              }
            }
        """.trimIndent().toResponseBody("application/json".toMediaType())
        return HttpException(Response.error<Any>(code, body))
    }

    @Test
    fun `search results and cache hits project current Room state without admitting old flags`() = runTest {
        val id = "search-state"
        every { sessionStore.getAccessToken() } returns "token"
        coEvery { api.article(id, session = any()) } returns ApiEnvelope(sampleArticleDetail(id, false))
        repository.article(id)
        val remote = sampleArticle(id).copy(readRevision = 10, savedRevision = 10)
        coEvery { api.search("state", categoryId = null, cursor = null, session = any()) } returns
            ApiListResponse(listOf(remote), null, false)
        assertEquals(false, (repository.search("state") as AppResult.Success).data.data.single().isSaved)

        repository.updateCachedReadState(id, true, 20)
        repository.updateCachedSavedState(id, true, 20)
        val stale = remote.copy(readRevision = 19, savedRevision = 19)
        coEvery { api.search("state", categoryId = null, cursor = null, session = any()) } returns
            ApiListResponse(listOf(stale), null, false)
        val refreshed = (repository.search("state") as AppResult.Success).data.data.single()
        assertEquals(true, refreshed.isRead)
        assertEquals(true, refreshed.isSaved)
        assertEquals(20, refreshed.readRevision)
        assertEquals(true, repository.cachedArticleDetail(id)?.isSaved)
        localStore.queueSavedStateMutation(id, false)
        assertEquals(false, (repository.search("state") as AppResult.Success).data.data.single().isSaved)
        // A cached search row is a projection, not a new confirmation of the pending flag.
        assertEquals(true, localStore.readPendingSavedStateMutations().single().previousState)
    }

    @Test
    fun `a paginated search response cannot overwrite a newer receipt in the reader cache`() = runTest {
        val id = "search-next"
        every { sessionStore.getAccessToken() } returns "token"
        coEvery { api.article(id, session = any()) } returns ApiEnvelope(sampleArticleDetail(id, false))
        repository.article(id)
        repository.updateCachedReadState(id, true, 20)
        coEvery { api.search("state", categoryId = null, cursor = "next", session = any()) } returns
            ApiListResponse(listOf(sampleArticle(id).copy(readRevision = 19)), null, false)
        val result = (repository.search("state", null, "next") as AppResult.Success).data.data.single()
        assertEquals(true, result.isRead)
        assertEquals(20, result.readRevision)
        assertEquals(true, repository.cachedArticleDetail(id)?.isRead)
    }

    @Test
    fun `unversioned bulk receipts retain known unread state in RAM and Room`() = runTest {
        val id = "bulk-known"
        every { sessionStore.getAccessToken() } returns "token"
        val detail = sampleArticleDetail(id, false).copy(readRevision = 20)
        coEvery { api.article(id, session = any()) } returns ApiEnvelope(detail)
        repository.article(id)
        val result = repository.markCachedArticlesReadByFeeds(setOf(detail.feedId))
        assertEquals(mapOf(id to detail.feedId), result.unreadArticleFeeds)
        assertEquals(false, repository.cachedArticleDetail(id)?.isRead)
        assertEquals(false, (repository.article(id) as AppResult.Success).data.isRead)
        assertEquals(false, localStore.readArticleDetail(id)?.isRead)
    }

    @Test
    fun `saved list confirmation uses the response revision before publishing to RAM`() = runTest {
        val id = "saved-revision"
        cacheSavedArticles(id)
        every { sessionStore.getAccessToken() } returns "token"
        coEvery { api.article(id, session = any()) } returns ApiEnvelope(
            sampleArticleDetail(id, false).copy(isSaved = true, savedRevision = 20),
        )
        repository.refreshArticleDetail(id)
        coEvery { api.article(id, session = any()) } returns ApiEnvelope(
            sampleArticleDetail(id, false).copy(isSaved = false, savedRevision = 19),
        )
        assertTrue(repository.reconcileSavedArticles("saved-current") is AppResult.Success)
        assertEquals(true, repository.cachedArticleDetail(id)?.isSaved)
        assertEquals(true, localStore.readArticleDetail(id)?.isSaved)
        coEvery { api.article(id, session = any()) } returns ApiEnvelope(
            sampleArticleDetail(id, false).copy(isSaved = false, savedRevision = 21),
        )
        assertTrue(repository.reconcileSavedArticles("saved-current") is AppResult.Success)
        assertEquals(false, repository.cachedArticleDetail(id)?.isSaved)
        assertEquals(false, localStore.readArticleDetail(id)?.isSaved)
    }

    @Test
    fun `saved reconciliation confirms remote unsaves and deletions while retaining cached content`() = runTest {
        cacheSavedArticles("unsaved", "deleted")
        every { sessionStore.getAccessToken() } returns "test-session"
        coEvery { api.article("unsaved", session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            sampleArticleDetail("unsaved", false).copy(isSaved = true),
        )
        repository.refreshArticleDetail("unsaved")
        coEvery { api.article("unsaved", session = any()) } returns com.selffeed.android.network.ApiEnvelope(sampleArticleDetail("unsaved", false))
        coEvery { api.article("deleted", session = any()) } throws httpError(404, "Article unavailable")

        assertTrue(repository.reconcileSavedArticles("saved-current") is AppResult.Success)

        val reopenedDatabase = androidx.room.Room.databaseBuilder(
            context, com.selffeed.android.data.local.LocalDatabase::class.java, databaseName,
        ).build()
        try {
            val reopened = LocalStore(reopenedDatabase, com.selffeed.android.network.NetworkModule.provideMoshi())
            assertTrue(reopened.savedArticlesMissingFromQuery("saved-current").isEmpty())
            assertEquals(false, reopened.readArticleDetail("unsaved")?.isSaved)
            assertEquals(false, reopened.readArticleDetail("deleted")?.isSaved)
            assertEquals("<p>Body</p>", reopened.readArticleDetail("deleted")?.contentHtml)
            assertEquals(false, repository.cachedArticleDetail("unsaved")?.isSaved)
        } finally { reopenedDatabase.close() }
    }

    @Test
    fun `saved reconciliation preserves queued intent and articles still saved beyond the list cutoff`() = runTest {
        cacheSavedArticles("pending", "still-saved")
        localStore.queueSavedStateMutation("pending", true)
        coEvery { api.article("still-saved", session = any()) } returns com.selffeed.android.network.ApiEnvelope(
            sampleArticleDetail("still-saved", false).copy(isSaved = true),
        )

        assertTrue(repository.reconcileSavedArticles("saved-current") is AppResult.Success)

        assertEquals(true, localStore.readArticleDetail("pending")?.isSaved)
        assertEquals(1, localStore.readPendingSavedStateMutations().size)
        assertEquals(true, localStore.readArticleDetail("still-saved")?.isSaved)
        coVerify(exactly = 0) { api.article("pending", session = any()) }
    }

    @Test
    fun `saved reconciliation cannot erase new pending or acknowledged saves during confirmation`() = runTest {
        cacheSavedArticles("pending", "acknowledged")
        coEvery { api.article("pending", session = any()) } coAnswers {
            localStore.queueSavedStateMutation("pending", true)
            com.selffeed.android.network.ApiEnvelope(sampleArticleDetail("pending", false))
        }
        coEvery { api.article("acknowledged", session = any()) } coAnswers {
            val mutation = localStore.queueSavedStateMutation("acknowledged", true)
            localStore.acknowledgeSavedStateMutation(mutation, true, revision = 7)
            com.selffeed.android.network.ApiEnvelope(sampleArticleDetail("acknowledged", false))
        }

        assertTrue(repository.reconcileSavedArticles("saved-current") is AppResult.Success)

        assertEquals(true, localStore.readArticleDetail("pending")?.isSaved)
        assertEquals(true, localStore.readArticleDetail("acknowledged")?.isSaved)
        assertEquals("pending", localStore.readPendingSavedStateMutations().single().articleId)
    }

    @Test
    fun `unavailable saved-state confirmation keeps the offline collection intact`() = runTest {
        cacheSavedArticles("unconfirmed")
        coEvery { api.article("unconfirmed", session = any()) } throws java.net.SocketTimeoutException("offline")

        assertTrue(repository.reconcileSavedArticles("saved-current") is AppResult.Error)

        assertEquals(true, localStore.readArticleDetail("unconfirmed")?.isSaved)
        assertEquals(listOf("unconfirmed"), localStore.savedArticlesMissingFromQuery("saved-current").map { it.articleId })
    }

    @Test
    fun `state lookup partitions requests without reading article bodies or removing missing offline entries`() = runTest {
        repository.prepareSession()
        val ids = (0 until 205).map { "lookup-$it" }.toSet()
        val missing = ids.first()
        localStore.writeArticleDetail(sampleArticleDetail(missing, false).copy(isSaved = true))
        val pending = localStore.queueReadStateMutation(missing, true)
        val requests = mutableListOf<List<String>>()
        coEvery { api.articleStates(any(), session = any()) } coAnswers {
            val requested = firstArg<ArticleStateLookupRequest>().articleIds
            requests += requested
            ApiEnvelope(ArticleStateLookupResponse(
                requested.filter { it != missing }.map { ArticleStateSnapshot(it, true, true, 8, 9) },
                requested.filter { it == missing },
            ))
        }
        assertEquals(AppResult.Success(Unit), repository.refreshArticleStates(ids))
        assertEquals(listOf(100, 100, 5), requests.map { it.size })
        assertEquals(ids, requests.flatten().toSet())
        assertEquals(205, requests.flatten().size)
        assertEquals(pending, localStore.readPendingReadStateMutations().single())
        assertEquals(true, localStore.readArticleDetail(missing)?.isSaved)
        val state = localStore.readArticleState(ids.last())
        assertEquals(true, state.isRead)
        assertEquals(true, state.isSaved)
        assertEquals(8, state.readRevision)
        assertEquals(9, state.savedRevision)
        coVerify(exactly = 0) { api.article(any(), session = any()) }
        assertEquals(AppResult.Success(Unit), repository.refreshArticleStates(emptySet()))
        coVerify(exactly = 3) { api.articleStates(any(), session = any()) }
    }

    @Test
    fun `malformed state batches cannot partially change durable flags`() = runTest {
        repository.prepareSession()
        val first = ArticleStateSnapshot("first", true, true, 7, 7)
        val second = first.copy(id = "second")
        val malformed = listOf(
            ArticleStateLookupResponse(listOf(first, first), emptyList()),
            ArticleStateLookupResponse(listOf(first), emptyList()),
            ArticleStateLookupResponse(listOf(first, second.copy(id = "foreign")), emptyList()),
            ArticleStateLookupResponse(listOf(first, second.copy(readRevision = -1)), emptyList()),
            ArticleStateLookupResponse(listOf(first, second.copy(savedRevision = -1)), emptyList()),
            ArticleStateLookupResponse(listOf(first, second), listOf("second")),
            ArticleStateLookupResponse(emptyList(), listOf("first", "first")),
        )
        for (response in malformed) {
            coEvery { api.articleStates(any(), session = any()) } returns ApiEnvelope(response)
            assertTrue(repository.refreshArticleStates(setOf("first", "second")) is AppResult.Error)
            assertNull(database.localStoreDao().readArticleStateRevision("first"))
            assertNull(database.localStoreDao().readArticleStateRevision("second"))
        }
    }

    @Test
    fun `state refresh projects current pending choices into memory and keeps later revisions`() = runTest {
        repository.prepareSession()
        coEvery { api.article("article", session = any()) } returns ApiEnvelope(sampleArticleDetail("article", false))
        assertTrue(repository.article("article", forceRefresh = true) is AppResult.Success)
        val pending = localStore.queueSavedStateMutation("article", true)
        coEvery { api.articleStates(any(), session = any()) } returns ApiEnvelope(ArticleStateLookupResponse(
            listOf(ArticleStateSnapshot("article", true, false, 8, 9)), emptyList(),
        ))
        assertEquals(AppResult.Success(Unit), repository.refreshArticleStates(setOf("article")))
        assertEquals(true, repository.cachedArticleDetail("article")?.isSaved)
        assertEquals(true, repository.cachedArticleDetail("article")?.isRead)
        assertEquals(pending.mutationId, localStore.readPendingSavedStateMutations().single().mutationId)
        coEvery { api.articleStates(any(), session = any()) } returns ApiEnvelope(ArticleStateLookupResponse(
            listOf(ArticleStateSnapshot("article", false, true, 7, 8)), emptyList(),
        ))
        assertEquals(AppResult.Success(Unit), repository.refreshArticleStates(setOf("article")))
        assertEquals(true, repository.cachedArticleDetail("article")?.isRead)
        assertEquals(8, localStore.readArticleState("article").readRevision)
        assertEquals(false, localStore.discardSavedStateMutation(localStore.readPendingSavedStateMutations().single())?.effectiveState)
    }

    private suspend fun cacheSavedArticles(vararg ids: String) {
        localStore.writeArticleRemotePage(
            "saved-old",
            ApiListResponse(data = ids.map { sampleArticle(it).copy(isSaved = true) }, cursor = null, hasMore = false),
            clearExisting = true,
        )
        ids.forEach { localStore.writeArticleDetail(sampleArticleDetail(it, false).copy(isSaved = true)) }
        localStore.writeArticleRemotePage(
            "saved-current", ApiListResponse(data = emptyList(), cursor = null, hasMore = false), clearExisting = true,
        )
    }

    @Test
    fun `preference background refresh cannot overwrite a later saved value`() = runTest {
        val initial = com.selffeed.android.network.UserPreferences(
            theme = "dark", fontFamily = "system-ui", textSize = 16, density = "comfortable",
            defaultSort = "latest", hideRead = false, keyboardShortcutsEnabled = true,
            autoMarkReadMode = "on_navigate",
        )
        localStore.writePreferences(initial)
        every { sessionStore.getAccessToken() } returns "test-session"
        val refreshStarted = CompletableDeferred<Unit>()
        val refreshResponse = CompletableDeferred<Unit>()
        coEvery { api.preferences(session = any()) } coAnswers {
            refreshStarted.complete(Unit)
            refreshResponse.await()
            com.selffeed.android.network.ApiEnvelope(initial)
        }
        coEvery { api.updatePreferences(any(), session = any()) } returns
            com.selffeed.android.network.ApiEnvelope(initial.copy(textSize = 22))
        assertEquals(initial, (repository.preferences() as AppResult.Success).data)
        refreshStarted.await()
        val save = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.currentCoroutineContext()).async {
            repository.updatePreferences(com.selffeed.android.network.UpdatePreferencesRequest(textSize = 22))
        }
        runCurrent()
        coVerify(exactly = 0) { api.updatePreferences(any(), session = any()) }
        refreshResponse.complete(Unit)
        assertTrue(save.await() is AppResult.Success)
        assertEquals(22, localStore.readPreferences()?.textSize)
    }

    private fun sampleArticleDetail(id: String, isRead: Boolean): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "feed-1",
        guid = id,
        canonicalUrl = "https://example.com/$id",
        title = "Title $id",
        author = null,
        excerpt = null,
        contentHtml = "<p>Body</p>",
        contentText = "Body",
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = null,
        hash = "h-$id",
        feedTitle = "Feed",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = emptyList(),
        isRead = isRead,
        isEnriched = false,
    )

    private fun sampleCategory(
        id: String,
        parentCategoryId: String? = null,
        children: List<CategoryWithCounts>? = null,
    ): CategoryWithCounts = CategoryWithCounts(
        id = id,
        parentCategoryId = parentCategoryId,
        name = "Category $id",
        slug = id,
        sortOrder = 0,
        feedCount = 1,
        unreadCount = 1,
        children = children,
    )

    private fun sampleFeed(id: String, categoryId: String = "c-local"): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed $id",
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = 1,
    )

    private fun sampleArticle(id: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "f-local",
        feedTitle = "Feed",
        title = "Article $id",
        isRead = false,
    )
}
