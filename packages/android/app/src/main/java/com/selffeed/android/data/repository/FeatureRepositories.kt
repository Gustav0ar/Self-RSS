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
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.EnrichArticleResponse
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
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : AuthRepository {
    override fun isCurrentSession(session: ApiSession): Boolean = source.isCurrentSession(session)
    override fun getApiBaseUrl(): String = source.getApiBaseUrl()
    override suspend fun setApiBaseUrl(rawBaseUrl: String): AppResult<String> =
        source.setApiBaseUrl(rawBaseUrl)

    override suspend fun registrationStatus(): AppResult<RegistrationStatusResponse> =
        source.registrationStatus()

    override suspend fun login(email: String, password: String): AppResult<AuthenticatedSession.Verified> =
        source.login(email, password)

    override suspend fun register(email: String, password: String): AppResult<AuthenticatedSession.Verified> =
        source.register(email, password)

    override suspend fun restoreSession(): AppResult<AuthenticatedSession> = source.restoreSession()
    override suspend fun logout(): AppResult<Boolean> = source.logout()
    override suspend fun me(): AppResult<User> = source.me()
    override suspend fun changePassword(
        currentPassword: String,
        newPassword: String
    ): AppResult<User> =
        source.changePassword(currentPassword, newPassword)

    override fun isLoggedIn(): Boolean = source.isLoggedIn()
    override fun authEvents(): Flow<String> = source.authEvents()
}

class FeedRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
    private val access: AccountAccess,
) : FeedRepository {
    override suspend fun categories(): AppResult<List<CategoryWithCounts>> = access.withAccount { source.categories() }
    override suspend fun createCategory(
        name: String,
        parentCategoryId: String?
    ): AppResult<CategoryWithCounts> =
        access.withAccount { source.createCategory(name, parentCategoryId) }

    override suspend fun updateCategory(
        id: String,
        name: String?,
        parentCategoryId: String?,
    ): AppResult<CategoryWithCounts> = access.withAccount { source.updateCategory(id, name, parentCategoryId) }

    override suspend fun reorderCategories(updates: List<CategoryOrderUpdate>): AppResult<Unit> =
        access.withAccount { source.reorderCategories(updates) }

    override suspend fun deleteCategory(id: String): AppResult<Boolean> = access.withAccount { source.deleteCategory(id) }
    override suspend fun feeds(categoryId: String?): AppResult<List<FeedWithCounts>> =
        access.withAccount { source.feeds(categoryId) }

    override suspend fun refreshFeeds(categoryId: String?): AppResult<List<FeedWithCounts>> =
        access.withAccount { source.refreshFeeds(categoryId) }

    override suspend fun createFeed(
        feedUrl: String,
        categoryId: String,
        title: String?
    ): AppResult<FeedWithCounts> =
        access.withAccount { source.createFeed(feedUrl, categoryId, title) }

    override suspend fun updateFeed(
        id: String,
        feedUrl: String?,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): AppResult<FeedWithCounts> =
        access.withAccount { source.updateFeed(id, feedUrl, categoryId, title, pollingIntervalMinutes) }

    override suspend fun deleteFeed(id: String): AppResult<Boolean> = access.withAccount { source.deleteFeed(id) }
    override suspend fun syncFeed(id: String): AppResult<SyncResponse> = access.withAccount { source.syncFeed(id) }
    override suspend fun syncAllFeeds(
        feedId: String?,
        categoryId: String?
    ): AppResult<SyncResponse> =
        access.withAccount { source.syncAllFeeds(feedId, categoryId) }

    override suspend fun syncAllFeedsStatus(requestId: String?): AppResult<FeedSyncAllStatus> =
        access.withAccount { source.syncAllFeedsStatus(requestId) }

    override suspend fun feedSyncHistory(feedId: String): AppResult<FeedSyncHistoryResponse> =
        access.withAccount { source.feedSyncHistory(feedId) }

    override suspend fun selectDiscoveryCandidate(candidateId: String): AppResult<FeedWithCounts> =
        access.withAccount { source.selectDiscoveryCandidate(candidateId) }

    override suspend fun cancelFeedReplacement(feedId: String): AppResult<FeedWithCounts> =
        access.withAccount { source.cancelFeedReplacement(feedId) }

    override suspend fun importOpml(
        fileName: String,
        fileBytes: ByteArray
    ): AppResult<OpmlImportSummary> =
        access.withAccount { source.importOpml(fileName, fileBytes) }

    override suspend fun exportOpml(): AppResult<String> = access.withAccount { source.exportOpml() }
}

