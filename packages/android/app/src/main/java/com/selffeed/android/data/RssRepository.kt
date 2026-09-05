package com.selffeed.android.data

import android.content.Context
import androidx.paging.ExperimentalPagingApi
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineReadStore
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.data.repository.ReadStateStreamClient
import com.selffeed.android.data.repository.RepositoryRuntime
import com.selffeed.android.data.repository.SavedStateRejection
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RecordProductAnalyticsEventsRequest
import com.selffeed.android.network.SessionRefreshCoordinator
import com.selffeed.android.network.SessionRefreshResult
import com.selffeed.android.network.UpdatePreferencesRequest
import com.squareup.moshi.Moshi
import coil3.ImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton

sealed interface AppResult<out T> {
    data class Success<T>(val data: T) : AppResult<T>
    data class Error(val message: String, val cause: Throwable? = null) : AppResult<Nothing>
}

@Singleton
class RssRepository @Inject constructor(
    private val authRemote: AuthRemoteDataSource,
    private val feedRemote: FeedRemoteDataSource,
    private val articleRemote: ArticleRemoteDataSource,
    private val searchRemote: SearchRemoteDataSource,
    private val settingsRemote: SettingsRemoteDataSource,
    private val sessionStore: SessionStore,
    private val sessionRefreshCoordinator: SessionRefreshCoordinator,
    okHttpClient: OkHttpClient,
    moshi: Moshi,
    private val localStore: LocalStore,
    private val offlineReadStore: OfflineReadStore,
    private val imageRequestContext: Context,
    private val imageLoader: ImageLoader,
    private val networkMonitor: NetworkMonitor,
) : SelfFeedRepository {
    private val runtime = RepositoryRuntime(
        moshi = moshi,
        maxMemoryCacheEntries = MAX_MEMORY_CACHE_ENTRIES,
        logTag = "RssRepository",
        apiBaseUrl = sessionStore::getApiBaseUrl,
    )
    private val readStateStreamClient = ReadStateStreamClient(
        okHttpClient = okHttpClient,
        moshi = moshi,
        runtime = runtime,
        apiBaseUrl = sessionStore::getApiBaseUrl,
    )

    // Detached scope for fire-and-forget background refreshes (e.g. the
    // stale-while-revalidate path in `article()`). Using a supervisor
    // scope tied to the repository means background work survives
    // individual failures and is cleaned up when the process dies.
    private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val savedStateRejectionEvents = MutableSharedFlow<SavedStateRejection>(extraBufferCapacity = 32)
    private val authLostEvents = MutableSharedFlow<String>(extraBufferCapacity = 1)
    private val analyticsSessionLock = Any()
    private val completedArticleIds = mutableSetOf<String>()
    private var appOpenRecordedOn: String? = null
    private val sessionGeneration = AtomicLong(0)

    init {
        refreshScope.launch {
            networkMonitor.online.collect { online ->
                if (online) flushProductAnalyticsEvents()
            }
        }
    }

    override fun getApiBaseUrl(): String = sessionStore.getApiBaseUrl()

    override suspend fun setApiBaseUrl(rawBaseUrl: String) = safeCall {
        val previousBaseUrl = sessionStore.getApiBaseUrl()
        val nextBaseUrl = sessionStore.setApiBaseUrl(rawBaseUrl)
        if (nextBaseUrl != previousBaseUrl) {
            sessionGeneration.incrementAndGet()
            clearCacheAndDatabase()
        }
        nextBaseUrl
    }

    override suspend fun registrationStatus() = safePublicCall {
        authRemote.registrationStatus()
    }

    override suspend fun login(email: String, password: String) = safePublicCall {
        val response = authRemote.login(email, password)
        sessionGeneration.incrementAndGet()
        clearCacheAndDatabase()
        sessionStore.setAccessToken(response.tokens.accessToken)
        sessionStore.recordAuthenticated()
        recordAppOpen()
        flushProductAnalyticsEvents()
        response.user
    }

    override suspend fun register(email: String, password: String) = safePublicCall {
        val response = authRemote.register(email, password)
        sessionGeneration.incrementAndGet()
        clearCacheAndDatabase()
        sessionStore.setAccessToken(response.tokens.accessToken)
        sessionStore.recordAuthenticated()
        recordAppOpen()
        flushProductAnalyticsEvents()
        response.user
    }

    override suspend fun restoreSession() = safeCall {
        val hasRefreshCookie = !sessionStore.getRefreshCookie().isNullOrBlank()
        val hasAccessToken = !sessionStore.getAccessToken().isNullOrBlank()
        if (!hasRefreshCookie && !hasAccessToken) {
            throw IllegalStateException("No saved session")
        }

        if (!hasAccessToken && hasRefreshCookie) {
            when (sessionRefreshCoordinator.refreshAccessToken()) {
                is SessionRefreshResult.Success -> Unit
                SessionRefreshResult.Rejected -> throw AuthenticationLostException()
                is SessionRefreshResult.Unavailable -> throw IllegalStateException(
                    "Unable to refresh session. Please check your connection.",
                )
            }
        }

        val user = runtime.withRetry { authRemote.me() }
        sessionStore.recordAuthenticated()
        recordAppOpen()
        flushProductAnalyticsEvents()
        user
    }

    override suspend fun logout(): AppResult<Boolean> {
        // Start revocation with the current credentials, then make logout local
        // and irreversible without waiting on the network.
        val accessToken = sessionStore.getAccessToken()
        val refreshCookie = sessionStore.getRefreshCookie()
        refreshScope.launch(start = CoroutineStart.UNDISPATCHED) {
            if (runCatching { authRemote.logout(accessToken, refreshCookie) }.isFailure) {
                runtime.debugLog("Remote logout could not be confirmed; local session was cleared")
            }
        }
        sessionGeneration.incrementAndGet()
        sessionStore.clear()
        clearCacheAndDatabase()
        return AppResult.Success(true)
    }

    suspend fun prepareSession() = sessionStore.preload()

    override suspend fun me() = safeReadCall {
        runtime.cachedGet(key = "me", ttlMs = USER_TTL_MS) { runtime.withRetry { authRemote.me() } }
    }

    override suspend fun changePassword(currentPassword: String, newPassword: String) = safeCall {
        val response = authRemote.changePassword(currentPassword, newPassword)
        sessionStore.setAccessToken(response.tokens.accessToken)
        runtime.invalidateByPrefix("auth:sessions")
        response.user
    }

    override suspend fun categories() = safeReadCall {
        flushPendingArticleStateMutations()
        runtime.getCached<List<CategoryWithCounts>>("categories")?.let {
            runtime.recordCacheHit()
            return@safeReadCall it
        }

        val cachedCategories = offlineReadStore.readCategories()
        if (cachedCategories.isNotEmpty()) {
            runtime.putCached("categories", CATEGORIES_TTL_MS, cachedCategories)
            refreshCategoriesInBackground()
            return@safeReadCall cachedCategories
        }

        try {
            runtime.cachedGet(key = "categories", ttlMs = CATEGORIES_TTL_MS) {
                runtime.withRetry { feedRemote.categories() }.also { categories ->
                    offlineReadStore.writeCategories(categories)
                }
            }
        } catch (e: Exception) {
            offlineReadStore.readCategories().takeIf { it.isNotEmpty() } ?: throw e
        }
    }

    override suspend fun createCategory(name: String, parentCategoryId: String?) = safeCall {
        feedRemote.createCategory(name, parentCategoryId).also {
            runtime.invalidateByPrefix("categories")
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("stats")
            offlineReadStore.clearCategories()
            offlineReadStore.clearFeeds()
        }
    }

    override suspend fun updateCategory(id: String, name: String?, parentCategoryId: String?) =
        safeCall {
            feedRemote.updateCategory(id, name, parentCategoryId).also {
                invalidateFeedAndArticleCaches()
            }
        }

    override suspend fun deleteCategory(id: String) = safeCall {
        feedRemote.deleteCategory(id).also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun feeds(categoryId: String?) = safeReadCall {
        flushPendingArticleStateMutations()
        val key = "feeds:${categoryId.orEmpty()}"
        runtime.getCached<List<FeedWithCounts>>(key)?.let {
            runtime.recordCacheHit()
            return@safeReadCall it
        }

        val cachedFeeds = offlineReadStore.readFeeds()
        if (cachedFeeds.isNotEmpty()) {
            val filtered = filterCachedFeeds(cachedFeeds, categoryId)
            if (filtered.isNotEmpty()) {
                runtime.putCached(key, FEEDS_TTL_MS, filtered)
                refreshFeedsInBackground(categoryId)
                return@safeReadCall filtered
            }
        }

        try {
            runtime.cachedGet(key = key, ttlMs = FEEDS_TTL_MS) {
                runtime.withRetry { feedRemote.feeds(categoryId) }.also { feeds ->
                    persistFeedSnapshot(categoryId, feeds)
                }
            }
        } catch (e: Exception) {
            val cached = offlineReadStore.readFeeds()
            val filtered = filterCachedFeeds(cached, categoryId)
            filtered.takeIf { it.isNotEmpty() } ?: throw e
        }
    }

    override suspend fun refreshFeeds(categoryId: String?) = safeReadCall {
        flushPendingArticleStateMutations()
        runtime.withRetry { feedRemote.feeds(categoryId) }.also { feeds ->
            runtime.putCached("feeds:${categoryId.orEmpty()}", FEEDS_TTL_MS, feeds)
            persistFeedSnapshot(categoryId, feeds)
        }
    }

    override suspend fun createFeed(feedUrl: String, categoryId: String, title: String?) =
        safeCall {
            feedRemote.createFeed(feedUrl, categoryId, title).also {
                invalidateFeedAndArticleCaches()
            }
        }

    override suspend fun updateFeed(
        id: String,
        feedUrl: String?,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?
    ) = safeCall {
        feedRemote.updateFeed(id, feedUrl, categoryId, title, pollingIntervalMinutes).also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun deleteFeed(id: String) = safeCall {
        feedRemote.deleteFeed(id).also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun syncFeed(id: String) = safeCall {
        feedRemote.syncFeed(id).also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun syncAllFeeds(feedId: String?, categoryId: String?) = safeCall {
        val response = feedRemote.syncAllFeeds(feedId, categoryId)
        if (response.requestId != null) {
            sessionStore.setFeedRefreshRequestId(response.requestId)
        }
        response
    }

    override suspend fun syncAllFeedsStatus(requestId: String?) = safeReadCall {
        val trackedRequestId =
            requestId ?: sessionStore.getFeedRefreshRequestId()?.takeIf(String::isNotBlank)
        val trackedStatus = feedRemote.syncAllFeedsStatus(trackedRequestId)
        val status = if (trackedRequestId != null && trackedStatus.requestId != trackedRequestId) {
            sessionStore.setFeedRefreshRequestId(null)
            feedRemote.syncAllFeedsStatus(null)
        } else trackedStatus
        if (status.active && status.requestId != null) {
            sessionStore.setFeedRefreshRequestId(status.requestId)
        }
        if (!status.active) invalidateFeedAndArticleRuntimeCaches()
        status
    }

    override suspend fun feedSyncHistory(feedId: String) = safeReadCall {
        feedRemote.feedSyncHistory(feedId)
    }

    override suspend fun selectDiscoveryCandidate(candidateId: String) = safeCall {
        val selection = feedRemote.selectDiscoveryCandidate(candidateId)
        sessionStore.setFeedRefreshRequestId(selection.requestId)
        feedRemote.feeds(null).first { it.id == selection.feedId }.also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun cancelFeedReplacement(feedId: String) = safeCall {
        feedRemote.cancelFeedReplacement(feedId).also { invalidateFeedAndArticleCaches() }
    }

    override suspend fun importOpml(fileName: String, fileBytes: ByteArray) = safeCall {
        val body = fileBytes.toRequestBody("application/xml".toMediaType())
        val part = MultipartBody.Part.createFormData("file", fileName, body)
        feedRemote.importOpml(part).also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun exportOpml() = safeReadCall {
        runtime.cachedGet(key = "opml:export", ttlMs = OPML_EXPORT_TTL_MS) {
            val response = runtime.withRetry { feedRemote.exportOpml() }
            if (!response.isSuccessful) throw HttpException(response)
            response.body()?.string().orEmpty()
        }
    }

    @OptIn(ExperimentalPagingApi::class)
    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> {
        val queryKey = query.remoteKey()
        return flow {
            // Snapshot durable overlays once per explicit query generation.
            // Subsequent read receipts are rendered by the ViewModel's live
            // override state and cannot structurally invalidate this Pager.
            val durableReadStates = localStore.readArticleReadOverrides()
            emitAll(
                Pager(
                    config = PagingConfig(
                        pageSize = ARTICLE_PAGE_SIZE,
                        initialLoadSize = ARTICLE_PAGE_SIZE,
                        prefetchDistance = ARTICLE_PAGING_PREFETCH_DISTANCE,
                        enablePlaceholders = false,
                    ),
                    remoteMediator = ArticleRemoteMediator(
                        queryKey = queryKey,
                        forceInitialRefresh = query.generation > 0L,
                        localStore = localStore,
                        loadPage = { limit, cursor ->
                            runtime.safeCall {
                                runtime.withRetry {
                                    articleRemote.articles(
                                        feedId = query.feedId,
                                        categoryId = query.categoryId,
                                        unreadOnly = query.unreadOnly,
                                        savedOnly = query.savedOnly,
                                        sort = query.sort,
                                        limit = limit,
                                        cursor = cursor,
                                    )
                                }
                            }
                        },
                    ),
                    pagingSourceFactory = {
                        if (query.savedOnly) localStore.savedArticlePagingSource()
                        else localStore.articlePagingSource(queryKey)
                    },
                ).flow.map { pagingData ->
                    val readStates = durableReadStates + readStateOverrides()
                    pagingData.map { article ->
                        readStates[article.id]?.let { article.copy(isRead = it) } ?: article
                    }
                },
            )
        }
    }

    override suspend fun article(articleId: String, forceRefresh: Boolean) = safeReadCall {
        flushPendingArticleStateMutations()
        if (forceRefresh) {
            val stale = runtime.getCached<ArticleDetail>("article:$articleId")
                ?: offlineReadStore.readArticleDetail(articleId)
            return@safeReadCall try {
                fetchAndStoreArticle(articleId)
            } catch (error: Exception) {
                stale ?: throw error
            }
        }

        // Fast path: in-memory hit. Instant.
        runtime.getCached<ArticleDetail>("article:$articleId")?.let { return@safeReadCall it }

        // Warm path: durable offline storage has a fresh copy. Return it
        // now and refresh from the network in the background so the reader
        // opens instantly for any article the user has ever opened. The
        // background refresh updates the in-memory cache and durable store
        // on success; on failure the cached copy stays valid until its own
        // expiry.
        val cachedDetail = offlineReadStore.readArticleDetail(articleId)
        if (cachedDetail != null) {
            runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, cachedDetail)
            // Detached background refresh — does not block the caller.
            // We swallow the result here on purpose: the caller already
            // has a usable ArticleDetail. Errors are surfaced on the next
            // explicit open or pull-to-refresh.
            backgroundRefreshArticle(articleId)
            return@safeReadCall cachedDetail
        }

        // Cold path: nothing in memory or durable storage. Hit the network.
        try {
            fetchAndStoreArticle(articleId)
        } catch (e: Exception) {
            offlineReadStore.readArticleDetail(articleId) ?: throw e
        }
    }

    suspend fun article(articleId: String): AppResult<ArticleDetail> =
        article(articleId, forceRefresh = false)

    private fun backgroundRefreshArticle(articleId: String, cacheImages: Boolean = false) {
        val generation = sessionGeneration.get()
        refreshScope.launch {
            try {
                val detail = localStore.applyPendingArticleState(
                    runtime.withRetry { articleRemote.article(articleId) },
                )
                if (generation != sessionGeneration.get() || !isLoggedIn()) return@launch
                runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
                offlineReadStore.writeArticleDetail(detail)
                if (cacheImages) cacheArticleImages(detail)
            } catch (_: Exception) {
                // Background refresh is best-effort. The cached copy the
                // user is already reading is still valid.
            }
        }
    }

    private fun refreshCategoriesInBackground() {
        val generation = sessionGeneration.get()
        refreshScope.launch {
            runCatching {
                runtime.withRetry { feedRemote.categories() }.also { categories ->
                    if (generation != sessionGeneration.get() || !isLoggedIn()) return@also
                    runtime.putCached("categories", CATEGORIES_TTL_MS, categories)
                    offlineReadStore.writeCategories(categories)
                }
            }
        }
    }

    private fun refreshFeedsInBackground(categoryId: String?) {
        val generation = sessionGeneration.get()
        refreshScope.launch {
            runCatching {
                runtime.withRetry { feedRemote.feeds(categoryId) }.also { feeds ->
                    if (generation != sessionGeneration.get() || !isLoggedIn()) return@also
                    runtime.putCached("feeds:${categoryId.orEmpty()}", FEEDS_TTL_MS, feeds)
                    persistFeedSnapshot(categoryId, feeds)
                }
            }
        }
    }

    private fun refreshPreferencesInBackground() {
        val generation = sessionGeneration.get()
        refreshScope.launch {
            runCatching {
                runtime.withRetry { settingsRemote.preferences() }.also { preferences ->
                    if (generation != sessionGeneration.get() || !isLoggedIn()) return@also
                    runtime.putCached("preferences", PREFERENCES_TTL_MS, preferences)
                    localStore.writePreferences(preferences)
                }
            }
        }
    }

    override fun cachedArticleDetail(articleId: String): ArticleDetail? =
        runtime.getCached("article:$articleId")

    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> =
        article(articleId)

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        safeReadCall {
            fetchAndStoreArticle(articleId)
        }

    private suspend fun fetchAndStoreArticle(articleId: String): ArticleDetail {
        val generation = sessionGeneration.get()
        val detail = localStore.applyPendingArticleState(
            runtime.withRetry { articleRemote.article(articleId) },
        )
        if (generation != sessionGeneration.get() || !isLoggedIn()) {
            throw IllegalStateException("Session changed while article was loading")
        }
        runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
        offlineReadStore.writeArticleDetail(detail)
        return detail
    }

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) {
        if (!networkMonitor.unmetered.value) return
        imageUrls
            .asSequence()
            .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
            .distinct()
            .take(ARTICLE_IMAGE_PREFETCH_LIMIT)
            .forEach { imageUrl ->
                val request = ImageRequest.Builder(imageRequestContext)
                    .data(imageUrl)
                    .memoryCachePolicy(CachePolicy.ENABLED)
                    .diskCachePolicy(CachePolicy.ENABLED)
                    .build()
                imageLoader.enqueue(request)
            }
    }

    private fun cacheArticleImages(detail: ArticleDetail) {
        sequenceOf(detail.heroImageUrl)
            .plus(detail.media.asSequence().filter { it.type == "image" }.map { it.url })
            .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
            .distinct()
            .take(SAVED_ARTICLE_IMAGE_CACHE_LIMIT)
            .forEach { imageUrl ->
                imageLoader.enqueue(
                    ImageRequest.Builder(imageRequestContext)
                        .data(imageUrl)
                        .memoryCachePolicy(CachePolicy.ENABLED)
                        .diskCachePolicy(CachePolicy.ENABLED)
                        .build(),
                )
            }
    }

    override suspend fun enrichArticle(articleId: String, invalidateCaches: Boolean) = safeCall {
        articleRemote.enrichArticle(articleId).also {
            if (it.success || it.reason == "already_enriched") {
                if (invalidateCaches) {
                    invalidateArticleCaches(articleId)
                } else {
                    invalidateArticleDetailCache(articleId)
                }
            }
        }
    }

    suspend fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> =
        enrichArticle(articleId, invalidateCaches = true)

    /** Queues the desired state before attempting network delivery. */
    override suspend fun markRead(articleId: String, read: Boolean, source: String) = safeCall {
        val key = "article:$articleId"
        val previous = runtime.getCached<ArticleDetail>(key)
        // Optimistic write — visible to the reader screen and the next
        // list query before the round-trip completes.
        if (previous != null) {
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, previous.copy(isRead = read))
        }
        localStore.queueReadStateMutation(articleId, read, source)
        runtime.invalidateByPrefix("stats")
        // The durable Room write is the success boundary. WorkManager may be
        // temporarily unavailable during process initialization, so scheduling
        // must never turn an already-persisted user action into an error.
        runCatching { ArticleStateSyncWorker.kickOnce(imageRequestContext) }
        if (networkMonitor.online.value) flushPendingArticleStateMutations()
        read
    }

    suspend fun markRead(articleId: String, read: Boolean): AppResult<Boolean> =
        markRead(articleId, read, source = "manual")

    override suspend fun markAllRead(feedId: String?, categoryId: String?) = safeCall {
        articleRemote.markAllRead(feedId, categoryId).also {
            localStore.clearAcknowledgedReadStateOverrides()
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("categories")
            runtime.invalidateByPrefix("stats")
            runtime.invalidateByPrefix("search")
        }
    }

    override fun savedStateRejections(): Flow<SavedStateRejection> = savedStateRejectionEvents.asSharedFlow()

    override suspend fun setSaved(articleId: String, saved: Boolean) = safeCall {
        val key = "article:$articleId"
        val previous = runtime.getCached<ArticleDetail>(key)
        localStore.queueSavedStateMutation(articleId, saved)
        if (previous != null) {
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, previous.copy(isSaved = saved))
        }
        runtime.invalidateByPrefix("articles")
        runtime.invalidateByPrefix("search")
        runCatching { ArticleStateSyncWorker.kickOnce(imageRequestContext) }
        if (networkMonitor.online.value) flushPendingArticleStateMutations()
        if (saved) {
            if (previous == null) backgroundRefreshArticle(articleId, cacheImages = true)
            else cacheArticleImages(previous.copy(isSaved = true))
        }
        saved
    }

    suspend fun markAllRead() = markAllRead(feedId = null, categoryId = null)

    override fun clientId(): String = sessionStore.getClientId()

    override fun readStateEvents(): Flow<ReadStateSyncEvent> =
        readStateStreamClient.events(::isLoggedIn)

    override suspend fun search(query: String, categoryId: String?, cursor: String?) =
        safeReadCall {
            if (!cursor.isNullOrBlank()) {
                return@safeReadCall runtime.withRetry {
                    searchRemote.search(
                        query = query,
                        categoryId = categoryId,
                        cursor = cursor
                    )
                }
            }

            val key = "search:${query.trim().lowercase()}:${categoryId.orEmpty()}:"
            try {
                runtime.cachedGet(key = key, ttlMs = SEARCH_TTL_MS) {
                    runtime.withRetry {
                        searchRemote.search(
                            query = query,
                            categoryId = categoryId,
                            cursor = cursor,
                        )
                    }
                }
            } catch (error: Exception) {
                val cached = localStore.searchArticles(query, categoryId)
                if (cached.isEmpty()) throw error
                ApiListResponse(data = cached, cursor = null, hasMore = false)
            }
        }

    suspend fun search(query: String): AppResult<ApiListResponse<ArticleListItem>> =
        search(query = query, categoryId = null, cursor = null)

    override suspend fun preferences() = safeReadCall {
        localStore.readPreferences()?.let { cached ->
            refreshPreferencesInBackground()
            return@safeReadCall cached
        }
        runtime.cachedGet(key = "preferences", ttlMs = PREFERENCES_TTL_MS) {
            runtime.withRetry { settingsRemote.preferences() }.also {
                localStore.writePreferences(it)
            }
        }
    }

    override suspend fun updatePreferences(request: UpdatePreferencesRequest) = safeCall {
        settingsRemote.updatePreferences(request).also {
            localStore.writePreferences(it)
            runtime.invalidateByPrefix("preferences")
            runtime.invalidateByPrefix("articles")
            runtime.invalidateByPrefix("search")
        }
    }

    override suspend fun stats() = safeReadCall {
        runtime.cachedGet(
            key = "stats",
            ttlMs = STATS_TTL_MS
        ) { runtime.withRetry { settingsRemote.stats() } }
    }

    override suspend fun authSessions() = safeReadCall {
        runtime.cachedGet(key = "auth:sessions", ttlMs = AUTH_SESSIONS_TTL_MS) {
            runtime.withRetry { settingsRemote.authSessions() }
        }
    }

    override suspend fun revokeAuthSession(id: String) = safeCall {
        settingsRemote.revokeAuthSession(id).also {
            runtime.invalidateByPrefix("auth:sessions")
        }
    }

    override suspend fun adminSettings() = safeReadCall {
        runtime.cachedGet(
            key = "admin:settings",
            ttlMs = ADMIN_SETTINGS_TTL_MS
        ) { runtime.withRetry { settingsRemote.adminSettings() } }
    }

    override suspend fun updateAdminSettings(registrationLocked: Boolean) = safeCall {
        settingsRemote.updateAdminSettings(registrationLocked).also {
            runtime.invalidateByPrefix("admin:settings")
        }
    }

    override suspend fun adminUsers() = safeReadCall {
        settingsRemote.adminUsers().users
    }

    override suspend fun adminCreateUser(email: String, password: String, role: String) = safeCall {
        settingsRemote.adminCreateUser(email, password, role)
    }

    override suspend fun adminUpdateUser(id: String, role: String?, isActive: Boolean?) = safeCall {
        settingsRemote.adminUpdateUser(id, role, isActive)
    }

    override suspend fun adminResetPassword(id: String, password: String) = safeCall {
        settingsRemote.adminResetPassword(id, password)
    }

    override fun isLoggedIn(): Boolean =
        !sessionStore.getRefreshCookie().isNullOrBlank() || !sessionStore.getAccessToken()
            .isNullOrBlank()

    override fun canUseOfflineSession(): Boolean =
        isLoggedIn() && sessionStore.hasValidOfflineAccessLease()

    override fun authEvents(): Flow<String> = authLostEvents.asSharedFlow()

    override suspend fun recordOfflineRestore() {
        recordAppOpen()
        runCatching { sessionStore.enqueueProductAnalyticsEvent("offline_restore") }
        flushProductAnalyticsEvents()
    }

    override suspend fun recordArticleCompletion(articleId: String) {
        val isNewCompletion = synchronized(analyticsSessionLock) { completedArticleIds.add(articleId) }
        if (!isNewCompletion) return
        runCatching { sessionStore.enqueueProductAnalyticsEvent("article_completed") }
        flushProductAnalyticsEvents()
    }

    override fun isOnline(): Boolean = networkMonitor.online.value

    override fun observeOnline(): Flow<Boolean> = networkMonitor.online

    override fun getDebugResilienceSnapshot(): Map<String, Long> = runtime.snapshot()

    override fun resetDebugResilienceMetrics() = runtime.resetMetrics()

    /**
     * Drops in-memory caches (e.g. on [android.content.ComponentCallbacks2]
     * trim memory) to free up heap when the system is under pressure.
     */
    override fun trimMemoryCaches() = runtime.trimMemoryCaches()

    private suspend fun <T> safeReadCall(block: suspend () -> T): AppResult<T> = safeCall(block)

    private suspend fun <T> safeCall(block: suspend () -> T): AppResult<T> {
        val result = runtime.safeCall(block)
        if (result is AppResult.Error) {
            if (isAuthenticationLost(result)) {
                handleAuthenticationLost()
                return AppResult.Error(AUTH_LOST_MESSAGE, result.cause)
            }
            if (isUnauthorized(result)) {
                return AppResult.Error(SESSION_REFRESH_UNAVAILABLE_MESSAGE, result.cause)
            }
        }
        return result
    }

    private fun isAuthenticationLost(result: AppResult.Error): Boolean {
        if (result.cause is AuthenticationLostException) {
            return true
        }
        val http = result.cause as? HttpException ?: return false
        return http.code() == 401 && sessionRefreshCoordinator.hasRecentRefreshRejection()
    }

    private fun isUnauthorized(result: AppResult.Error): Boolean =
        (result.cause as? HttpException)?.code() == 401

    private suspend fun <T> safePublicCall(block: suspend () -> T): AppResult<T> =
        runtime.safeCall(block)

    private suspend fun handleAuthenticationLost() {
        sessionGeneration.incrementAndGet()
        sessionStore.clear()
        clearCacheAndDatabase()
        authLostEvents.tryEmit(AUTH_LOST_MESSAGE)
    }

    private suspend fun flushProductAnalyticsEvents() {
        if (!networkMonitor.online.value || !isLoggedIn()) return
        val pending = runCatching { sessionStore.pendingProductAnalyticsEvents() }.getOrNull() ?: return
        if (pending.isEmpty()) return
        runCatching {
            settingsRemote.recordProductAnalyticsEvents(RecordProductAnalyticsEventsRequest(pending))
            sessionStore.removeProductAnalyticsEvents(pending.mapTo(mutableSetOf()) { it.id })
        }
    }

    private suspend fun recordAppOpen() {
        val today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString()
        val shouldRecord = synchronized(analyticsSessionLock) {
            if (appOpenRecordedOn == today) {
                false
            } else {
                appOpenRecordedOn = today
                true
            }
        }
        if (!shouldRecord) return
        if (runCatching { sessionStore.enqueueProductAnalyticsEvent("app_opened") }.isFailure) {
            synchronized(analyticsSessionLock) { appOpenRecordedOn = null }
        }
    }

    suspend fun invalidateArticleCaches(articleId: String) {
        // Targeted invalidation for a single markRead. The SSE read-state
        // event handles the in-memory `state.articles` patch, so we
        // don't need to blow away every cached list here. We only drop
        // the article detail and the stats aggregate; feeds/categories
        // are refreshed lazily on the next unread-count read.
        invalidateArticleDetailCache(articleId)
        runtime.invalidateByPrefix("stats")
    }

    private suspend fun invalidateArticleDetailCache(articleId: String) {
        runtime.invalidateByPrefix("article:$articleId")
        // Keep the durable copy as a stale fallback until a successful fetch
        // replaces it. Realtime invalidation is only a freshness hint and can
        // arrive immediately before connectivity is lost.
    }

    override suspend fun invalidateReadStateCaches(articleId: String?) {
        flushPendingArticleStateMutations()
        // Read state is an overlay; never evict immutable article content or
        // the visible list for a receipt arriving from another client.
        runtime.invalidateByPrefix("feeds")
        runtime.invalidateByPrefix("categories")
        runtime.invalidateByPrefix("stats")
    }

    override suspend fun invalidateArticleContentCaches(articleId: String?) {
        if (articleId != null) {
            invalidateArticleDetailCache(articleId)
        } else {
            runtime.invalidateByPrefix("article:")
        }
        runtime.invalidateByPrefix("articles")
        runtime.invalidateByPrefix("search")
        runtime.invalidateByPrefix("feeds")
        runtime.invalidateByPrefix("categories")
        runtime.invalidateByPrefix("stats")
        // Realtime availability is a hint for the next explicit refresh.
        // Clearing Room here invalidates the active PagingSource and briefly
        // replaces the user's queue with an empty list while they are reading.
        // The manual refresh RemoteMediator transaction will replace the
        // durable query rows atomically when the user asks for fresh content.
    }

    override suspend fun updateCachedReadState(articleId: String, read: Boolean, revision: Int?) {
        val visibleState = localStore.updateArticleReadState(articleId, read, revision)
        val key = "article:$articleId"
        runtime.getCached<ArticleDetail>(key)?.let { cached ->
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, cached.copy(isRead = visibleState))
        }
    }

    override suspend fun updateCachedSavedState(articleId: String, saved: Boolean, revision: Int?) {
        val visibleState = localStore.updateArticleSavedState(articleId, saved, revision)
        val key = "article:$articleId"
        runtime.getCached<ArticleDetail>(key)?.let { cached ->
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, cached.copy(isSaved = visibleState))
        }
        runtime.invalidateByPrefix("articles")
        runtime.invalidateByPrefix("search")
    }

    override suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>) {
        localStore.markArticlesReadByFeeds(feedIds)
        runtime.invalidateByPrefix("search")
    }

    private suspend fun clearCacheAndDatabase() {
        synchronized(analyticsSessionLock) {
            completedArticleIds.clear()
            appOpenRecordedOn = null
        }
        runtime.clearCache()
        offlineReadStore.clearAll()
    }

    private suspend fun invalidateFeedAndArticleCaches() {
        invalidateFeedAndArticleRuntimeCaches()
        runtime.invalidateByPrefix("article:")
        offlineReadStore.clearFeedAndArticleData()
    }

    /**
     * Marks network-derived values stale without deleting the Room Paging
     * source currently on screen. A completed background sync is followed by
     * an explicit Pager refresh that replaces query rows transactionally.
     */
    private fun invalidateFeedAndArticleRuntimeCaches() {
        runtime.invalidateByPrefix("feeds")
        runtime.invalidateByPrefix("articles")
        runtime.invalidateByPrefix("search")
        runtime.invalidateByPrefix("stats")
        runtime.invalidateByPrefix("categories")
    }

    suspend fun flushPendingArticleStateMutations(): Boolean {
        if (!networkMonitor.online.value) return false
        repeat(MAX_OUTBOX_FLUSH_ATTEMPTS) {
            val read = localStore.readPendingReadStateMutations().firstOrNull()
            val saved = localStore.readPendingSavedStateMutations().firstOrNull()
            if (read == null && saved == null) return true
            try {
                if (saved == null || (read != null && read.updatedAt <= saved.updatedAt)) {
                    val mutation = requireNotNull(read)
                    if (mutation.mutationId.isBlank()) {
                        localStore.rebaseReadStateMutation(mutation, mutation.baseRevision ?: 0)
                        return@repeat
                    }
                    val response = runtime.withRetry {
                        articleRemote.markRead(
                            articleId = mutation.articleId,
                            read = mutation.read,
                            source = mutation.source,
                            mutationId = mutation.mutationId,
                            baseRevision = mutation.baseRevision,
                        )
                    }
                    if (response.conflict) {
                        localStore.rebaseReadStateMutation(mutation, response.revision)
                    } else {
                        val authoritative = response.read ?: mutation.read
                        localStore.acknowledgeReadStateMutation(
                            mutation,
                            authoritative,
                            response.revision,
                        )
                        runtime.getCached<ArticleDetail>("article:${mutation.articleId}")?.let { detail ->
                            runtime.putCached(
                                "article:${mutation.articleId}",
                                ARTICLE_DETAIL_TTL_MS,
                                detail.copy(isRead = authoritative),
                            )
                        }
                    }
                } else {
                    val mutation = saved
                    val response = runtime.withRetry {
                        articleRemote.setSaved(
                            articleId = mutation.articleId,
                            saved = mutation.saved,
                            mutationId = mutation.mutationId,
                            baseRevision = mutation.baseRevision,
                        )
                    }
                    if (response.conflict) {
                        localStore.rebaseSavedStateMutation(mutation, response.revision)
                    } else {
                        val authoritative = response.saved ?: mutation.saved
                        localStore.acknowledgeSavedStateMutation(
                            mutation,
                            authoritative,
                            response.revision,
                        )
                        runtime.getCached<ArticleDetail>("article:${mutation.articleId}")?.let { detail ->
                            runtime.putCached(
                                "article:${mutation.articleId}",
                                ARTICLE_DETAIL_TTL_MS,
                                detail.copy(isSaved = authoritative),
                            )
                        }
                    }
                }
            } catch (error: Exception) {
                val status = (error as? HttpException)?.code()
                if (status == 401) {
                    if (sessionRefreshCoordinator.hasRecentRefreshRejection()) throw error
                    runtime.debugLog("Offline mutation flush paused until session refresh is available")
                    return false
                }
                if (status != null && !isRetriableMutationStatus(status)) {
                    if (read != null && (saved == null || read.updatedAt <= saved.updatedAt)) {
                        localStore.discardReadStateMutation(read)
                    } else if (saved != null) {
                        localStore.discardSavedStateMutation(saved)?.let { restored ->
                            val key = "article:${saved.articleId}"
                            runtime.getCached<ArticleDetail>(key)?.let { detail ->
                                runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, detail.copy(isSaved = restored))
                            }
                            runtime.invalidateByPrefix("search")
                            savedStateRejectionEvents.emit(SavedStateRejection(saved.articleId, restored))
                        }
                    }
                    return@repeat
                }
                runtime.debugLog(
                    "Offline mutation flush paused: ${error.message ?: error::class.java.simpleName}",
                )
                return false
            }
        }
        return false
    }

    private fun isRetriableMutationStatus(status: Int): Boolean =
        status == 408 || status == 425 || status == 429 || status >= 500

    private suspend fun persistFeedSnapshot(categoryId: String?, feeds: List<FeedWithCounts>) {
        if (categoryId == null) {
            offlineReadStore.writeFeeds(feeds)
        } else {
            offlineReadStore.mergeFeeds(feeds)
        }
    }

    private suspend fun filterCachedFeeds(
        feeds: List<FeedWithCounts>,
        categoryId: String?,
    ): List<FeedWithCounts> {
        if (categoryId == null) return feeds
        val flattened = buildList {
            fun append(categories: List<CategoryWithCounts>) {
                for (category in categories) {
                    add(category)
                    append(category.children.orEmpty())
                }
            }
            append(offlineReadStore.readCategories())
        }
        val includedCategoryIds = mutableSetOf(categoryId)
        var changed: Boolean
        do {
            changed = false
            for (category in flattened) {
                if (
                    category.parentCategoryId in includedCategoryIds &&
                    includedCategoryIds.add(category.id)
                ) {
                    changed = true
                }
            }
        } while (changed)
        return feeds.filter { it.categoryId in includedCategoryIds }
    }

    private companion object {
        const val USER_TTL_MS = 30_000L
        const val CATEGORIES_TTL_MS = 60_000L
        const val FEEDS_TTL_MS = 60_000L

        // Article details change rarely once published (only on enrichment
        // or read-state flip, both of which invalidate explicitly). Keep
        // them in the in-memory cache for a full day so reopening an old
        // article is instant — durable offline storage is the source, this
        // just avoids re-parsing on every cold start.
        const val ARTICLE_DETAIL_TTL_MS = 24L * 60 * 60 * 1000
        const val SEARCH_TTL_MS = 30_000L
        const val PREFERENCES_TTL_MS = 60_000L
        const val STATS_TTL_MS = 30_000L
        const val AUTH_SESSIONS_TTL_MS = 15_000L
        const val ADMIN_SETTINGS_TTL_MS = 60_000L
        const val OPML_EXPORT_TTL_MS = 30_000L
        const val ARTICLE_IMAGE_PREFETCH_LIMIT = 5
        const val SAVED_ARTICLE_IMAGE_CACHE_LIMIT = 20
        const val MAX_MEMORY_CACHE_ENTRIES = 160
        const val ARTICLE_PAGE_SIZE = 30
        const val ARTICLE_PAGING_PREFETCH_DISTANCE = 8
        const val MAX_OUTBOX_FLUSH_ATTEMPTS = 100
        const val AUTH_LOST_MESSAGE = "Authentication was lost. Please sign in again."
        const val SESSION_REFRESH_UNAVAILABLE_MESSAGE =
            "Session could not be refreshed. Please try again."
    }
}

private class AuthenticationLostException : IllegalStateException(
    "Authentication was lost. Please sign in again.",
)
