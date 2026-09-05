package com.selffeed.android.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.paging.PagingSource
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.flow.Flow

object LocalTables {
    const val CATEGORIES = "categories"
    const val FEEDS = "feeds"
    const val ARTICLES = "articles"
    const val ARTICLE_QUERY_ENTRIES = "article_query_entries"
    const val ARTICLE_REMOTE_KEYS = "article_remote_keys"
    const val PENDING_READ_STATE_MUTATIONS = "pending_read_state_mutations"
    const val PENDING_SAVED_STATE_MUTATIONS = "pending_saved_state_mutations"
    const val ARTICLE_STATE_REVISIONS = "article_state_revisions"
    const val ARTICLE_READ_OVERRIDES = "article_read_overrides"
    const val ARTICLE_DETAILS = "article_details"
    const val PREFERENCES = "preferences"
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
    val lastSyncError: String?,
    val lastSyncErrorAt: String?,
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
    val isSaved: Boolean = false,
    val contentStatus: String,
    val contentVersion: Int,
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
    @ColumnInfo(defaultValue = "''") val mutationId: String,
    @ColumnInfo(defaultValue = "'manual'") val source: String,
    val baseRevision: Int?,
    val previousState: Boolean?,
    val updatedAt: Long,
)

@Entity(tableName = LocalTables.PENDING_SAVED_STATE_MUTATIONS)
data class PendingSavedStateMutationEntity(
    @PrimaryKey val articleId: String,
    val saved: Boolean,
    val mutationId: String,
    val baseRevision: Int?,
    val previousState: Boolean?,
    val updatedAt: Long,
)

@Entity(tableName = LocalTables.ARTICLE_STATE_REVISIONS)
data class ArticleStateRevisionEntity(
    @PrimaryKey val articleId: String,
    val readRevision: Int?,
    val savedRevision: Int?,
)

@Entity(tableName = LocalTables.PREFERENCES)
data class PreferencesEntity(
    @PrimaryKey val key: String = "current",
    val payloadJson: String,
    val writtenAt: Long,
)

