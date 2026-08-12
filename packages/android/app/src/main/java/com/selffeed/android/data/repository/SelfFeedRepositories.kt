package com.selffeed.android.data.repository

import androidx.paging.PagingData
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ArticlePageQuery
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.FeedSyncHistoryResponse
import com.selffeed.android.network.MarkAllReadResponse
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
    fun getApiBaseUrl(): String
    suspend fun setApiBaseUrl(rawBaseUrl: String): AppResult<String>
    suspend fun registrationStatus(): AppResult<RegistrationStatusResponse>
    suspend fun login(email: String, password: String): AppResult<User>
    suspend fun register(email: String, password: String): AppResult<User>
    suspend fun restoreSession(): AppResult<User>
    suspend fun logout(): AppResult<Boolean>
    suspend fun me(): AppResult<User>
    suspend fun changePassword(currentPassword: String, newPassword: String): AppResult<User>
    fun isLoggedIn(): Boolean
    fun authEvents(): Flow<String>
    suspend fun recordOfflineRestore() = Unit
}

interface FeedRepository {
    suspend fun categories(): AppResult<List<CategoryWithCounts>>
    suspend fun createCategory(
        name: String,
        parentCategoryId: String? = null
    ): AppResult<CategoryWithCounts>

    suspend fun updateCategory(
        id: String,
        name: String?,
        parentCategoryId: String?
    ): AppResult<CategoryWithCounts>

    suspend fun deleteCategory(id: String): AppResult<Boolean>
    suspend fun feeds(categoryId: String? = null): AppResult<List<FeedWithCounts>>
    suspend fun refreshFeeds(categoryId: String? = null): AppResult<List<FeedWithCounts>> =
        feeds(categoryId)

    suspend fun createFeed(
        feedUrl: String,
        categoryId: String,
        title: String?
    ): AppResult<FeedWithCounts>

    suspend fun updateFeed(
        id: String,
        feedUrl: String?,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): AppResult<FeedWithCounts>

    suspend fun deleteFeed(id: String): AppResult<Boolean>
    suspend fun syncFeed(id: String): AppResult<SyncResponse>
    suspend fun syncAllFeeds(
        feedId: String? = null,
        categoryId: String? = null
    ): AppResult<SyncResponse>

    suspend fun syncAllFeedsStatus(requestId: String? = null): AppResult<FeedSyncAllStatus>
    suspend fun feedSyncHistory(feedId: String): AppResult<FeedSyncHistoryResponse>
    suspend fun selectDiscoveryCandidate(candidateId: String): AppResult<FeedWithCounts>
    suspend fun cancelFeedReplacement(feedId: String): AppResult<FeedWithCounts>
    suspend fun importOpml(fileName: String, fileBytes: ByteArray): AppResult<OpmlImportSummary>
    suspend fun exportOpml(): AppResult<String>
}

interface ArticleRepository {
    fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean> = { emptyMap() },
    ): Flow<PagingData<ArticleListItem>>

    suspend fun article(articleId: String, forceRefresh: Boolean = false): AppResult<ArticleDetail>
    fun cachedArticleDetail(articleId: String): ArticleDetail?
    suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail>
    suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail>
    fun prefetchHeroImages(imageUrls: Iterable<String?>)
    suspend fun enrichArticle(
        articleId: String,
        invalidateCaches: Boolean = true
    ): AppResult<EnrichArticleResponse>

    suspend fun markRead(
        articleId: String,
        read: Boolean,
        source: String = "manual"
    ): AppResult<Boolean>

    suspend fun setSaved(articleId: String, saved: Boolean): AppResult<Boolean>
    suspend fun markAllRead(
        feedId: String? = null,
        categoryId: String? = null
    ): AppResult<MarkAllReadResponse>

    fun clientId(): String
    fun readStateEvents(): Flow<ReadStateSyncEvent>
    suspend fun invalidateReadStateCaches(articleId: String? = null)
    suspend fun invalidateArticleContentCaches(articleId: String? = null)
    suspend fun updateCachedReadState(articleId: String, read: Boolean)
    suspend fun updateCachedSavedState(articleId: String, saved: Boolean)
    suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>)
    suspend fun recordArticleCompletion(articleId: String) = Unit
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
    suspend fun authSessions(): AppResult<List<AuthSession>>
    suspend fun revokeAuthSession(id: String): AppResult<Boolean>
    suspend fun adminSettings(): AppResult<AppSettingsResponse>
    suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse>
    suspend fun adminUsers(): AppResult<List<User>>
    suspend fun adminCreateUser(email: String, password: String, role: String): AppResult<User>
    suspend fun adminUpdateUser(
        id: String,
        role: String? = null,
        isActive: Boolean? = null
    ): AppResult<User>

    suspend fun adminResetPassword(id: String, password: String): AppResult<User>
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
