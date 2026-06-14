package com.selffeed.android.data.repository

import com.selffeed.android.data.AppResult
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    suspend fun registrationStatus(): AppResult<RegistrationStatusResponse>
    suspend fun login(email: String, password: String): AppResult<User>
    suspend fun register(email: String, password: String): AppResult<User>
    suspend fun logout(): AppResult<Boolean>
    suspend fun me(): AppResult<User>
    fun isLoggedIn(): Boolean
}

interface FeedRepository {
    suspend fun categories(): AppResult<List<CategoryWithCounts>>
    suspend fun createCategory(name: String, parentCategoryId: String? = null): AppResult<CategoryWithCounts>
    suspend fun updateCategory(id: String, name: String?, parentCategoryId: String?): AppResult<CategoryWithCounts>
    suspend fun deleteCategory(id: String): AppResult<Boolean>
    suspend fun feeds(categoryId: String? = null): AppResult<List<FeedWithCounts>>
    suspend fun createFeed(feedUrl: String, categoryId: String, title: String?): AppResult<FeedWithCounts>
    suspend fun updateFeed(
        id: String,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): AppResult<FeedWithCounts>
    suspend fun deleteFeed(id: String): AppResult<Boolean>
    suspend fun syncFeed(id: String): AppResult<SyncResponse>
    suspend fun syncAllFeeds(): AppResult<SyncResponse>
    suspend fun importOpml(fileName: String, fileBytes: ByteArray): AppResult<OpmlImportSummary>
    suspend fun exportOpml(): AppResult<String>
}

interface ArticleRepository {
    suspend fun articles(
        feedId: String? = null,
        categoryId: String? = null,
        unreadOnly: Boolean? = null,
        sort: String? = null,
        limit: Int? = 30,
        cursor: String? = null,
    ): AppResult<ApiListResponse<ArticleListItem>>

    suspend fun article(articleId: String, forceRefresh: Boolean = false): AppResult<ArticleDetail>
    fun cachedArticleDetail(articleId: String): ArticleDetail?
    suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail>
    suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail>
    fun prefetchHeroImages(imageUrls: Iterable<String?>)
    suspend fun enrichArticle(articleId: String, invalidateCaches: Boolean = true): AppResult<EnrichArticleResponse>
    suspend fun markRead(articleId: String, read: Boolean): AppResult<Boolean>
    suspend fun markAllRead(feedId: String? = null, categoryId: String? = null): AppResult<Int>
    fun clientId(): String
    fun readStateEvents(): Flow<ReadStateSyncEvent>
    suspend fun invalidateReadStateCaches(articleId: String? = null)
}

interface SearchRepository {
    suspend fun search(
        query: String,
        categoryId: String? = null,
        cursor: String? = null,
    ): AppResult<ApiListResponse<ArticleListItem>>
}

interface SettingsRepository {
    suspend fun preferences(): AppResult<UserPreferences>
    suspend fun updatePreferences(request: UpdatePreferencesRequest): AppResult<UserPreferences>
    suspend fun stats(): AppResult<StatsResponse>
    suspend fun adminSettings(): AppResult<AppSettingsResponse>
    suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse>
    fun getDebugResilienceSnapshot(): Map<String, Long>
    fun resetDebugResilienceMetrics()
}

interface AppStatusRepository {
    fun isOnline(): Boolean
    fun observeOnline(): Flow<Boolean>
}

interface SelfFeedRepository :
    AuthRepository,
    FeedRepository,
    ArticleRepository,
    SearchRepository,
    SettingsRepository,
    AppStatusRepository {
    fun trimMemoryCaches()
}
