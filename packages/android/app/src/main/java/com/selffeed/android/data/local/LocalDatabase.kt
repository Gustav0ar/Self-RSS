package com.selffeed.android.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Embedded
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
    const val CURRENT_LOCAL_OWNER = "current_local_owner"
    const val ARCHIVED_READ_STATE_MUTATIONS = "archived_read_state_mutations"
    const val ARCHIVED_SAVED_STATE_MUTATIONS = "archived_saved_state_mutations"
    const val LEGACY_OFFLINE_ARTICLES = "legacy_offline_articles"
    const val LOCAL_COUNT_STATE = "local_count_state"
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
    val countScopeJson: String? = null,
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

/** The single active snapshot's durable session identity, independent of token rotation. */
@Entity(tableName = LocalTables.CURRENT_LOCAL_OWNER)
data class LocalOwnerEntity(
    @PrimaryKey val key: String = "current",
    val ownerId: String,
    val apiBaseUrl: String,
    val userId: String? = null,
)

/** Historical outboxes never participate in active drains or presentation overlays. */
@Entity(tableName = LocalTables.ARCHIVED_READ_STATE_MUTATIONS, primaryKeys = ["ownerId", "articleId"])
data class ArchivedReadStateMutationEntity(
    val ownerId: String,
    val apiBaseUrl: String,
    val userId: String?,
    @Embedded val mutation: PendingReadStateMutationEntity,
)

@Entity(tableName = LocalTables.ARCHIVED_SAVED_STATE_MUTATIONS, primaryKeys = ["ownerId", "articleId"])
data class ArchivedSavedStateMutationEntity(
    val ownerId: String,
    val apiBaseUrl: String,
    val userId: String?,
    @Embedded val mutation: PendingSavedStateMutationEntity,
)

/** Early version 6 used local offline pins, which are distinct from server bookmarks. */
@Entity(tableName = LocalTables.LEGACY_OFFLINE_ARTICLES)
data class LegacyOfflineArticleEntity(
    @PrimaryKey val articleId: String,
    val savedAt: Long,
)

@Entity(tableName = LocalTables.ARTICLE_STATE_REVISIONS)
data class ArticleStateRevisionEntity(
    @PrimaryKey val articleId: String,
    val readRevision: Int?,
    val savedRevision: Int?,
    val confirmedReadState: Boolean? = null,
    val confirmedSavedState: Boolean? = null,
    val lastReadMutationId: String? = null,
    val lastSavedMutationId: String? = null,
    val articleFeedId: String? = null,
)

