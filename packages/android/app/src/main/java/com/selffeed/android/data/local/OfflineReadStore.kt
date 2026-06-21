package com.selffeed.android.data.local

import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts

interface OfflineReadStore {
    suspend fun writeCategories(categories: List<CategoryWithCounts>)
    suspend fun readCategories(): List<CategoryWithCounts>
    suspend fun clearCategories()

    suspend fun writeFeeds(feeds: List<FeedWithCounts>)
    suspend fun readFeeds(): List<FeedWithCounts>
    suspend fun clearFeeds()

    suspend fun writeArticles(key: String, payload: ApiListResponse<ArticleListItem>)
    suspend fun readArticles(key: String): ApiListResponse<ArticleListItem>?
    suspend fun clearArticlePages()

    suspend fun writeArticleDetail(detail: ArticleDetail)
    suspend fun readArticleDetail(articleId: String): ArticleDetail?
    suspend fun clearArticleDetail(articleId: String)

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

    override suspend fun readFeeds(): List<FeedWithCounts> =
        localStore.readFeeds().ifEmpty { fileCacheStore.readFeeds() }

    override suspend fun clearFeeds() {
        localStore.clearTable(LocalStore.TABLE_FEEDS)
        fileCacheStore.clearByPrefix("feeds")
    }

    override suspend fun writeArticles(key: String, payload: ApiListResponse<ArticleListItem>) {
        localStore.writeArticles(key, payload)
        fileCacheStore.writeArticles(key, payload)
    }

    override suspend fun readArticles(key: String): ApiListResponse<ArticleListItem>? =
        localStore.readArticles(key) ?: fileCacheStore.readArticles(key)

    override suspend fun clearArticlePages() {
        localStore.clearTable(LocalStore.TABLE_ARTICLES)
        localStore.clearTable(LocalStore.TABLE_ARTICLE_PAGES)
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

    override suspend fun clearAll() {
        localStore.clearAll()
        fileCacheStore.clearAll()
    }

    override suspend fun clearFeedAndArticleData() {
        clearFeeds()
        clearCategories()
        clearArticlePages()
    }
}
