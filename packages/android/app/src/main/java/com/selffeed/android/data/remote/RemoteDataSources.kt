package com.selffeed.android.data.remote

import com.selffeed.android.data.ApiSession
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AdminCreateUserRequest
import com.selffeed.android.network.AdminResetPasswordRequest
import com.selffeed.android.network.AdminUpdateUserRequest
import com.selffeed.android.network.AdminUsersResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.AuthResponse
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.CategoryOrderUpdate
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.ChangePasswordRequest
import com.selffeed.android.network.CreateCategoryRequest
import com.selffeed.android.network.CreateFeedRequest
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.FeedSyncHistoryResponse
import com.selffeed.android.network.LoginRequest
import com.selffeed.android.network.MarkAllReadRequest
import com.selffeed.android.network.MarkReadRequest
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.RegisterRequest
import com.selffeed.android.network.RecordProductAnalyticsEventsRequest
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.RssApi
import com.selffeed.android.network.SaveArticleRequest
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
import java.util.UUID

class AuthRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun registrationStatus(session: ApiSession): RegistrationStatusResponse = api.registrationStatus(session = session).data
    suspend fun login(email: String, password: String, session: ApiSession): AuthResponse =
        api.login(LoginRequest(email, password), session).data

    suspend fun register(email: String, password: String, session: ApiSession): AuthResponse =
        api.register(RegisterRequest(email, password), session).data

    suspend fun logout(accessToken: String?, refreshCookie: String?, session: ApiSession): Boolean = api.logout(
        authorization = accessToken?.takeIf(String::isNotBlank)?.let { "Bearer $it" },
        cookie = refreshCookie
            ?.substringBefore(';')
            ?.trim()
            ?.takeIf { it.isNotBlank() && '=' in it },
        session = session,
    ).data.success
    suspend fun me(session: ApiSession): User = api.me(session = session).data
    suspend fun changePassword(currentPassword: String, newPassword: String, session: ApiSession): AuthResponse =
        api.changePassword(ChangePasswordRequest(currentPassword, newPassword), session = session).data
}

class FeedRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun categories(session: ApiSession): List<CategoryWithCounts> = api.categories(session = session).data.categories
    suspend fun createCategory(name: String, parentCategoryId: String?, session: ApiSession): CategoryWithCounts =
        api.createCategory(CreateCategoryRequest(name, parentCategoryId), session = session).data

    suspend fun updateCategory(
        id: String,
        name: String?,
        parentCategoryId: String?,
        session: ApiSession,
    ): CategoryWithCounts =
        api.updateCategory(id, UpdateCategoryRequest(name, parentCategoryId), session = session).data

    suspend fun reorderCategories(updates: List<CategoryOrderUpdate>, session: ApiSession): Int =
        api.reorderCategories(com.selffeed.android.network.ReorderCategoriesRequest(updates), session = session).data.updatedCount

    suspend fun deleteCategory(id: String, session: ApiSession): Boolean = api.deleteCategory(id, session = session).data.success
    suspend fun feeds(categoryId: String?, session: ApiSession): List<FeedWithCounts> = api.feeds(categoryId, session = session).data
    suspend fun createFeed(feedUrl: String, categoryId: String, title: String?, session: ApiSession): FeedWithCounts =
        api.createFeed(
            CreateFeedRequest(
                feedUrl = feedUrl,
                categoryId = categoryId,
                title = title
            ),
            session = session,
        ).data

    suspend fun updateFeed(
        id: String,
        feedUrl: String?,
        categoryId: String?,
        title: String?,
        pollingIntervalMinutes: Int?,
        session: ApiSession,
    ): FeedWithCounts = api.updateFeed(
        id,
        UpdateFeedRequest(
            feedUrl = feedUrl,
            categoryId = categoryId,
            title = title,
            pollingIntervalMinutes = pollingIntervalMinutes,
        ),
        session = session,
    ).data

    suspend fun deleteFeed(id: String, session: ApiSession): Boolean = api.deleteFeed(id, session = session).data.success
    suspend fun syncFeed(id: String, session: ApiSession): SyncResponse = api.syncFeed(id, UUID.randomUUID().toString(), session = session).data
    suspend fun syncAllFeeds(feedId: String?, categoryId: String?, session: ApiSession): SyncResponse =
        api.syncAllFeeds(UUID.randomUUID().toString(), feedId, categoryId, session = session).data

    suspend fun syncAllFeedsStatus(requestId: String?, session: ApiSession): FeedSyncAllStatus =
        api.syncAllFeedsStatus(requestId, session = session).data

    suspend fun feedSyncHistory(feedId: String, session: ApiSession): FeedSyncHistoryResponse =
        api.feedSyncRuns(feedId, limit = 20, cursor = null, session = session).data

    suspend fun discoveryCandidates(requestId: String, session: ApiSession) = api.discoveryCandidates(requestId, session = session).data
    suspend fun selectDiscoveryCandidate(candidateId: String, session: ApiSession) =
        api.selectDiscoveryCandidate(candidateId, session = session).data

    suspend fun cancelFeedReplacement(feedId: String, session: ApiSession) = api.cancelFeedReplacement(feedId, session = session).data
    suspend fun importOpml(part: MultipartBody.Part, session: ApiSession): OpmlImportSummary = api.importOpml(part, session = session).data
    suspend fun exportOpml(session: ApiSession): Response<ResponseBody> = api.exportOpml(session = session)
}

class ArticleRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun articles(
        feedId: String?,
        categoryId: String?,
        unreadOnly: Boolean?,
        savedOnly: Boolean?,
        sort: String?,
        limit: Int?,
        cursor: String?,
        session: ApiSession,
    ): ApiListResponse<ArticleListItem> =
        api.articles(feedId, categoryId, unreadOnly, savedOnly, sort, limit, cursor, session = session)

    suspend fun article(articleId: String, session: ApiSession): ArticleDetail = api.article(articleId, session = session).data
    suspend fun enrichArticle(articleId: String, session: ApiSession): EnrichArticleResponse =
        api.enrichArticle(articleId, session = session).data

    suspend fun markRead(
        articleId: String,
        read: Boolean,
        source: String = "manual",
        mutationId: String? = null,
        baseRevision: Int? = null,
        session: ApiSession,
    ) = api.markRead(
        articleId,
        MarkReadRequest(read, source, mutationId, baseRevision),
        session = session,
    ).data

    suspend fun setSaved(
        articleId: String,
        saved: Boolean,
        mutationId: String? = null,
        baseRevision: Int? = null,
        session: ApiSession,
    ) = api.setSaved(
        articleId,
        SaveArticleRequest(saved, mutationId, baseRevision),
        session = session,
    ).data

    suspend fun markAllRead(feedId: String?, categoryId: String?, session: ApiSession) =
        api.markAllRead(MarkAllReadRequest(feedId = feedId, categoryId = categoryId), session = session).data
}

class SearchRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun search(
        query: String,
        categoryId: String?,
        cursor: String?,
        session: ApiSession,
    ): ApiListResponse<ArticleListItem> =
        api.search(query = query, categoryId = categoryId, cursor = cursor, session = session)
}

class SettingsRemoteDataSource @Inject constructor(
    private val api: RssApi,
) {
    suspend fun preferences(session: ApiSession): UserPreferences = api.preferences(session = session).data
    suspend fun updatePreferences(request: UpdatePreferencesRequest, session: ApiSession): UserPreferences =
        api.updatePreferences(request, session = session).data

    suspend fun stats(session: ApiSession): StatsResponse = api.stats(session = session).data
    suspend fun recordProductAnalyticsEvents(request: RecordProductAnalyticsEventsRequest, session: ApiSession): Int =
        api.recordProductAnalyticsEvents(request, session = session).data.accepted
    suspend fun authSessions(session: ApiSession): List<AuthSession> = api.authSessions(session = session).data.sessions
    suspend fun revokeAuthSession(id: String, session: ApiSession): Boolean = api.revokeAuthSession(id, session = session).data.success
    suspend fun adminSettings(session: ApiSession): AppSettingsResponse = api.adminSettings(session = session).data
    suspend fun updateAdminSettings(registrationLocked: Boolean, session: ApiSession): AppSettingsResponse =
        api.updateAdminSettings(UpdateAppSettingsRequest(registrationLocked), session = session).data

    suspend fun adminUsers(session: ApiSession): AdminUsersResponse = api.adminUsers(session = session).data
    suspend fun adminCreateUser(email: String, password: String, role: String, session: ApiSession): User =
        api.adminCreateUser(AdminCreateUserRequest(email, password, role), session = session).data

    suspend fun adminUpdateUser(id: String, role: String?, isActive: Boolean?, session: ApiSession): User =
        api.adminUpdateUser(id, AdminUpdateUserRequest(role, isActive), session = session).data

    suspend fun adminResetPassword(id: String, password: String, session: ApiSession): User =
        api.adminResetPassword(id, AdminResetPasswordRequest(password), session = session).data
}
