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
    suspend fun updateFeed(@Path("id") id: String, @Body request: UpdateFeedRequest): ApiEnvelope<FeedWithCounts>

    @DELETE("feeds/{id}")
    suspend fun deleteFeed(@Path("id") id: String): ApiEnvelope<SuccessResponse>

    @POST("feeds/{id}/sync")
    suspend fun syncFeed(@Path("id") id: String): ApiEnvelope<SyncResponse>

    @POST("feeds/sync")
    suspend fun syncAllFeeds(): ApiEnvelope<SyncResponse>

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
        @Query("sort") sort: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("cursor") cursor: String? = null,
    ): ApiListResponse<ArticleListItem>

    @GET("articles/{id}")
    suspend fun article(@Path("id") id: String): ApiEnvelope<ArticleDetail>

    @POST("articles/{id}/enrich")
    suspend fun enrichArticle(@Path("id") id: String): ApiEnvelope<EnrichArticleResponse>

    @PATCH("articles/{id}/read")
    suspend fun markRead(@Path("id") id: String, @Body request: MarkReadRequest): ApiEnvelope<MarkReadResponse>

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
}
