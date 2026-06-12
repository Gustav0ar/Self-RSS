package com.selffeed.android.data

import android.content.Context
import android.util.Log
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.network.ApiErrorEnvelope
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CreateCategoryRequest
import com.selffeed.android.network.CreateFeedRequest
import com.selffeed.android.network.LoginRequest
import com.selffeed.android.network.MarkAllReadRequest
import com.selffeed.android.network.MarkReadRequest
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.ReadStateEventPayload
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RssApi
import com.selffeed.android.network.RegisterRequest
import com.selffeed.android.network.SseEventParser
import com.selffeed.android.network.UpdateAppSettingsRequest
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.toReadStateEvent
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import coil3.ImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.isActive
import kotlinx.coroutines.plus
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.coroutineContext
import kotlin.random.Random

sealed interface AppResult<out T> {
    data class Success<T>(val data: T) : AppResult<T>
    data class Error(val message: String, val cause: Throwable? = null) : AppResult<Nothing>
}

class RssRepository(
    private val api: RssApi,
    private val sessionStore: SessionStore,
    okHttpClient: OkHttpClient,
    moshi: Moshi,
    private val offlineCacheStore: OfflineCacheStore,
    private val localStore: LocalStore,
    private val imageRequestContext: Context,
    private val imageLoader: ImageLoader,
    private val networkMonitor: NetworkMonitor,
) {
    private val retryCount = AtomicLong(0)
    private val retryExhaustedCount = AtomicLong(0)
    private val cacheHitCount = AtomicLong(0)
    private val cacheMissCount = AtomicLong(0)
    private val cacheStoreCount = AtomicLong(0)
    private val cacheInvalidationCount = AtomicLong(0)
    private val cacheInvalidatedEntriesCount = AtomicLong(0)
    private val sseLastEventId = AtomicLong(0)

    private val cache = ConcurrentHashMap<String, CacheEntry<Any?>>()
    private val cacheLocks = ConcurrentHashMap<String, Mutex>()
    private val apiErrorAdapter: JsonAdapter<ApiErrorEnvelope> = moshi.adapter(ApiErrorEnvelope::class.java)
    private val readStateEventAdapter: JsonAdapter<ReadStateEventPayload> = moshi.adapter(ReadStateEventPayload::class.java)

    /**
     * The SSE client intentionally reuses the main client (instead of building a
     * fresh one) so the [com.selffeed.android.network.TokenAuthenticator] can
     * refresh the access token if the stream hits a 401. We still override the
     * read timeout to zero so a long-lived stream doesn't get cut by the SSE
     * keep-alive.
     */
    private val readStateClient: OkHttpClient = okHttpClient.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .addInterceptor { chain ->
            // The main client's interceptor already adds the Authorization header
            // and X-Self-Feed-Client-Id. The newBuilder().build() chain still
            // keeps the application's interceptors, so this is just a sanity hook
            // for the SSE request: ensure Last-Event-ID is forwarded for
            // resume-after-disconnect.
            val original = chain.request()
            val builder = original.newBuilder()
            val lastId = sseLastEventId.get()
            if (lastId > 0) {
                builder.header("Last-Event-ID", lastId.toString())
            }
            chain.proceed(builder.build())
        }
        .build()

    suspend fun registrationStatus() = safeReadCall {
        api.registrationStatus().data
    }

    suspend fun login(email: String, password: String) = safeCall {
        val response = api.login(LoginRequest(email, password)).data
        sessionStore.setAccessToken(response.tokens.accessToken)
        clearCacheAndDatabase()
        response.user
    }

    suspend fun register(email: String, password: String) = safeCall {
        val response = api.register(RegisterRequest(email, password)).data
        sessionStore.setAccessToken(response.tokens.accessToken)
        clearCacheAndDatabase()
        response.user
    }

    suspend fun logout() = safeCall {
        api.logout()
        sessionStore.clear()
        clearCacheAndDatabase()
        true
    }

    suspend fun me() = safeReadCall {
        cachedGet(key = "me", ttlMs = USER_TTL_MS) { withRetry { api.me().data } }
    }

    suspend fun categories() = safeReadCall {
        try {
            cachedGet(key = "categories", ttlMs = CATEGORIES_TTL_MS) {
                withRetry { api.categories().data.categories }.also { categories ->
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

    suspend fun createCategory(name: String, parentCategoryId: String? = null) = safeCall {
        api.createCategory(CreateCategoryRequest(name, parentCategoryId)).data.also {
            invalidateByPrefix("categories")
            invalidateByPrefix("feeds")
            invalidateByPrefix("stats")
            offlineCacheStore.clearByPrefix("categories")

            localStore.clearTable(LocalStore.TABLE_CATEGORIES)
            offlineCacheStore.clearByPrefix("feeds")

            localStore.clearTable(LocalStore.TABLE_FEEDS)
        }
    }

    suspend fun updateCategory(id: String, name: String?, parentCategoryId: String?) = safeCall {
        api.updateCategory(id, UpdateCategoryRequest(name, parentCategoryId)).data.also {
            invalidateByPrefix("categories")
            invalidateByPrefix("feeds")
            invalidateByPrefix("articles")
            invalidateByPrefix("search")
            offlineCacheStore.clearByPrefix("categories")

            localStore.clearTable(LocalStore.TABLE_CATEGORIES)
            offlineCacheStore.clearByPrefix("feeds")

            localStore.clearTable(LocalStore.TABLE_FEEDS)
            offlineCacheStore.clearByPrefix("articles")

            localStore.clearTable(LocalStore.TABLE_ARTICLES)
        }
    }

    suspend fun deleteCategory(id: String) = safeCall {
        api.deleteCategory(id).data.success.also {
            invalidateByPrefix("categories")
            invalidateByPrefix("feeds")
            invalidateByPrefix("articles")
            invalidateByPrefix("search")
            invalidateByPrefix("stats")
            offlineCacheStore.clearByPrefix("categories")

            localStore.clearTable(LocalStore.TABLE_CATEGORIES)
            offlineCacheStore.clearByPrefix("feeds")

            localStore.clearTable(LocalStore.TABLE_FEEDS)
            offlineCacheStore.clearByPrefix("articles")

            localStore.clearTable(LocalStore.TABLE_ARTICLES)
        }
    }

    suspend fun feeds(categoryId: String? = null) = safeReadCall {
        try {
            cachedGet(key = "feeds:${categoryId.orEmpty()}", ttlMs = FEEDS_TTL_MS) {
                withRetry { api.feeds(categoryId).data }.also { feeds ->
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

    suspend fun createFeed(feedUrl: String, categoryId: String, title: String?) = safeCall {
        api.createFeed(CreateFeedRequest(feedUrl = feedUrl, categoryId = categoryId, title = title)).data.also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun updateFeed(id: String, categoryId: String?, title: String?, pollingIntervalMinutes: Int?) = safeCall {
        api.updateFeed(id, UpdateFeedRequest(categoryId, title, pollingIntervalMinutes)).data.also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun deleteFeed(id: String) = safeCall {
        api.deleteFeed(id).data.success.also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun syncFeed(id: String) = safeCall {
        api.syncFeed(id).data.also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun syncAllFeeds() = safeCall {
        api.syncAllFeeds().data.also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun importOpml(fileName: String, fileBytes: ByteArray) = safeCall {
        val body = fileBytes.toRequestBody("application/xml".toMediaType())
        val part = MultipartBody.Part.createFormData("file", fileName, body)
        api.importOpml(part).data.also {
            invalidateFeedAndArticleCaches()
        }
    }

    suspend fun exportOpml() = safeReadCall {
        cachedGet(key = "opml:export", ttlMs = OPML_EXPORT_TTL_MS) {
            val response = withRetry { api.exportOpml() }
            if (!response.isSuccessful) throw HttpException(response)
            response.body()?.string().orEmpty()
        }
    }

    suspend fun articles(
        feedId: String? = null,
        categoryId: String? = null,
        unreadOnly: Boolean? = null,
        sort: String? = null,
        limit: Int? = 30,
        cursor: String? = null,
    ): AppResult<ApiListResponse<ArticleListItem>> = safeReadCall {
        if (!cursor.isNullOrBlank()) {
            return@safeReadCall withRetry { api.articles(feedId, categoryId, unreadOnly, sort, limit, cursor) }
        }

        val key = "articles:${feedId.orEmpty()}:${categoryId.orEmpty()}:${unreadOnly ?: "null"}:${sort.orEmpty()}:${limit ?: 0}:"
        try {
            cachedGet(key = key, ttlMs = ARTICLES_TTL_MS) {
                withRetry { api.articles(feedId, categoryId, unreadOnly, sort, limit, cursor) }.also { response ->
                    localStore.writeArticles(key, response)
                    offlineCacheStore.writeArticles(key, response)
                }
            }
        } catch (e: Exception) {
            localStore.readArticles(key) ?: offlineCacheStore.readArticles(key) ?: throw e
        }
    }

    suspend fun article(articleId: String, forceRefresh: Boolean = false) = safeReadCall {
        if (forceRefresh) invalidateArticleCaches(articleId)
        try {
            cachedGet(key = "article:$articleId", ttlMs = ARTICLE_DETAIL_TTL_MS) {
                withRetry { api.article(articleId).data }.also { detail ->
                    localStore.writeArticleDetail(detail)
                    offlineCacheStore.writeArticleDetail(detail)
                }
            }
        } catch (e: Exception) {
            localStore.readArticleDetail(articleId) ?: offlineCacheStore.readArticleDetail(articleId) ?: throw e
        }
    }

    fun cachedArticleDetail(articleId: String): ArticleDetail? = getCached("article:$articleId")

    suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> = article(articleId)

    suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> = safeReadCall {
        withRetry { api.article(articleId).data }.also { detail ->
            putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
            localStore.writeArticleDetail(detail)
            offlineCacheStore.writeArticleDetail(detail)
        }
    }

    fun prefetchHeroImages(imageUrls: Iterable<String?>) {
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

    suspend fun enrichArticle(articleId: String, invalidateCaches: Boolean = true) = safeCall {
        api.enrichArticle(articleId).data.also {
            if (it.success || it.reason == "already_enriched") {
                if (invalidateCaches) {
                    invalidateArticleCaches(articleId)
                } else {
                    invalidateArticleDetailCache(articleId)
                }
            }
        }
    }

    /**
     * Marks an article read/unread with **optimistic cache write** so the UI
     * reflects the new state immediately, even before the server confirms.
     * The cached entry is rolled back to its previous state if the request
     * fails.
     */
    suspend fun markRead(articleId: String, read: Boolean) = safeCall {
        val key = "article:$articleId"
        val previous = getCached<ArticleDetail>(key)
        // Optimistic write — visible to the reader screen and the next
        // list query before the round-trip completes.
        if (previous != null) {
            putCached(key, ARTICLE_DETAIL_TTL_MS, previous.copy(isRead = read))
        }
        try {
            api.markRead(articleId, MarkReadRequest(read = read)).data.success.let { read }.also {
                // The detail is now authoritative; refresh the cached body.
                invalidateArticleDetailCache(articleId)
                invalidateByPrefix("stats")
                offlineCacheStore.clearByPrefix("article-$articleId")
            }
        } catch (e: Exception) {
            // Roll back the optimistic update so the next read is consistent
            // with the server's eventual truth.
            if (previous != null) putCached(key, ARTICLE_DETAIL_TTL_MS, previous)
            throw e
        }
    }

    suspend fun markAllRead(feedId: String? = null, categoryId: String? = null) = safeCall {
        api.markAllRead(MarkAllReadRequest(feedId = feedId, categoryId = categoryId)).data.markedCount.also {
            invalidateFeedAndArticleCaches()
        }
    }

    fun clientId(): String = sessionStore.getClientId()

    /**
     * Long-lived read-state stream. Reconnects with exponential backoff and
     * tracks the most recently observed event id so reconnects can resume
     * from where the server left off (Last-Event-ID).
     *
     * The flow is bounded by [maxAttempts] reconnects so a permanently broken
     * server doesn't keep a half-sleeping coroutine alive forever; the
     * collector can re-subscribe to retry.
     */
    fun readStateEvents(): Flow<ReadStateSyncEvent> = flow {
        var attempt = 0
        while (coroutineContext.isActive && isLoggedIn()) {
            try {
                readStateEventsOnce().collect { event ->
                    attempt = 0
                    sseLastEventId.set(parseEventId(event.eventId))
                    emit(event)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                debugLog("Read-state stream disconnected: ${e.message ?: e::class.java.simpleName}")
            }

            if (!coroutineContext.isActive || !isLoggedIn()) break
            if (attempt >= READ_STATE_RECONNECT_MAX_ATTEMPTS) {
                debugLog("Read-state stream giving up after $attempt attempts")
                break
            }
            delay(readStateReconnectDelay(attempt))
            attempt++
        }
    }

    suspend fun search(query: String, categoryId: String? = null, cursor: String? = null) = safeReadCall {
        if (!cursor.isNullOrBlank()) {
            return@safeReadCall withRetry { api.search(query = query, categoryId = categoryId, cursor = cursor) }
        }

        val key = "search:${query.trim().lowercase()}:${categoryId.orEmpty()}:"
        cachedGet(key = key, ttlMs = SEARCH_TTL_MS) { withRetry { api.search(query = query, categoryId = categoryId, cursor = cursor) } }
    }

    suspend fun preferences() = safeReadCall {
        cachedGet(key = "preferences", ttlMs = PREFERENCES_TTL_MS) { withRetry { api.preferences().data } }
    }

    suspend fun updatePreferences(request: UpdatePreferencesRequest) = safeCall {
        api.updatePreferences(request).data.also {
            invalidateByPrefix("preferences")
            invalidateByPrefix("articles")
            invalidateByPrefix("search")
        }
    }

    suspend fun stats() = safeReadCall {
        cachedGet(key = "stats", ttlMs = STATS_TTL_MS) { withRetry { api.stats().data } }
    }

    suspend fun adminSettings() = safeReadCall {
        cachedGet(key = "admin:settings", ttlMs = ADMIN_SETTINGS_TTL_MS) { withRetry { api.adminSettings().data } }
    }

    suspend fun updateAdminSettings(registrationLocked: Boolean) = safeCall {
        api.updateAdminSettings(UpdateAppSettingsRequest(registrationLocked)).data.also {
            invalidateByPrefix("admin:settings")
        }
    }

    fun isLoggedIn(): Boolean = !sessionStore.getAccessToken().isNullOrBlank()

    fun isOnline(): Boolean = networkMonitor.online.value

    fun observeOnline(): Flow<Boolean> = networkMonitor.online

    fun getDebugResilienceSnapshot(): Map<String, Long> = mapOf(
        "retryCount" to retryCount.get(),
        "retryExhaustedCount" to retryExhaustedCount.get(),
        "cacheHitCount" to cacheHitCount.get(),
        "cacheMissCount" to cacheMissCount.get(),
        "cacheStoreCount" to cacheStoreCount.get(),
        "cacheInvalidationCount" to cacheInvalidationCount.get(),
        "cacheInvalidatedEntriesCount" to cacheInvalidatedEntriesCount.get(),
    )

    fun resetDebugResilienceMetrics() {
        retryCount.set(0)
        retryExhaustedCount.set(0)
        cacheHitCount.set(0)
        cacheMissCount.set(0)
        cacheStoreCount.set(0)
        cacheInvalidationCount.set(0)
        cacheInvalidatedEntriesCount.set(0)
        debugLog("Debug resilience metrics reset")
    }

    /**
     * Drops in-memory caches (e.g. on [android.content.ComponentCallbacks2]
     * trim memory) to free up heap when the system is under pressure.
     */
    fun trimMemoryCaches() {
        val cleared = cache.size
        cache.clear()
        cacheLocks.clear()
        cacheInvalidationCount.incrementAndGet()
        cacheInvalidatedEntriesCount.addAndGet(cleared.toLong())
    }

    private suspend fun <T> safeReadCall(block: suspend () -> T): AppResult<T> = safeCall { block() }

    private suspend fun <T> safeCall(block: suspend () -> T): AppResult<T> =
        try {
            AppResult.Success(block())
        } catch (e: HttpException) {
            val rawBody = e.response()?.errorBody()?.string()
            val structuredMessage = rawBody?.let(::extractApiErrorMessage)
            val plainBodyMessage = rawBody
                ?.trim()
                ?.takeIf { it.isNotBlank() && !it.startsWith("{") }
                ?.take(240)
            val message = structuredMessage ?: plainBodyMessage ?: defaultHttpMessage(e.code())
            AppResult.Error(message, e)
        } catch (e: SocketTimeoutException) {
            AppResult.Error(
                if (BuildConfig.DEBUG) {
                    "Connection timed out. Please check if the API server is running at ${BuildConfig.API_BASE_URL}"
                } else {
                    "Connection timed out. Please try again."
                },
                e,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AppResult.Error(e.message ?: "Unexpected error", e)
        }

    private fun extractApiErrorMessage(rawBody: String): String? {
        val parsed = runCatching { apiErrorAdapter.fromJson(rawBody) }.getOrNull()
        return parsed?.error?.message?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun defaultHttpMessage(code: Int): String = when (code) {
        400 -> "Invalid request. Please review the provided data."
        401 -> "Session expired. Please sign in again."
        403 -> "You do not have permission for this action."
        404 -> "Requested resource was not found."
        408 -> "Request timed out. Please try again."
        409 -> "This action conflicts with current data."
        413 -> "Payload too large. Please reduce file/content size."
        415 -> "Unsupported content type."
        422 -> "Validation failed. Please adjust your input."
        429 -> "Too many requests. Please try again shortly."
        in 500..599 -> "Server error. Please try again in a moment."
        else -> "Request failed ($code)"
    }

    private suspend fun <T> withRetry(
        maxAttempts: Int = READ_RETRY_MAX_ATTEMPTS,
        initialDelayMs: Long = READ_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: Long = READ_RETRY_MAX_DELAY_MS,
        block: suspend () -> T,
    ): T {
        var currentDelayMs = initialDelayMs
        var attempt = 1
        var lastException: Exception? = null

        while (true) {
            try {
                return block()
            } catch (e: Exception) {
                lastException = e
                val canRetry = attempt < maxAttempts && isRetriableException(e)
                if (!canRetry) {
                    if (isRetriableException(e)) retryExhaustedCount.incrementAndGet()
                    throw e
                }

                val retryAttempt = retryCount.incrementAndGet()
                val jitter = Random.nextLong(0, currentDelayMs / 2 + 1)
                val totalDelay = (currentDelayMs + jitter).coerceAtMost(maxDelayMs)
                debugLog("Retrying request (attempt=$attempt, totalRetries=$retryAttempt, delayMs=$totalDelay, reason=${e::class.java.simpleName})")
                delay(totalDelay)
                currentDelayMs = (currentDelayMs * 2).coerceAtMost(maxDelayMs)
                attempt++
            }
        }
        @Suppress("UNREACHABLE_CODE")
        throw lastException ?: IllegalStateException("withRetry exited without resolution")
    }

    private fun isRetriableException(error: Exception): Boolean = when (error) {
        is SocketTimeoutException, is IOException -> true
        is HttpException -> error.code() in RETRIABLE_HTTP_CODES
        else -> false
    }

    private suspend fun <T> cachedGet(key: String, ttlMs: Long, loader: suspend () -> T): T {
        val cached = getCached<T>(key)
        if (cached != null) {
            cacheHitCount.incrementAndGet()
            return cached
        }

        cacheMissCount.incrementAndGet()
        val mutex = cacheLocks.getOrPut(key) { Mutex() }
        return mutex.withLock {
            val cachedInsideLock = getCached<T>(key)
            if (cachedInsideLock != null) {
                cacheHitCount.incrementAndGet()
                return@withLock cachedInsideLock
            }

            val loaded = loader()
            putCached(key, ttlMs, loaded)
            loaded
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> getCached(key: String): T? {
        val entry = cache[key] ?: return null
        if (entry.expiresAt < System.currentTimeMillis()) {
            cache.remove(key)
            cacheLocks.remove(key)
            return null
        }
        entry.lastAccessMs = System.currentTimeMillis()
        return entry.value as? T
    }

    private fun putCached(key: String, ttlMs: Long, value: Any?) {
        cacheStoreCount.incrementAndGet()
        val now = System.currentTimeMillis()
        cache[key] = CacheEntry(value = value, expiresAt = now + ttlMs, lastAccessMs = now)
        pruneMemoryCache()
    }

    private fun pruneMemoryCache() {
        val now = System.currentTimeMillis()
        val expiredKeys = cache.entries
            .filter { (_, entry) -> entry.expiresAt < now }
            .map { it.key }
        expiredKeys.forEach {
            cache.remove(it)
            cacheLocks.remove(it)
        }

        if (cache.size <= MAX_MEMORY_CACHE_ENTRIES) return

        val overflow = cache.size - MAX_MEMORY_CACHE_ENTRIES
        // LRU by last access, not by expiry. The previous code sorted by
        // expiresAt ascending which evicted the shortest-lived entries first
        // (e.g. the 8s article cache) — the opposite of what's wanted.
        cache.entries
            .sortedBy { it.value.lastAccessMs }
            .take(overflow)
            .forEach { (key, _) ->
                cache.remove(key)
                cacheLocks.remove(key)
            }
    }

    private fun invalidateByPrefix(prefix: String) {
        // Treat the prefix as a *namespace* — a key is matched only if
        // it is either exactly the prefix (for a bare key like
        // `categories` or `preferences`) or it lives under the prefix
        // with a `:` separator (e.g. `articles:foo` matches the prefix
        // `articles`). This keeps an unrelated key like `articlesList`
        // from being clobbered by `invalidateByPrefix("articles")`.
        var removedEntries = 0L
        cache.keys.removeIf { key ->
            val shouldRemove =
                if (prefix.endsWith(':')) {
                    key == prefix.dropLast(1) || key.startsWith(prefix)
                } else {
                    key == prefix || key.startsWith("$prefix:")
                }
            if (shouldRemove) removedEntries++
            shouldRemove
        }

        cacheInvalidationCount.incrementAndGet()
        if (removedEntries > 0) cacheInvalidatedEntriesCount.addAndGet(removedEntries)
    }

    suspend fun invalidateArticleCaches(articleId: String) {
        // Targeted invalidation for a single markRead. The SSE read-state
        // event handles the in-memory `state.articles` patch, so we
        // don't need to blow away every cached list here. We only drop
        // the article detail and the stats aggregate; feeds/categories
        // are refreshed lazily on the next unread-count read.
        invalidateArticleDetailCache(articleId)
        invalidateByPrefix("stats")
        offlineCacheStore.clearByPrefix("article-$articleId")
    }

    private suspend fun invalidateArticleDetailCache(articleId: String) {
        invalidateByPrefix("article:$articleId")
        offlineCacheStore.clearByPrefix("article-$articleId")
    }

    suspend fun invalidateReadStateCaches(articleId: String? = null) {
        if (articleId != null) {
            invalidateByPrefix("article:$articleId")
            offlineCacheStore.clearByPrefix("article-$articleId")
        }
        invalidateFeedAndArticleCaches()
    }

    private suspend fun clearCacheAndDatabase() {
        clearCache()
        localStore.clearAll()
        offlineCacheStore.clearAll()
    }

    private fun clearCache() {
        val clearedEntries = cache.size.toLong()
        cache.clear()
        cacheLocks.clear()
        cacheInvalidationCount.incrementAndGet()
        cacheInvalidatedEntriesCount.addAndGet(clearedEntries)
    }

    private suspend fun invalidateFeedAndArticleCaches() {
        invalidateByPrefix("feeds")
        invalidateByPrefix("articles")
        invalidateByPrefix("search")
        invalidateByPrefix("stats")
        invalidateByPrefix("categories")
        offlineCacheStore.clearByPrefix("feeds")

        localStore.clearTable(LocalStore.TABLE_FEEDS)
        offlineCacheStore.clearByPrefix("categories")

        localStore.clearTable(LocalStore.TABLE_CATEGORIES)
        offlineCacheStore.clearByPrefix("articles-")

        localStore.clearTable(LocalStore.TABLE_ARTICLE_PAGES)
    }

    private fun readStateEventsOnce(): Flow<ReadStateSyncEvent> = callbackFlow stream@ {
        val request = Request.Builder()
            .url("${BuildConfig.API_BASE_URL.trimEnd('/')}/events/read-state")
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .build()
        val call = readStateClient.newCall(request)
        call.enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (call.isCanceled()) {
                        this@stream.close()
                    } else {
                        this@stream.close(e)
                    }
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (!response.isSuccessful) {
                            this@stream.close(IOException("Read-state stream failed with HTTP ${response.code}"))
                            return
                        }

                        val body = response.body
                        if (body == null) {
                            this@stream.close(IOException("Read-state stream response did not include a body"))
                            return
                        }

                        val parser = SseEventParser()
                        try {
                            val source = body.source()
                            while (!call.isCanceled()) {
                                val line = source.readUtf8Line() ?: break
                                parser.pushLine(line)
                                    ?.toReadStateEvent(readStateEventAdapter)
                                    ?.let { this@stream.trySend(it) }
                            }
                            parser.flush()
                                ?.toReadStateEvent(readStateEventAdapter)
                                ?.let { this@stream.trySend(it) }
                            this@stream.close()
                        } catch (e: IOException) {
                            if (call.isCanceled()) {
                                this@stream.close()
                            } else {
                                this@stream.close(e)
                            }
                        }
                    }
                }
            },
        )

        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    private fun readStateReconnectDelay(attempt: Int): Long =
        (READ_STATE_RECONNECT_INITIAL_DELAY_MS * (1L shl attempt.coerceAtMost(5)))
            .coerceAtMost(READ_STATE_RECONNECT_MAX_DELAY_MS)

    private fun parseEventId(raw: String): Long = raw.toLongOrNull() ?: 0L

    private fun debugLog(message: String) {
        if (!BuildConfig.DEBUG) return
        Log.d("RssRepository", message)
    }

    private data class CacheEntry<T>(
        val value: T,
        val expiresAt: Long,
        var lastAccessMs: Long,
    )

    private companion object {
        const val READ_RETRY_MAX_ATTEMPTS = 3
        const val READ_RETRY_INITIAL_DELAY_MS = 300L
        const val READ_RETRY_MAX_DELAY_MS = 2_000L
        const val READ_STATE_RECONNECT_INITIAL_DELAY_MS = 1_000L
        const val READ_STATE_RECONNECT_MAX_DELAY_MS = 30_000L
        const val READ_STATE_RECONNECT_MAX_ATTEMPTS = 50
        val RETRIABLE_HTTP_CODES = setOf(408, 425, 429, 500, 502, 503, 504)

        const val USER_TTL_MS = 30_000L
        const val CATEGORIES_TTL_MS = 60_000L
        const val FEEDS_TTL_MS = 60_000L
        const val ARTICLES_TTL_MS = 30_000L
        const val ARTICLE_DETAIL_TTL_MS = 60_000L
        const val SEARCH_TTL_MS = 30_000L
        const val PREFERENCES_TTL_MS = 60_000L
        const val STATS_TTL_MS = 30_000L
        const val ADMIN_SETTINGS_TTL_MS = 60_000L
        const val OPML_EXPORT_TTL_MS = 30_000L
        const val ARTICLE_IMAGE_PREFETCH_LIMIT = 5
        const val MAX_MEMORY_CACHE_ENTRIES = 160
    }
}