@Entity(tableName = LocalTables.LOCAL_COUNT_STATE)
data class LocalCountStateEntity(
    @PrimaryKey val key: String = "current",
    val readEpoch: Long = 0,
    val statsJson: String? = null,
    val totalRead: Int? = null,
    val totalUnread: Int? = null,
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

data class ScopedArticleState(
    @androidx.room.Embedded val state: ArticleStateRevisionEntity,
    val feedId: String?,
    val cachedReadState: Boolean?,
    val hasStateRecord: Boolean,
)

@Dao
interface LocalStoreDao {
    @Query("SELECT * FROM current_local_owner WHERE `key` = 'current'")
    suspend fun readOwner(): LocalOwnerEntity?

    @Query("SELECT * FROM local_count_state WHERE `key` = 'current'")
    suspend fun readCountState(): LocalCountStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCountState(state: LocalCountStateEntity)

    @Query("SELECT EXISTS(SELECT 1 FROM pending_read_state_mutations)")
    suspend fun hasPendingReadStateMutations(): Boolean

    @Query("SELECT * FROM feeds WHERE id = :feedId")
    suspend fun readFeed(feedId: String): FeedEntity?

    @Query("UPDATE feeds SET unreadCount = unreadCount + :delta WHERE id = :feedId")
    suspend fun applyFeedUnreadDelta(feedId: String, delta: Int)

    @Query("DELETE FROM local_count_state")
    suspend fun clearCountState()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertOwner(owner: LocalOwnerEntity)

    @Query("""
        INSERT INTO archived_read_state_mutations
            (ownerId, apiBaseUrl, userId, articleId, read, mutationId, source, baseRevision, previousState, updatedAt, countScopeJson)
        SELECT :ownerId, :apiBaseUrl, :userId, articleId, read, mutationId, source, baseRevision, previousState, updatedAt, countScopeJson
        FROM pending_read_state_mutations
    """)
    suspend fun archiveReadStateMutations(ownerId: String, apiBaseUrl: String, userId: String?)

    @Query("""
        INSERT INTO archived_saved_state_mutations
            (ownerId, apiBaseUrl, userId, articleId, saved, mutationId, baseRevision, previousState, updatedAt)
        SELECT :ownerId, :apiBaseUrl, :userId, articleId, saved, mutationId, baseRevision, previousState, updatedAt
        FROM pending_saved_state_mutations
    """)
    suspend fun archiveSavedStateMutations(ownerId: String, apiBaseUrl: String, userId: String?)

    @Query("SELECT * FROM archived_read_state_mutations WHERE ownerId = :ownerId ORDER BY updatedAt, articleId")
    suspend fun readArchivedReadStateMutations(ownerId: String): List<ArchivedReadStateMutationEntity>

    @Query("SELECT * FROM archived_saved_state_mutations WHERE ownerId = :ownerId ORDER BY updatedAt, articleId")
    suspend fun readArchivedSavedStateMutations(ownerId: String): List<ArchivedSavedStateMutationEntity>

    @Query("""
        SELECT EXISTS(SELECT 1 FROM archived_read_state_mutations WHERE ownerId = :ownerId)
            OR EXISTS(SELECT 1 FROM archived_saved_state_mutations WHERE ownerId = :ownerId)
    """)
    suspend fun hasArchivedOwner(ownerId: String): Boolean

    @Query("SELECT EXISTS(SELECT 1 FROM legacy_offline_articles WHERE articleId = :articleId)")
    suspend fun isLegacyOfflineArticle(articleId: String): Boolean

    @Query("DELETE FROM legacy_offline_articles WHERE articleId = :articleId")
    suspend fun removeLegacyOfflineArticle(articleId: String)

    @Query("DELETE FROM legacy_offline_articles")
    suspend fun clearLegacyOfflineArticles()

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

    @Query("UPDATE articles SET isSaved = :saved WHERE id = :articleId AND isSaved != :saved")
    suspend fun updateArticleSavedState(articleId: String, saved: Boolean)

    @Query("UPDATE articles SET isRead = :read WHERE id = :articleId AND isRead != :read")
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
        SELECT articles.*, NULL AS readRevision, NULL AS savedRevision FROM article_query_entries
        INNER JOIN articles ON articles.id = article_query_entries.articleId
        WHERE article_query_entries.queryKey = :queryKey
          AND (:ownerId IS NULL OR EXISTS (SELECT 1 FROM current_local_owner WHERE `key` = 'current' AND ownerId = :ownerId))
        ORDER BY article_query_entries.position ASC
        """,
    )
    fun articlePagingSource(queryKey: String, ownerId: String?): PagingSource<Int, ArticleListItem>

    @Query(
        """
        SELECT articles.*, NULL AS readRevision, NULL AS savedRevision FROM articles
        WHERE isSaved = 1
          AND (:ownerId IS NULL OR EXISTS (SELECT 1 FROM current_local_owner WHERE `key` = 'current' AND ownerId = :ownerId))
        ORDER BY COALESCE(displayedAt, publishedAt) DESC, id DESC
        """,
    )
    fun savedArticlePagingSource(ownerId: String?): PagingSource<Int, ArticleListItem>

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

    @Query("""
        SELECT items.id AS articleId, COALESCE(items.feedId, state.articleFeedId) AS feedId, articles.isRead AS cachedReadState,
            state.articleId IS NOT NULL AS hasStateRecord,
            state.readRevision, state.savedRevision, state.confirmedReadState, state.confirmedSavedState,
            state.lastReadMutationId, state.lastSavedMutationId, state.articleFeedId
        FROM (
            SELECT id, feedId FROM articles
            UNION ALL
            SELECT id, feedId FROM article_details WHERE id NOT IN (SELECT id FROM articles)
            UNION ALL
            SELECT articleId AS id, articleFeedId AS feedId FROM article_state_revisions
            WHERE articleId NOT IN (SELECT id FROM articles)
              AND articleId NOT IN (SELECT id FROM article_details)
        ) items
        LEFT JOIN articles ON articles.id = items.id
        LEFT JOIN article_state_revisions state ON state.articleId = items.id
        WHERE :allFeeds OR items.feedId IN (:feedIds) OR items.feedId IS NULL
    """)
    suspend fun readArticleStatesByFeeds(feedIds: List<String>, allFeeds: Boolean): List<ScopedArticleState>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleStateRevisions(states: List<ArticleStateRevisionEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleReadOverrides(overrides: List<ArticleReadOverrideEntity>)

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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertArticleDetail(detail: ArticleDetailEntity)

    @Query("SELECT * FROM article_details WHERE id = :articleId LIMIT 1")
    suspend fun readArticleDetail(articleId: String): ArticleDetailEntity?

    @Query("DELETE FROM article_details WHERE id = :articleId AND id NOT IN (SELECT articleId FROM legacy_offline_articles)")
    suspend fun clearArticleDetail(articleId: String)

    @Query("SELECT * FROM article_details WHERE writtenAt < :cutoff AND id NOT IN (SELECT articleId FROM legacy_offline_articles)")
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
          AND id NOT IN (SELECT articleId FROM legacy_offline_articles)
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

    @Query("DELETE FROM article_details WHERE id NOT IN (SELECT articleId FROM legacy_offline_articles)")
    suspend fun clearArticleDetails()

    @Query("DELETE FROM article_details")
    suspend fun clearAllArticleDetails()
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
        LocalCountStateEntity::class,
        ArticleReadOverrideEntity::class,
        ArticleDetailEntity::class,
        PreferencesEntity::class,
        LocalOwnerEntity::class,
        ArchivedReadStateMutationEntity::class,
        ArchivedSavedStateMutationEntity::class,
        LegacyOfflineArticleEntity::class,
    ],
    version = LOCAL_DATABASE_VERSION,
    exportSchema = true,
)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun localStoreDao(): LocalStoreDao
}