class ArticleRepositoryImpl @Inject constructor(
    private val delegate: SelfFeedRepository,
    private val access: AccountAccess,
) : ArticleRepository {
    override fun observePendingArticleChanges(): Flow<Int> =
        access.observe { delegate.observePendingArticleChanges() }
    override fun observeArticleTextAvailability(articleId: String): Flow<Boolean> =
        access.observe { delegate.observeArticleTextAvailability(articleId) }
    override suspend fun retryPendingArticleChanges() =
        access.withAccount { delegate.retryPendingArticleChanges() }

    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> = access.observe { delegate.articlePagingData(query, readStateOverrides) }

    override suspend fun article(
        articleId: String,
        forceRefresh: Boolean
    ): AppResult<ArticleDetail> =
        access.withAccount { delegate.article(articleId, forceRefresh) }

    override fun cachedArticleDetail(articleId: String): ArticleDetail? =
        access.read { delegate.cachedArticleDetail(articleId) }

    override suspend fun readCachedArticleDetail(articleId: String): ArticleDetail? =
        access.withAccount { delegate.readCachedArticleDetail(articleId) }

    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> =
        access.withAccount { delegate.prefetchArticle(articleId) }

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        access.withAccount { delegate.refreshArticleDetail(articleId) }

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) {
        if (access.isCurrent()) delegate.prefetchHeroImages(imageUrls)
    }

    override suspend fun enrichArticle(
        articleId: String,
        invalidateCaches: Boolean,
    ): AppResult<EnrichArticleResponse> = access.withAccount { delegate.enrichArticle(articleId, invalidateCaches) }

    override suspend fun markRead(
        articleId: String,
        read: Boolean,
        source: String
    ): AppResult<Boolean> =
        access.withAccount { delegate.markRead(articleId, read, source) }

    override suspend fun setSaved(articleId: String, saved: Boolean): AppResult<Boolean> =
        access.withAccount { delegate.setSaved(articleId, saved) }

    override fun savedStateRejections(): Flow<SavedStateRejection> = access.observe { delegate.savedStateRejections() }

    override suspend fun markAllRead(
        feedId: String?,
        categoryId: String?
    ): AppResult<MarkAllReadResponse> =
        access.withAccount { delegate.markAllRead(feedId, categoryId) }

    override fun clientId(): String = delegate.clientId()
    override fun readStateEvents(): Flow<ReadStateSyncEvent> = access.observe { delegate.readStateEvents() }
    override suspend fun invalidateReadStateCaches(articleId: String?) =
        access.withAccount { delegate.invalidateReadStateCaches(articleId) }

    override suspend fun invalidateArticleContentCaches(articleId: String?) =
        access.withAccount { delegate.invalidateArticleContentCaches(articleId) }

    override suspend fun updateCachedReadState(articleId: String, read: Boolean, revision: Int?) =
        access.withAccount { delegate.updateCachedReadState(articleId, read, revision) }

    override suspend fun updateCachedSavedState(articleId: String, saved: Boolean, revision: Int?) =
        access.withAccount { delegate.updateCachedSavedState(articleId, saved, revision) }

    override suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>) =
        access.withAccount { delegate.markCachedArticlesReadByFeeds(feedIds) }

    override suspend fun recordArticleCompletion(articleId: String) =
        access.withAccount { delegate.recordArticleCompletion(articleId) }
}

class SearchRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
    private val access: AccountAccess,
) : SearchRepository {
    override suspend fun search(
        query: String,
        categoryId: String?,
        cursor: String?,
    ): AppResult<ApiListResponse<ArticleListItem>> = access.withAccount { source.search(query, categoryId, cursor) }
}

class SettingsRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
    private val access: AccountAccess,
) : SettingsRepository {
    override suspend fun preferences(): AppResult<UserPreferences> = access.withAccount { source.preferences() }
    override suspend fun updatePreferences(request: UpdatePreferencesRequest): AppResult<UserPreferences> =
        access.withAccount { source.updatePreferences(request) }

    override suspend fun stats(): AppResult<StatsResponse> = access.withAccount { source.stats() }
    override suspend fun authSessions(): AppResult<List<AuthSession>> = access.withAccount { source.authSessions() }
    override suspend fun revokeAuthSession(id: String): AppResult<Boolean> =
        access.withAccount { source.revokeAuthSession(id) }

    override suspend fun adminSettings(): AppResult<AppSettingsResponse> = access.withAccount { source.adminSettings() }
    override suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse> =
        access.withAccount { source.updateAdminSettings(registrationLocked) }

    override suspend fun adminUsers(): AppResult<List<User>> = access.withAccount { source.adminUsers() }
    override suspend fun adminCreateUser(
        email: String,
        password: String,
        role: String
    ): AppResult<User> =
        access.withAccount { source.adminCreateUser(email, password, role) }

    override suspend fun adminUpdateUser(
        id: String,
        role: String?,
        isActive: Boolean?,
    ): AppResult<User> = access.withAccount { source.adminUpdateUser(id, role, isActive) }

    override suspend fun adminResetPassword(id: String, password: String): AppResult<User> =
        access.withAccount { source.adminResetPassword(id, password) }

    override fun getDebugResilienceSnapshot(): Map<String, Long> =
        source.getDebugResilienceSnapshot()

    override fun resetDebugResilienceMetrics() = source.resetDebugResilienceMetrics()
}

class AppStatusRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : AppStatusRepository {
    override fun isOnline(): Boolean = source.isOnline()
    override fun observeOnline(): Flow<Boolean> = source.observeOnline()
}
