package com.selffeed.android.data

import androidx.paging.PagingData
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FakeSelfFeedRepository @Inject constructor() : SelfFeedRepository {
    private val online = MutableStateFlow(true)
    private val fakeArticles = listOf(
        ArticleListItem(
            id = "article-1",
            feedId = "feed-1",
            feedTitle = "Injected Feed",
            title = "Injected Article",
            excerpt = "Rendered from the Hilt test repository",
            isRead = false,
        ),
    )

    override suspend fun registrationStatus(): AppResult<RegistrationStatusResponse> =
        AppResult.Success(RegistrationStatusResponse(registrationEnabled = true))

    override suspend fun login(email: String, password: String): AppResult<User> = AppResult.Success(fakeUser)
    override suspend fun register(email: String, password: String): AppResult<User> = AppResult.Success(fakeUser)
    override suspend fun logout(): AppResult<Boolean> = AppResult.Success(true)
    override suspend fun me(): AppResult<User> = AppResult.Success(fakeUser)
    override fun isLoggedIn(): Boolean = true

    override suspend fun categories(): AppResult<List<CategoryWithCounts>> = AppResult.Success(
        listOf(
            CategoryWithCounts(
                id = "category-1",
                name = "Injected Category",
                slug = "injected-category",
                sortOrder = 0,
                feedCount = 1,
                unreadCount = 1,
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
                unreadCount = 1,
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
    ): AppResult<ApiListResponse<ArticleListItem>> = AppResult.Success(
        ApiListResponse(data = fakeArticles, cursor = null, hasMore = false),
    )

    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> = flowOf(PagingData.from(fakeArticles))

    override suspend fun article(articleId: String, forceRefresh: Boolean): AppResult<ArticleDetail> =
        AppResult.Success(fakeArticleDetail(articleId))

    override fun cachedArticleDetail(articleId: String): ArticleDetail? = null
    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> =
        AppResult.Success(fakeArticleDetail(articleId))

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        AppResult.Success(fakeArticleDetail(articleId))

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) = Unit
    override suspend fun enrichArticle(articleId: String, invalidateCaches: Boolean): AppResult<EnrichArticleResponse> =
        AppResult.Success(EnrichArticleResponse(success = true))

    override suspend fun markRead(articleId: String, read: Boolean): AppResult<Boolean> = AppResult.Success(read)
    override suspend fun markAllRead(feedId: String?, categoryId: String?): AppResult<MarkAllReadResponse> =
        AppResult.Success(MarkAllReadResponse(markedCount = 1, feedIds = listOf("feed-1")))
    override fun clientId(): String = "android-test-client"
    override fun readStateEvents(): Flow<ReadStateSyncEvent> = emptyFlow()
    override suspend fun invalidateReadStateCaches(articleId: String?) = Unit

    override suspend fun search(query: String, categoryId: String?, cursor: String?) =
        AppResult.Success(ApiListResponse(data = fakeArticles, cursor = null, hasMore = false))

    override suspend fun preferences(): AppResult<UserPreferences> = AppResult.Success(fakePreferences)
    override suspend fun updatePreferences(request: UpdatePreferencesRequest): AppResult<UserPreferences> =
        AppResult.Success(fakePreferences.copy(hideRead = request.hideRead ?: fakePreferences.hideRead))

    override suspend fun stats(): AppResult<StatsResponse> =
        AppResult.Success(StatsResponse(totalUnread = 1, totalRead = 0, totalFeeds = 1, totalCategories = 1))

    override suspend fun adminSettings(): AppResult<AppSettingsResponse> =
        AppResult.Success(AppSettingsResponse(registrationLocked = false))

    override suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse> =
        AppResult.Success(AppSettingsResponse(registrationLocked = registrationLocked))

    override fun getDebugResilienceSnapshot(): Map<String, Long> = emptyMap()
    override fun resetDebugResilienceMetrics() = Unit
    override fun isOnline(): Boolean = online.value
    override fun observeOnline(): Flow<Boolean> = online
    override fun trimMemoryCaches() = Unit

    private fun fakeArticleDetail(articleId: String) = ArticleDetail(
        id = articleId,
        feedId = "feed-1",
        guid = articleId,
        canonicalUrl = "https://example.com/articles/$articleId",
        title = "Injected Article",
        contentText = "Body",
        hash = "hash-$articleId",
        feedTitle = "Injected Feed",
        media = emptyList(),
        isRead = false,
        isEnriched = false,
    )

    private companion object {
        val fakeUser = User(id = "user-1", email = "reader@example.com", role = "user", isActive = true)
        val fakePreferences = UserPreferences(
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
