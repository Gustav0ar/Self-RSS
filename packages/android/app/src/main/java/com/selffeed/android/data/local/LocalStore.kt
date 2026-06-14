package com.selffeed.android.data.local

import android.content.ContentValues
import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.sqlite.db.SupportSQLiteOpenHelper
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong

/**
 * SQLite-backed offline store using [androidx.sqlite] (the same framework
 * Room is built on, but without the annotation processor). Provides the
 * same offline-first guarantees as the previous JSON cache, with much
 * better concurrency and indexed lookups.
 *
 * Schema:
 *   categories (id PK, name, parent_id, unread_count, sort_order, ...)
 *   feeds      (id PK, category_id, title, url, favicon_url, unread_count, ...)
 *   articles   (id PK, feed_id, title, url, hero_image_url, published_at,
 *               displayed_at, is_read, is_bookmarked, canonical_url, ...)
 *   article_details (id PK, content_html, content_text, excerpt, hero_image_url,
 *                    video_url, audio_url, is_enriched, ...)
 *
 * Each row is keyed by a single primary key (the upstream ID), so the
 * network response replaces the local row in a single upsert.
 */
class LocalStore(
    context: Context,
    moshi: Moshi,
) {
    private val openHelper: SupportSQLiteOpenHelper = FrameworkSQLiteOpenHelperFactory().create(
        SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(DB_NAME)
            .callback(Callback())
            .build(),
    )

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

    // Lightweight invalidation signals. Compose can observe these instead
    // of polling Room. The shared flow replays the latest value to new
    // subscribers so the UI updates on subscription.
    private val _invalidations = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 16)
    val invalidations = _invalidations.asSharedFlow()
    private val invalidationSeq = AtomicLong(0)

    suspend fun writeCategories(categories: List<CategoryWithCounts>) = withContext(Dispatchers.IO) {
        val db = openHelper.writableDatabase
db.beginTransaction()
try {
                for (c in categories) {
                    openHelper.writableDatabase.insert(
                        TABLE_CATEGORIES,
                        android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE,
                        ContentValues().apply {
                            put("id", c.id)
                            put("name", c.name)
                            put("parent_id", c.parentCategoryId)
                            put("slug", c.slug)
                            put("sort_order", c.sortOrder)
                            put("feed_count", c.feedCount)
                            put("unread_count", c.unreadCount)
                            put("payload", categoriesAdapter.toJson(categories))
                        },
                    )
                }
db.setTransactionSuccessful()
} finally {
db.endTransaction()
}
        notifyInvalidation(TABLE_CATEGORIES)
    }

    suspend fun readCategories(): List<CategoryWithCounts> = withContext(Dispatchers.IO) {
        // The "payload" column stores the last full list; this is the
        // simplest representation and supports offline reads in O(1).
        readPayload(TABLE_CATEGORIES, categoriesAdapter) ?: emptyList()
    }

    suspend fun writeFeeds(feeds: List<FeedWithCounts>) = withContext(Dispatchers.IO) {
        val db = openHelper.writableDatabase
db.beginTransaction()
try {
                for (f in feeds) {
                    openHelper.writableDatabase.insert(
                        TABLE_FEEDS,
                        android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE,
                        ContentValues().apply {
                            put("id", f.id)
                            put("category_id", f.categoryId)
                            put("title", f.title)
                            put("url", f.feedUrl)
                            put("favicon_url", f.faviconUrl)
                            put("unread_count", f.unreadCount)
                            put("polling_interval", f.pollingIntervalMinutes)
                            put("payload", feedsAdapter.toJson(feeds))
                        },
                    )
                }
db.setTransactionSuccessful()
} finally {
db.endTransaction()
}
        notifyInvalidation(TABLE_FEEDS)
    }

    suspend fun readFeeds(): List<FeedWithCounts> = withContext(Dispatchers.IO) {
        readPayload(TABLE_FEEDS, feedsAdapter) ?: emptyList()
    }

    suspend fun writeArticles(key: String, payload: ApiListResponse<ArticleListItem>) = withContext(Dispatchers.IO) {
        openHelper.writableDatabase.insert(
            TABLE_ARTICLE_PAGES,
            android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE,
            ContentValues().apply {
                put("cache_key", key)
                put("payload", articleListAdapter.toJson(payload))
                put("written_at", System.currentTimeMillis())
            },
        )
        notifyInvalidation(TABLE_ARTICLES)
    }

    suspend fun readArticles(key: String): ApiListResponse<ArticleListItem>? = withContext(Dispatchers.IO) {
        openHelper.readableDatabase.query(
            "SELECT payload, written_at FROM $TABLE_ARTICLE_PAGES WHERE cache_key = ?",
            arrayOf(key),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val writtenAt = cursor.getLong(1)
            if (System.currentTimeMillis() - writtenAt > MAX_ARTICLE_PAGE_AGE_MS) {
                return@use null
            }
            articleListAdapter.fromJson(cursor.getString(0))
        }
    }

    suspend fun writeArticleDetail(detail: ArticleDetail) = withContext(Dispatchers.IO) {
        openHelper.writableDatabase.insert(
            TABLE_ARTICLE_DETAILS,
            android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE,
            ContentValues().apply {
                put("id", detail.id)
                put("feed_id", detail.feedId)
                put("payload", articleDetailAdapter.toJson(detail))
                put("written_at", System.currentTimeMillis())
            },
        )
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    suspend fun readArticleDetail(articleId: String): ArticleDetail? = withContext(Dispatchers.IO) {
        openHelper.readableDatabase.query(
            "SELECT payload, written_at FROM $TABLE_ARTICLE_DETAILS WHERE id = ?",
            arrayOf(articleId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val writtenAt = cursor.getLong(1)
            if (System.currentTimeMillis() - writtenAt > MAX_ARTICLE_DETAIL_AGE_MS) {
                return@use null
            }
            articleDetailAdapter.fromJson(cursor.getString(0))
        }
    }

    suspend fun clearAll() = withContext(Dispatchers.IO) {
        val db = openHelper.writableDatabase
db.beginTransaction()
try {
                for (table in listOf(TABLE_CATEGORIES, TABLE_FEEDS, TABLE_ARTICLE_PAGES, TABLE_ARTICLE_DETAILS)) {
                    openHelper.writableDatabase.delete(table, null, null)
                }
db.setTransactionSuccessful()
} finally {
db.endTransaction()
}
        notifyInvalidation("all")
    }

    /**
     * Clears rows from a specific table. The prefix is the table name
     * (one of [TABLE_CATEGORIES], [TABLE_FEEDS], [TABLE_ARTICLE_PAGES],
     * [TABLE_ARTICLE_DETAILS]). Callers are expected to pass the right
     * value — splitting storage by table is the only indexing we have.
     */
    suspend fun clearTable(table: String) = withContext(Dispatchers.IO) {
        if (table in listOf(TABLE_CATEGORIES, TABLE_FEEDS, TABLE_ARTICLE_PAGES, TABLE_ARTICLE_DETAILS)) {
            openHelper.writableDatabase.delete(table, null, null)
            notifyInvalidation(table)
        }
    }

    /**
     * Subscribe to invalidation signals. Each emission is `seq:table`
     * where seq is monotonic and table is one of the table names.
     * Consumers can dedupe / filter by table.
     */
    fun invalidationFlow(): Flow<String> = invalidations

    private fun <T> readPayload(table: String, adapter: JsonAdapter<T>): T? {
        openHelper.readableDatabase.query(
            "SELECT payload FROM $table LIMIT 1",
            arrayOf<Any?>(),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return runCatching { adapter.fromJson(cursor.getString(0)) }.getOrNull()
        }
    }

    private suspend fun notifyInvalidation(table: String) {
        _invalidations.emit("${invalidationSeq.incrementAndGet()}:$table")
    }

    private class Callback : SupportSQLiteOpenHelper.Callback(VERSION) {
        override fun onCreate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE $TABLE_CATEGORIES (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    parent_id TEXT,
                    slug TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    feed_count INTEGER NOT NULL DEFAULT 0,
                    unread_count INTEGER NOT NULL DEFAULT 0,
                    payload TEXT
                )
                """.trimIndent(),
            )
            db.execSQL("CREATE INDEX idx_categories_parent ON $TABLE_CATEGORIES(parent_id)")
            db.execSQL(
                """
                CREATE TABLE $TABLE_FEEDS (
                    id TEXT PRIMARY KEY NOT NULL,
                    category_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    favicon_url TEXT,
                    unread_count INTEGER NOT NULL DEFAULT 0,
                    polling_interval INTEGER NOT NULL DEFAULT 60,
                    payload TEXT
                )
                """.trimIndent(),
            )
            db.execSQL("CREATE INDEX idx_feeds_category ON $TABLE_FEEDS(category_id)")
            db.execSQL(
                """
                CREATE TABLE $TABLE_ARTICLE_PAGES (
                    cache_key TEXT PRIMARY KEY NOT NULL,
                    payload TEXT NOT NULL,
                    written_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            db.execSQL(
                """
                CREATE TABLE $TABLE_ARTICLE_DETAILS (
                    id TEXT PRIMARY KEY NOT NULL,
                    feed_id TEXT,
                    payload TEXT NOT NULL,
                    written_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            db.execSQL("CREATE INDEX idx_details_written ON $TABLE_ARTICLE_DETAILS(written_at)")
        }

        override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // Future schema bumps land here. For now this is a no-op
            // because the store was just introduced.
        }
    }

    companion object {
        private const val VERSION = 1
        private const val DB_NAME = "selffeed.db"
        const val TABLE_CATEGORIES = "categories"
        const val TABLE_FEEDS = "feeds"
        const val TABLE_ARTICLE_PAGES = "article_pages"
        const val TABLE_ARTICLE_DETAILS = "article_details"
        const val TABLE_ARTICLES = "articles"

        private const val MAX_ARTICLE_PAGE_AGE_MS = 7L * 24 * 60 * 60 * 1000 // 7 days
        private const val MAX_ARTICLE_DETAIL_AGE_MS = 7L * 24 * 60 * 60 * 1000 // 7 days
    }
}
