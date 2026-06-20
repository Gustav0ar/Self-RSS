package com.selffeed.android.data

import android.content.Context
import androidx.paging.ExperimentalPagingApi
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.data.repository.ReadStateStreamClient
import com.selffeed.android.data.repository.RepositoryRuntime
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.UpdatePreferencesRequest
import com.squareup.moshi.Moshi
import coil3.ImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException
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
    okHttpClient: OkHttpClient,
    moshi: Moshi,
    private val offlineCacheStore: OfflineCacheStore,
    private val localStore: LocalStore,
    private val imageRequestContext: Context,
    private val imageLoader: ImageLoader,
    private val networkMonitor: NetworkMonitor,
) : SelfFeedRepository {
    private val runtime = RepositoryRuntime(moshi, MAX_MEMORY_CACHE_ENTRIES, "RssRepository")
    private val readStateStreamClient = ReadStateStreamClient(okHttpClient, moshi, runtime)

    // Detached scope for fire-and-forget background refreshes (e.g. the
    // stale-while-revalidate path in `article()`). Using a supervisor
    // scope tied to the repository means background work survives
    // individual failures and is cleaned up when the process dies.
    private val refreshScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override suspend fun registrationStatus() = safeReadCall {
        authRemote.registrationStatus()
    }

    override suspend fun login(email: String, password: String) = safeCall {
        val response = authRemote.login(email, password)
        sessionStore.setAccessToken(response.tokens.accessToken)
        clearCacheAndDatabase()
        response.user
    }

    override suspend fun register(email: String, password: String) = safeCall {
        val response = authRemote.register(email, password)
        sessionStore.setAccessToken(response.tokens.accessToken)
        clearCacheAndDatabase()
        response.user
    }

    override suspend fun logout() = safeCall {
        authRemote.logout()
        sessionStore.clear()
        clearCacheAndDatabase()
        true
    }

    override suspend fun me() = safeReadCall {
        runtime.cachedGet(key = "me", ttlMs = USER_TTL_MS) { runtime.withRetry { authRemote.me() } }
    }

    override suspend fun categories() = safeReadCall {
        flushPendingReadStateMutations()
        runtime.getCached<List<CategoryWithCounts>>("categories")?.let {
            runtime.recordCacheHit()
            return@safeReadCall it
        }

        val localCategories = localStore.readCategories()
        if (localCategories.isNotEmpty()) {
            runtime.putCached("categories", CATEGORIES_TTL_MS, localCategories)
            refreshCategoriesInBackground()
            return@safeReadCall localCategories
        }

        try {
            runtime.cachedGet(key = "categories", ttlMs = CATEGORIES_TTL_MS) {
                runtime.withRetry { feedRemote.categories() }.also { categories ->
                    localStore.writeCategories(categories)
                    offlineCacheStore.writeCategories(categories)
                }
            }
        } catch (e: Exception) {
            val fromSqlite = localStore.readCategories()
            if (fromSqlite.isNotEmpty()) fromSqlite
            else offlineCacheStore.readCategories().takeIf { it.isNotEmpty() } ?: throw e
        }
    }

    override suspend fun createCategory(name: String, parentCategoryId: String?) = safeCall {
        feedRemote.createCategory(name, parentCategoryId).also {
            runtime.invalidateByPrefix("categories")
            runtime.invalidateByPrefix("feeds")
            runtime.invalidateByPrefix("stats")
            offlineCacheStore.clearByPrefix("categories")

            localStore.clearTable(LocalStore.TABLE_CATEGORIES)
            offlineCacheStore.clearByPrefix("feeds")

            localStore.clearTable(LocalStore.TABLE_FEEDS)
        }
    }

    override suspend fun updateCategory(id: String, name: String?, parentCategoryId: String?) = safeCall {
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
        flushPendingReadStateMutations()
        val key = "feeds:${categoryId.orEmpty()}"
        runtime.getCached<List<FeedWithCounts>>(key)?.let {
            runtime.recordCacheHit()
            return@safeReadCall it
        }

        val localFeeds = localStore.readFeeds()
        if (localFeeds.isNotEmpty()) {
            val filtered = categoryId?.let { id -> localFeeds.filter { it.categoryId == id } } ?: localFeeds
            if (filtered.isNotEmpty()) {
                runtime.putCached(key, FEEDS_TTL_MS, filtered)
                refreshFeedsInBackground(categoryId)
                return@safeReadCall filtered
            }
        }

        try {
            runtime.cachedGet(key = key, ttlMs = FEEDS_TTL_MS) {
                runtime.withRetry { feedRemote.feeds(categoryId) }.also { feeds ->
                    localStore.writeFeeds(feeds)
                    offlineCacheStore.writeFeeds(feeds)
                }
            }
        } catch (e: Exception) {
            val cached = localStore.readFeeds().ifEmpty { offlineCacheStore.readFeeds() }
            val filtered = categoryId?.let { id -> cached.filter { it.categoryId == id } } ?: cached
            filtered.takeIf { it.isNotEmpty() } ?: throw e
        }
    }

    override suspend fun createFeed(feedUrl: String, categoryId: String, title: String?) = safeCall {
        feedRemote.createFeed(feedUrl, categoryId, title).also {
            invalidateFeedAndArticleCaches()
        }
    }

    override suspend fun updateFeed(id: String, categoryId: String?, title: String?, pollingIntervalMinutes: Int?) = safeCall {
        feedRemote.updateFeed(id, categoryId, title, pollingIntervalMinutes).also {
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

    override suspend fun syncAllFeeds() = safeCall {
        feedRemote.syncAllFeeds().also {
            invalidateFeedAndArticleCaches()
        }
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

    override suspend fun articles(
        feedId: String?,
        categoryId: String?,
        unreadOnly: Boolean?,
        sort: String?,
        limit: Int?,
        cursor: String?,
    ): AppResult<ApiListResponse<ArticleListItem>> = safeReadCall {
        flushPendingReadStateMutations()
        if (!cursor.isNullOrBlank()) {
            return@safeReadCall runtime.withRetry {
                articleRemote.articles(feedId, categoryId, unreadOnly, sort, limit, cursor)
            }
        }

        val key = "articles:${feedId.orEmpty()}:${categoryId.orEmpty()}:${unreadOnly ?: "null"}:${sort.orEmpty()}:${limit ?: 0}:"
        runtime.getCached<ApiListResponse<ArticleListItem>>(key)?.let {
            runtime.recordCacheHit()
            return@safeReadCall it
        }

        val localPage = localStore.readArticles(key)
        if (localPage != null) {
            runtime.putCached(key, ARTICLES_TTL_MS, localPage)
            refreshArticlePageInBackground(
                key = key,
                feedId = feedId,
                categoryId = categoryId,
                unreadOnly = unreadOnly,
                sort = sort,
                limit = limit,
            )
            return@safeReadCall localPage
        }

        try {
            runtime.cachedGet(key = key, ttlMs = ARTICLES_TTL_MS) {
                runtime.withRetry {
                    articleRemote.articles(feedId, categoryId, unreadOnly, sort, limit, cursor)
                }.also { response ->
                    localStore.writeArticles(key, response)
                    offlineCacheStore.writeArticles(key, response)
                }
            }
        } catch (e: Exception) {
            localStore.readArticles(key) ?: offlineCacheStore.readArticles(key) ?: throw e
        }
    }

    @OptIn(ExperimentalPagingApi::class)
    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> {
        val queryKey = query.remoteKey()
        return Pager(
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
                                sort = query.sort,
                                limit = limit,
                                cursor = cursor,
                            )
                        }
                    }
                },
            ),
            pagingSourceFactory = { localStore.articlePagingSource(queryKey) },
        ).flow.map { pagingData ->
            val readStates = readStateOverrides()
            pagingData.map { article ->
                readStates[article.id]?.let { article.copy(isRead = it) } ?: article
            }
        }
    }

    override suspend fun article(articleId: String, forceRefresh: Boolean) = safeReadCall {
        flushPendingReadStateMutations()
        if (forceRefresh) invalidateArticleCaches(articleId)

        // Fast path: in-memory hit. Instant.
        runtime.getCached<ArticleDetail>("article:$articleId")?.let { return@safeReadCall it }

        // Warm path: SQLite has a fresh copy. Return it now and refresh
        // from the network in the background so the reader opens
        // instantly for any article the user has ever opened. The
        // background refresh updates the in-memory cache and SQLite on
        // success; on failure the SQLite copy stays valid until its own
        // 7-day expiry.
        val sqliteCopy = localStore.readArticleDetail(articleId)
        if (sqliteCopy != null) {
            runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, sqliteCopy)
            // Detached background refresh — does not block the caller.
            // We swallow the result here on purpose: the caller already
            // has a usable ArticleDetail. Errors are surfaced on the next
            // explicit open or pull-to-refresh.
            backgroundRefreshArticle(articleId)
            return@safeReadCall sqliteCopy
        }

        // Cold path: nothing in memory or SQLite. Hit the network.
        try {
            runtime.withRetry { articleRemote.article(articleId) }.also { detail ->
                runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
                localStore.writeArticleDetail(detail)
                offlineCacheStore.writeArticleDetail(detail)
            }
        } catch (e: Exception) {
            offlineCacheStore.readArticleDetail(articleId) ?: throw e
        }
    }

    suspend fun article(articleId: String): AppResult<ArticleDetail> = article(articleId, forceRefresh = false)

    private fun backgroundRefreshArticle(articleId: String) {
        refreshScope.launch {
            try {
                val detail = runtime.withRetry { articleRemote.article(articleId) }
                runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
                localStore.writeArticleDetail(detail)
                offlineCacheStore.writeArticleDetail(detail)
            } catch (_: Exception) {
                // Background refresh is best-effort. The SQLite copy the
                // user is already reading is still valid.
            }
        }
    }

    private fun refreshCategoriesInBackground() {
        refreshScope.launch {
            runCatching {
                runtime.withRetry { feedRemote.categories() }.also { categories ->
                    runtime.putCached("categories", CATEGORIES_TTL_MS, categories)
                    localStore.writeCategories(categories)
                    offlineCacheStore.writeCategories(categories)
                }
            }
        }
    }

    private fun refreshFeedsInBackground(categoryId: String?) {
        refreshScope.launch {
            runCatching {
                runtime.withRetry { feedRemote.feeds(categoryId) }.also { feeds ->
                    runtime.putCached("feeds:${categoryId.orEmpty()}", FEEDS_TTL_MS, feeds)
                    localStore.writeFeeds(feeds)
                    offlineCacheStore.writeFeeds(feeds)
                }
            }
        }
    }

    private fun refreshArticlePageInBackground(
        key: String,
        feedId: String?,
        categoryId: String?,
        unreadOnly: Boolean?,
        sort: String?,
        limit: Int?,
    ) {
        refreshScope.launch {
            runCatching {
                runtime.withRetry { articleRemote.articles(feedId, categoryId, unreadOnly, sort, limit, cursor = null) }
                    .also { response ->
                        runtime.putCached(key, ARTICLES_TTL_MS, response)
                        localStore.writeArticles(key, response)
                        offlineCacheStore.writeArticles(key, response)
                    }
            }
        }
    }

    override fun cachedArticleDetail(articleId: String): ArticleDetail? = runtime.getCached("article:$articleId")

    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> = article(articleId)

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> = safeReadCall {
        runtime.withRetry { articleRemote.article(articleId) }.also { detail ->
            runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
            localStore.writeArticleDetail(detail)
            offlineCacheStore.writeArticleDetail(detail)
        }
    }

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) {
        if (!networkMonitor.online.value) return // Skip prefetch on cellular/metered when offline
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

    /**
     * Marks an article read/unread with **optimistic cache write** so the UI
     * reflects the new state immediately, even before the server confirms.
     * The cached entry is rolled back to its previous state if the request
     * fails.
     */
    override suspend fun markRead(articleId: String, read: Boolean) = safeCall {
        val key = "article:$articleId"
        val previous = runtime.getCached<ArticleDetail>(key)
        // Optimistic write — visible to the reader screen and the next
        // list query before the round-trip completes.
        if (previous != null) {
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, previous.copy(isRead = read))
        }
        if (!networkMonitor.online.value) {
            localStore.queueReadStateMutation(articleId, read)
            runtime.invalidateByPrefix("stats")
            return@safeCall read
        }
        try {
            articleRemote.markRead(articleId, read).let { read }.also {
                // The detail is now authoritative; refresh the cached body.
                invalidateArticleDetailCache(articleId)
                runtime.invalidateByPrefix("stats")
                offlineCacheStore.clearByPrefix("article-$articleId")
            }
        } catch (e: Exception) {
            // Roll back the optimistic update so the next read is consistent
            // with the server's eventual truth.
            if (previous != null) runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, previous)
            throw e
        }
    }

    override suspend fun markAllRead(feedId: String?, categoryId: String?) = safeCall {
        articleRemote.markAllRead(feedId, categoryId).also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun markAllRead() = markAllRead(feedId = null, categoryId = null)

    override fun clientId(): String = sessionStore.getClientId()

    override fun readStateEvents(): Flow<ReadStateSyncEvent> =
        readStateStreamClient.events(::isLoggedIn)

    override suspend fun search(query: String, categoryId: String?, cursor: String?) = safeReadCall {
        if (!cursor.isNullOrBlank()) {
            return@safeReadCall runtime.withRetry { searchRemote.search(query = query, categoryId = categoryId, cursor = cursor) }
        }

        val key = "search:${query.trim().lowercase()}:${categoryId.orEmpty()}:"
        runtime.cachedGet(key = key, ttlMs = SEARCH_TTL_MS) {
            runtime.withRetry { searchRemote.search(query = query, categoryId = categoryId, cursor = cursor) }
        }
    }

    suspend fun search(query: String): AppResult<ApiListResponse<ArticleListItem>> =
        search(query = query, categoryId = null, cursor = null)

    override suspend fun preferences() = safeReadCall {
        runtime.cachedGet(key = "preferences", ttlMs = PREFERENCES_TTL_MS) { runtime.withRetry { settingsRemote.preferences() } }
    }

    override suspend fun updatePreferences(request: UpdatePreferencesRequest) = safeCall {
        settingsRemote.updatePreferences(request).also {
            runtime.invalidateByPrefix("preferences")
            runtime.invalidateByPrefix("articles")
            runtime.invalidateByPrefix("search")
        }
    }

    override suspend fun stats() = safeReadCall {
        runtime.cachedGet(key = "stats", ttlMs = STATS_TTL_MS) { runtime.withRetry { settingsRemote.stats() } }
    }

    override suspend fun adminSettings() = safeReadCall {
        runtime.cachedGet(key = "admin:settings", ttlMs = ADMIN_SETTINGS_TTL_MS) { runtime.withRetry { settingsRemote.adminSettings() } }
    }

    override suspend fun updateAdminSettings(registrationLocked: Boolean) = safeCall {
        settingsRemote.updateAdminSettings(registrationLocked).also {
            runtime.invalidateByPrefix("admin:settings")
        }
    }

    override fun isLoggedIn(): Boolean = !sessionStore.getAccessToken().isNullOrBlank()

    override fun isOnline(): Boolean = networkMonitor.online.value

    override fun observeOnline(): Flow<Boolean> = networkMonitor.online

    override fun getDebugResilienceSnapshot(): Map<String, Long> = runtime.snapshot()

    override fun resetDebugResilienceMetrics() = runtime.resetMetrics()

    /**
     * Drops in-memory caches (e.g. on [android.content.ComponentCallbacks2]
     * trim memory) to free up heap when the system is under pressure.
     */
    override fun trimMemoryCaches() = runtime.trimMemoryCaches()

    private suspend fun <T> safeReadCall(block: suspend () -> T): AppResult<T> = runtime.safeCall { block() }

    private suspend fun <T> safeCall(block: suspend () -> T): AppResult<T> = runtime.safeCall(block)

    suspend fun invalidateArticleCaches(articleId: String) {
        // Targeted invalidation for a single markRead. The SSE read-state
        // event handles the in-memory `state.articles` patch, so we
        // don't need to blow away every cached list here. We only drop
        // the article detail and the stats aggregate; feeds/categories
        // are refreshed lazily on the next unread-count read.
        invalidateArticleDetailCache(articleId)
        runtime.invalidateByPrefix("stats")
        offlineCacheStore.clearByPrefix("article-$articleId")
    }

    private suspend fun invalidateArticleDetailCache(articleId: String) {
        runtime.invalidateByPrefix("article:$articleId")
        offlineCacheStore.clearByPrefix("article-$articleId")
    }

    override suspend fun invalidateReadStateCaches(articleId: String?) {
        if (articleId != null) {
            runtime.invalidateByPrefix("article:$articleId")
            offlineCacheStore.clearByPrefix("article-$articleId")
        }
        invalidateFeedAndArticleCaches()
    }

    private suspend fun clearCacheAndDatabase() {
        runtime.clearCache()
        localStore.clearAll()
        offlineCacheStore.clearAll()
    }

    private suspend fun invalidateFeedAndArticleCaches() {
        runtime.invalidateByPrefix("feeds")
        runtime.invalidateByPrefix("articles")
        runtime.invalidateByPrefix("search")
        runtime.invalidateByPrefix("stats")
        runtime.invalidateByPrefix("categories")
        offlineCacheStore.clearByPrefix("feeds")

        localStore.clearTable(LocalStore.TABLE_FEEDS)
        offlineCacheStore.clearByPrefix("categories")

        localStore.clearTable(LocalStore.TABLE_CATEGORIES)
        offlineCacheStore.clearByPrefix("articles-")

        localStore.clearTable(LocalStore.TABLE_ARTICLES)
        localStore.clearTable(LocalStore.TABLE_ARTICLE_PAGES)
    }

    private suspend fun flushPendingReadStateMutations() {
        if (!networkMonitor.online.value) return
        val pending = localStore.readPendingReadStateMutations()
        if (pending.isEmpty()) return
        val failedIds = mutableListOf<Long>()
        for (mutation in pending) {
            try {
                runtime.withRetry {
                    articleRemote.markRead(mutation.articleId, mutation.read)
                }
                localStore.deletePendingReadStateMutation(mutation.articleId)
            } catch (e: Exception) {
                runtime.debugLog("Pending read-state flush failed for ${mutation.articleId}: ${e.message ?: e::class.java.simpleName}")
                failedIds.add(mutation.articleId)
            }
        }
        if (failedIds.isNotEmpty()) {
            runtime.debugLog("Pending read-state flush failed for ${failedIds.size} mutation(s): ${failedIds.joinToString()}")
        }
    }

    private companion object {
        const val USER_TTL_MS = 30_000L
        const val CATEGORIES_TTL_MS = 60_000L
        const val FEEDS_TTL_MS = 60_000L
        const val ARTICLES_TTL_MS = 30_000L
        // Article details change rarely once published (only on enrichment
        // or read-state flip, both of which invalidate explicitly). Keep
        // them in the in-memory cache for a full day so reopening an old
        // article is instant — the SQLite write-through is the durable
        // source, this just avoids re-parsing on every cold start.
        const val ARTICLE_DETAIL_TTL_MS = 24L * 60 * 60 * 1000
        const val SEARCH_TTL_MS = 30_000L
        const val PREFERENCES_TTL_MS = 60_000L
        const val STATS_TTL_MS = 30_000L
        const val ADMIN_SETTINGS_TTL_MS = 60_000L
        const val OPML_EXPORT_TTL_MS = 30_000L
        const val ARTICLE_IMAGE_PREFETCH_LIMIT = 5
        const val MAX_MEMORY_CACHE_ENTRIES = 160
        const val ARTICLE_PAGE_SIZE = 30
        const val ARTICLE_PAGING_PREFETCH_DISTANCE = 8
    }
}
