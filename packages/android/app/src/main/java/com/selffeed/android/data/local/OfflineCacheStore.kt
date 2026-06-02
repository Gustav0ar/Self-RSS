package com.selffeed.android.data.local

import android.content.Context
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import java.io.File

class OfflineCacheStore(
    context: Context,
    moshi: Moshi,
) {
    private val root = File(context.cacheDir, "offline-cache").apply { mkdirs() }
    private val categoriesAdapter: JsonAdapter<List<CategoryWithCounts>> = moshi.adapter(
        Types.newParameterizedType(List::class.java, CategoryWithCounts::class.java),
    )
    private val feedsAdapter: JsonAdapter<List<FeedWithCounts>> = moshi.adapter(
        Types.newParameterizedType(List::class.java, FeedWithCounts::class.java),
    )
    private val articleListAdapter: JsonAdapter<ApiListResponse<ArticleListItem>> = moshi.adapter(
        Types.newParameterizedType(ApiListResponse::class.java, ArticleListItem::class.java),
    )
    private val articleDetailAdapter: JsonAdapter<ArticleDetail> = moshi.adapter(ArticleDetail::class.java)

    fun writeCategories(categories: List<CategoryWithCounts>) {
        File(root, "categories.json").writeText(categoriesAdapter.toJson(categories))
        pruneCacheFiles()
    }

    fun readCategories(): List<CategoryWithCounts> =
        runCatching {
            val file = File(root, "categories.json")
            if (!file.exists()) emptyList() else categoriesAdapter.fromJson(file.readText()) ?: emptyList()
        }.getOrDefault(emptyList())

    fun writeFeeds(feeds: List<FeedWithCounts>) {
        File(root, "feeds.json").writeText(feedsAdapter.toJson(feeds))
        pruneCacheFiles()
    }

    fun readFeeds(): List<FeedWithCounts> =
        runCatching {
            val file = File(root, "feeds.json")
            if (!file.exists()) emptyList() else feedsAdapter.fromJson(file.readText()) ?: emptyList()
        }.getOrDefault(emptyList())

    fun writeArticles(key: String, payload: ApiListResponse<ArticleListItem>) {
        File(root, sanitizeKey("articles-$key.json")).writeText(articleListAdapter.toJson(payload))
        pruneCacheFiles()
    }

    fun readArticles(key: String): ApiListResponse<ArticleListItem>? =
        runCatching {
            val file = File(root, sanitizeKey("articles-$key.json"))
            if (!file.exists()) null else articleListAdapter.fromJson(file.readText())
        }.getOrNull()

    fun writeArticleDetail(article: ArticleDetail) {
        File(root, sanitizeKey("article-${article.id}.json")).writeText(articleDetailAdapter.toJson(article))
        pruneCacheFiles()
    }

    fun readArticleDetail(articleId: String): ArticleDetail? =
        runCatching {
            val file = File(root, sanitizeKey("article-$articleId.json"))
            if (!file.exists()) null else articleDetailAdapter.fromJson(file.readText())
        }.getOrNull()

    fun clearByPrefix(prefix: String) {
        root.listFiles()?.forEach { file ->
            if (file.name.startsWith(prefix)) {
                file.delete()
            }
        }
    }

    fun clearAll() {
        root.listFiles()?.forEach { it.deleteRecursively() }
    }

    private fun sanitizeKey(value: String): String = value.replace(Regex("[^a-zA-Z0-9._-]"), "_")

    private fun pruneCacheFiles() {
        val files = root.listFiles()?.filter { it.isFile } ?: return
        if (files.size <= MAX_CACHE_FILES) return

        files
            .sortedBy { it.lastModified() }
            .take(files.size - MAX_CACHE_FILES)
            .forEach { it.delete() }
    }

    private companion object {
        const val MAX_CACHE_FILES = 240
    }
}
