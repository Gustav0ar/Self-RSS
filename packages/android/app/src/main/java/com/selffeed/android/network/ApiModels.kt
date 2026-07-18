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
data class AuthSession(
    val id: String,
    val deviceName: String,
    val clientId: String? = null,
    val ipAddress: String? = null,
    val userAgent: String? = null,
    val createdAt: String,
    val lastSeenAt: String,
    val current: Boolean,
)

@JsonClass(generateAdapter = true)
data class AuthSessionsResponse(
    val sessions: List<AuthSession>,
)

@JsonClass(generateAdapter = true)
data class RegistrationStatusResponse(
    val registrationEnabled: Boolean,
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
    val lastSyncError: String? = null,
    val lastSyncErrorAt: String? = null,
    val syncStatus: String,
    val lifecycleStatus: String? = null,
    val sourceId: String? = null,
    val pendingSourceId: String? = null,
    val pendingFeedUrl: String? = null,
    val sourceState: String? = null,
    val sourceErrorCode: String? = null,
    val sourceErrorDetails: String? = null,
    val lastFetchAt: String? = null,
    val lastSuccessAt: String? = null,
    val nextEligibleFetchAt: String? = null,
    val replacementRequestedAt: String? = null,
    val discovery: FeedDiscovery? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val unreadCount: Int,
)

@JsonClass(generateAdapter = true)
data class FeedDiscoveryOption(
    val id: String,
    val requestId: String,
    val url: String,
    val title: String? = null,
    val type: String,
    val expiresAt: String,
)

