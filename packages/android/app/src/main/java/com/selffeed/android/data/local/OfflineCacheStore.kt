package com.selffeed.android.data.local

import android.content.Context
import android.util.Log
import com.selffeed.android.BuildConfig
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/**
 * Persists read responses to a per-app cache directory so the app can show
 * something useful while offline. Hardening notes:
 *
 * - **Atomic writes**: every payload is written to a `*.tmp` file and then
 *   renamed into place. A crash mid-write leaves the previous file intact.
 * - **TTL**: cached files are checked against [DEFAULT_MAX_AGE_MS] on read;
 *   stale entries are treated as misses (the caller falls back to network).
 * - **Size cap**: total cache bytes are bounded; oldest files are evicted LRU.
 * - **Persistent root**: the root dir is re-created lazily so we survive the
 *   system clearing cacheDir.
 */
class OfflineCacheStore(
    context: Context,
    moshi: Moshi,
    private val maxAgeMs: Long = DEFAULT_MAX_AGE_MS,
    private val maxTotalBytes: Long = DEFAULT_MAX_TOTAL_BYTES,
) {
    private val root: File = File(context.cacheDir, ROOT_DIR).apply { mkdirs() }

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

    suspend fun writeCategories(categories: List<CategoryWithCounts>) = withContext(Dispatchers.IO) {
        atomicWrite("categories.json", categoriesAdapter.toJson(categories))
        pruneCacheFiles()
    }

    suspend fun readCategories(): List<CategoryWithCounts> = withContext(Dispatchers.IO) {
        readIfFresh("categories.json", categoriesAdapter::fromJson) ?: emptyList()
    }

    suspend fun writeFeeds(feeds: List<FeedWithCounts>) = withContext(Dispatchers.IO) {
        atomicWrite("feeds.json", feedsAdapter.toJson(feeds))
        pruneCacheFiles()
    }

    suspend fun readFeeds(): List<FeedWithCounts> = withContext(Dispatchers.IO) {
        readIfFresh("feeds.json", feedsAdapter::fromJson) ?: emptyList()
    }

    suspend fun writeArticles(key: String, payload: ApiListResponse<ArticleListItem>) = withContext(Dispatchers.IO) {
        atomicWrite(sanitizeKey("articles-$key.json"), articleListAdapter.toJson(payload))
        pruneCacheFiles()
    }

    suspend fun readArticles(key: String): ApiListResponse<ArticleListItem>? = withContext(Dispatchers.IO) {
        readIfFresh(sanitizeKey("articles-$key.json"), articleListAdapter::fromJson)
    }

    suspend fun writeArticleDetail(article: ArticleDetail) = withContext(Dispatchers.IO) {
        atomicWrite(sanitizeKey("article-${article.id}.json"), articleDetailAdapter.toJson(article))
        pruneCacheFiles()
    }

    suspend fun readArticleDetail(articleId: String): ArticleDetail? = withContext(Dispatchers.IO) {
        readIfFresh(sanitizeKey("article-$articleId.json"), articleDetailAdapter::fromJson)
    }

    suspend fun clearByPrefix(prefix: String) = withContext(Dispatchers.IO) {
        ensureRoot()
        root.listFiles()?.forEach { file ->
            if (file.isFile && file.name.startsWith(prefix)) {
                file.delete()
            }
        }
        Unit
    }

    suspend fun clearAll() = withContext(Dispatchers.IO) {
        ensureRoot()
        root.listFiles()?.forEach { it.delete() }
        Unit
    }

    private fun ensureRoot() {
        if (!root.exists()) root.mkdirs()
    }

    private fun atomicWrite(fileName: String, content: String) {
        ensureRoot()
        val target = File(root, fileName)
        val tmp = File(root, "$fileName.tmp")
        try {
            tmp.writeText(content, Charsets.UTF_8)
            if (target.exists()) target.delete()
            if (!tmp.renameTo(target)) {
                // renameTo can fail across mount points; fall back to copy+delete.
                tmp.copyTo(target, overwrite = true)
                tmp.delete()
            }
        } catch (e: IOException) {
            tmp.delete()
            debugLog("Failed to write cache file $fileName: ${e.message}")
        }
    }

    private fun <T> readIfFresh(fileName: String, parser: (String) -> T?): T? {
        ensureRoot()
        val file = File(root, fileName)
        if (!file.exists()) return null
        val age = System.currentTimeMillis() - file.lastModified()
        if (age > maxAgeMs) {
            debugLog("Discarding stale cache file $fileName (age=${age}ms)")
            file.delete()
            return null
        }
        return runCatching { parser(file.readText()) }.getOrNull()
    }

    private fun pruneCacheFiles() {
        val files = root.listFiles()?.filter { it.isFile && !it.name.endsWith(".tmp") } ?: return
        if (files.isEmpty()) return

        // File-count guard (legacy behavior; bounds pathological tiny-file growth).
        if (files.size > MAX_CACHE_FILES) {
            files.sortedBy { it.lastModified() }
                .take(files.size - MAX_CACHE_FILES)
                .forEach { it.delete() }
        }

        // Size guard — sum the remaining files; evict oldest until under cap.
        val survivors = root.listFiles()?.filter { it.isFile && !it.name.endsWith(".tmp") }
            ?: return
        var totalBytes = survivors.sumOf { it.length() }
        if (totalBytes <= maxTotalBytes) return

        val ordered = survivors.sortedBy { it.lastModified() }
        val it = ordered.iterator()
        while (totalBytes > maxTotalBytes && it.hasNext()) {
            val victim = it.next()
            totalBytes -= victim.length()
            victim.delete()
        }
    }

    private fun sanitizeKey(value: String): String = value.replace(Regex("[^a-zA-Z0-9._-]"), "_")

    private fun debugLog(message: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, message)
    }

    companion object {
        private const val TAG = "OfflineCacheStore"
        private const val ROOT_DIR = "offline-cache"
        private const val MAX_CACHE_FILES = 240
        private const val DEFAULT_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000 // 7 days
        private const val DEFAULT_MAX_TOTAL_BYTES = 25L * 1024 * 1024 // 25 MB
    }
}
