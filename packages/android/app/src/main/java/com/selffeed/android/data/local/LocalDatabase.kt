package com.selffeed.android.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

object LocalTables {
    const val CATEGORIES = "categories"
    const val FEEDS = "feeds"
    const val ARTICLES = "articles"
    const val ARTICLE_PAGES = "article_pages"
    const val ARTICLE_DETAILS = "article_details"
}

@Entity(
    tableName = LocalTables.CATEGORIES,
    indices = [Index("parentCategoryId")],
)
data class CategoryEntity(
    @PrimaryKey val id: String,
    val userId: String?,
    val parentCategoryId: String?,
    val name: String,
    val slug: String,
    val sortOrder: Int,
    val createdAt: String?,
    val updatedAt: String?,
    val feedCount: Int,
    val unreadCount: Int,
    val childrenJson: String?,
    val cacheOrder: Int,
)

@Entity(
    tableName = LocalTables.FEEDS,
    indices = [Index("categoryId")],
)
data class FeedEntity(
    @PrimaryKey val id: String,
    val userId: String?,
    val categoryId: String,
    val title: String,
    val siteUrl: String?,
    val feedUrl: String,
    val faviconUrl: String?,
    val description: String?,
    val pollingIntervalMinutes: Int,
    val lastSyncedAt: String?,
    val syncStatus: String,
    val createdAt: String?,
    val updatedAt: String?,
    val unreadCount: Int,
    val cacheOrder: Int,
)

@Entity(
    tableName = LocalTables.ARTICLES,
    indices = [Index("feedId"), Index("displayedAt"), Index("publishedAt")],
)
data class ArticleEntity(
    @PrimaryKey val id: String,
    val feedId: String,
    val feedTitle: String,
    val feedFaviconUrl: String?,
    val title: String,
    val author: String?,
    val excerpt: String?,
    val heroImageUrl: String?,
    val publishedAt: String?,
    val displayedAt: String?,
    val isRead: Boolean,
)

@Entity(tableName = LocalTables.ARTICLE_PAGES)
data class ArticlePageEntity(
    @PrimaryKey val cacheKey: String,
    val articleIdsJson: String,
    val cursor: String?,
    val hasMore: Boolean,
    val writtenAt: Long,
)

@Entity(
    tableName = LocalTables.ARTICLE_DETAILS,
    indices = [Index("feedId"), Index("writtenAt")],
)
data class ArticleDetailEntity(
    @PrimaryKey val id: String,
    val feedId: String?,
    val payloadJson: String,
    val writtenAt: Long,
)

@Dao
interface LocalStoreDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCategories(categories: List<CategoryEntity>)

    @Query("SELECT * FROM categories ORDER BY sortOrder ASC, cacheOrder ASC, name ASC")
    suspend fun readCategories(): List<CategoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFeeds(feeds: List<FeedEntity>)

    @Query("SELECT * FROM feeds ORDER BY cacheOrder ASC, title ASC")
    suspend fun readFeeds(): List<FeedEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticles(articles: List<ArticleEntity>)

    @Query("SELECT * FROM articles WHERE id IN (:ids)")
    suspend fun readArticlesByIds(ids: List<String>): List<ArticleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticlePage(page: ArticlePageEntity)

    @Query("SELECT * FROM article_pages WHERE cacheKey = :key LIMIT 1")
    suspend fun readArticlePage(key: String): ArticlePageEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleDetail(detail: ArticleDetailEntity)

    @Query("SELECT * FROM article_details WHERE id = :articleId LIMIT 1")
    suspend fun readArticleDetail(articleId: String): ArticleDetailEntity?

    @Query("DELETE FROM categories")
    suspend fun clearCategories()

    @Query("DELETE FROM feeds")
    suspend fun clearFeeds()

    @Query("DELETE FROM articles")
    suspend fun clearArticles()

    @Query("DELETE FROM article_pages")
    suspend fun clearArticlePages()

    @Query("DELETE FROM article_details")
    suspend fun clearArticleDetails()
}

@Database(
    entities = [
        CategoryEntity::class,
        FeedEntity::class,
        ArticleEntity::class,
        ArticlePageEntity::class,
        ArticleDetailEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun localStoreDao(): LocalStoreDao
}