/** A durable presentation overlay that does not invalidate article paging rows. */
@Entity(tableName = LocalTables.ARTICLE_READ_OVERRIDES)
data class ArticleReadOverrideEntity(
    @PrimaryKey val articleId: String,
    val read: Boolean,
    val updatedAt: Long,
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

data class SavedArticleSnapshot(val articleId: String, val savedRevision: Int?)

@Dao
interface LocalStoreDao {
    @Query("SELECT (SELECT COUNT(*) FROM pending_read_state_mutations) + (SELECT COUNT(*) FROM pending_saved_state_mutations)")
    fun observePendingArticleChanges(): Flow<Int>

    @Query("SELECT * FROM article_details WHERE id = :articleId LIMIT 1")
    fun observeArticleDetail(articleId: String): Flow<ArticleDetailEntity?>

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

    @Query("SELECT * FROM articles WHERE id = :articleId LIMIT 1")
    suspend fun readArticle(articleId: String): ArticleEntity?

    @Query("UPDATE articles SET isSaved = :saved WHERE id = :articleId")
    suspend fun updateArticleSavedState(articleId: String, saved: Boolean)

    @Query("UPDATE articles SET isRead = :read WHERE id = :articleId")
    suspend fun updateArticleReadState(articleId: String, read: Boolean)

    @Query(
        """
        SELECT articles.* FROM articles
        LEFT JOIN feeds ON feeds.id = articles.feedId
        WHERE (:categoryId IS NULL OR feeds.categoryId = :categoryId)
          AND (articles.title LIKE '%' || :query || '%' COLLATE NOCASE
               OR COALESCE(articles.excerpt, '') LIKE '%' || :query || '%' COLLATE NOCASE)
        ORDER BY COALESCE(articles.displayedAt, articles.publishedAt) DESC
        LIMIT :limit
        """,
    )
    suspend fun searchArticles(query: String, categoryId: String?, limit: Int): List<ArticleEntity>

    @Query(
        """
        SELECT articles.* FROM article_query_entries
        INNER JOIN articles ON articles.id = article_query_entries.articleId
        WHERE article_query_entries.queryKey = :queryKey
        ORDER BY article_query_entries.position ASC
        """,
    )
    fun articlePagingSource(queryKey: String): PagingSource<Int, ArticleListItem>

    @Query(
        """
        SELECT * FROM articles
        WHERE isSaved = 1
        ORDER BY COALESCE(displayedAt, publishedAt) DESC, id DESC
        """,
    )
    fun savedArticlePagingSource(): PagingSource<Int, ArticleListItem>

    @Query(
        """
        SELECT articles.id AS articleId, article_state_revisions.savedRevision
        FROM articles
        LEFT JOIN article_state_revisions ON article_state_revisions.articleId = articles.id
        WHERE articles.isSaved = 1
          AND articles.id NOT IN (SELECT articleId FROM article_query_entries WHERE queryKey = :queryKey)
          AND articles.id NOT IN (SELECT articleId FROM pending_saved_state_mutations)
        ORDER BY articles.id
        """,
    )
    suspend fun savedArticlesMissingFromQuery(queryKey: String): List<SavedArticleSnapshot>

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

    @Query("SELECT * FROM pending_read_state_mutations WHERE articleId = :articleId LIMIT 1")
    suspend fun readPendingReadStateMutation(articleId: String): PendingReadStateMutationEntity?

    @Query("DELETE FROM pending_read_state_mutations WHERE articleId = :articleId AND mutationId = :mutationId")
    suspend fun deletePendingReadStateMutation(articleId: String, mutationId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPendingSavedStateMutation(mutation: PendingSavedStateMutationEntity)

    @Query("SELECT * FROM pending_saved_state_mutations ORDER BY updatedAt ASC")
    suspend fun readPendingSavedStateMutations(): List<PendingSavedStateMutationEntity>

    @Query("SELECT * FROM pending_saved_state_mutations WHERE articleId = :articleId LIMIT 1")
    suspend fun readPendingSavedStateMutation(articleId: String): PendingSavedStateMutationEntity?

    @Query("DELETE FROM pending_saved_state_mutations WHERE articleId = :articleId AND mutationId = :mutationId")
    suspend fun deletePendingSavedStateMutation(articleId: String, mutationId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleStateRevision(revision: ArticleStateRevisionEntity)

    @Query("SELECT * FROM article_state_revisions WHERE articleId = :articleId LIMIT 1")
    suspend fun readArticleStateRevision(articleId: String): ArticleStateRevisionEntity?

    @Query("DELETE FROM article_read_overrides WHERE articleId = :articleId")
    suspend fun deleteArticleReadOverride(articleId: String)

    @Query(
        """
        DELETE FROM article_read_overrides
        WHERE articleId = :articleId
          AND NOT EXISTS (
              SELECT 1 FROM pending_read_state_mutations
              WHERE pending_read_state_mutations.articleId = :articleId
          )
        """,
    )
    suspend fun deleteAcknowledgedArticleReadOverride(articleId: String)

    @Query(
        """
        DELETE FROM article_read_overrides
        WHERE articleId NOT IN (SELECT articleId FROM pending_read_state_mutations)
        """,
    )
    suspend fun clearAcknowledgedArticleReadOverrides()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleReadOverride(override: ArticleReadOverrideEntity)

    @Query("SELECT * FROM article_read_overrides")
    suspend fun readArticleReadOverrides(): List<ArticleReadOverrideEntity>

    @Query(
        """
        INSERT OR REPLACE INTO article_read_overrides(articleId, read, updatedAt)
        SELECT id, 1, :updatedAt FROM articles WHERE feedId IN (:feedIds)
        """,
    )
    suspend fun markArticleReadOverridesByFeeds(feedIds: List<String>, updatedAt: Long)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleDetail(detail: ArticleDetailEntity)

    @Query("SELECT * FROM article_details WHERE id = :articleId LIMIT 1")
    suspend fun readArticleDetail(articleId: String): ArticleDetailEntity?

    @Query("DELETE FROM article_details WHERE id = :articleId")
    suspend fun clearArticleDetail(articleId: String)

    @Query("SELECT * FROM article_details WHERE writtenAt < :cutoff")
    suspend fun readExpiredArticleDetails(cutoff: Long): List<ArticleDetailEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPreferences(preferences: PreferencesEntity)

    @Query("SELECT * FROM preferences WHERE `key` = 'current' LIMIT 1")
    suspend fun readPreferences(): PreferencesEntity?

    @Query("DELETE FROM preferences")
    suspend fun clearPreferences()

    @Query(
        """
        DELETE FROM article_remote_keys
        WHERE queryKey NOT IN (
            SELECT queryKey FROM article_remote_keys ORDER BY updatedAt DESC LIMIT :maxQueries
        )
        """,
    )
    suspend fun pruneArticleRemoteKeys(maxQueries: Int)

    @Query("DELETE FROM article_query_entries WHERE queryKey NOT IN (SELECT queryKey FROM article_remote_keys)")
    suspend fun pruneArticleQueryEntries()

    @Query(
        """
        DELETE FROM articles
        WHERE id NOT IN (SELECT articleId FROM article_query_entries)
          AND id NOT IN (SELECT id FROM article_details)
          AND id NOT IN (SELECT articleId FROM pending_read_state_mutations)
          AND id NOT IN (SELECT articleId FROM pending_saved_state_mutations)
          AND isSaved = 0
        """,
    )
    suspend fun pruneOrphanArticles()

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

    @Query("DELETE FROM pending_saved_state_mutations")
    suspend fun clearPendingSavedStateMutations()

    @Query("DELETE FROM article_state_revisions")
    suspend fun clearArticleStateRevisions()

    @Query("DELETE FROM article_read_overrides")
    suspend fun clearArticleReadOverrides()

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
        PendingSavedStateMutationEntity::class,
        ArticleStateRevisionEntity::class,
        ArticleReadOverrideEntity::class,
        ArticleDetailEntity::class,
        PreferencesEntity::class,
    ],
    version = LOCAL_DATABASE_VERSION,
    exportSchema = true,
)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun localStoreDao(): LocalStoreDao
}