@JsonClass(generateAdapter = true)
data class FeedDiscovery(
    val required: Boolean,
    val candidates: List<FeedDiscoveryOption> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class FeedDiscoveryCandidate(
    val id: String,
    val requestId: String,
    val candidateUrl: String,
    val normalizedCandidateUrl: String,
    val title: String? = null,
    val type: String? = null,
    val status: String,
    val expiresAt: String,
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
    val contentStatus: String = "feed_ready",
    val contentVersion: Int = 1,
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
    val contentStatus: String = "feed_ready",
    val contentVersion: Int = 1,
    val enrichmentQueuedAt: String? = null,
    val enrichmentAttemptedAt: String? = null,
    val enrichedAt: String? = null,
    val enrichmentError: String? = null,
)

sealed interface ReadStateSyncEvent {
    val eventId: String
    val clientId: String?
    val updatedAt: String
}

data class ArticleReadStateChangedEvent(
    override val eventId: String,
    val articleId: String,
    val feedId: String,
    val isRead: Boolean,
    val source: String,
    override val clientId: String?,
    override val updatedAt: String,
) : ReadStateSyncEvent

data class ArticlesMarkedReadEvent(
    override val eventId: String,
    val feedIds: List<String>,
    val scope: ReadStateScope,
    val markedCount: Int,
    override val clientId: String?,
    override val updatedAt: String,
) : ReadStateSyncEvent

data class ArticlesNewEvent(
    override val eventId: String,
    val feedId: String,
    val articleIds: List<String>,
    val count: Int,
    override val updatedAt: String,
    override val clientId: String? = null,
) : ReadStateSyncEvent

data class ArticleUpdatedEvent(
    override val eventId: String,
    val articleId: String,
    val feedId: String,
    val contentStatus: String,
    val contentVersion: Int,
    override val updatedAt: String,
    override val clientId: String? = null,
) : ReadStateSyncEvent

data class RealtimeConnectedEvent(
    override val eventId: String = "connected-${System.currentTimeMillis()}",
    override val updatedAt: String = "",
    override val clientId: String? = null,
) : ReadStateSyncEvent

@JsonClass(generateAdapter = true)
data class ReadStateScope(
    val feedId: String? = null,
    val categoryId: String? = null,
)

@JsonClass(generateAdapter = true)
data class ReadStateEventPayload(
    val type: String,
    val eventId: String? = null,
    val articleId: String? = null,
    val feedId: String? = null,
    val isRead: Boolean? = null,
    val source: String? = null,
    val clientId: String? = null,
    val updatedAt: String? = null,
    val feedIds: List<String>? = null,
    val scope: ReadStateScope? = null,
    val markedCount: Int? = null,
    val articleIds: List<String>? = null,
    val count: Int? = null,
    val contentStatus: String? = null,
    val contentVersion: Int? = null,
) {
    fun toEvent(): ReadStateSyncEvent? = when (type) {
        "article.read_state_changed" -> {
            val validEventId = eventId ?: return null
            val validArticleId = articleId ?: return null
            val validFeedId = feedId ?: return null
            val validIsRead = isRead ?: return null
            val validSource = source ?: return null
            val validUpdatedAt = updatedAt ?: return null
            ArticleReadStateChangedEvent(
                eventId = validEventId,
                articleId = validArticleId,
                feedId = validFeedId,
                isRead = validIsRead,
                source = validSource,
                clientId = clientId,
                updatedAt = validUpdatedAt,
            )
        }

        "articles.marked_read" -> {
            val validEventId = eventId ?: return null
            val validFeedIds = feedIds ?: return null
            val validMarkedCount = markedCount ?: return null
            val validUpdatedAt = updatedAt ?: return null
            ArticlesMarkedReadEvent(
                eventId = validEventId,
                feedIds = validFeedIds,
                scope = scope ?: ReadStateScope(),
                markedCount = validMarkedCount,
                clientId = clientId,
                updatedAt = validUpdatedAt,
            )
        }

        "articles.new" -> {
            val validEventId = eventId ?: return null
            val validFeedId = feedId ?: return null
            val validArticleIds = articleIds ?: return null
            val validCount = count ?: return null
            val validUpdatedAt = updatedAt ?: return null
            ArticlesNewEvent(
                eventId = validEventId,
                feedId = validFeedId,
                articleIds = validArticleIds,
                count = validCount,
                updatedAt = validUpdatedAt,
            )
        }

        "article.updated" -> {
            val validEventId = eventId ?: return null
            val validArticleId = articleId ?: return null
            val validFeedId = feedId ?: return null
            val validContentStatus = contentStatus ?: return null
            val validContentVersion = contentVersion ?: return null
            val validUpdatedAt = updatedAt ?: return null
            ArticleUpdatedEvent(
                eventId = validEventId,
                articleId = validArticleId,
                feedId = validFeedId,
                contentStatus = validContentStatus,
                contentVersion = validContentVersion,
                updatedAt = validUpdatedAt,
            )
        }

        else -> null
    }
}

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
    val accentColor: String? = null,
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
    val feedIds: List<String> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class SyncResponse(
    val accepted: Boolean? = null,
    val alreadyQueued: Boolean? = null,
    val requestId: String? = null,
    val jobId: String? = null,
    val jobIds: List<String> = emptyList(),
    val syncedCount: Int? = null,
    // Legacy fixtures used a string while queued refresh endpoints return an
    // object. Keep this tolerant; requestId plus the status endpoint are the
    // durable source of truth.
    val status: Any? = null,
    val totalFeeds: Int? = null,
    val syncedFeeds: Int? = null,
    val failedFeeds: Int? = null,
    val skippedFeeds: Int? = null,
    val newArticles: Int? = null,
)

@JsonClass(generateAdapter = true)
data class FeedSyncScope(
    val feedId: String? = null,
    val categoryId: String? = null,
)

@JsonClass(generateAdapter = true)
data class FeedSyncAllStatus(
    val requestId: String? = null,
    val status: String? = null,
    val queued: Boolean,
    val running: Boolean,
    val active: Boolean,
    val stale: Boolean,
    val queuedAt: String? = null,
    val startedAt: String? = null,
    val heartbeatAt: String? = null,
    val totalFeeds: Int = 0,
    val completedFeeds: Int = 0,
    val syncedFeeds: Int = 0,
    val failedFeeds: Int = 0,
    val skippedFeeds: Int = 0,
    val pendingFeeds: Int = 0,
    val runningFeeds: Int = 0,
    val deadFeeds: Int = 0,
    val newArticles: Int = 0,
    val articleRevision: Long = 0L,
    val jobId: String? = null,
    val scope: FeedSyncScope = FeedSyncScope(),
    val items: List<FeedSyncItemStatus> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class FeedSyncItemStatus(
    val feedId: String? = null,
    val sourceId: String? = null,
    val jobId: String? = null,
    val status: String,
    val feedTitle: String? = null,
    val errorCode: String? = null,
    val errorDetails: String? = null,
    val nextEligibleAt: String? = null,
    val publisherRequestStarted: Boolean = false,
    val lastFetchAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class DiscoverySelectionResponse(
    val candidateId: String,
    val feedId: String,
    val requestId: String,
    val jobId: String? = null,
)

@JsonClass(generateAdapter = true)
data class EnrichArticleResponse(
    val success: Boolean,
    val reason: String? = null,
    val queued: Boolean? = null,
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
