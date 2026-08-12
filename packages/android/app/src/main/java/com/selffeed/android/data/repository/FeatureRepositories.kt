package com.selffeed.android.data.repository

import androidx.paging.PagingData
import com.selffeed.android.data.AppResult
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
    override fun getApiBaseUrl(): String = source.getApiBaseUrl()
    override suspend fun setApiBaseUrl(rawBaseUrl: String): AppResult<String> =
        source.setApiBaseUrl(rawBaseUrl)

    override suspend fun registrationStatus(): AppResult<RegistrationStatusResponse> =
        source.registrationStatus()

    override suspend fun login(email: String, password: String): AppResult<User> =
        source.login(email, password)

    override suspend fun register(email: String, password: String): AppResult<User> =
        source.register(email, password)

    override suspend fun restoreSession(): AppResult<User> = source.restoreSession()
    override suspend fun logout(): AppResult<Boolean> = source.logout()
    override suspend fun me(): AppResult<User> = source.me()
    override suspend fun changePassword(
        currentPassword: String,
        newPassword: String
    ): AppResult<User> =
        source.changePassword(currentPassword, newPassword)

    override fun isLoggedIn(): Boolean = source.isLoggedIn()
    override fun authEvents(): Flow<String> = source.authEvents()
    override suspend fun recordOfflineRestore() = source.recordOfflineRestore()
}

class FeedRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : FeedRepository {
    override suspend fun categories(): AppResult<List<CategoryWithCounts>> = source.categories()
    override suspend fun createCategory(
        name: String,
        parentCategoryId: String?
    ): AppResult<CategoryWithCounts> =
        source.createCategory(name, parentCategoryId)

    override suspend fun updateCategory(
        id: String,
        name: String?,
        parentCategoryId: String?,
    ): AppResult<CategoryWithCounts> = source.updateCategory(id, name, parentCategoryId)

    override suspend fun deleteCategory(id: String): AppResult<Boolean> = source.deleteCategory(id)
    override suspend fun feeds(categoryId: String?): AppResult<List<FeedWithCounts>> =
        source.feeds(categoryId)

    override suspend fun refreshFeeds(categoryId: String?): AppResult<List<FeedWithCounts>> =
        source.refreshFeeds(categoryId)

    override suspend fun createFeed(
        feedUrl: String,
        categoryId: String,
        title: String?
    ): AppResult<FeedWithCounts> =
        source.createFeed(feedUrl, categoryId, title)

    override suspend fun updateFeed(
        id: String,
        feedUrl: String?,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): AppResult<FeedWithCounts> =
        source.updateFeed(id, feedUrl, categoryId, title, pollingIntervalMinutes)

    override suspend fun deleteFeed(id: String): AppResult<Boolean> = source.deleteFeed(id)
    override suspend fun syncFeed(id: String): AppResult<SyncResponse> = source.syncFeed(id)
    override suspend fun syncAllFeeds(
        feedId: String?,
        categoryId: String?
    ): AppResult<SyncResponse> =
        source.syncAllFeeds(feedId, categoryId)

    override suspend fun syncAllFeedsStatus(requestId: String?): AppResult<FeedSyncAllStatus> =
        source.syncAllFeedsStatus(requestId)

    override suspend fun feedSyncHistory(feedId: String): AppResult<FeedSyncHistoryResponse> =
        source.feedSyncHistory(feedId)

    override suspend fun selectDiscoveryCandidate(candidateId: String): AppResult<FeedWithCounts> =
        source.selectDiscoveryCandidate(candidateId)

    override suspend fun cancelFeedReplacement(feedId: String): AppResult<FeedWithCounts> =
        source.cancelFeedReplacement(feedId)

    override suspend fun importOpml(
        fileName: String,
        fileBytes: ByteArray
    ): AppResult<OpmlImportSummary> =
        source.importOpml(fileName, fileBytes)

