package com.selffeed.android.data.local

import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts

interface OfflineReadStore {
    suspend fun writeCategories(categories: List<CategoryWithCounts>)
    suspend fun readCategories(): List<CategoryWithCounts>
    suspend fun clearCategories()

    suspend fun writeFeeds(feeds: List<FeedWithCounts>)
    suspend fun mergeFeeds(feeds: List<FeedWithCounts>)
    suspend fun readFeeds(): List<FeedWithCounts>
    suspend fun clearFeeds()

    suspend fun clearArticleLists()

    suspend fun writeArticleDetail(detail: ArticleDetail)
    suspend fun readArticleDetail(articleId: String): ArticleDetail?
    suspend fun clearArticleDetail(articleId: String)
    suspend fun clearArticleDetails()

    suspend fun clearAll()
    suspend fun clearFeedAndArticleData()
}

class CompositeOfflineReadStore(
    private val localStore: LocalStore,
    private val fileCacheStore: OfflineCacheStore,
) : OfflineReadStore {
    override suspend fun writeCategories(categories: List<CategoryWithCounts>) {
        localStore.writeCategories(categories)
        fileCacheStore.writeCategories(categories)
    }

    override suspend fun readCategories(): List<CategoryWithCounts> =
        localStore.readCategories().ifEmpty { fileCacheStore.readCategories() }

    override suspend fun clearCategories() {
        localStore.clearTable(LocalStore.TABLE_CATEGORIES)
        fileCacheStore.clearByPrefix("categories")
    }

    override suspend fun writeFeeds(feeds: List<FeedWithCounts>) {
        localStore.writeFeeds(feeds)
        fileCacheStore.writeFeeds(feeds)
    }

    override suspend fun mergeFeeds(feeds: List<FeedWithCounts>) {
        if (feeds.isEmpty()) return
        val replacements = feeds.associateBy(FeedWithCounts::id)
        val existing = readFeeds()
        val merged = buildList {
            existing.forEach { add(replacements[it.id] ?: it) }
            feeds.filterNot { incoming -> existing.any { it.id == incoming.id } }.forEach(::add)
        }
        writeFeeds(merged)
    }

    override suspend fun readFeeds(): List<FeedWithCounts> =
        localStore.readFeeds().ifEmpty { fileCacheStore.readFeeds() }

    override suspend fun clearFeeds() {
        localStore.clearTable(LocalStore.TABLE_FEEDS)
        fileCacheStore.clearByPrefix("feeds")
    }

    override suspend fun clearArticleLists() {
        localStore.clearTable(LocalStore.TABLE_ARTICLES)
        // Remove cursor-page files left by older versions. New builds keep
        // article lists exclusively in Room query entries.
        fileCacheStore.clearByPrefix("articles-")
    }

    override suspend fun writeArticleDetail(detail: ArticleDetail) {
        localStore.writeArticleDetail(detail)
        fileCacheStore.writeArticleDetail(detail)
    }

    override suspend fun readArticleDetail(articleId: String): ArticleDetail? =
        localStore.readArticleDetail(articleId) ?: fileCacheStore.readArticleDetail(articleId)

    override suspend fun clearArticleDetail(articleId: String) {
        localStore.clearArticleDetail(articleId)
        fileCacheStore.clearByPrefix("article-$articleId")
    }

    override suspend fun clearArticleDetails() {
        localStore.clearArticleDetails()
        fileCacheStore.clearByPrefix("article-")
    }

    override suspend fun clearAll() {
        localStore.clearAll()
        fileCacheStore.clearAll()
    }

    override suspend fun clearFeedAndArticleData() {
        clearFeeds()
        clearCategories()
        clearArticleLists()
    }
}
