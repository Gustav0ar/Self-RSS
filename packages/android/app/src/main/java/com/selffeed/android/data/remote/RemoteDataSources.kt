package com.selffeed.android.data.remote

import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.AuthResponse
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.CreateCategoryRequest
import com.selffeed.android.network.CreateFeedRequest
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.LoginRequest
import com.selffeed.android.network.MarkAllReadRequest
import com.selffeed.android.network.MarkReadRequest
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.RegisterRequest
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.RssApi
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdateAppSettingsRequest
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import javax.inject.Inject

class AuthRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun registrationStatus(): RegistrationStatusResponse = api.registrationStatus().data
    suspend fun login(email: String, password: String): AuthResponse = api.login(LoginRequest(email, password)).data
    suspend fun register(email: String, password: String): AuthResponse = api.register(RegisterRequest(email, password)).data
    suspend fun logout(): Boolean = api.logout().data.success
    suspend fun me(): User = api.me().data
}

class FeedRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun categories(): List<CategoryWithCounts> = api.categories().data.categories
    suspend fun createCategory(name: String, parentCategoryId: String?): CategoryWithCounts =
        api.createCategory(CreateCategoryRequest(name, parentCategoryId)).data

    suspend fun updateCategory(id: String, name: String?, parentCategoryId: String?): CategoryWithCounts =
        api.updateCategory(id, UpdateCategoryRequest(name, parentCategoryId)).data

    suspend fun deleteCategory(id: String): Boolean = api.deleteCategory(id).data.success
    suspend fun feeds(categoryId: String?): List<FeedWithCounts> = api.feeds(categoryId).data
    suspend fun createFeed(feedUrl: String, categoryId: String, title: String?): FeedWithCounts =
        api.createFeed(CreateFeedRequest(feedUrl = feedUrl, categoryId = categoryId, title = title)).data

    suspend fun updateFeed(
        id: String,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
    ): FeedWithCounts = api.updateFeed(id, UpdateFeedRequest(categoryId, title, pollingIntervalMinutes)).data

    suspend fun deleteFeed(id: String): Boolean = api.deleteFeed(id).data.success
    suspend fun syncFeed(id: String): SyncResponse = api.syncFeed(id).data
    suspend fun syncAllFeeds(): SyncResponse = api.syncAllFeeds().data
    suspend fun importOpml(part: MultipartBody.Part): OpmlImportSummary = api.importOpml(part).data
    suspend fun exportOpml(): Response<ResponseBody> = api.exportOpml()
}

class ArticleRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun articles(
        feedId: String?,
        categoryId: String?,
        unreadOnly: Boolean?,
        sort: String?,
        limit: Int?,
        cursor: String?,
    ): ApiListResponse<ArticleListItem> = api.articles(feedId, categoryId, unreadOnly, sort, limit, cursor)

    suspend fun article(articleId: String): ArticleDetail = api.article(articleId).data
    suspend fun enrichArticle(articleId: String): EnrichArticleResponse = api.enrichArticle(articleId).data
    suspend fun markRead(articleId: String, read: Boolean): Boolean =
        api.markRead(articleId, MarkReadRequest(read = read)).data.success

    suspend fun markAllRead(feedId: String?, categoryId: String?) =
        api.markAllRead(MarkAllReadRequest(feedId = feedId, categoryId = categoryId)).data
}

class SearchRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun search(
        query: String,
        categoryId: String?,
        cursor: String?,
    ): ApiListResponse<ArticleListItem> = api.search(query = query, categoryId = categoryId, cursor = cursor)
}

class SettingsRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun preferences(): UserPreferences = api.preferences().data
    suspend fun updatePreferences(request: UpdatePreferencesRequest): UserPreferences = api.updatePreferences(request).data
    suspend fun stats(): StatsResponse = api.stats().data
    suspend fun authSessions(): List<AuthSession> = api.authSessions().data.sessions
    suspend fun revokeAuthSession(id: String): Boolean = api.revokeAuthSession(id).data.success
    suspend fun adminSettings(): AppSettingsResponse = api.adminSettings().data
    suspend fun updateAdminSettings(registrationLocked: Boolean): AppSettingsResponse =
        api.updateAdminSettings(UpdateAppSettingsRequest(registrationLocked)).data
}
