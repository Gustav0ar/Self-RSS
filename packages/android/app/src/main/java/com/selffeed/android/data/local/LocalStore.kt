package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.atomic.AtomicLong

/**
 * Room-backed local source for offline reads and stale-while-revalidate flows.
 *
 * Categories and feeds are stored as typed rows so they can become the durable
 * source of truth for navigation and unread counts. Article pages and details
 * still retain their network payloads because the API is cursor-based and the
 * reader body is already a complete immutable document.
 */
class LocalStore(
    context: Context,
    moshi: Moshi,
) {
    private val database: LocalDatabase = Room.databaseBuilder(
        context.applicationContext,
        LocalDatabase::class.java,
        DB_NAME,
    )
        .fallbackToDestructiveMigration(dropAllTables = true)
        .build()
    private val dao = database.localStoreDao()

    private val categoryChildrenAdapter: JsonAdapter<List<CategoryWithCounts>> = moshi.adapter(
        Types.newParameterizedType(List::class.java, CategoryWithCounts::class.java),
    )
    private val articleIdsAdapter: JsonAdapter<List<String>> = moshi.adapter(
        Types.newParameterizedType(List::class.java, String::class.java),
    )
    private val articleDetailAdapter: JsonAdapter<ArticleDetail> = moshi.adapter(ArticleDetail::class.java)

    private val _invalidations = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 16)
    val invalidations = _invalidations.asSharedFlow()
    private val invalidationSeq = AtomicLong(0)

    suspend fun writeCategories(categories: List<CategoryWithCounts>) {
        dao.clearCategories()
        if (categories.isNotEmpty()) {
            dao.upsertCategories(categories.mapIndexed { index, category -> category.toEntity(index) })
        }
        notifyInvalidation(TABLE_CATEGORIES)
    }

    suspend fun readCategories(): List<CategoryWithCounts> =
        dao.readCategories().map { it.toModel() }

    suspend fun writeFeeds(feeds: List<FeedWithCounts>) {
        dao.clearFeeds()
        if (feeds.isNotEmpty()) {
            dao.upsertFeeds(feeds.mapIndexed { index, feed -> feed.toEntity(index) })
        }
        notifyInvalidation(TABLE_FEEDS)
    }

    suspend fun readFeeds(): List<FeedWithCounts> =
        dao.readFeeds().map { it.toModel() }

    suspend fun writeArticles(key: String, payload: ApiListResponse<ArticleListItem>) {
        if (payload.data.isNotEmpty()) {
            dao.upsertArticles(payload.data.map { it.toEntity() })
        }
        dao.upsertArticlePage(
            ArticlePageEntity(
                cacheKey = key,
                articleIdsJson = articleIdsAdapter.toJson(payload.data.map { it.id }),
                cursor = payload.cursor,
                hasMore = payload.hasMore,
                writtenAt = System.currentTimeMillis(),
            ),
        )
        notifyInvalidation(TABLE_ARTICLE_PAGES)
    }

    suspend fun readArticles(key: String): ApiListResponse<ArticleListItem>? {
        val page = dao.readArticlePage(key) ?: return null
        if (System.currentTimeMillis() - page.writtenAt > MAX_ARTICLE_PAGE_AGE_MS) {
            return null
        }
        val ids = runCatching { articleIdsAdapter.fromJson(page.articleIdsJson) }.getOrNull()
            ?: return null
        if (ids.isEmpty()) {
            return ApiListResponse(data = emptyList(), cursor = page.cursor, hasMore = page.hasMore)
        }
        val rowsById = dao.readArticlesByIds(ids).associateBy { it.id }
        val orderedRows = ids.mapNotNull(rowsById::get)
        if (orderedRows.size != ids.size) return null
        return ApiListResponse(
            data = orderedRows.map { it.toModel() },
            cursor = page.cursor,
            hasMore = page.hasMore,
        )
    }

    suspend fun writeArticleDetail(detail: ArticleDetail) {
        dao.upsertArticleDetail(
            ArticleDetailEntity(
                id = detail.id,
                feedId = detail.feedId,
                payloadJson = articleDetailAdapter.toJson(detail),
                writtenAt = System.currentTimeMillis(),
            ),
        )
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    suspend fun readArticleDetail(articleId: String): ArticleDetail? {
        val detail = dao.readArticleDetail(articleId) ?: return null
        if (System.currentTimeMillis() - detail.writtenAt > MAX_ARTICLE_DETAIL_AGE_MS) {
            return null
        }
        return runCatching { articleDetailAdapter.fromJson(detail.payloadJson) }.getOrNull()
    }

    suspend fun clearAll() {
        dao.clearCategories()
        dao.clearFeeds()
        dao.clearArticles()
        dao.clearArticlePages()
        dao.clearArticleDetails()
        notifyInvalidation("all")
    }

    suspend fun clearTable(table: String) {
        when (table) {
            TABLE_CATEGORIES -> dao.clearCategories()
            TABLE_FEEDS -> dao.clearFeeds()
            TABLE_ARTICLES -> dao.clearArticles()
            TABLE_ARTICLE_PAGES -> dao.clearArticlePages()
            TABLE_ARTICLE_DETAILS -> dao.clearArticleDetails()
            else -> return
        }
        notifyInvalidation(table)
    }

    fun invalidationFlow(): Flow<String> = invalidations

    private suspend fun notifyInvalidation(table: String) {
        _invalidations.emit("${invalidationSeq.incrementAndGet()}:$table")
    }

    private fun CategoryWithCounts.toEntity(cacheOrder: Int): CategoryEntity =
        CategoryEntity(
            id = id,
            userId = userId,
            parentCategoryId = parentCategoryId,
            name = name,
            slug = slug,
            sortOrder = sortOrder,
            createdAt = createdAt,
            updatedAt = updatedAt,
            feedCount = feedCount,
            unreadCount = unreadCount,
            childrenJson = children?.let(categoryChildrenAdapter::toJson),
            cacheOrder = cacheOrder,
        )

    private fun CategoryEntity.toModel(): CategoryWithCounts =
        CategoryWithCounts(
            id = id,
            userId = userId,
            parentCategoryId = parentCategoryId,
            name = name,
            slug = slug,
            sortOrder = sortOrder,
            createdAt = createdAt,
            updatedAt = updatedAt,
            feedCount = feedCount,
            unreadCount = unreadCount,
            children = childrenJson?.let { runCatching { categoryChildrenAdapter.fromJson(it) }.getOrNull() },
        )

    private fun FeedWithCounts.toEntity(cacheOrder: Int): FeedEntity =
        FeedEntity(
            id = id,
            userId = userId,
            categoryId = categoryId,
            title = title,
            siteUrl = siteUrl,
            feedUrl = feedUrl,
            faviconUrl = faviconUrl,
            description = description,
            pollingIntervalMinutes = pollingIntervalMinutes,
            lastSyncedAt = lastSyncedAt,
            syncStatus = syncStatus,
            createdAt = createdAt,
            updatedAt = updatedAt,
            unreadCount = unreadCount,
            cacheOrder = cacheOrder,
        )

    private fun FeedEntity.toModel(): FeedWithCounts =
        FeedWithCounts(
            id = id,
            userId = userId,
            categoryId = categoryId,
            title = title,
            siteUrl = siteUrl,
            feedUrl = feedUrl,
            faviconUrl = faviconUrl,
            description = description,
            pollingIntervalMinutes = pollingIntervalMinutes,
            lastSyncedAt = lastSyncedAt,
            syncStatus = syncStatus,
            createdAt = createdAt,
            updatedAt = updatedAt,
            unreadCount = unreadCount,
        )

    private fun ArticleListItem.toEntity(): ArticleEntity =
        ArticleEntity(
            id = id,
            feedId = feedId,
            feedTitle = feedTitle,
            feedFaviconUrl = feedFaviconUrl,
            title = title,
            author = author,
            excerpt = excerpt,
            heroImageUrl = heroImageUrl,
            publishedAt = publishedAt,
            displayedAt = displayedAt,
            isRead = isRead,
        )

    private fun ArticleEntity.toModel(): ArticleListItem =
        ArticleListItem(
            id = id,
            feedId = feedId,
            feedTitle = feedTitle,
            feedFaviconUrl = feedFaviconUrl,
            title = title,
            author = author,
            excerpt = excerpt,
            heroImageUrl = heroImageUrl,
            publishedAt = publishedAt,
            displayedAt = displayedAt,
            isRead = isRead,
        )

    companion object {
        private const val DB_NAME = "selffeed.db"
        const val TABLE_CATEGORIES = LocalTables.CATEGORIES
        const val TABLE_FEEDS = LocalTables.FEEDS
        const val TABLE_ARTICLES = LocalTables.ARTICLES
        const val TABLE_ARTICLE_PAGES = LocalTables.ARTICLE_PAGES
        const val TABLE_ARTICLE_DETAILS = LocalTables.ARTICLE_DETAILS

        private const val MAX_ARTICLE_PAGE_AGE_MS = 7L * 24 * 60 * 60 * 1000
        private const val MAX_ARTICLE_DETAIL_AGE_MS = 7L * 24 * 60 * 60 * 1000
    }
}
