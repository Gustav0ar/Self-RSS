package com.selffeed.android.network

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface RssApi {
    @GET("auth/registration-status")
    suspend fun registrationStatus(): ApiEnvelope<RegistrationStatusResponse>

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): ApiEnvelope<AuthResponse>

    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): ApiEnvelope<AuthResponse>

    @POST("auth/logout")
    suspend fun logout(): ApiEnvelope<SuccessResponse>

    @GET("auth/me")
    suspend fun me(): ApiEnvelope<User>

    @POST("auth/change-password")
    suspend fun changePassword(@Body request: ChangePasswordRequest): ApiEnvelope<AuthResponse>

    @GET("auth/sessions")
    suspend fun authSessions(): ApiEnvelope<AuthSessionsResponse>

    @DELETE("auth/sessions/{id}")
    suspend fun revokeAuthSession(@Path("id") id: String): ApiEnvelope<SuccessResponse>

    @GET("categories")
    suspend fun categories(): ApiEnvelope<CategoryTreeResponse>

    @POST("categories")
    suspend fun createCategory(@Body request: CreateCategoryRequest): ApiEnvelope<CategoryWithCounts>

    @PATCH("categories/{id}")
    suspend fun updateCategory(
        @Path("id") id: String,
        @Body request: UpdateCategoryRequest,
    ): ApiEnvelope<CategoryWithCounts>

    @DELETE("categories/{id}")
    suspend fun deleteCategory(@Path("id") id: String): ApiEnvelope<SuccessResponse>

    @GET("feeds")
    suspend fun feeds(@Query("categoryId") categoryId: String? = null): ApiEnvelope<List<FeedWithCounts>>

    @POST("feeds")
    suspend fun createFeed(@Body request: CreateFeedRequest): ApiEnvelope<FeedWithCounts>

    @PATCH("feeds/{id}")
    suspend fun updateFeed(
        @Path("id") id: String,
        @Body request: UpdateFeedRequest
    ): ApiEnvelope<FeedWithCounts>

    @DELETE("feeds/{id}")
    suspend fun deleteFeed(@Path("id") id: String): ApiEnvelope<SuccessResponse>

    @POST("feeds/{id}/sync")
    suspend fun syncFeed(@Path("id") id: String): ApiEnvelope<SyncResponse>

    @GET("feeds/{id}/sync-runs")
    suspend fun feedSyncRuns(
        @Path("id") id: String,
        @Query("limit") limit: Int = 25,
        @Query("cursor") cursor: String? = null,
    ): ApiEnvelope<FeedSyncHistoryResponse>

    @POST("feeds/sync")
    suspend fun syncAllFeeds(
        @Query("feedId") feedId: String? = null,
        @Query("categoryId") categoryId: String? = null,
    ): ApiEnvelope<SyncResponse>

    @GET("feeds/sync/status")
    suspend fun syncAllFeedsStatus(@Query("requestId") requestId: String? = null): ApiEnvelope<FeedSyncAllStatus>

    @GET("feeds/discovery/{requestId}")
    suspend fun discoveryCandidates(@Path("requestId") requestId: String): ApiEnvelope<List<FeedDiscoveryCandidate>>

    @POST("feeds/discovery/candidates/{candidateId}/select")
    suspend fun selectDiscoveryCandidate(@Path("candidateId") candidateId: String): ApiEnvelope<DiscoverySelectionResponse>

    @POST("feeds/{feedId}/replacement/cancel")
    suspend fun cancelFeedReplacement(@Path("feedId") feedId: String): ApiEnvelope<FeedWithCounts>

    @Multipart
    @POST("feeds/import/opml")
    suspend fun importOpml(@Part file: MultipartBody.Part): ApiEnvelope<OpmlImportSummary>

    @GET("feeds/export/opml")
    suspend fun exportOpml(): Response<ResponseBody>

    @GET("articles")
    suspend fun articles(
        @Query("feedId") feedId: String? = null,
        @Query("categoryId") categoryId: String? = null,
        @Query("unreadOnly") unreadOnly: Boolean? = null,
        @Query("savedOnly") savedOnly: Boolean? = null,
        @Query("sort") sort: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("cursor") cursor: String? = null,
    ): ApiListResponse<ArticleListItem>

    @GET("articles/detail")
    suspend fun article(@Query("id") id: String): ApiEnvelope<ArticleDetail>

    @POST("articles/{id}/enrich")
    suspend fun enrichArticle(@Path("id") id: String): ApiEnvelope<EnrichArticleResponse>

    @PATCH("articles/{id}/read")
    suspend fun markRead(
        @Path("id") id: String,
        @Body request: MarkReadRequest
    ): ApiEnvelope<MarkReadResponse>

    @PATCH("articles/{id}/saved")
    suspend fun setSaved(
        @Path("id") id: String,
        @Body request: SaveArticleRequest
    ): ApiEnvelope<MarkReadResponse>

    @PATCH("articles/mark-all-read")
    suspend fun markAllRead(@Body request: MarkAllReadRequest): ApiEnvelope<MarkAllReadResponse>

    @GET("search")
    suspend fun search(
        @Query("q") query: String,
        @Query("categoryId") categoryId: String? = null,
        @Query("limit") limit: Int? = 20,
        @Query("cursor") cursor: String? = null,
    ): ApiListResponse<ArticleListItem>

    @GET("preferences")
    suspend fun preferences(): ApiEnvelope<UserPreferences>

    @PATCH("preferences")
    suspend fun updatePreferences(@Body request: UpdatePreferencesRequest): ApiEnvelope<UserPreferences>

    @GET("stats")
    suspend fun stats(): ApiEnvelope<StatsResponse>

    @GET("admin/settings")
    suspend fun adminSettings(): ApiEnvelope<AppSettingsResponse>

    @PATCH("admin/settings")
    suspend fun updateAdminSettings(@Body request: UpdateAppSettingsRequest): ApiEnvelope<AppSettingsResponse>

    @GET("admin/users")
    suspend fun adminUsers(
        @Query("limit") limit: Int = 100,
        @Query("cursor") cursor: String? = null,
    ): ApiEnvelope<AdminUsersResponse>

    @POST("admin/users")
    suspend fun adminCreateUser(@Body request: AdminCreateUserRequest): ApiEnvelope<User>

    @PATCH("admin/users/{id}")
    suspend fun adminUpdateUser(
        @Path("id") id: String,
        @Body request: AdminUpdateUserRequest,
    ): ApiEnvelope<User>

    @POST("admin/users/{id}/reset-password")
    suspend fun adminResetPassword(
        @Path("id") id: String,
        @Body request: AdminResetPasswordRequest,
    ): ApiEnvelope<User>
}
