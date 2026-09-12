package com.selffeed.android.network

import com.selffeed.android.data.ApiSession
import retrofit2.http.Tag
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface RssApi {
    @GET("auth/registration-status")
    suspend fun registrationStatus(@Tag session: ApiSession? = null): ApiEnvelope<RegistrationStatusResponse>

    @POST("auth/login")
    suspend fun login(
        @Body request: LoginRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<AuthResponse>

    @POST("auth/register")
    suspend fun register(
        @Body request: RegisterRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<AuthResponse>

    @POST("auth/logout")
    suspend fun logout(
        @Header("Authorization") authorization: String? = null,
        @Header("Cookie") cookie: String? = null,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<SuccessResponse>

    @GET("auth/me")
    suspend fun me(@Tag session: ApiSession? = null): ApiEnvelope<User>

    @POST("auth/change-password")
    suspend fun changePassword(@Body request: ChangePasswordRequest, @Tag session: ApiSession? = null): ApiEnvelope<AuthResponse>

    @GET("auth/sessions")
    suspend fun authSessions(@Tag session: ApiSession? = null): ApiEnvelope<AuthSessionsResponse>

    @DELETE("auth/sessions/{id}")
    suspend fun revokeAuthSession(@Path("id") id: String, @Tag session: ApiSession? = null): ApiEnvelope<SuccessResponse>

    @GET("categories")
    suspend fun categories(@Tag session: ApiSession? = null): ApiEnvelope<CategoryTreeResponse>

    @POST("categories")
    suspend fun createCategory(@Body request: CreateCategoryRequest, @Tag session: ApiSession? = null): ApiEnvelope<CategoryWithCounts>

    @PATCH("categories/{id}")
    suspend fun updateCategory(
        @Path("id") id: String,
        @Body request: UpdateCategoryRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<CategoryWithCounts>

    @PATCH("categories/reorder")
    suspend fun reorderCategories(@Body request: ReorderCategoriesRequest, @Tag session: ApiSession? = null): ApiEnvelope<ReorderCategoriesResponse>

    @DELETE("categories/{id}")
    suspend fun deleteCategory(@Path("id") id: String, @Tag session: ApiSession? = null): ApiEnvelope<SuccessResponse>

    @GET("feeds")
    suspend fun feeds(@Query("categoryId") categoryId: String? = null, @Tag session: ApiSession? = null): ApiEnvelope<List<FeedWithCounts>>

    @POST("feeds")
    suspend fun createFeed(@Body request: CreateFeedRequest, @Tag session: ApiSession? = null): ApiEnvelope<FeedWithCounts>

    @PATCH("feeds/{id}")
    suspend fun updateFeed(
        @Path("id") id: String,
        @Body request: UpdateFeedRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<FeedWithCounts>

    @DELETE("feeds/{id}")
    suspend fun deleteFeed(@Path("id") id: String, @Tag session: ApiSession? = null): ApiEnvelope<SuccessResponse>

    @POST("feeds/{id}/sync")
    suspend fun syncFeed(
        @Path("id") id: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<SyncResponse>

    @GET("feeds/{id}/sync-runs")
    suspend fun feedSyncRuns(
        @Path("id") id: String,
        @Query("limit") limit: Int = 25,
        @Query("cursor") cursor: String? = null,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<FeedSyncHistoryResponse>

    @POST("feeds/sync")
    suspend fun syncAllFeeds(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Query("feedId") feedId: String? = null,
        @Query("categoryId") categoryId: String? = null,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<SyncResponse>

    @GET("feeds/sync/status")
    suspend fun syncAllFeedsStatus(@Query("requestId") requestId: String? = null, @Tag session: ApiSession? = null): ApiEnvelope<FeedSyncAllStatus>

    @GET("feeds/discovery/{requestId}")
    suspend fun discoveryCandidates(@Path("requestId") requestId: String, @Tag session: ApiSession? = null): ApiEnvelope<List<FeedDiscoveryCandidate>>

    @POST("feeds/discovery/candidates/{candidateId}/select")
    suspend fun selectDiscoveryCandidate(@Path("candidateId") candidateId: String, @Tag session: ApiSession? = null): ApiEnvelope<DiscoverySelectionResponse>

    @POST("feeds/{feedId}/replacement/cancel")
    suspend fun cancelFeedReplacement(@Path("feedId") feedId: String, @Tag session: ApiSession? = null): ApiEnvelope<FeedWithCounts>

    @Multipart
    @POST("feeds/import/opml")
    suspend fun importOpml(@Part file: MultipartBody.Part, @Tag session: ApiSession? = null): ApiEnvelope<OpmlImportSummary>

    @GET("feeds/export/opml")
    suspend fun exportOpml(@Tag session: ApiSession? = null): Response<ResponseBody>

    @GET("articles")
    suspend fun articles(
        @Query("feedId") feedId: String? = null,
        @Query("categoryId") categoryId: String? = null,
        @Query("unreadOnly") unreadOnly: Boolean? = null,
        @Query("savedOnly") savedOnly: Boolean? = null,
        @Query("sort") sort: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("cursor") cursor: String? = null,
        @Tag session: ApiSession? = null,
    ): ApiListResponse<ArticleListItem>

    @GET("articles/detail")
    suspend fun article(@Query("id") id: String, @Tag session: ApiSession? = null): ApiEnvelope<ArticleDetail>

    @POST("articles/states")
    suspend fun articleStates(
        @Body request: ArticleStateLookupRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<ArticleStateLookupResponse>

    @POST("articles/{id}/enrich")
    suspend fun enrichArticle(@Path("id") id: String, @Tag session: ApiSession? = null): ApiEnvelope<EnrichArticleResponse>

    @PATCH("articles/{id}/read")
    suspend fun markRead(
        @Path("id") id: String,
        @Body request: MarkReadRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<MarkReadResponse>

    @PATCH("articles/{id}/saved")
    suspend fun setSaved(
        @Path("id") id: String,
        @Body request: SaveArticleRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<MarkReadResponse>

    @PATCH("articles/mark-all-read")
    suspend fun markAllRead(@Body request: MarkAllReadRequest, @Tag session: ApiSession? = null): ApiEnvelope<MarkAllReadResponse>

    @GET("search")
    suspend fun search(
        @Query("q") query: String,
        @Query("categoryId") categoryId: String? = null,
        @Query("limit") limit: Int? = 20,
        @Query("cursor") cursor: String? = null,
        @Tag session: ApiSession? = null,
    ): ApiListResponse<ArticleListItem>

    @GET("preferences")
    suspend fun preferences(@Tag session: ApiSession? = null): ApiEnvelope<UserPreferences>

    @PATCH("preferences")
    suspend fun updatePreferences(@Body request: UpdatePreferencesRequest, @Tag session: ApiSession? = null): ApiEnvelope<UserPreferences>

    @GET("stats")
    suspend fun stats(@Tag session: ApiSession? = null): ApiEnvelope<StatsResponse>

    @POST("analytics/events")
    suspend fun recordProductAnalyticsEvents(
        @Body request: RecordProductAnalyticsEventsRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<RecordProductAnalyticsEventsResponse>

    @GET("admin/settings")
    suspend fun adminSettings(@Tag session: ApiSession? = null): ApiEnvelope<AppSettingsResponse>

    @PATCH("admin/settings")
    suspend fun updateAdminSettings(@Body request: UpdateAppSettingsRequest, @Tag session: ApiSession? = null): ApiEnvelope<AppSettingsResponse>

    @GET("admin/users")
    suspend fun adminUsers(
        @Query("limit") limit: Int = 100,
        @Query("cursor") cursor: String? = null,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<AdminUsersResponse>

    @POST("admin/users")
    suspend fun adminCreateUser(@Body request: AdminCreateUserRequest, @Tag session: ApiSession? = null): ApiEnvelope<User>

    @PATCH("admin/users/{id}")
    suspend fun adminUpdateUser(
        @Path("id") id: String,
        @Body request: AdminUpdateUserRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<User>

    @POST("admin/users/{id}/reset-password")
    suspend fun adminResetPassword(
        @Path("id") id: String,
        @Body request: AdminResetPasswordRequest,
        @Tag session: ApiSession? = null,
    ): ApiEnvelope<User>
}
