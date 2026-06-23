package com.selffeed.android.data

import androidx.paging.PagingData
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.MarkAllReadResponse
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.network.normalizeApiServerHost
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FakeSelfFeedRepository @Inject constructor() : SelfFeedRepository {
    private val online = MutableStateFlow(true)
    private var apiBaseUrl = "10.0.2.2:3000"
    private var authenticated = true
    private var preferences = defaultPreferences
    private var articleDetailDelayMs = 0L
    private val articleReadStates = mutableMapOf<String, Boolean>()
    private val fakeArticles = listOf(
        ArticleListItem(
            id = "article-1",
            feedId = "feed-1",
            feedTitle = "Injected Feed",
            title = "Injected Article",
            excerpt = "Rendered from the Hilt test repository",
            isRead = false,
        ),
        ArticleListItem(
            id = "article-2",
            feedId = "feed-1",
            feedTitle = "Injected Feed",
            title = "Injected Article 2",
            excerpt = "Second rendered article from the Hilt test repository",
            isRead = false,
        ),
        ArticleListItem(
            id = "article-3",
            feedId = "feed-1",
            feedTitle = "Injected Feed",
            title = "Injected Article 3",
            excerpt = "Third rendered article from the Hilt test repository",
            isRead = false,
        ),
    )

    override suspend fun registrationStatus(): AppResult<RegistrationStatusResponse> =
        AppResult.Success(RegistrationStatusResponse(registrationEnabled = true))

    override fun getApiBaseUrl(): String = apiBaseUrl
    override suspend fun setApiBaseUrl(rawBaseUrl: String): AppResult<String> {
        apiBaseUrl = normalizeApiServerHost(rawBaseUrl)
        return AppResult.Success(apiBaseUrl)
    }

    fun reset(authenticated: Boolean = true, hideRead: Boolean = false) {
        this.authenticated = authenticated
        apiBaseUrl = "10.0.2.2:3000"
        preferences = defaultPreferences.copy(hideRead = hideRead)
        articleDetailDelayMs = 0L
        articleReadStates.clear()
    }

    fun delayArticleDetailsBy(delayMs: Long) {
        articleDetailDelayMs = delayMs
    }

    override suspend fun login(email: String, password: String): AppResult<User> {
        authenticated = true
        return AppResult.Success(fakeUser)
    }

    override suspend fun register(email: String, password: String): AppResult<User> {
        authenticated = true
        return AppResult.Success(fakeUser)
    }

    override suspend fun restoreSession(): AppResult<User> =
        if (authenticated) AppResult.Success(fakeUser) else AppResult.Error("No saved session")

    override suspend fun logout(): AppResult<Boolean> {
        authenticated = false
        return AppResult.Success(true)
    }
    override suspend fun me(): AppResult<User> = AppResult.Success(fakeUser)
    override fun isLoggedIn(): Boolean = authenticated
    override fun authEvents(): Flow<String> = emptyFlow()

    override suspend fun categories(): AppResult<List<CategoryWithCounts>> = AppResult.Success(
        listOf(
            CategoryWithCounts(
                id = "category-1",
                name = "Injected Category",
                slug = "injected-category",
                sortOrder = 0,
                feedCount = 1,
                unreadCount = unreadCount(),
            ),
        ),
    )

    override suspend fun createCategory(name: String, parentCategoryId: String?): AppResult<CategoryWithCounts> =
        AppResult.Error("Not supported in fake")

    override suspend fun updateCategory(
        id: String,
        name: String?,
        parentCategoryId: String?,
    ): AppResult<CategoryWithCounts> = AppResult.Error("Not supported in fake")

    override suspend fun deleteCategory(id: String): AppResult<Boolean> = AppResult.Error("Not supported in fake")

    override suspend fun feeds(categoryId: String?): AppResult<List<FeedWithCounts>> = AppResult.Success(
        listOf(
            FeedWithCounts(
                id = "feed-1",
                categoryId = "category-1",
                title = "Injected Feed",
                feedUrl = "https://example.com/feed.xml",
                pollingIntervalMinutes = 60,
                syncStatus = "idle",
                unreadCount = unreadCount(),
            ),
        ),
    )

    override suspend fun createFeed(feedUrl: String, categoryId: String, title: String?): AppResult<FeedWithCounts> =
        AppResult.Error("Not supported in fake")

    override suspend fun updateFeed(
        id: String,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): AppResult<FeedWithCounts> = AppResult.Error("Not supported in fake")

    override suspend fun deleteFeed(id: String): AppResult<Boolean> = AppResult.Error("Not supported in fake")
    override suspend fun syncFeed(id: String): AppResult<SyncResponse> = AppResult.Success(SyncResponse(syncedFeeds = 1))
    override suspend fun syncAllFeeds(): AppResult<SyncResponse> = AppResult.Success(SyncResponse(syncedFeeds = 1))
    override suspend fun importOpml(fileName: String, fileBytes: ByteArray) =
        AppResult.Error("Not supported in fake")

    override suspend fun exportOpml(): AppResult<String> = AppResult.Success("")

    override suspend fun articles(
        feedId: String?,
        categoryId: String?,
        unreadOnly: Boolean?,
        sort: String?,
        limit: Int?,
        cursor: String?,
    ): AppResult<ApiListResponse<ArticleListItem>> =
        AppResult.Success(ApiListResponse(data = currentArticles(unreadOnly), cursor = null, hasMore = false))

    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> {
        val overrides = readStateOverrides()
        val articles = currentArticles(query.unreadOnly).map { article ->
            overrides[article.id]?.let { article.copy(isRead = it) } ?: article
        }
        return flowOf(PagingData.from(articles))
    }

    override suspend fun article(articleId: String, forceRefresh: Boolean): AppResult<ArticleDetail> {
        if (articleDetailDelayMs > 0L) {
            delay(articleDetailDelayMs)
        }
        return AppResult.Success(fakeArticleDetail(articleId))
    }

    override fun cachedArticleDetail(articleId: String): ArticleDetail? = null
    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> =
        AppResult.Success(fakeArticleDetail(articleId))

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        AppResult.Success(fakeArticleDetail(articleId))

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) = Unit
    override suspend fun enrichArticle(articleId: String, invalidateCaches: Boolean): AppResult<EnrichArticleResponse> =
        AppResult.Success(EnrichArticleResponse(success = true))

    override suspend fun markRead(articleId: String, read: Boolean, source: String): AppResult<Boolean> {
        articleReadStates[articleId] = read
        return AppResult.Success(read)
    }
    override suspend fun markAllRead(feedId: String?, categoryId: String?): AppResult<MarkAllReadResponse> {
        val unreadBefore = unreadCount()
        fakeArticles.forEach { articleReadStates[it.id] = true }
        return AppResult.Success(MarkAllReadResponse(markedCount = unreadBefore, feedIds = listOf("feed-1")))
    }
    override fun clientId(): String = "android-test-client"
    override fun readStateEvents(): Flow<ReadStateSyncEvent> = emptyFlow()
    override suspend fun invalidateReadStateCaches(articleId: String?) = Unit
    override suspend fun updateCachedReadState(articleId: String, read: Boolean) {
        articleReadStates[articleId] = read
    }
    override suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>) {
        fakeArticles
            .filter { feedIds.isEmpty() || it.feedId in feedIds }
            .forEach { articleReadStates[it.id] = true }
    }

    override suspend fun search(query: String, categoryId: String?, cursor: String?) =
        AppResult.Success(ApiListResponse(data = currentArticles(), cursor = null, hasMore = false))

    override suspend fun preferences(): AppResult<UserPreferences> = AppResult.Success(preferences)
    override suspend fun updatePreferences(request: UpdatePreferencesRequest): AppResult<UserPreferences> {
        preferences = preferences.copy(
            theme = request.theme ?: preferences.theme,
            fontFamily = request.fontFamily ?: preferences.fontFamily,
            textSize = request.textSize ?: preferences.textSize,
            density = request.density ?: preferences.density,
            defaultSort = request.defaultSort ?: preferences.defaultSort,
            hideRead = request.hideRead ?: preferences.hideRead,
            keyboardShortcutsEnabled = request.keyboardShortcutsEnabled ?: preferences.keyboardShortcutsEnabled,
            autoMarkReadMode = request.autoMarkReadMode ?: preferences.autoMarkReadMode,
        )
        return AppResult.Success(preferences)
    }

    override suspend fun stats(): AppResult<StatsResponse> =
        AppResult.Success(
            StatsResponse(
                totalUnread = unreadCount(),
                totalRead = fakeArticles.size - unreadCount(),
                totalFeeds = 1,
                totalCategories = 1,
            ),
        )

    override suspend fun authSessions(): AppResult<List<AuthSession>> = AppResult.Success(listOf(fakeSession))

    override suspend fun revokeAuthSession(id: String): AppResult<Boolean> = AppResult.Success(true)

    override suspend fun adminSettings(): AppResult<AppSettingsResponse> =
        AppResult.Success(AppSettingsResponse(registrationLocked = false))

    override suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse> =
        AppResult.Success(AppSettingsResponse(registrationLocked = registrationLocked))

    override fun getDebugResilienceSnapshot(): Map<String, Long> = emptyMap()
    override fun resetDebugResilienceMetrics() = Unit
    override fun isOnline(): Boolean = online.value
    override fun observeOnline(): Flow<Boolean> = online
    override fun trimMemoryCaches() = Unit

    private fun currentArticles(unreadOnly: Boolean? = null): List<ArticleListItem> =
        fakeArticles
            .map { article -> article.copy(isRead = articleReadStates[article.id] ?: article.isRead) }
            .filter { article -> unreadOnly != true || !article.isRead }

    private fun unreadCount(): Int = fakeArticles.count { articleReadStates[it.id] != true }

    private fun fakeArticleDetail(articleId: String): ArticleDetail {
        val article = fakeArticles.firstOrNull { it.id == articleId }
        return ArticleDetail(
            id = articleId,
            feedId = article?.feedId ?: "feed-1",
            guid = articleId,
            canonicalUrl = "https://example.com/articles/$articleId",
            title = article?.title ?: "Injected Article",
            excerpt = article?.excerpt,
            contentText = article?.excerpt ?: "Body",
            heroImageUrl = article?.heroImageUrl,
            publishedAt = article?.publishedAt,
            hash = "hash-$articleId",
            feedTitle = article?.feedTitle ?: "Injected Feed",
            feedFaviconUrl = article?.feedFaviconUrl,
            media = emptyList(),
            isRead = articleReadStates[articleId] ?: article?.isRead ?: false,
            isEnriched = false,
        )
    }

    private companion object {
        val fakeUser = User(id = "user-1", email = "reader@example.com", role = "user", isActive = true)
        val fakeSession = AuthSession(
            id = "session-1",
            deviceName = "Android test device",
            ipAddress = "127.0.0.1",
            createdAt = "2026-06-21T00:00:00.000Z",
            lastSeenAt = "2026-06-21T00:00:00.000Z",
            current = true,
        )
        val defaultPreferences = UserPreferences(
            theme = "system",
            fontFamily = "system",
            textSize = 16,
            density = "comfortable",
            defaultSort = "newest",
            hideRead = false,
            keyboardShortcutsEnabled = true,
            autoMarkReadMode = "off",
        )
    }
}
