package com.selffeed.android.data

import com.selffeed.android.data.repository.ArticleMutationReceipt
import com.selffeed.android.data.repository.LocalArticleState
import com.selffeed.android.data.repository.LibraryCounts
import com.selffeed.android.data.repository.AuthenticatedSession
import com.selffeed.android.data.repository.AccountAccess
import com.selffeed.android.di.ApplicationCoroutineScope
import com.selffeed.android.data.repository.BulkReadReconciliation
import android.content.Context
import androidx.paging.ExperimentalPagingApi
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.selffeed.android.data.local.LocalOwnerEntity
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
import com.selffeed.android.data.repository.ReadStateRejection
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.CategoryOrderUpdate
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException
import java.io.IOException
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
    @param:ApplicationCoroutineScope private val refreshScope: CoroutineScope,
) : SelfFeedRepository {
    private val preferencesMutex = Mutex()
    private val feedReadMutex = Mutex()
    private val categoryReadMutex = Mutex()
    private val statsReadMutex = Mutex()
    private val runtime = RepositoryRuntime(
        moshi = moshi,
        maxMemoryCacheEntries = MAX_MEMORY_CACHE_ENTRIES,
        logTag = "RssRepository",
        apiBaseUrl = sessionStore::getApiBaseUrl,
        cacheEpoch = { localStore.articleStateRetentionEpoch },
    )
    private val readStateStreamClient = ReadStateStreamClient(
        okHttpClient = okHttpClient,
        moshi = moshi,
        runtime = runtime,
    )

    private val savedStateRejectionEvents = MutableSharedFlow<SessionEvent<SavedStateRejection>>(extraBufferCapacity = 32)
    private val readStateRejectionEvents = MutableSharedFlow<SessionEvent<ReadStateRejection>>(extraBufferCapacity = 32)
    private val authLostEvents = MutableSharedFlow<SessionEvent<String>>(extraBufferCapacity = 1)
    private val analyticsSessionLock = Any()
    private val categoryCacheMutex = Mutex()
    private val libraryMetadataRevision = AtomicLong()
    private val completedArticleIds = mutableSetOf<String>()
    private var appOpenRecordedOn: String? = null
    private val account = AccountSessionBoundary(sessionStore, localStore, ::clearSessionMemory)
    private val articleStateFlushMutex = Mutex()
    private val articleStateProjectionMutex = Mutex()

    init {
        refreshScope.launch {
            networkMonitor.online.collect { online ->
                if (online) {
                    try { flushProductAnalyticsEvents() } catch (_: SessionChangedException) {
                        // A departing account cancels its flush, not this process-wide observer.
                    }
                }
            }
        }
    }

    override fun accountAccess(ownerId: String): AccountAccess = object : AccountAccess {
        override val ownerId = ownerId

        override fun isCurrent(): Boolean = sessionStore.loadedSession()?.ownerId == ownerId

        override suspend fun <T> withAccount(block: suspend () -> T): T {
            val expected = sessionStore.loadedSession()?.takeIf { it.ownerId == ownerId }
                ?: throw SessionChangedException()
            return account.withSession(expected) { block() }
        }
    }

    override fun isCurrentSession(session: ApiSession): Boolean = sessionStore.isCurrentSession(session)

    override fun getApiBaseUrl(): String = sessionStore.getApiBaseUrl()

    override suspend fun setApiBaseUrl(rawBaseUrl: String) = runtime.safeCall {
        account.replace { sessionStore.setApiBaseUrl(rawBaseUrl) }
    }

    override suspend fun registrationStatus() = safePublicCall { session ->
        authRemote.registrationStatus(session)
    }

    override suspend fun login(email: String, password: String) = authenticate { session ->
        authRemote.login(email, password, session)
    }

    override suspend fun register(email: String, password: String) = authenticate { session ->
        authRemote.register(email, password, session)
    }

    private suspend fun authenticate(
        request: suspend (ApiSession) -> com.selffeed.android.network.AuthResponse,
    ): AppResult<AuthenticatedSession.Verified> = runtime.safeCall {
        val session = account.replace { sessionStore.beginAuthentication() }
        account.withSession(session) {
            val response = request(session)
            account.commit(session) {
                check(sessionStore.setAccessTokenIfCurrent(session, response.tokens.accessToken)) { "Session changed" }
                bindVerifiedUser(session, response.user.id)
                sessionStore.recordAuthenticated()
            }
            recordAppOpen(session)
            flushProductAnalyticsEvents(session)
            AuthenticatedSession.Verified(session, response.user)
        }
    }

    // Called only inside the local commit boundary after a verified server response.
    private suspend fun bindVerifiedUser(session: ApiSession, userId: String) {
        localStore.switchOwner(LocalOwnerEntity(ownerId = session.ownerId, apiBaseUrl = session.apiBaseUrl, userId = userId))
    }

    override suspend fun restoreSession(): AppResult<AuthenticatedSession> = safeCall { session ->
        val (hasRefreshCookie, hasAccessToken) = account.commit(session) {
            !sessionStore.getRefreshCookie().isNullOrBlank() to !sessionStore.getAccessToken().isNullOrBlank()
        }
        check(hasRefreshCookie || hasAccessToken) { "No saved session" }
        val user = try {
            if (!hasAccessToken && hasRefreshCookie) {
                when (sessionRefreshCoordinator.refresh(session)) {
                    is SessionRefreshResult.Success -> Unit
                    SessionRefreshResult.Rejected -> throw AuthenticationLostException()
                    is SessionRefreshResult.Unavailable -> throw IllegalStateException(
                        "Unable to refresh session. Please check your connection.",
                    )
                }
            }
            withRetry(session) { authRemote.me(session) }
        } catch (error: Exception) {
            return@safeCall restoreOfflineSession(session, error)
        }
        val renewalFailure = account.commit(session) {
            // Identity violations must propagate, never become offline admission.
            bindVerifiedUser(session, user.id)
            try {
                sessionStore.recordAuthenticated()
                null
            } catch (error: java.io.IOException) {
                error
            }
        }
        if (renewalFailure != null) return@safeCall restoreOfflineSession(session, renewalFailure)
        recordAppOpen(session)
        flushProductAnalyticsEvents(session)
        AuthenticatedSession.Verified(session, user)
    }

    private suspend fun restoreOfflineSession(session: ApiSession, error: Exception): AuthenticatedSession.Offline {
        if (error is CancellationException || isAuthenticationLost(error)) throw error
        val allowed = account.commit(session) {
            isLoggedIn() && sessionStore.hasValidOfflineAccessLease()
        }
        if (!allowed) throw error
        recordOfflineRestore(session)
        return AuthenticatedSession.Offline(session)
    }

    override suspend fun logout(): AppResult<Boolean> = runtime.safeCall {
        val credentials = account.replace {
            Triple(sessionStore.currentSession(), sessionStore.getAccessToken(), sessionStore.getRefreshCookie())
                .also { sessionStore.clear() }
        }
        // Revocation carries the departed owner's explicit credentials and server.
        // It cannot delay local logout or acquire the next account's credentials.
        refreshScope.launch {
            runCatching { authRemote.logout(credentials.second, credentials.third, credentials.first) }
                .onFailure { runtime.debugLog("Remote logout could not be confirmed; local session was cleared") }
        }
        true
    }

    suspend fun prepareSession() { account.prepare() }

    /** Keeps one account owner across worker admission, delivery and polling. */
    internal suspend fun <T> withAuthenticatedAccount(block: suspend () -> T): T? = account.withSession {
        if (isLoggedIn()) block() else null
    }

    override suspend fun me() = safeReadCall { session ->
        runtime.cachedGet(key = "me", ttlMs = USER_TTL_MS) { withRetry(session) { authRemote.me(session = session) } }
    }

    override suspend fun changePassword(currentPassword: String, newPassword: String) = safeCall { session ->
        val response = authRemote.changePassword(currentPassword, newPassword, session = session)
        account.commit(session) {
            check(sessionStore.setAccessTokenIfCurrent(session, response.tokens.accessToken)) { "Session changed" }
            runtime.invalidateByPrefix("auth:sessions")
        }
        response.user
    }

    override fun categoryUpdates(): Flow<AppResult<List<CategoryWithCounts>>> = cachedReadUpdates(
        readCached = { session -> account.commit(session) { offlineReadStore.readCategories().takeIf { it.isNotEmpty() } } },
        fetch = ::fetchCategories,
    )

    override fun feedUpdates(): Flow<AppResult<List<FeedWithCounts>>> = cachedReadUpdates(
        readCached = { session -> account.commit(session) { offlineReadStore.readFeeds().takeIf { it.isNotEmpty() } } },
        fetch = { session -> fetchFeeds(null, session) },
    )

    override fun libraryCounts(): Flow<LibraryCounts> = flow {
        account.withSession { session ->
            localStore.observeLibraryCounts().collect { counts ->
                account.requireCurrent(session)
                emit(counts)
            }
        }
    }.catch { error ->
        if (error is CancellationException) throw error
        runtime.debugLog("Stored count observation unavailable")
    }

    override fun countRefreshRequests(): Flow<Unit> = flow {
        account.withSession { session ->
            localStore.observeCountRefreshRequests().collect {
                account.requireCurrent(session)
                emit(Unit)
            }
        }
    }.catch { error ->
        if (error is CancellationException) throw error
        runtime.debugLog("Stored count freshness unavailable")
        emit(Unit)
    }

    /** Stored content is usable while the collector awaits or cancels freshness work. */
    private fun <T : Any> cachedReadUpdates(
        readCached: suspend (ApiSession) -> T?,
        fetch: suspend (ApiSession) -> T,
    ): Flow<AppResult<T>> = flow {
        account.withSession { session ->
            val stored = (safeReadCall(session, readCached) as? AppResult.Success)?.data
            if (stored != null) emit(AppResult.Success(stored))
            val fresh = safeReadCall(session, fetch)
            when (fresh) {
                is AppResult.Success -> {
                    emit(AppResult.Success(fresh.data))
                }
                is AppResult.Error -> if (stored == null) emit(fresh)
            }
        }
    }

    override suspend fun categories() = safeReadCall { session ->
        categoryCacheMutex.withLock {
            runtime.getCached<List<CategoryWithCounts>>("categories")?.let {
                runtime.recordCacheHit()
                return@safeReadCall account.commit(session) { offlineReadStore.readCategories() }
            }

            val cachedCategories = account.commit(session) { offlineReadStore.readCategories() }
            if (cachedCategories.isNotEmpty()) {
                account.commit(session) { runtime.putCached("categories", CATEGORIES_TTL_MS, cachedCategories) }
                refreshCategoriesInBackground(session)
                return@safeReadCall cachedCategories
            }
        }

        try {
            fetchCategories(session)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            account.requireCurrent(session)
            account.commit(session) { offlineReadStore.readCategories() }.takeIf { it.isNotEmpty() } ?: throw e
        }
    }

    private suspend fun fetchCategories(session: ApiSession): List<CategoryWithCounts> = categoryReadMutex.withLock {
        fetchCategorySnapshot(session)
    }

    private suspend fun fetchCategorySnapshot(session: ApiSession): List<CategoryWithCounts> {
        while (true) {
            val revision = libraryMetadataRevision.get()
            val ticket = account.commit(session) { localStore.captureCountSnapshot() }
            val categories = withRetry(session) { feedRemote.categories(session = session) }
            val accepted = categoryCacheMutex.withLock {
                account.commit(session) {
                    if (revision != libraryMetadataRevision.get()) null else {
                        localStore.writeRemoteCategories(categories, ticket).also {
                            runtime.putCached("categories", CATEGORIES_TTL_MS, it)
                        }
                    }
                }
            }
            if (accepted != null) return accepted
        }
    }

    override suspend fun createCategory(name: String, parentCategoryId: String?) = safeCall { session ->
        feedRemote.createCategory(name, parentCategoryId, session = session).also {
            account.commit(session) {
                libraryMetadataRevision.incrementAndGet()
                runtime.invalidateByPrefix("categories")
                runtime.invalidateByPrefix("feeds")
            }
        }
    }

    override suspend fun updateCategory(id: String, name: String?, parentCategoryId: String?) =
        safeCall { session ->
            feedRemote.updateCategory(id, name, parentCategoryId, session = session).also {
                invalidateFeedAndArticleCaches(session)
            }
        }

    override suspend fun reorderCategories(updates: List<CategoryOrderUpdate>) = safeCall { session ->
        check(feedRemote.reorderCategories(updates, session = session) == updates.size) { "Category order was not fully saved" }
        categoryCacheMutex.withLock {
            account.commit(session) {
                libraryMetadataRevision.incrementAndGet()
                localStore.reorderCategories(updates)
                runtime.invalidateByPrefix("categories")
            }
        }
    }

    override suspend fun deleteCategory(id: String) = safeCall { session ->
        feedRemote.deleteCategory(id, session = session).also {
            invalidateFeedAndArticleCaches(session) { localStore.removeCategoryMetadata(id) }
        }
    }

    override suspend fun feeds(categoryId: String?) = safeReadCall { session ->
        val key = "feeds:${categoryId.orEmpty()}"
        runtime.getCached<List<FeedWithCounts>>(key)?.let {
            runtime.recordCacheHit()
            return@safeReadCall filterCachedFeeds(account.commit(session) { offlineReadStore.readFeeds() }, categoryId, session)
        }

        val cachedFeeds = account.commit(session) { offlineReadStore.readFeeds() }
        if (cachedFeeds.isNotEmpty()) {
            val filtered = filterCachedFeeds(cachedFeeds, categoryId, session)
            if (filtered.isNotEmpty()) {
                account.commit(session) { runtime.putCached(key, FEEDS_TTL_MS, filtered) }
                refreshFeedsInBackground(categoryId, session)
                return@safeReadCall filtered
            }
        }

        try {
            runtime.cachedGet(key = key, ttlMs = FEEDS_TTL_MS) {
                fetchFeeds(categoryId, session)
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            account.requireCurrent(session)
            val cached = account.commit(session) { offlineReadStore.readFeeds() }
            val filtered = filterCachedFeeds(cached, categoryId, session)
            filtered.takeIf { it.isNotEmpty() } ?: throw e
        }
    }

    override suspend fun refreshFeeds(categoryId: String?) = safeReadCall { session ->
        fetchFeeds(categoryId, session)
    }

    override suspend fun createFeed(feedUrl: String, categoryId: String, title: String?) =
        safeCall { session ->
            feedRemote.createFeed(feedUrl, categoryId, title, session = session).also {
                invalidateFeedAndArticleCaches(session)
            }
        }

    override suspend fun updateFeed(
        id: String,
        feedUrl: String?,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?
    ) = safeCall { session ->
        feedRemote.updateFeed(id, feedUrl, categoryId, title, pollingIntervalMinutes, session = session).also {
            invalidateFeedAndArticleCaches(session)
        }
    }

    override suspend fun deleteFeed(id: String) = safeCall { session ->
        feedRemote.deleteFeed(id, session = session).also {
            invalidateFeedAndArticleCaches(session) { localStore.removeFeedMetadata(id) }
        }
    }

    override suspend fun syncFeed(id: String) = safeCall { session ->
        feedRemote.syncFeed(id, session = session).also {
            invalidateFeedAndArticleCaches(session)
        }
    }

    override suspend fun syncAllFeeds(feedId: String?, categoryId: String?) = safeCall { session ->
        val response = feedRemote.syncAllFeeds(feedId, categoryId, session = session)
        if (response.requestId != null) {
            account.commit(session) { sessionStore.setFeedRefreshRequestId(response.requestId) }
        }
        response
    }

    override suspend fun syncAllFeedsStatus(requestId: String?) = safeReadCall { session ->
        val trackedRequestId =
            requestId ?: sessionStore.getFeedRefreshRequestId()?.takeIf(String::isNotBlank)
        val trackedStatus = feedRemote.syncAllFeedsStatus(trackedRequestId, session = session)
        val status = if (trackedRequestId != null && trackedStatus.requestId != trackedRequestId) {
            account.commit(session) { sessionStore.setFeedRefreshRequestId(null) }
            feedRemote.syncAllFeedsStatus(null, session = session)
        } else trackedStatus
        if (status.active && status.requestId != null) {
            account.commit(session) { sessionStore.setFeedRefreshRequestId(status.requestId) }
        }
        if (!status.active) invalidateFeedAndArticleRuntimeCaches(session)
        status
    }

    override suspend fun feedSyncHistory(feedId: String) = safeReadCall { session ->
        feedRemote.feedSyncHistory(feedId, session = session)
    }

    override suspend fun selectDiscoveryCandidate(candidateId: String) = safeCall { session ->
        val selection = feedRemote.selectDiscoveryCandidate(candidateId, session = session)
        account.commit(session) { sessionStore.setFeedRefreshRequestId(selection.requestId) }
        feedRemote.feeds(null, session = session).first { it.id == selection.feedId }.also {
            invalidateFeedAndArticleCaches(session)
        }
    }

    override suspend fun cancelFeedReplacement(feedId: String) = safeCall { session ->
        feedRemote.cancelFeedReplacement(feedId, session = session).also { invalidateFeedAndArticleCaches(session) }
    }

    override suspend fun importOpml(fileName: String, fileBytes: ByteArray) = safeCall { session ->
        val body = fileBytes.toRequestBody("application/xml".toMediaType())
        val part = MultipartBody.Part.createFormData("file", fileName, body)
        feedRemote.importOpml(part, session = session).also {
            invalidateFeedAndArticleCaches(session)
        }
    }

    override suspend fun exportOpml() = safeReadCall { session ->
        runtime.cachedGet(key = "opml:export", ttlMs = OPML_EXPORT_TTL_MS) {
            val response = withRetry(session) { feedRemote.exportOpml(session = session) }
            if (!response.isSuccessful) throw HttpException(response)
            response.body()?.string().orEmpty()
        }
    }

    @OptIn(ExperimentalPagingApi::class)
    override fun articlePagingData(
        query: ArticlePageQuery,
    ): Flow<PagingData<ArticleListItem>> {
        val queryKey = query.remoteKey()
        val expected = sessionStore.loadedSession()
        return flow {
            account.withSession(expected) { session ->
                emitAll(
                    Pager(
                        config = PagingConfig(
                            pageSize = ARTICLE_PAGE_SIZE,
                            initialLoadSize = ARTICLE_PAGE_SIZE,
                            prefetchDistance = ARTICLE_PAGING_PREFETCH_DISTANCE,
                            enablePlaceholders = false,
                        ),
                        remoteMediator = ArticleRemoteMediator(
                            forceInitialRefresh = query.generation > 0L,
                            readRemoteKey = { account.commit(session) { localStore.readArticleRemoteKey(queryKey) } },
                            onCompletedRefresh = {
                                if (query.savedOnly) reconcileSavedArticles(queryKey, session) else AppResult.Success(Unit)
                            },
                            loadAndStorePage = { limit, cursor, clearExisting ->
                                safeReadCall(session) {
                                    fetchArticleSnapshot(
                                        session,
                                        fetch = {
                                            withRetry(session) {
                                                articleRemote.articles(
                                                    feedId = query.feedId,
                                                    categoryId = query.categoryId,
                                                    unreadOnly = query.unreadOnly,
                                                    savedOnly = query.savedOnly,
                                                    sort = query.sort,
                                                    limit = limit,
                                                    cursor = cursor,
                                                    session = session,
                                                )
                                            }
                                        },
                                    ) { payload ->
                                        val effective = localStore.writeArticleRemotePage(queryKey, payload, clearExisting)
                                        effective.forEach { projectCachedArticleState(it.id) }
                                        payload
                                    }
                                }
                            },
                        ),
                        pagingSourceFactory = {
                            if (query.savedOnly) localStore.savedArticlePagingSource(session.ownerId)
                            else localStore.articlePagingSource(queryKey, session.ownerId)
                        },
                    ).flow,
                )
            }
        }
    }

    /** Missing list membership needs confirmation because saved state can change between pages. */
    internal suspend fun reconcileSavedArticles(
        queryKey: String,
        expected: ApiSession? = sessionStore.loadedSession(),
    ): AppResult<Unit> = safeReadCall(expected) { session ->
        val missing = account.commit(session) { localStore.savedArticlesMissingFromQuery(queryKey) }
        for (batch in missing.chunked(4)) {
            fetchArticleSnapshot(
                session,
                fetch = {
                    coroutineScope {
                        batch.map { snapshot ->
                            async {
                                val detail = try {
                                    withRetry(session) { articleRemote.article(snapshot.articleId, session = session) }
                                } catch (error: HttpException) {
                                    if (error.code() == 404) null else throw error
                                }
                                snapshot to detail
                            }
                        }.awaitAll()
                    }
                },
            ) { confirmed ->
                for ((snapshot, detail) in confirmed) {
                    if (detail == null) {
                        if (localStore.clearSavedStateIfUnchanged(snapshot)) {
                            val key = "article:${snapshot.articleId}"
                            runtime.getCached<ArticleDetail>(key)?.let { cached ->
                                runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, cached.copy(isSaved = false))
                            }
                        }
                    } else {
                        localStore.updateArticleSavedState(snapshot.articleId, detail.isSaved, detail.savedRevision)
                    }
                    projectCachedArticleState(snapshot.articleId)
                }
                runtime.invalidateByPrefix("search")
            }
        }
    }

    override suspend fun article(articleId: String, forceRefresh: Boolean) = safeReadCall { session ->
        if (forceRefresh) {
            return@safeReadCall try {
                fetchAndStoreArticle(articleId, session)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                account.requireCurrent(session)
                articleStateProjectionMutex.withLock {
                    account.commit(session) {
                        offlineReadStore.readArticleDetail(articleId)?.let { localStore.applyPendingArticleState(it) }
                            ?: runtime.getCached<ArticleDetail>("article:$articleId")
                    }
                } ?: throw error
            }
        }

        // Fast path: in-memory hit. Instant.
        articleStateProjectionMutex.withLock {
            runtime.getCached<ArticleDetail>("article:$articleId")?.let { return@safeReadCall it }
        }

        // Warm path: durable offline storage has a fresh copy. Return it
        // now and refresh from the network in the background so the reader
        // opens instantly for any article the user has ever opened. The
        // background refresh updates the in-memory cache and durable store
        // on success; on failure the cached copy stays valid until its own
        // expiry.
        val cachedDetail = articleStateProjectionMutex.withLock {
            account.commit(session) {
                offlineReadStore.readArticleDetail(articleId)?.let { cached ->
                    localStore.applyPendingArticleState(cached).also { projected ->
                        runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, projected)
                    }
                }
            }
        }
        if (cachedDetail != null) {
            // Detached background refresh — does not block the caller.
            // We swallow the result here on purpose: the caller already
            // has a usable ArticleDetail. Errors are surfaced on the next
            // explicit open or pull-to-refresh.
            backgroundRefreshArticle(articleId, session = session)
            return@safeReadCall cachedDetail
        }

        // Cold path: nothing in memory or durable storage. Hit the network.
        try {
            fetchAndStoreArticle(articleId, session)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            account.requireCurrent(session)
            account.commit(session) { offlineReadStore.readArticleDetail(articleId) } ?: throw e
        }
    }

    override fun observeArticleStates(articleIds: Set<String>): Flow<AppResult<Map<String, LocalArticleState>>> {
        val ids = articleIds.toSet()
        val expected = sessionStore.loadedSession()
        return flow<AppResult<Map<String, LocalArticleState>>> {
            account.withSession(expected) { session ->
                localStore.observeArticleStates(ids, session.ownerId).collect { states ->
                    account.requireCurrent(session)
                    emit(AppResult.Success(states))
                }
            }
        }.catch { error ->
            if (error is CancellationException) throw error
            emit(AppResult.Error("Stored article state unavailable", error))
        }
    }

    override suspend fun refreshArticleStates(articleIds: Set<String>): AppResult<Unit> {
        val batches = articleIds.toList().chunked(ArticleRemoteDataSource.STATE_LOOKUP_BATCH_SIZE)
        return safeReadCall { session ->
            batches.forEach { ids ->
                fetchArticleSnapshot(session, fetch = { withRetry(session) { articleRemote.articleStates(ids, session) } }) { response ->
                    localStore.reconcileArticleStates(response.states).forEach { projectCachedArticleState(it) }
                    // Missing IDs do not revoke cached content or discard pending user choices.
                }
            }
        }
    }

    override suspend fun localArticleState(articleId: String) = safeReadCall { session ->
        account.commit(session) { localStore.readArticleState(articleId) }
    }

    suspend fun article(articleId: String): AppResult<ArticleDetail> =
        article(articleId, forceRefresh = false)

    private fun backgroundRefreshArticle(articleId: String, cacheImages: Boolean = false, session: ApiSession) {
        refreshScope.launch {
            safeReadCall(session) {
                val detail = fetchAndStoreArticle(articleId, session)
                if (cacheImages) account.commit(session) { cacheArticleImages(detail) }
            }
        }
    }

    private fun refreshCategoriesInBackground(session: ApiSession) {
        refreshScope.launch { safeReadCall(session) { fetchCategories(session) } }
    }

    private fun refreshFeedsInBackground(categoryId: String?, session: ApiSession) {
        refreshScope.launch {
            safeReadCall(session) {
                fetchFeeds(categoryId, session)
            }
        }
    }

    private fun refreshPreferencesInBackground(session: ApiSession) {
        refreshScope.launch {
            safeReadCall(session) {
                preferencesMutex.withLock {
                    val preferences = withRetry(session) { settingsRemote.preferences(session) }
                    account.commit(session) {
                        localStore.writePreferences(preferences)
                        runtime.putCached("preferences", PREFERENCES_TTL_MS, preferences)
                    }
                }
            }
        }
    }

    override fun cachedArticleDetail(articleId: String): ArticleDetail? =
        account.readCurrentMemory { runtime.getCached("article:$articleId") }

    override suspend fun readCachedArticleDetail(articleId: String): ArticleDetail? = account.withSession { session ->
        account.commit(session) { localStore.readArticleDetail(articleId) }?.let { account.commit(session) { localStore.applyPendingArticleState(it) } }
    }

    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> =
        article(articleId)

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        safeReadCall { session ->
            fetchAndStoreArticle(articleId, session)
        }

    private suspend fun fetchAndStoreArticle(articleId: String, session: ApiSession): ArticleDetail {
        return fetchArticleSnapshot(session, fetch = { withRetry(session) { articleRemote.article(articleId, session = session) } }) { remoteDetail ->
            offlineReadStore.writeArticleDetail(remoteDetail)
            localStore.applyPendingArticleState(remoteDetail).also { detail ->
                runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
            }
        }
    }

    /** Evicting revision history also retires snapshots dispatched under that history. */
    private suspend fun <Remote, Result : Any> fetchArticleSnapshot(
        session: ApiSession,
        fetch: suspend () -> Remote,
        accept: suspend (Remote) -> Result,
    ): Result {
        repeat(3) {
            val epoch = localStore.articleStateRetentionEpoch
            val payload = fetch()
            val accepted = articleStateProjectionMutex.withLock {
                account.commit(session) {
                    localStore.acceptArticleSnapshot(epoch) { accept(payload) }
                }
            }
            if (accepted != null) return accepted
        }
        throw IOException("Article state changed while loading. Please try again.")
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

    override suspend fun enrichArticle(articleId: String, invalidateCaches: Boolean) = safeCall { session ->
        articleRemote.enrichArticle(articleId, session = session).also {
            if (it.success || it.reason == "already_enriched") {
                if (invalidateCaches) {
                    invalidateArticleDetailCache(articleId, session)
                } else {
                    invalidateArticleDetailCache(articleId, session)
                }
            }
        }
    }

    suspend fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> =
        enrichArticle(articleId, invalidateCaches = true)

    /** Returns the committed local choice; delivery and its transport IDs belong to the worker. */
    override suspend fun markRead(articleId: String, read: Boolean, source: String) = safeCall { session ->
        withContext(NonCancellable) {
            val receipt = articleStateProjectionMutex.withLock {
                account.commit(session) {
                    val pending = localStore.queueReadStateMutation(articleId, read, source)
                    val key = "article:$articleId"
                    runtime.getCached<ArticleDetail>(key)?.let { previous ->
                        runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, previous.copy(isRead = read))
                    }
                    ArticleMutationReceipt(pending.mutationId)
                }
            }
            // Scheduling failure cannot turn a committed choice into an error.
            scheduleArticleStateDelivery()
            receipt
        }
    }

    suspend fun markRead(articleId: String, read: Boolean): AppResult<ArticleMutationReceipt> =
        markRead(articleId, read, source = "manual")

    override suspend fun markAllRead(feedId: String?, categoryId: String?) = safeCall { session ->
        articleRemote.markAllRead(feedId, categoryId, session = session).also {
            account.commit(session) {
                localStore.invalidateCountSnapshots()
                localStore.clearAcknowledgedReadStateOverrides()
                runtime.invalidateByPrefix("feeds")
                runtime.invalidateByPrefix("categories")
                runtime.invalidateByPrefix("search")
            }
        }
    }

    override fun savedStateRejections(): Flow<SavedStateRejection> = savedStateRejectionEvents.mapNotNull { event ->
        event.value.takeIf { sessionStore.isCurrentSession(event.session) }
    }

    override fun readStateRejections(): Flow<ReadStateRejection> = readStateRejectionEvents.mapNotNull { event ->
        event.value.takeIf { sessionStore.isCurrentSession(event.session) }
    }

    override suspend fun setSaved(articleId: String, saved: Boolean) = safeCall { session ->
        val (receipt, previous) = withContext(NonCancellable) {
            val committed = articleStateProjectionMutex.withLock {
                account.commit(session) {
                    val pending = localStore.queueSavedStateMutation(articleId, saved)
                    val key = "article:$articleId"
                    val cached = runtime.getCached<ArticleDetail>(key)?.also {
                        runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, it.copy(isSaved = saved))
                    }
                    runtime.invalidateByPrefix("articles")
                    runtime.invalidateByPrefix("search")
                    ArticleMutationReceipt(pending.mutationId) to cached
                }
            }
            scheduleArticleStateDelivery()
            committed
        }
        if (saved) {
            if (previous == null) backgroundRefreshArticle(articleId, cacheImages = true, session = session)
            else refreshScope.launch {
                safeReadCall(session) {
                    account.commit(session) { cacheArticleImages(previous.copy(isSaved = true)) }
                }
            }
        }
        receipt
    }

    suspend fun markAllRead() = markAllRead(feedId = null, categoryId = null)

    override fun clientId(): String = sessionStore.getClientId()

    override fun readStateEvents(): Flow<ReadStateSyncEvent> {
        val expected = sessionStore.loadedSession()
        return flow {
            account.withSession(expected) { session ->
                readStateStreamClient.events(session, ::isLoggedIn).collect { event ->
                    account.requireCurrent(session)
                    emit(event)
                }
            }
        }
    }

    override suspend fun search(query: String, categoryId: String?, cursor: String?) =
        safeReadCall { session ->
            val cacheKey = if (cursor.isNullOrBlank()) "search:${query.trim().lowercase()}:${categoryId.orEmpty()}:" else null
            suspend fun fetch(): SearchSnapshot = fetchArticleSnapshot(
                session,
                fetch = { withRetry(session) { searchRemote.search(query, categoryId, cursor, session = session) } },
            ) { payload ->
                localStore.reconcileArticleSnapshots(payload.data)
                payload.data.forEach { projectCachedArticleState(it.id) }
                // Admission may prune older history. Its own result belongs to the resulting epoch.
                SearchSnapshot(payload, localStore.articleStateRetentionEpoch).also { snapshot ->
                    cacheKey?.let { runtime.putCached(it, SEARCH_TTL_MS, snapshot) }
                }
            }
            try {
                repeat(3) {
                    val snapshot = if (cacheKey == null) fetch() else {
                        runtime.cachedGet(key = cacheKey, ttlMs = SEARCH_TTL_MS) { fetch() }
                    }
                    val projected = articleStateProjectionMutex.withLock {
                        account.commit(session) {
                            localStore.acceptArticleSnapshot(snapshot.epoch) {
                                // Cached server facts are projected, never admitted as a fresh response.
                                snapshot.payload.copy(data = localStore.projectArticleSnapshots(snapshot.payload.data))
                            }
                        }
                    }
                    if (projected != null) return@safeReadCall projected
                }
                throw IOException("Article state changed while searching. Please try again.")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                account.requireCurrent(session)
                // A later page cannot restart the first local page under an old cursor.
                if (!cursor.isNullOrBlank()) throw error
                val cached = account.commit(session) { localStore.searchArticles(query, categoryId) }
                if (cached.isEmpty()) throw error
                ApiListResponse(data = cached, cursor = null, hasMore = false)
            }
        }

    suspend fun search(query: String): AppResult<ApiListResponse<ArticleListItem>> =
        search(query = query, categoryId = null, cursor = null)

    override suspend fun preferences() = safeReadCall { session ->
        preferencesMutex.withLock {
            account.commit(session) { localStore.readPreferences() }?.let { cached ->
                refreshPreferencesInBackground(session)
                return@withLock cached
            }
            runtime.cachedGet(key = "preferences", ttlMs = PREFERENCES_TTL_MS) {
                withRetry(session) { settingsRemote.preferences(session = session) }.also {
                    account.commit(session) { localStore.writePreferences(it) }
                }
            }
        }
    }

    override suspend fun updatePreferences(request: UpdatePreferencesRequest) = safeCall { session ->
        preferencesMutex.withLock {
            settingsRemote.updatePreferences(request, session = session).also {
                account.commit(session) {
                    localStore.writePreferences(it)
                    runtime.invalidateByPrefix("preferences")
                    runtime.invalidateByPrefix("articles")
                    runtime.invalidateByPrefix("search")
                }
            }
        }
    }

    override suspend fun stats() = safeReadCall { session -> statsReadMutex.withLock {
        val stored = account.commit(session) { localStore.readStats() }
        val ticket = account.commit(session) { localStore.captureCountSnapshot() }
        try {
            val remote = withRetry(session) { settingsRemote.stats(session = session) }
            account.commit(session) { localStore.writeRemoteStats(remote, ticket) }
                ?: throw IllegalStateException("Stats will be available after pending changes are synchronized")
        } catch (error: Exception) {
            if (error is CancellationException || isAuthenticationLost(error)) throw error
            account.requireCurrent(session)
            account.commit(session) { localStore.readStats() } ?: stored ?: throw error
        }
    }

    }

    override suspend fun authSessions() = safeReadCall { session ->
        runtime.cachedGet(key = "auth:sessions", ttlMs = AUTH_SESSIONS_TTL_MS) {
            withRetry(session) { settingsRemote.authSessions(session = session) }
        }
    }

    override suspend fun revokeAuthSession(id: String) = safeCall { session ->
        settingsRemote.revokeAuthSession(id, session = session).also {
            account.commit(session) { runtime.invalidateByPrefix("auth:sessions") }
        }
    }

    override suspend fun adminSettings() = safeReadCall { session ->
        runtime.cachedGet(
            key = "admin:settings",
            ttlMs = ADMIN_SETTINGS_TTL_MS
        ) { withRetry(session) { settingsRemote.adminSettings(session = session) } }
    }

    override suspend fun updateAdminSettings(registrationLocked: Boolean) = safeCall { session ->
        settingsRemote.updateAdminSettings(registrationLocked, session = session).also {
            account.commit(session) { runtime.invalidateByPrefix("admin:settings") }
        }
    }

    override suspend fun adminUsers() = safeReadCall { session ->
        settingsRemote.adminUsers(session = session).users
    }

    override suspend fun adminCreateUser(email: String, password: String, role: String) = safeCall { session ->
        settingsRemote.adminCreateUser(email, password, role, session = session)
    }

    override suspend fun adminUpdateUser(id: String, role: String?, isActive: Boolean?) = safeCall { session ->
        settingsRemote.adminUpdateUser(id, role, isActive, session = session)
    }

    override suspend fun adminResetPassword(id: String, password: String) = safeCall { session ->
        settingsRemote.adminResetPassword(id, password, session = session)
    }

    override fun isLoggedIn(): Boolean =
        !sessionStore.getRefreshCookie().isNullOrBlank() || !sessionStore.getAccessToken()
            .isNullOrBlank()

    override fun authEvents(): Flow<String> = authLostEvents.mapNotNull { event ->
        event.value.takeIf { sessionStore.isCurrentSession(event.session) }
    }

    private suspend fun recordOfflineRestore(session: ApiSession) {
        runtime.safeCall {
            recordAppOpen(session)
            account.commit(session) { sessionStore.enqueueProductAnalyticsEvent("offline_restore") }
            flushProductAnalyticsEvents(session)
        }
    }

    override suspend fun recordArticleCompletion(articleId: String) {
        safePublicCall { session ->
            account.commit(session) {
                val alreadyRecorded = synchronized(analyticsSessionLock) { articleId in completedArticleIds }
                if (!alreadyRecorded) {
                    sessionStore.enqueueProductAnalyticsEvent("article_completed")
                    synchronized(analyticsSessionLock) { completedArticleIds.add(articleId) }
                }
            }
            flushProductAnalyticsEvents(session)
        }
    }

    override fun observePendingArticleChanges(): Flow<Int> {
        val expected = sessionStore.loadedSession()
        return flow {
            account.withSession(expected) { emitAll(localStore.observePendingArticleChanges()) }
        }
    }

    override fun observeArticleTextAvailability(articleId: String): Flow<Boolean> {
        val expected = sessionStore.loadedSession()
        return flow {
            account.withSession(expected) {
                emitAll(localStore.observeArticleTextAvailability(articleId))
            }
        }
    }

    override suspend fun retryPendingArticleChanges() {
        account.withSession { session ->
            val authenticated = account.commit(session) { isLoggedIn() }
            if (authenticated) ArticleStateSyncWorker.kickOnce(imageRequestContext)
        }
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

    private suspend fun <T> safeReadCall(
        expected: ApiSession? = sessionStore.loadedSession(),
        block: suspend (ApiSession) -> T,
    ): AppResult<T> = safeCall(expected, block)

    private suspend fun <T> safeCall(
        expected: ApiSession? = sessionStore.loadedSession(),
        block: suspend (ApiSession) -> T,
    ): AppResult<T> {
        var owner: ApiSession? = null
        val result = runtime.safeCall {
            account.withSession(expected) { session -> owner = session; block(session) }
        }
        if (result is AppResult.Error) {
            val session = owner ?: return result
            account.requireCurrent(session)
            if (isAuthenticationLost(result.cause)) {
                // Clearing retires the caller too. Publish before cancellation can
                // resume it out of Room's final transaction handoff.
                withContext(NonCancellable) {
                    account.clearIfCurrent(session)?.let { cleared ->
                        authLostEvents.tryEmit(SessionEvent(cleared, AUTH_LOST_MESSAGE))
                    }
                }
                return AppResult.Error(AUTH_LOST_MESSAGE, result.cause)
            }
            if ((result.cause as? HttpException)?.code() == 401) {
                return AppResult.Error(SESSION_REFRESH_UNAVAILABLE_MESSAGE, result.cause)
            }
        }
        return result
    }

    private fun isAuthenticationLost(cause: Throwable?): Boolean =
        cause is AuthenticationLostException ||
            ((cause as? HttpException)?.code() == 401 && sessionRefreshCoordinator.hasRecentRefreshRejection())

    private suspend fun <T> safePublicCall(
        expected: ApiSession? = sessionStore.loadedSession(),
        block: suspend (ApiSession) -> T,
    ): AppResult<T> = runtime.safeCall { account.withSession(expected, block) }

    private suspend fun <T> withRetry(session: ApiSession, block: suspend () -> T): T = runtime.withRetry {
        currentCoroutineContext().ensureActive()
        account.requireCurrent(session)
        block().also {
            currentCoroutineContext().ensureActive()
            account.requireCurrent(session)
        }
    }

    private suspend fun flushProductAnalyticsEvents(expected: ApiSession? = sessionStore.loadedSession()) {
        if (!networkMonitor.online.value || !isLoggedIn()) return
        safeCall(expected) { session ->
            if (!networkMonitor.online.value || !isLoggedIn()) return@safeCall
            val pending = account.commit(session) { sessionStore.pendingProductAnalyticsEvents() }
            if (pending.isEmpty()) return@safeCall
            settingsRemote.recordProductAnalyticsEvents(RecordProductAnalyticsEventsRequest(pending), session)
            account.commit(session) { sessionStore.removeProductAnalyticsEvents(pending.mapTo(mutableSetOf()) { it.id }) }
        }
    }

    private suspend fun recordAppOpen(session: ApiSession) {
        runtime.safeCall {
            account.commit(session) {
                val today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString()
                val alreadyRecorded = synchronized(analyticsSessionLock) { appOpenRecordedOn == today }
                if (!alreadyRecorded) {
                    sessionStore.enqueueProductAnalyticsEvent("app_opened")
                    synchronized(analyticsSessionLock) { appOpenRecordedOn = today }
                }
            }
        }
    }

    suspend fun invalidateArticleCaches(articleId: String) = account.withSession { session ->
        // Targeted invalidation for a single markRead. The SSE read-state
        // event handles the in-memory `state.articles` patch, so we
        // don't need to blow away every cached list here. We only drop
        // the article detail and the stats aggregate; feeds/categories
        // are refreshed lazily on the next unread-count read.
        invalidateArticleDetailCache(articleId, session)
    }

    private suspend fun invalidateArticleDetailCache(articleId: String, session: ApiSession) {
        account.commit(session) { runtime.invalidateByPrefix("article:$articleId") }
        // Keep the durable copy as a stale fallback until a successful fetch
        // replaces it. Realtime invalidation is only a freshness hint and can
        // arrive immediately before connectivity is lost.
    }

    override suspend fun invalidateReadStateCaches(articleId: String?) = account.withSession { session ->
        // Read state is an overlay; never evict immutable article content or
        // the visible list for a receipt arriving from another client.
        account.commit(session) {
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("categories")
        }
    }

    override suspend fun invalidateArticleContentCaches(articleId: String?) = account.withSession { session ->
        if (articleId != null) {
            invalidateArticleDetailCache(articleId, session)
        } else {
            account.commit(session) { runtime.invalidateByPrefix("article:") }
        }
        account.commit(session) {
            runtime.invalidateByPrefix("articles")
            runtime.invalidateByPrefix("search")
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("categories")
        }
        // Realtime availability is a hint for the next explicit refresh.
        // Clearing Room here invalidates the active PagingSource and briefly
        // replaces the user's queue with an empty list while they are reading.
        // The manual refresh RemoteMediator transaction will replace the
        // durable query rows atomically when the user asks for fresh content.
    }

    /** Called inside an account commit, after Room has reconciled the server response. */
    private suspend fun projectCachedArticleState(articleId: String) {
        val key = "article:$articleId"
        runtime.getCached<ArticleDetail>(key)?.let { cached ->
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, localStore.applyPendingArticleState(cached))
        }
    }

    override suspend fun updateCachedReadState(articleId: String, read: Boolean, revision: Int?): Boolean? = account.withSession { session ->
        articleStateProjectionMutex.withLock {
            account.commit(session) {
                val visibleState = localStore.updateArticleReadState(articleId, read, revision)
                projectCachedArticleState(articleId)
                visibleState
            }
        }
    }

    override suspend fun updateCachedSavedState(articleId: String, saved: Boolean, revision: Int?) = account.withSession { session ->
        articleStateProjectionMutex.withLock {
            account.commit(session) {
                localStore.updateArticleSavedState(articleId, saved, revision)
                projectCachedArticleState(articleId)
                runtime.invalidateByPrefix("articles")
                runtime.invalidateByPrefix("search")
            }
        }
    }

    override suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>): BulkReadReconciliation = account.withSession { session ->
        val reconciliation = account.commit(session) {
            runtime.invalidateByPrefix("search")
            localStore.markArticlesReadByFeeds(feedIds).also { result ->
                result.affectedArticleIds.forEach { projectCachedArticleState(it) }
            }
        }
        reconciliation
    }

    private fun clearSessionMemory() {
        synchronized(analyticsSessionLock) {
            completedArticleIds.clear()
            appOpenRecordedOn = null
        }
        runtime.clearCache()
    }

    private suspend fun invalidateFeedAndArticleCaches(session: ApiSession, updateMetadata: suspend () -> Unit = {}) {
        account.commit(session) {
            libraryMetadataRevision.incrementAndGet()
            updateMetadata()
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("articles")
            runtime.invalidateByPrefix("search")
            runtime.invalidateByPrefix("categories")
            runtime.invalidateByPrefix("article:")
            // Keep unrelated count baselines and queued intents when membership changes.
            offlineReadStore.clearArticleLists()
        }
    }

    /**
     * Marks network-derived values stale without deleting the Room Paging
     * source currently on screen. A completed background sync is followed by
     * an explicit Pager refresh that replaces query rows transactionally.
     */
    private suspend fun invalidateFeedAndArticleRuntimeCaches(session: ApiSession) {
        account.commit(session) {
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("articles")
            runtime.invalidateByPrefix("search")
            runtime.invalidateByPrefix("categories")
        }
    }

    private fun scheduleArticleStateDelivery() {
        // The application owns scheduling after Room accepts the edit. A slow
        // WorkManager query must not hold the caller's durable receipt.
        refreshScope.launch {
            try {
                ArticleStateSyncWorker.kickOnce(imageRequestContext)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                runtime.debugLog("Outbox scheduling unavailable; durable intent will be recovered on startup")
            }
        }
    }

    // Explicit delivery joins one drain and uses normal authenticated error handling.
    suspend fun flushPendingArticleStateMutations(): Boolean = when (val result = safeCall { session ->
        articleStateFlushMutex.withLock { drainPendingArticleStateMutations(session) }
    }) {
        is AppResult.Success -> result.data
        is AppResult.Error -> false
    }

    private suspend fun drainPendingArticleStateMutations(session: ApiSession): Boolean {
        if (!networkMonitor.online.value) return false
        repeat(MAX_OUTBOX_FLUSH_ATTEMPTS) {
            val read = account.commit(session) { localStore.readPendingReadStateMutations() }.firstOrNull()
            val saved = account.commit(session) { localStore.readPendingSavedStateMutations() }.firstOrNull()
            if (read == null && saved == null) return true
            try {
                if (saved == null || (read != null && read.updatedAt <= saved.updatedAt)) {
                    val mutation = requireNotNull(read)
                    if (mutation.mutationId.isBlank()) {
                        account.commit(session) { localStore.rebaseReadStateMutation(mutation, mutation.baseRevision ?: 0) }
                        return@repeat
                    }
                    val response = withRetry(session) {
                        articleRemote.markRead(
                            articleId = mutation.articleId,
                            read = mutation.read,
                            source = mutation.source,
                            mutationId = mutation.mutationId,
                            baseRevision = mutation.baseRevision,
                            session = session,
                        )
                    }
                    if (response.conflict) {
                        account.commit(session) {
                            localStore.rebaseReadStateMutation(mutation, response.revision, response.read)
                            projectCachedArticleState(mutation.articleId)
                        }
                    } else {
                        val authoritative = response.read ?: mutation.read
                        articleStateProjectionMutex.withLock {
                            account.commit(session) {
                                localStore.acknowledgeReadStateMutation(mutation, authoritative, response.revision)
                                projectCachedArticleState(mutation.articleId)
                            }
                        }
                    }
                } else {
                    val mutation = saved
                    val response = withRetry(session) {
                        articleRemote.setSaved(
                            articleId = mutation.articleId,
                            saved = mutation.saved,
                            mutationId = mutation.mutationId,
                            baseRevision = mutation.baseRevision,
                            session = session,
                        )
                    }
                    if (response.conflict) {
                        account.commit(session) {
                            localStore.rebaseSavedStateMutation(mutation, response.revision, response.saved)
                            projectCachedArticleState(mutation.articleId)
                        }
                    } else {
                        val authoritative = response.saved ?: mutation.saved
                        articleStateProjectionMutex.withLock {
                            account.commit(session) {
                                localStore.acknowledgeSavedStateMutation(mutation, authoritative, response.revision)
                                projectCachedArticleState(mutation.articleId)
                            }
                        }
                    }
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                account.requireCurrent(session)
                val status = (error as? HttpException)?.code()
                if (status == 401) {
                    if (sessionRefreshCoordinator.hasRecentRefreshRejection()) throw error
                    runtime.debugLog("Offline mutation flush paused until session refresh is available")
                    return false
                }
                if (status != null && !isRetriableMutationStatus(status)) {
                    if (read != null && (saved == null || read.updatedAt <= saved.updatedAt)) {
                        articleStateProjectionMutex.withLock {
                            account.commit(session) {
                                val rejected = localStore.discardReadStateMutation(read)
                                if (rejected != null) {
                                    projectCachedArticleState(read.articleId)
                                    readStateRejectionEvents.tryEmit(SessionEvent(session, ReadStateRejection(read.articleId, rejected.mutationId)))
                                }
                            }
                        }
                    } else if (saved != null) {
                        articleStateProjectionMutex.withLock {
                            account.commit(session) {
                                val rejected = localStore.discardSavedStateMutation(saved)
                                if (rejected != null) {
                                    projectCachedArticleState(saved.articleId)
                                    runtime.invalidateByPrefix("search")
                                    savedStateRejectionEvents.tryEmit(
                                        SessionEvent(session, SavedStateRejection(saved.articleId, rejected.effectiveState, rejected.mutationId)),
                                    )
                                }
                            }
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

    private suspend fun fetchFeeds(categoryId: String?, session: ApiSession): List<FeedWithCounts> = feedReadMutex.withLock {
        while (true) {
            val revision = libraryMetadataRevision.get()
            val ticket = account.commit(session) { localStore.captureCountSnapshot() }
            val feeds = withRetry(session) { feedRemote.feeds(categoryId, session) }
            val accepted = account.commit(session) {
                if (revision != libraryMetadataRevision.get()) null else {
                    localStore.writeRemoteFeeds(feeds, ticket, merge = categoryId != null).also {
                        runtime.putCached("feeds:${categoryId.orEmpty()}", FEEDS_TTL_MS, it)
                    }
                }
            }
            if (accepted != null) return accepted
        }
        @Suppress("UNREACHABLE_CODE")
        error("Feed snapshot loop exited")
    }

    private suspend fun filterCachedFeeds(
        feeds: List<FeedWithCounts>,
        categoryId: String?,
        session: ApiSession,
    ): List<FeedWithCounts> {
        if (categoryId == null) return feeds
        val flattened = buildList {
            fun append(categories: List<CategoryWithCounts>) {
                for (category in categories) {
                    add(category)
                    append(category.children.orEmpty())
                }
            }
            append(account.commit(session) { offlineReadStore.readCategories() })
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

    private data class SearchSnapshot(val payload: ApiListResponse<ArticleListItem>, val epoch: Long)

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

private data class SessionEvent<out T>(val session: ApiSession, val value: T)
