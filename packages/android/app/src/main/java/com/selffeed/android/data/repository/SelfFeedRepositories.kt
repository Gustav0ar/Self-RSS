package com.selffeed.android.data.repository

import com.selffeed.android.network.CategoryOrderUpdate
import androidx.paging.PagingData
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ApiSession
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
import kotlinx.coroutines.flow.emptyFlow

/** An authentication result keeps its account identity even after that account ends. */
sealed interface AuthenticatedSession {
    val session: ApiSession

    data class Verified(override val session: ApiSession, val user: User) : AuthenticatedSession
    data class Offline(override val session: ApiSession) : AuthenticatedSession
}

interface AuthRepository {
    fun isCurrentSession(session: ApiSession): Boolean
    fun getApiBaseUrl(): String
    suspend fun setApiBaseUrl(rawBaseUrl: String): AppResult<String>
    suspend fun registrationStatus(): AppResult<RegistrationStatusResponse>
    suspend fun login(email: String, password: String): AppResult<AuthenticatedSession.Verified>
    suspend fun register(email: String, password: String): AppResult<AuthenticatedSession.Verified>
    suspend fun restoreSession(): AppResult<AuthenticatedSession>
    suspend fun logout(): AppResult<Boolean>
    suspend fun me(): AppResult<User>
    suspend fun changePassword(currentPassword: String, newPassword: String): AppResult<User>
    fun isLoggedIn(): Boolean
    fun authEvents(): Flow<String>
}

/** Complete durable count projection. Null totals mean no usable aggregate has been stored yet. */
data class LibraryCounts(
    val feedUnread: Map<String, Int> = emptyMap(),
    val categoryUnread: Map<String, Int> = emptyMap(),
    val totalRead: Int? = null,
    val totalUnread: Int? = null,
)

interface LibraryCountsRepository {
    fun libraryCounts(): Flow<LibraryCounts>
}

interface FeedRepository : LibraryCountsRepository {
    fun countRefreshRequests(): Flow<Unit>
    /** Emits stored content first; the collector owns the subsequent freshness request. */
    fun categoryUpdates(): Flow<AppResult<List<CategoryWithCounts>>>
    fun feedUpdates(): Flow<AppResult<List<FeedWithCounts>>>
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

    suspend fun reorderCategories(updates: List<CategoryOrderUpdate>): AppResult<Unit>

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

/** Identifies the durable local choice, independently of transport retries or observer timing. */
data class ArticleMutationReceipt(val mutationId: String)

data class SavedStateRejection(val articleId: String, val restoredSaved: Boolean?, val mutationId: String)
data class ReadStateRejection(val articleId: String, val mutationId: String)

data class LocalArticleState(
    val isRead: Boolean?,
    val isSaved: Boolean?,
    val pendingReadMutationId: String? = null,
    val pendingSavedMutationId: String? = null,
    val lastReadMutationId: String? = null,
    val lastSavedMutationId: String? = null,
    val readRevision: Int? = null,
    val savedRevision: Int? = null,
)

interface ArticleRepository {
    fun observeArticleStates(articleIds: Set<String>): Flow<AppResult<Map<String, LocalArticleState>>>
    suspend fun refreshArticleStates(articleIds: Set<String>): AppResult<Unit>
    suspend fun localArticleState(articleId: String): AppResult<LocalArticleState>
    fun observePendingArticleChanges(): Flow<Int> = emptyFlow()
    fun observeArticleTextAvailability(articleId: String): Flow<Boolean> = emptyFlow()
    suspend fun retryPendingArticleChanges() = Unit
    fun articlePagingData(
        query: ArticlePageQuery,
    ): Flow<PagingData<ArticleListItem>>

    suspend fun article(articleId: String, forceRefresh: Boolean = false): AppResult<ArticleDetail>
    fun cachedArticleDetail(articleId: String): ArticleDetail?
    suspend fun readCachedArticleDetail(articleId: String): ArticleDetail?
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
    ): AppResult<ArticleMutationReceipt>

    suspend fun setSaved(articleId: String, saved: Boolean): AppResult<ArticleMutationReceipt>
    fun savedStateRejections(): Flow<SavedStateRejection> = emptyFlow()
    fun readStateRejections(): Flow<ReadStateRejection> = emptyFlow()
    suspend fun markAllRead(
        feedId: String? = null,
        categoryId: String? = null
    ): AppResult<MarkAllReadResponse>

    fun clientId(): String
    fun readStateEvents(): Flow<ReadStateSyncEvent>
    suspend fun invalidateReadStateCaches(articleId: String? = null)
    suspend fun invalidateArticleContentCaches(articleId: String? = null)
    suspend fun updateCachedReadState(articleId: String, read: Boolean, revision: Int? = null): Boolean?
    suspend fun updateCachedSavedState(articleId: String, saved: Boolean, revision: Int? = null)
    suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>): BulkReadReconciliation
    suspend fun recordArticleCompletion(articleId: String) = Unit
}

interface SearchRepository {
    suspend fun search(
        query: String,
        categoryId: String? = null,
        cursor: String? = null,
    ): AppResult<ApiListResponse<ArticleListItem>>
}

interface SettingsRepository : LibraryCountsRepository {
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
    fun accountAccess(ownerId: String): AccountAccess
    fun trimMemoryCaches()
}

/** Local read choices that a remote bulk receipt must preserve. */
data class BulkReadReconciliation(
    val unreadArticleFeeds: Map<String, String> = emptyMap(),
    val affectedArticleIds: Set<String> = emptySet(),
)
