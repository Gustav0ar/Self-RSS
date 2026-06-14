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
import androidx.paging.PagingSource
import com.selffeed.android.network.ArticleListItem

object LocalTables {
    const val CATEGORIES = "categories"
    const val FEEDS = "feeds"
    const val ARTICLES = "articles"
    const val ARTICLE_QUERY_ENTRIES = "article_query_entries"
    const val ARTICLE_REMOTE_KEYS = "article_remote_keys"
    const val PENDING_READ_STATE_MUTATIONS = "pending_read_state_mutations"
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

@Entity(
    tableName = LocalTables.ARTICLE_QUERY_ENTRIES,
    primaryKeys = ["queryKey", "articleId"],
    indices = [Index("queryKey"), Index("articleId"), Index("position")],
)
data class ArticleQueryEntryEntity(
    val queryKey: String,
    val articleId: String,
    val position: Int,
)

@Entity(tableName = LocalTables.ARTICLE_REMOTE_KEYS)
data class ArticleRemoteKeyEntity(
    @PrimaryKey val queryKey: String,
    val nextCursor: String?,
    val endReached: Boolean,
    val updatedAt: Long,
)

@Entity(tableName = LocalTables.PENDING_READ_STATE_MUTATIONS)
data class PendingReadStateMutationEntity(
    @PrimaryKey val articleId: String,
    val read: Boolean,
    val updatedAt: Long,
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

    @Query(
        """
        SELECT articles.* FROM article_query_entries
        INNER JOIN articles ON articles.id = article_query_entries.articleId
        WHERE article_query_entries.queryKey = :queryKey
        ORDER BY article_query_entries.position ASC
        """,
    )
    fun articlePagingSource(queryKey: String): PagingSource<Int, ArticleListItem>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleQueryEntries(entries: List<ArticleQueryEntryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleRemoteKey(remoteKey: ArticleRemoteKeyEntity)

    @Query("SELECT * FROM article_remote_keys WHERE queryKey = :queryKey LIMIT 1")
    suspend fun readArticleRemoteKey(queryKey: String): ArticleRemoteKeyEntity?

    @Query("SELECT COALESCE(MAX(position), -1) FROM article_query_entries WHERE queryKey = :queryKey")
    suspend fun maxArticleQueryPosition(queryKey: String): Int

    @Query("DELETE FROM article_query_entries WHERE queryKey = :queryKey")
    suspend fun clearArticleQueryEntries(queryKey: String)

    @Query("DELETE FROM article_remote_keys WHERE queryKey = :queryKey")
    suspend fun clearArticleRemoteKey(queryKey: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPendingReadStateMutation(mutation: PendingReadStateMutationEntity)

    @Query("SELECT * FROM pending_read_state_mutations ORDER BY updatedAt ASC")
    suspend fun readPendingReadStateMutations(): List<PendingReadStateMutationEntity>

    @Query("DELETE FROM pending_read_state_mutations WHERE articleId = :articleId")
    suspend fun deletePendingReadStateMutation(articleId: String)

    @Query("UPDATE articles SET isRead = :read WHERE id = :articleId")
    suspend fun updateArticleReadState(articleId: String, read: Boolean)

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

    @Query("DELETE FROM article_query_entries")
    suspend fun clearArticleQueryEntries()

    @Query("DELETE FROM article_remote_keys")
    suspend fun clearArticleRemoteKeys()

    @Query("DELETE FROM pending_read_state_mutations")
    suspend fun clearPendingReadStateMutations()

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
        ArticleQueryEntryEntity::class,
        ArticleRemoteKeyEntity::class,
        PendingReadStateMutationEntity::class,
        ArticlePageEntity::class,
        ArticleDetailEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun localStoreDao(): LocalStoreDao
}
