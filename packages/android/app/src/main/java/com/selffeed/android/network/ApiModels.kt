package com.selffeed.android.network

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class ApiEnvelope<T>(
    val data: T,
)

@JsonClass(generateAdapter = true)
data class ApiListResponse<T>(
    val data: List<T>,
    val cursor: String?,
    val hasMore: Boolean,
)

@JsonClass(generateAdapter = true)
data class ApiErrorEnvelope(
    val error: ApiError,
)

@JsonClass(generateAdapter = true)
data class ApiError(
    val code: String,
    val message: String,
)

@JsonClass(generateAdapter = true)
data class AuthResponse(
    val user: User,
    val tokens: AccessTokenOnly,
)

@JsonClass(generateAdapter = true)
data class AccessTokenOnly(
    val accessToken: String,
)

@JsonClass(generateAdapter = true)
data class RefreshData(
    val tokens: AccessTokenOnly,
)

@JsonClass(generateAdapter = true)
data class User(
    val id: String,
    val email: String,
    val role: String,
    val isActive: Boolean,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class CategoryTreeResponse(
    val categories: List<CategoryWithCounts>,
    val totalUnread: Int,
)

@JsonClass(generateAdapter = true)
data class CategoryWithCounts(
    val id: String,
    val userId: String? = null,
    val parentCategoryId: String? = null,
    val name: String,
    val slug: String,
    val sortOrder: Int,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val feedCount: Int,
    val unreadCount: Int,
    val children: List<CategoryWithCounts>? = null,
)

@JsonClass(generateAdapter = true)
data class FeedWithCounts(
    val id: String,
    val userId: String? = null,
    val categoryId: String,
    val title: String,
    val siteUrl: String? = null,
    val feedUrl: String,
    val faviconUrl: String? = null,
    val description: String? = null,
    val pollingIntervalMinutes: Int,
    val lastSyncedAt: String? = null,
    val syncStatus: String,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val unreadCount: Int,
)

@JsonClass(generateAdapter = true)
data class ArticleListItem(
    val id: String,
    val feedId: String,
    val feedTitle: String,
    val feedFaviconUrl: String? = null,
    val title: String,
    val author: String? = null,
    val excerpt: String? = null,
    val heroImageUrl: String? = null,
    val publishedAt: String? = null,
    val displayedAt: String? = null,
    val isRead: Boolean,
)

@JsonClass(generateAdapter = true)
data class ArticleMedia(
    val id: String,
    val articleId: String,
    val type: String,
    val provider: String,
    val url: String,
    val embedUrl: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val position: Int,
)

@JsonClass(generateAdapter = true)
data class ArticleDetail(
    val id: String,
    val feedId: String,
    val guid: String,
    val canonicalUrl: String? = null,
    val title: String,
    val author: String? = null,
    val excerpt: String? = null,
    val contentHtml: String? = null,
    val contentText: String? = null,
    val heroImageUrl: String? = null,
    val publishedAt: String? = null,
    val fetchedAt: String? = null,
    val hash: String,
    val feedTitle: String,
    val feedFaviconUrl: String? = null,
    val feedSiteUrl: String? = null,
    val media: List<ArticleMedia> = emptyList(),
    val isRead: Boolean,
    val isEnriched: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class UserPreferences(
    val userId: String? = null,
    val theme: String,
    val fontFamily: String,
    val textSize: Int,
    val density: String,
    val defaultSort: String,
    val hideRead: Boolean,
    val keyboardShortcutsEnabled: Boolean,
    val autoMarkReadMode: String,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class StatsResponse(
    val totalUnread: Int,
    val totalRead: Int,
    val totalFeeds: Int,
    val totalCategories: Int,
    val recentSyncRuns: List<Map<String, Any?>> = emptyList(),
    val dailyMetrics: List<DailyMetric> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class DailyMetric(
    val date: String,
    val articlesReadCount: Int,
    val feedsSyncedCount: Int,
    val searchCount: Int,
)

@JsonClass(generateAdapter = true)
data class AppSettingsResponse(
    val registrationLocked: Boolean,
)

@JsonClass(generateAdapter = true)
data class SuccessResponse(
    val success: Boolean,
)

@JsonClass(generateAdapter = true)
data class MarkReadResponse(
    val success: Boolean,
)

@JsonClass(generateAdapter = true)
data class MarkAllReadResponse(
    val markedCount: Int,
)

@JsonClass(generateAdapter = true)
data class SyncResponse(
    val syncedCount: Int? = null,
    val status: String? = null,
    val totalFeeds: Int? = null,
    val syncedFeeds: Int? = null,
    val failedFeeds: Int? = null,
    val skippedFeeds: Int? = null,
    val newArticles: Int? = null,
)

@JsonClass(generateAdapter = true)
data class EnrichArticleResponse(
    val success: Boolean,
    val reason: String? = null,
)

@JsonClass(generateAdapter = true)
data class OpmlImportSummary(
    val createdCategories: Int,
    val createdFeeds: Int,
    val skippedDuplicates: Int,
    val invalidEntries: Int,
    val warnings: List<OpmlImportWarning> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class OpmlImportWarning(
    val code: String,
    val message: String,
    val feedUrl: String? = null,
    val categoryPath: List<String>? = null,
)
