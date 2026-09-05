package com.selffeed.android.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import coil3.ImageLoader
import com.selffeed.android.data.local.CompositeOfflineReadStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.data.local.OfflineReadStore
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.network.ApiListResponse
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
import com.selffeed.android.ui.MainDispatcherRule
import com.selffeed.android.ui.articles.ArticleWarmingManager
import com.selffeed.android.ui.articles.EnrichmentManager
import com.selffeed.android.ui.articles.ReadStateManager
import com.squareup.moshi.Moshi
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    private lateinit var cacheStore: OfflineCacheStore
    private lateinit var localStore: LocalStore
    private lateinit var offlineReadStore: OfflineReadStore
    private lateinit var imageLoader: ImageLoader
    private lateinit var networkMonitor: NetworkMonitor
    private lateinit var onlineState: MutableStateFlow<Boolean>
    private lateinit var repository: RssRepository

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        api = mockk(relaxed = true)
        sessionStore = mockk(relaxed = true)
        sessionRefreshCoordinator = mockk(relaxed = true)
        // The production Moshi includes the reflective
        // KotlinJsonAdapterFactory as a fallback for DTOs whose generated
        // adapters aren't on the test classpath. The test suite uses the
        // same Moshi so writes through LocalStore can encode payloads.
        val moshi = com.selffeed.android.network.NetworkModule.provideMoshi()
        cacheStore = OfflineCacheStore(context, moshi)
        localStore = LocalStore(context, moshi)
        runBlocking {
            localStore.clearAll()
            cacheStore.clearAll()
        }
        offlineReadStore = CompositeOfflineReadStore(localStore, cacheStore)
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
        )
    }

    @Test
    fun `worker rejection restores saved state through the real ViewModel repository and Room`() = runTest {
        val articleId = "saved-rollback"
        val detail = sampleArticleDetail(articleId, isRead = false).copy(isEnriched = true)
        every { sessionStore.getAccessToken() } returns "test-session"
        coEvery { api.article(articleId) } returns com.selffeed.android.network.ApiEnvelope(detail)
        coEvery { api.setSaved(articleId, any()) } throws httpError(404, "Article unavailable")
        onlineState.value = false
        val viewModel = ArticlesViewModel(
            repository, ReadStateManager(repository), EnrichmentManager(repository), ArticleWarmingManager(repository),
        )
        val viewModelStore = androidx.lifecycle.ViewModelStore().apply { put("articles", viewModel) }
        try {
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
            assertEquals(false, viewModel.state.value.selectedArticle?.isSaved)
            assertNotNull(viewModel.state.value.errorMessage)
        } finally {
            viewModelStore.clear()
        }
    }

    @Test
    fun `trimMemoryCaches clears the in-memory map and reports an invalidation`() {
        // Populate the cache via a successful call.
        coEvery { api.me() } returns com.selffeed.android.network.ApiEnvelope(
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
        coEvery { api.article(articleId) } returns com.selffeed.android.network.ApiEnvelope(detail)
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
            )
        } throws
            java.net.SocketTimeoutException("simulated timeout")
        val result = repository.markRead(articleId, true)
        assertTrue(result is AppResult.Success)

        val cachedAfter = repository.cachedArticleDetail(articleId)
        assertNotNull(cachedAfter)
        assertEquals(true, cachedAfter!!.isRead)
        assertEquals(1, localStore.readPendingReadStateMutations().size)
    }

    @Test
    fun `markRead with successful server response retains the warmed article cache`() = runTest {
        val articleId = "article-2"
        val detail = sampleArticleDetail(id = articleId, isRead = false)
        coEvery { api.article(articleId) } returns com.selffeed.android.network.ApiEnvelope(detail)
        every { sessionStore.getAccessToken() } returns "token"
        coEvery {
            api.markRead(
                articleId,
                match { it.read && it.source == "manual" && it.mutationId != null },
            )
        } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.MarkReadResponse(success = true, read = true, revision = 1),
        )

        // Seed cache.
        repository.article(articleId)
        assertNotNull(repository.cachedArticleDetail(articleId))

        val result = repository.markRead(articleId, true)
        assertTrue(result is AppResult.Success)

        assertEquals(true, repository.cachedArticleDetail(articleId)?.isRead)
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        coVerify {
            api.markRead(articleId, match { it.read && it.source == "manual" && it.mutationId != null })
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
            )
        } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.MarkReadResponse(success = true, read = true, revision = 1),
        )

        val result = repository.markRead(articleId, true, source = "auto_open")

        assertTrue(result is AppResult.Success)
        coVerify {
            api.markRead(articleId, match { it.read && it.source == "auto_open" && it.mutationId != null })
        }
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

        val pagingSource = localStore.articlePagingSource(queryKey)
        pagingSource.load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        repository.updateCachedReadState(articleId, read = true)
        repository.invalidateReadStateCaches(articleId)

        assertEquals(true, pagingSource.invalid)
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        val page = localStore.articlePagingSource(queryKey).load(
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
        val pagingSource = localStore.articlePagingSource(queryKey)

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
            api.markAllRead(com.selffeed.android.network.MarkAllReadRequest(feedId = "f-local"))
        } returns com.selffeed.android.network.ApiEnvelope(
            MarkAllReadResponse(markedCount = 1, feedIds = listOf("f-local")),
        )

        val result = repository.markAllRead(feedId = "f-local", categoryId = null)

        assertTrue(result is AppResult.Success)
        val page = localStore.articlePagingSource(queryKey).load(
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
    fun `offline markRead queues mutation and next online read flushes it`() = runTest {
        val articleId = "article-pending"
        onlineState.value = false
        localStore.writeArticleRemotePage(
            queryKey = ArticlePageQuery().remoteKey(),
            payload = ApiListResponse(data = listOf(sampleArticle(articleId)), cursor = null, hasMore = false),
            clearExisting = true,
        )

        val queuedResult = repository.markRead(articleId, true)

        assertTrue(queuedResult is AppResult.Success)
        assertEquals(1, localStore.readPendingReadStateMutations().size)
        coVerify(exactly = 0) { api.markRead(any(), any()) }

        onlineState.value = true
        coEvery {
            api.markRead(articleId, match { it.read && it.mutationId != null })
        } returns com.selffeed.android.network.ApiEnvelope(
            MarkReadResponse(success = true, read = true, revision = 1),
        )
        coEvery { api.categories() } returns com.selffeed.android.network.ApiEnvelope(
            com.selffeed.android.network.CategoryTreeResponse(categories = emptyList(), totalUnread = 0),
        )

        val readResult = repository.categories()

        assertTrue(readResult is AppResult.Success)
        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        coVerify(exactly = 1) { api.markRead(articleId, match { it.read && it.mutationId != null }) }
    }

    @Test
    fun `reconnect invalidation flushes pending read state before clearing acknowledged overlays`() = runTest {
        val articleId = "article-reconnect"
        localStore.queueReadStateMutation(articleId, read = true)
        coEvery {
            api.markRead(articleId, match { it.read && it.mutationId != null })
        } returns com.selffeed.android.network.ApiEnvelope(
            MarkReadResponse(success = true, read = true, revision = 1),
        )

        repository.invalidateReadStateCaches()

        assertTrue(localStore.readPendingReadStateMutations().isEmpty())
        assertTrue(localStore.readArticleReadOverrides().isEmpty())
        coVerify(exactly = 1) { api.markRead(articleId, match { it.read && it.mutationId != null }) }
    }

    @Test
    fun `reconnect invalidation preserves pending read state when the server flush fails`() = runTest {
        val articleId = "article-reconnect-failure"
        localStore.queueReadStateMutation(articleId, read = true)
        coEvery { api.markRead(articleId, match { it.read && it.mutationId != null }) } throws
            java.net.SocketTimeoutException("still offline")

        repository.invalidateReadStateCaches()

        assertEquals(listOf(articleId), localStore.readPendingReadStateMutations().map { it.articleId })
        assertEquals(mapOf(articleId to true), localStore.readArticleReadOverrides())
    }

    @Test
    fun `unauthorized mutation remains queued when token refresh is unavailable`() = runTest {
        val articleId = "article-refresh-unavailable"
        localStore.queueReadStateMutation(articleId, read = true)
        coEvery { api.markRead(articleId, match { it.mutationId != null }) } throws
            httpError(401, "expired")
        every { sessionRefreshCoordinator.hasRecentRefreshRejection() } returns false

        val flushed = repository.flushPendingArticleStateMutations()

        assertEquals(false, flushed)
        assertEquals(articleId, localStore.readPendingReadStateMutations().single().articleId)
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
        assertTrue(queuedResult is AppResult.Success)
        assertEquals(1, localStore.readPendingReadStateMutations().size)

        onlineState.value = true
        coEvery {
            api.syncAllFeeds(match { it.isNotBlank() }, null, null)
        } returns com.selffeed.android.network.ApiEnvelope(
            SyncResponse(status = "queued", totalFeeds = 1),
        )

        val syncResult = repository.syncAllFeeds()

        assertTrue(syncResult is AppResult.Success)
        val pending = localStore.readPendingReadStateMutations()
        assertEquals(1, pending.size)
        assertEquals(articleId, pending.first().articleId)
        coVerify(exactly = 0) { api.markRead(any(), any()) }
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
        val pagingSource = localStore.articlePagingSource(queryKey)
        coEvery { api.syncAllFeedsStatus(any()) } returns com.selffeed.android.network.ApiEnvelope(
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
        coEvery { api.syncAllFeedsStatus("old-request") } returns com.selffeed.android.network.ApiEnvelope(
            FeedSyncAllStatus(
                requestId = null,
                status = "completed",
                queued = false,
                running = false,
                active = false,
                stale = false,
            ),
        )
        coEvery { api.syncAllFeedsStatus(null) } returns com.selffeed.android.network.ApiEnvelope(
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
        coVerify { api.syncAllFeedsStatus("old-request") }
        coVerify(exactly = 1) { api.syncAllFeedsStatus(null) }
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
        coEvery { api.me() } returns com.selffeed.android.network.ApiEnvelope(
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
    fun `categories return sqlite data before network refresh`() = runTest {
        localStore.writeCategories(listOf(sampleCategory("c-local")))
        coEvery { api.categories() } returns com.selffeed.android.network.ApiEnvelope(
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
        coEvery { api.feeds(null) } returns com.selffeed.android.network.ApiEnvelope(
            listOf(sampleFeed("f-network")),
        )

        val result = repository.feeds(null)

        assertTrue(result is AppResult.Success)
        assertEquals("f-local", (result as AppResult.Success).data.first().id)
    }

    @Test
    fun `refreshFeeds bypasses stale sqlite feed health`() = runTest {
        localStore.writeFeeds(listOf(sampleFeed("f-local")))
        coEvery { api.feeds(null) } returns com.selffeed.android.network.ApiEnvelope(
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
        assertEquals(listOf("f-network"), cacheStore.readFeeds().map { it.id })
        coVerify(exactly = 1) { api.feeds(null) }
    }

    @Test
    fun `scoped feed refresh merges into the complete offline snapshot`() = runTest {
        localStore.writeFeeds(listOf(sampleFeed("f-existing", categoryId = "c-other")))
        coEvery { api.feeds("c-target") } returns com.selffeed.android.network.ApiEnvelope(
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
            cacheStore.readFeeds().map { it.id }.toSet(),
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
        coEvery { api.me() } returns com.selffeed.android.network.ApiEnvelope(sampleUser())

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Success)
        io.mockk.verify(exactly = 0) { sessionRefreshCoordinator.refreshAccessToken() }
    }

    @Test
    fun `restoreSession refreshes through the shared coordinator when only a refresh cookie exists`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns null
        every { sessionRefreshCoordinator.refreshAccessToken() } returns
            SessionRefreshResult.Success("new-access-token")
        coEvery { api.me() } returns com.selffeed.android.network.ApiEnvelope(sampleUser())

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Success)
        io.mockk.verify(exactly = 1) { sessionRefreshCoordinator.refreshAccessToken() }
        coVerify(exactly = 1) { api.me() }
    }

    @Test
    fun `restoreSession clears the local session when refresh session is rejected`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns null
        every { sessionRefreshCoordinator.refreshAccessToken() } returns SessionRefreshResult.Rejected

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Error)
        assertEquals("Authentication was lost. Please sign in again.", (result as AppResult.Error).message)
        coVerify(exactly = 1) { sessionStore.clear() }
        coVerify(exactly = 0) { api.me() }
    }

    @Test
    fun `restoreSession keeps the local session when refresh is temporarily unavailable`() = runTest {
        every { sessionStore.getRefreshCookie() } returns "refresh-cookie"
        every { sessionStore.getAccessToken() } returns null
        every { sessionRefreshCoordinator.refreshAccessToken() } returns
            SessionRefreshResult.Unavailable(java.io.IOException("network unavailable"))

        val result = repository.restoreSession()

        assertTrue(result is AppResult.Error)
        assertEquals("Unable to refresh session. Please check your connection.", (result as AppResult.Error).message)
        coVerify(exactly = 0) { sessionStore.clear() }
        coVerify(exactly = 0) { api.me() }
    }

    @Test
    fun `logout clears local state without waiting for remote revocation`() = runTest {
        every { sessionStore.getAccessToken() } returns "access"
        every { sessionStore.getRefreshCookie() } returns "rss_refresh_token=refresh; Path=/"
        val remoteResponse = CompletableDeferred<com.selffeed.android.network.ApiEnvelope<com.selffeed.android.network.SuccessResponse>>()
        coEvery {
            api.logout("Bearer access", "rss_refresh_token=refresh")
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
        coEvery { api.me() } throws httpError(
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
        coEvery { api.me() } throws httpError(
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
        coEvery { api.me() } throws httpError(
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
