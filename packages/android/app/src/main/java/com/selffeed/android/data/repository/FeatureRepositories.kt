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
    override suspend fun setApiBaseUrl(rawBaseUrl: String): AppResult<String> = source.setApiBaseUrl(rawBaseUrl)
    override suspend fun registrationStatus(): AppResult<RegistrationStatusResponse> = source.registrationStatus()
    override suspend fun login(email: String, password: String): AppResult<User> = source.login(email, password)
    override suspend fun register(email: String, password: String): AppResult<User> = source.register(email, password)
    override suspend fun restoreSession(): AppResult<User> = source.restoreSession()
    override suspend fun logout(): AppResult<Boolean> = source.logout()
    override suspend fun me(): AppResult<User> = source.me()
    override fun isLoggedIn(): Boolean = source.isLoggedIn()
    override fun authEvents(): Flow<String> = source.authEvents()
}

class FeedRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : FeedRepository {
    override suspend fun categories(): AppResult<List<CategoryWithCounts>> = source.categories()
    override suspend fun createCategory(name: String, parentCategoryId: String?): AppResult<CategoryWithCounts> =
        source.createCategory(name, parentCategoryId)

    override suspend fun updateCategory(
        id: String,
        name: String?,
        parentCategoryId: String?,
    ): AppResult<CategoryWithCounts> = source.updateCategory(id, name, parentCategoryId)

    override suspend fun deleteCategory(id: String): AppResult<Boolean> = source.deleteCategory(id)
    override suspend fun feeds(categoryId: String?): AppResult<List<FeedWithCounts>> = source.feeds(categoryId)
    override suspend fun createFeed(feedUrl: String, categoryId: String, title: String?): AppResult<FeedWithCounts> =
        source.createFeed(feedUrl, categoryId, title)

    override suspend fun updateFeed(
        id: String,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): AppResult<FeedWithCounts> = source.updateFeed(id, categoryId, title, pollingIntervalMinutes)

    override suspend fun deleteFeed(id: String): AppResult<Boolean> = source.deleteFeed(id)
    override suspend fun syncFeed(id: String): AppResult<SyncResponse> = source.syncFeed(id)
    override suspend fun syncAllFeeds(): AppResult<SyncResponse> = source.syncAllFeeds()
    override suspend fun importOpml(fileName: String, fileBytes: ByteArray): AppResult<OpmlImportSummary> =
        source.importOpml(fileName, fileBytes)

    override suspend fun exportOpml(): AppResult<String> = source.exportOpml()
}

class ArticleRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : ArticleRepository {
    override suspend fun articles(
        feedId: String?,
        categoryId: String?,
        unreadOnly: Boolean?,
        sort: String?,
        limit: Int?,
        cursor: String?,
    ): AppResult<ApiListResponse<ArticleListItem>> =
        source.articles(feedId, categoryId, unreadOnly, sort, limit, cursor)

    override fun articlePagingData(
        query: ArticlePageQuery,
        readStateOverrides: () -> Map<String, Boolean>,
    ): Flow<PagingData<ArticleListItem>> = source.articlePagingData(query, readStateOverrides)

    override suspend fun article(articleId: String, forceRefresh: Boolean): AppResult<ArticleDetail> =
        source.article(articleId, forceRefresh)

    override fun cachedArticleDetail(articleId: String): ArticleDetail? = source.cachedArticleDetail(articleId)
    override suspend fun prefetchArticle(articleId: String): AppResult<ArticleDetail> = source.prefetchArticle(articleId)
    override suspend fun refreshArticleDetail(articleId: String): AppResult<ArticleDetail> =
        source.refreshArticleDetail(articleId)

    override fun prefetchHeroImages(imageUrls: Iterable<String?>) = source.prefetchHeroImages(imageUrls)
    override suspend fun enrichArticle(
        articleId: String,
        invalidateCaches: Boolean,
    ): AppResult<EnrichArticleResponse> = source.enrichArticle(articleId, invalidateCaches)

    override suspend fun markRead(articleId: String, read: Boolean): AppResult<Boolean> = source.markRead(articleId, read)
    override suspend fun markAllRead(feedId: String?, categoryId: String?): AppResult<MarkAllReadResponse> =
        source.markAllRead(feedId, categoryId)

    override fun clientId(): String = source.clientId()
    override fun readStateEvents(): Flow<ReadStateSyncEvent> = source.readStateEvents()
    override suspend fun invalidateReadStateCaches(articleId: String?) = source.invalidateReadStateCaches(articleId)
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
    override suspend fun revokeAuthSession(id: String): AppResult<Boolean> = source.revokeAuthSession(id)
    override suspend fun adminSettings(): AppResult<AppSettingsResponse> = source.adminSettings()
    override suspend fun updateAdminSettings(registrationLocked: Boolean): AppResult<AppSettingsResponse> =
        source.updateAdminSettings(registrationLocked)

    override fun getDebugResilienceSnapshot(): Map<String, Long> = source.getDebugResilienceSnapshot()
    override fun resetDebugResilienceMetrics() = source.resetDebugResilienceMetrics()
}

class AppStatusRepositoryImpl @Inject constructor(
    private val source: SelfFeedRepository,
) : AppStatusRepository {
    override fun isOnline(): Boolean = source.isOnline()
    override fun observeOnline(): Flow<Boolean> = source.observeOnline()
}