    override suspend fun exportOpml(): AppResult<String> = source.exportOpml()
}

class ArticleRepositoryImpl @Inject constructor(
    private val delegate: SelfFeedRepository,
) : ArticleRepository {
    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> = delegate.articlePagingData(query, readStateOverrides)

    override suspend fun article(
        articleId: String,
        forceRefresh: Boolean
    ): AppResult<ArticleDetail> =
        delegate.article(articleId, forceRefresh)

    override fun cachedArticleDetail(articleId: String): ArticleDetail? =
        delegate.cachedArticleDetail(articleId)

    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> =
        delegate.prefetchArticle(articleId)

    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        delegate.refreshArticleDetail(articleId)

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) =
        delegate.prefetchHeroImages(imageUrls)

    override suspend fun enrichArticle(
        articleId: String,
        invalidateCaches: Boolean,
    ): AppResult<EnrichArticleResponse> = delegate.enrichArticle(articleId, invalidateCaches)

    override suspend fun markRead(
        articleId: String,
        read: Boolean,
        source: String
    ): AppResult<Boolean> =
        delegate.markRead(articleId, read, source)

    override suspend fun setSaved(articleId: String, saved: Boolean): AppResult<Boolean> =
        delegate.setSaved(articleId, saved)

    override suspend fun markAllRead(
        feedId: String?,
        categoryId: String?
    ): AppResult<MarkAllReadResponse> =
        delegate.markAllRead(feedId, categoryId)

    override fun clientId(): String = delegate.clientId()
    override fun readStateEvents(): Flow<ReadStateSyncEvent> = delegate.readStateEvents()
    override suspend fun invalidateReadStateCaches(articleId: String?) =
        delegate.invalidateReadStateCaches(articleId)

    override suspend fun invalidateArticleContentCaches(articleId: String?) =
        delegate.invalidateArticleContentCaches(articleId)

    override suspend fun updateCachedReadState(articleId: String, read: Boolean) =
        delegate.updateCachedReadState(articleId, read)

    override suspend fun updateCachedSavedState(articleId: String, saved: Boolean) =
        delegate.updateCachedSavedState(articleId, saved)

    override suspend fun markCachedArticlesReadByFeeds(feedIds: Set<String>) =
        delegate.markCachedArticlesReadByFeeds(feedIds)

    override suspend fun recordArticleCompletion(articleId: String) =
        delegate.recordArticleCompletion(articleId)
}

class SearchRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : SearchRepository {
    override suspend fun search(
        query: String,
        categoryId: String?,
        cursor: String?,
    ): AppResult<ApiListResponse<ArticleListItem>> = source.search(query, categoryId, cursor)
}

class SettingsRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : SettingsRepository {
    override suspend fun preferences(): AppResult<UserPreferences> = source.preferences()
    override suspend fun updatePreferences(request: UpdatePreferencesRequest): AppResult<UserPreferences> =
        source.updatePreferences(request)

    override suspend fun stats(): AppResult<StatsResponse> = source.stats()
    override suspend fun authSessions(): AppResult<List<AuthSession>> = source.authSessions()
    override suspend fun revokeAuthSession(id: String): AppResult<Boolean> =
        source.revokeAuthSession(id)

    override suspend fun adminSettings(): AppResult<AppSettingsResponse> = source.adminSettings()
    override suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse> =
        source.updateAdminSettings(registrationLocked)

    override suspend fun adminUsers(): AppResult<List<User>> = source.adminUsers()
    override suspend fun adminCreateUser(
        email: String,
        password: String,
        role: String
    ): AppResult<User> =
        source.adminCreateUser(email, password, role)

    override suspend fun adminUpdateUser(
        id: String,
        role: String?,
        isActive: Boolean?,
    ): AppResult<User> = source.adminUpdateUser(id, role, isActive)

    override suspend fun adminResetPassword(id: String, password: String): AppResult<User> =
        source.adminResetPassword(id, password)

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
