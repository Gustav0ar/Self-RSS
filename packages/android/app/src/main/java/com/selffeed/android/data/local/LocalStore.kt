package com.selffeed.android.data.local

import android.content.Context
import androidx.paging.PagingSource
import androidx.core.text.HtmlCompat
import androidx.room.Room
import androidx.room.withTransaction
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.UserPreferences
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID

/**
 * Room-backed local source for offline reads and stale-while-revalidate flows.
 *
 * Categories and feeds are stored as typed rows so they can become the durable
 * source of truth for navigation and unread counts. Article queries use
 * Paging 3's typed query entries, while reader details retain complete
 * immutable documents for instant offline reopening.
 */
class LocalStore(
    context: Context,
    moshi: Moshi,
) : OfflineReadStore {
    private val database: LocalDatabase = Room.databaseBuilder(
        context.applicationContext,
        LocalDatabase::class.java,
        DB_NAME,
    )
        .addMigrations(*LOCAL_DATABASE_MIGRATIONS)
        .build()
    private val dao = database.localStoreDao()

    private val categoryChildrenAdapter: JsonAdapter<List<CategoryWithCounts>> = moshi.adapter(
        Types.newParameterizedType(List::class.java, CategoryWithCounts::class.java),
    )
    private val articleDetailAdapter: JsonAdapter<ArticleDetail> =
        moshi.adapter(ArticleDetail::class.java)
    private val preferencesAdapter: JsonAdapter<UserPreferences> =
        moshi.adapter(UserPreferences::class.java)

    private val _invalidations = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 16)
    val invalidations = _invalidations.asSharedFlow()
    private val invalidationSeq = AtomicLong(0)

    override suspend fun writeCategories(categories: List<CategoryWithCounts>) {
        database.withTransaction {
            dao.clearCategories()
            if (categories.isNotEmpty()) {
                dao.upsertCategories(categories.mapIndexed { index, category -> category.toEntity(index) })
            }
        }
        notifyInvalidation(TABLE_CATEGORIES)
    }

    override suspend fun readCategories(): List<CategoryWithCounts> =
        dao.readCategories().map { it.toModel() }

    override suspend fun writeFeeds(feeds: List<FeedWithCounts>) {
        database.withTransaction {
            dao.clearFeeds()
            if (feeds.isNotEmpty()) {
                dao.upsertFeeds(feeds.mapIndexed { index, feed -> feed.toEntity(index) })
            }
        }
        notifyInvalidation(TABLE_FEEDS)
    }

    override suspend fun readFeeds(): List<FeedWithCounts> =
        dao.readFeeds().map { it.toModel() }

    override suspend fun mergeFeeds(feeds: List<FeedWithCounts>) {
        if (feeds.isEmpty()) return
        val replacements = feeds.associateBy(FeedWithCounts::id)
        val existing = readFeeds()
        writeFeeds(buildList {
            existing.forEach { add(replacements[it.id] ?: it) }
            feeds.filterNot { incoming -> existing.any { it.id == incoming.id } }.forEach(::add)
        })
    }

    fun articlePagingSource(queryKey: String): PagingSource<Int, ArticleListItem> =
        dao.articlePagingSource(queryKey)

    fun savedArticlePagingSource(): PagingSource<Int, ArticleListItem> =
        dao.savedArticlePagingSource()

    suspend fun savedArticlesMissingFromQuery(queryKey: String): List<SavedArticleSnapshot> =
        dao.savedArticlesMissingFromQuery(queryKey)

    /** Applies a confirmed remote removal only while the captured local intent is unchanged. */
    suspend fun clearSavedStateIfUnchanged(snapshot: SavedArticleSnapshot): Boolean {
        val removed = database.withTransaction {
            val articleId = snapshot.articleId
            if (dao.readPendingSavedStateMutation(articleId) != null ||
                dao.readArticleStateRevision(articleId)?.savedRevision != snapshot.savedRevision ||
                dao.readArticle(articleId)?.isSaved != true
            ) return@withTransaction false

            dao.updateArticleSavedState(articleId, false)
            dao.readArticleDetail(articleId)?.let { entity ->
                articleDetailAdapter.fromJson(entity.payloadJson)?.let { detail ->
                    dao.upsertArticleDetail(
                        entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = false))),
                    )
                }
            }
            true
        }
        if (removed) notifyInvalidation(TABLE_ARTICLES)
        return removed
    }

    suspend fun readArticleRemoteKey(queryKey: String): ArticleRemoteKeyEntity? =
        dao.readArticleRemoteKey(queryKey)

    suspend fun writeArticleRemotePage(
        queryKey: String,
        payload: ApiListResponse<ArticleListItem>,
        clearExisting: Boolean,
    ) {
        database.withTransaction {
            val pendingReads = dao.readPendingReadStateMutations().associateBy { it.articleId }
            val pendingSaves = dao.readPendingSavedStateMutations().associateBy { it.articleId }
            if (clearExisting) {
                dao.clearArticleQueryEntries(queryKey)
                dao.clearArticleRemoteKey(queryKey)
            }
            if (payload.data.isNotEmpty()) {
                dao.upsertArticles(
                    payload.data.map { article ->
                        article.copy(
                            isRead = pendingReads[article.id]?.read ?: article.isRead,
                            isSaved = pendingSaves[article.id]?.saved ?: article.isSaved,
                        ).toEntity()
                    },
                )
                val startPosition = dao.maxArticleQueryPosition(queryKey) + 1
                dao.upsertArticleQueryEntries(
                    payload.data.mapIndexed { index, article ->
                        ArticleQueryEntryEntity(
                            queryKey = queryKey,
                            articleId = article.id,
                            position = startPosition + index,
                        )
                    },
                )
            }
            dao.upsertArticleRemoteKey(
                ArticleRemoteKeyEntity(
                    queryKey = queryKey,
                    nextCursor = payload.cursor,
                    endReached = !payload.hasMore || payload.cursor.isNullOrBlank(),
                    updatedAt = System.currentTimeMillis(),
                ),
            )
            dao.pruneArticleRemoteKeys(MAX_CACHED_ARTICLE_QUERIES)
            dao.pruneArticleQueryEntries()
            dao.pruneOrphanArticles()
        }
        notifyInvalidation(TABLE_ARTICLES)
    }

    suspend fun queueReadStateMutation(
        articleId: String,
        read: Boolean,
        source: String = "manual",
    ): PendingReadStateMutationEntity {
        lateinit var queued: PendingReadStateMutationEntity
        database.withTransaction {
            val previous = dao.readPendingReadStateMutation(articleId)
            val revision = dao.readArticleStateRevision(articleId)?.readRevision
            val detailEntity = dao.readArticleDetail(articleId)
            val detail = detailEntity?.let {
                runCatching { articleDetailAdapter.fromJson(it.payloadJson) }.getOrNull()
            }
            queued = PendingReadStateMutationEntity(
                articleId = articleId,
                read = read,
                mutationId = UUID.randomUUID().toString(),
                source = source,
                baseRevision = previous?.baseRevision ?: revision,
                previousState = previous?.previousState ?: dao.readArticle(articleId)?.isRead ?: detail?.isRead,
                updatedAt = System.currentTimeMillis(),
            )
            dao.upsertArticleReadOverride(articleId.toReadOverride(read))
            dao.updateArticleReadState(articleId, read)
            if (detailEntity != null && detail != null) {
                dao.upsertArticleDetail(
                    detailEntity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = read))),
                )
            }
            dao.upsertPendingReadStateMutation(queued)
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
        return queued
    }

    suspend fun queueSavedStateMutation(
        articleId: String,
        saved: Boolean,
    ): PendingSavedStateMutationEntity {
        lateinit var queued: PendingSavedStateMutationEntity
        database.withTransaction {
            val previous = dao.readPendingSavedStateMutation(articleId)
            val revision = dao.readArticleStateRevision(articleId)?.savedRevision
            val detailEntity = dao.readArticleDetail(articleId)
            val detail = detailEntity?.let {
                runCatching { articleDetailAdapter.fromJson(it.payloadJson) }.getOrNull()
            }
            val article = dao.readArticle(articleId)
            val previousState = previous?.previousState ?: article?.isSaved ?: detail?.isSaved
            if (article == null && detail != null) {
                dao.upsertArticles(listOf(detail.toArticleEntity(saved)))
            }
            queued = PendingSavedStateMutationEntity(
                articleId = articleId,
                saved = saved,
                mutationId = UUID.randomUUID().toString(),
                baseRevision = previous?.baseRevision ?: revision,
                previousState = previousState,
                updatedAt = System.currentTimeMillis(),
            )
            dao.updateArticleSavedState(articleId, saved)
            if (detailEntity != null && detail != null) {
                dao.upsertArticleDetail(
                    detailEntity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = saved))),
                )
            }
            dao.upsertPendingSavedStateMutation(queued)
        }
        notifyInvalidation(TABLE_ARTICLES)
        return queued
    }

    suspend fun updateArticleReadState(articleId: String, read: Boolean, revision: Int? = null): Boolean {
        var visibleState = read
        database.withTransaction {
            val pending = dao.readPendingReadStateMutation(articleId)
            visibleState = pending?.read ?: read
            dao.updateArticleReadState(articleId, visibleState)
            if (pending != null) {
                dao.upsertPendingReadStateMutation(pending.copy(previousState = read))
                dao.upsertArticleReadOverride(articleId.toReadOverride(visibleState))
            } else {
                dao.deleteArticleReadOverride(articleId)
            }
            dao.readArticleDetail(articleId)?.let { entity ->
                runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                    dao.upsertArticleDetail(
                        entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = visibleState))),
                    )
                }
            }
            if (revision != null) {
                val existing = dao.readArticleStateRevision(articleId)
                dao.upsertArticleStateRevision(
                    ArticleStateRevisionEntity(articleId, revision, existing?.savedRevision),
                )
            }
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
        return visibleState
    }

    suspend fun updateArticleSavedState(articleId: String, saved: Boolean, revision: Int? = null): Boolean {
        var visibleState = saved
        database.withTransaction {
            val pending = dao.readPendingSavedStateMutation(articleId)
            visibleState = pending?.saved ?: saved
            dao.updateArticleSavedState(articleId, visibleState)
            if (pending != null) {
                dao.upsertPendingSavedStateMutation(pending.copy(previousState = saved))
            }
            dao.readArticleDetail(articleId)?.let { entity ->
                runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                    dao.upsertArticleDetail(
                        entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = visibleState))),
                    )
                }
            }
            if (revision != null) {
                val existing = dao.readArticleStateRevision(articleId)
                dao.upsertArticleStateRevision(
                    ArticleStateRevisionEntity(articleId, existing?.readRevision, revision),
                )
            }
        }
        notifyInvalidation(TABLE_ARTICLES)
        return visibleState
    }

    suspend fun readArticleReadOverrides(): Map<String, Boolean> =
        dao.readArticleReadOverrides().associate { it.articleId to it.read }

    suspend fun markArticlesReadByFeeds(feedIds: Collection<String>) {
        val ids = feedIds.distinct()
        if (ids.isEmpty()) return
        dao.markArticleReadOverridesByFeeds(ids, System.currentTimeMillis())
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
    }

    suspend fun readPendingReadStateMutations(): List<PendingReadStateMutationEntity> =
        dao.readPendingReadStateMutations()

    suspend fun readPendingSavedStateMutations(): List<PendingSavedStateMutationEntity> =
        dao.readPendingSavedStateMutations()

    suspend fun deletePendingReadStateMutation(articleId: String) {
        dao.readPendingReadStateMutation(articleId)?.let {
            dao.deletePendingReadStateMutation(articleId, it.mutationId)
        }
    }

    suspend fun acknowledgeReadStateMutation(articleId: String) {
        dao.readPendingReadStateMutation(articleId)?.let {
            acknowledgeReadStateMutation(it, it.read, it.baseRevision ?: 0)
        }
    }

    suspend fun acknowledgeReadStateMutation(
        mutation: PendingReadStateMutationEntity,
        read: Boolean,
        revision: Int,
    ) {
        database.withTransaction {
            if (dao.deletePendingReadStateMutation(mutation.articleId, mutation.mutationId) > 0) {
                dao.updateArticleReadState(mutation.articleId, read)
                dao.readArticleDetail(mutation.articleId)?.let { entity ->
                    runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                        dao.upsertArticleDetail(
                            entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = read))),
                        )
                    }
                }
                val existing = dao.readArticleStateRevision(mutation.articleId)
                dao.upsertArticleStateRevision(
                    ArticleStateRevisionEntity(mutation.articleId, revision, existing?.savedRevision),
                )
                dao.deleteAcknowledgedArticleReadOverride(mutation.articleId)
            }
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
    }

    suspend fun acknowledgeSavedStateMutation(
        mutation: PendingSavedStateMutationEntity,
        saved: Boolean,
        revision: Int,
    ) {
        database.withTransaction {
            if (dao.deletePendingSavedStateMutation(mutation.articleId, mutation.mutationId) > 0) {
                dao.updateArticleSavedState(mutation.articleId, saved)
                dao.readArticleDetail(mutation.articleId)?.let { entity ->
                    runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                        dao.upsertArticleDetail(
                            entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = saved))),
                        )
                    }
                }
                val existing = dao.readArticleStateRevision(mutation.articleId)
                dao.upsertArticleStateRevision(
                    ArticleStateRevisionEntity(mutation.articleId, existing?.readRevision, revision),
                )
            }
        }
        notifyInvalidation(TABLE_ARTICLES)
    }

    suspend fun rebaseReadStateMutation(mutation: PendingReadStateMutationEntity, revision: Int) {
        database.withTransaction {
            val current = dao.readPendingReadStateMutation(mutation.articleId) ?: return@withTransaction
            dao.upsertPendingReadStateMutation(
                current.copy(mutationId = UUID.randomUUID().toString(), baseRevision = revision),
            )
        }
    }

    suspend fun rebaseSavedStateMutation(mutation: PendingSavedStateMutationEntity, revision: Int) {
        database.withTransaction {
            val current = dao.readPendingSavedStateMutation(mutation.articleId) ?: return@withTransaction
            dao.upsertPendingSavedStateMutation(
                current.copy(mutationId = UUID.randomUUID().toString(), baseRevision = revision),
            )
        }
    }

    suspend fun discardReadStateMutation(mutation: PendingReadStateMutationEntity) {
        database.withTransaction {
            if (dao.deletePendingReadStateMutation(mutation.articleId, mutation.mutationId) > 0) {
                mutation.previousState?.let { previous ->
                    dao.updateArticleReadState(mutation.articleId, previous)
                    dao.readArticleDetail(mutation.articleId)?.let { entity ->
                        runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                            dao.upsertArticleDetail(
                                entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = previous))),
                            )
                        }
                    }
                }
                dao.deleteAcknowledgedArticleReadOverride(mutation.articleId)
            }
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
    }

    suspend fun discardSavedStateMutation(mutation: PendingSavedStateMutationEntity): Boolean? {
        var restoredState: Boolean? = null
        database.withTransaction {
            if (dao.deletePendingSavedStateMutation(mutation.articleId, mutation.mutationId) > 0) {
                mutation.previousState?.let { previous ->
                    restoredState = previous
                    dao.updateArticleSavedState(mutation.articleId, previous)
                    dao.readArticleDetail(mutation.articleId)?.let { entity ->
                        runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                            dao.upsertArticleDetail(
                                entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = previous))),
                            )
                        }
                    }
                }
            }
        }
        notifyInvalidation(TABLE_ARTICLES)
        return restoredState
    }

    suspend fun clearAcknowledgedReadStateOverride(articleId: String) {
        dao.deleteAcknowledgedArticleReadOverride(articleId)
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
    }

    suspend fun clearAcknowledgedReadStateOverrides() {
        dao.clearAcknowledgedArticleReadOverrides()
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
    }

    override suspend fun writeArticleDetail(detail: ArticleDetail) {
        database.withTransaction {
            val stored = detail.copy(
                isRead = dao.readPendingReadStateMutation(detail.id)?.read ?: detail.isRead,
                isSaved = dao.readPendingSavedStateMutation(detail.id)?.saved ?: detail.isSaved,
            )
            dao.upsertArticleDetail(
                ArticleDetailEntity(
                    id = stored.id,
                    feedId = stored.feedId,
                    payloadJson = articleDetailAdapter.toJson(stored),
                    writtenAt = System.currentTimeMillis(),
                ),
            )
            for (expired in dao.readExpiredArticleDetails(System.currentTimeMillis() - MAX_ARTICLE_DETAIL_AGE_MS)) {
                val cached = runCatching { articleDetailAdapter.fromJson(expired.payloadJson) }.getOrNull()
                if (cached?.isSaved != true) dao.clearArticleDetail(expired.id)
            }
        }
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    suspend fun applyPendingArticleState(detail: ArticleDetail): ArticleDetail = detail.copy(
        isRead = dao.readPendingReadStateMutation(detail.id)?.read ?: detail.isRead,
        isSaved = dao.readPendingSavedStateMutation(detail.id)?.saved ?: detail.isSaved,
    )

    fun observePendingArticleChanges(): Flow<Int> = dao.observePendingArticleChanges().distinctUntilChanged()

    /** Only persisted, reopenable body content counts, independent of bookmark state. */
    fun observeArticleTextAvailability(articleId: String): Flow<Boolean> =
        dao.observeArticleDetail(articleId).distinctUntilChanged().map { entity ->
            readableArticleDetail(entity)?.hasReadableText() ?: false
        }.distinctUntilChanged().flowOn(Dispatchers.IO)

    private fun ArticleDetail.hasReadableText(): Boolean {
        if (!contentText.isNullOrBlank()) return true
        val html = contentHtml?.takeIf(String::isNotBlank) ?: return false
        var excludedStart = 0
        var excludedDepth = 0
        val text = HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_LEGACY, null) { opening, tag, output, _ ->
            if (tag in NON_TEXT_HTML_TAGS) {
                if (opening) {
                    if (excludedDepth++ == 0) excludedStart = output.length
                } else if (excludedDepth > 0 && --excludedDepth == 0) {
                    output.delete(excludedStart, output.length)
                }
            }
        }
        // Android represents images with an object replacement character.
        return text.any { !it.isWhitespace() && it != '\uFFFC' }
    }

    override suspend fun readArticleDetail(articleId: String): ArticleDetail? =
        readableArticleDetail(dao.readArticleDetail(articleId))

    private suspend fun readableArticleDetail(detail: ArticleDetailEntity?): ArticleDetail? {
        detail ?: return null
        val parsed = runCatching { articleDetailAdapter.fromJson(detail.payloadJson) }.getOrNull()
        if (System.currentTimeMillis() - detail.writtenAt > MAX_ARTICLE_DETAIL_AGE_MS) {
            // A saved article is an explicit offline promise. It remains readable
            // until the user unsaves it or signs out, even after normal cache TTLs.
            if (parsed?.isSaved == true) return parsed
            dao.clearArticleDetail(detail.id)
            return null
        }
        return parsed
    }

    override suspend fun clearArticleDetail(articleId: String) {
        dao.clearArticleDetail(articleId)
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    override suspend fun clearArticleDetails() {
        dao.clearArticleDetails()
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    suspend fun writePreferences(preferences: UserPreferences) {
        dao.upsertPreferences(
            PreferencesEntity(payloadJson = preferencesAdapter.toJson(preferences), writtenAt = System.currentTimeMillis()),
        )
    }

    suspend fun readPreferences(): UserPreferences? = dao.readPreferences()?.let { entity ->
        runCatching { preferencesAdapter.fromJson(entity.payloadJson) }.getOrNull()
    }

    suspend fun searchArticles(query: String, categoryId: String?, limit: Int = 20): List<ArticleListItem> =
        dao.searchArticles(query.trim(), categoryId, limit).map { it.toModel() }

    override suspend fun clearAll() {
        database.withTransaction {
            dao.clearCategories()
            dao.clearFeeds()
            dao.clearArticles()
            dao.clearArticleQueryEntries()
            dao.clearArticleRemoteKeys()
            dao.clearPendingReadStateMutations()
            dao.clearPendingSavedStateMutations()
            dao.clearArticleStateRevisions()
            dao.clearArticleReadOverrides()
            dao.clearArticleDetails()
            dao.clearPreferences()
        }
        notifyInvalidation("all")
    }

    override suspend fun clearCategories() = clearTable(TABLE_CATEGORIES)

    override suspend fun clearFeeds() = clearTable(TABLE_FEEDS)

    override suspend fun clearArticleLists() {
        database.withTransaction {
            dao.clearArticleQueryEntries()
            dao.clearArticleRemoteKeys()
            dao.pruneOrphanArticles()
        }
        notifyInvalidation(TABLE_ARTICLES)
    }

    override suspend fun clearFeedAndArticleData() {
        clearFeeds()
        clearCategories()
        clearArticleLists()
    }

    suspend fun clearTable(table: String) {
        when (table) {
            TABLE_CATEGORIES -> dao.clearCategories()
            TABLE_FEEDS -> dao.clearFeeds()
            TABLE_ARTICLES -> {
                dao.clearArticles()
                dao.clearArticleQueryEntries()
                dao.clearArticleRemoteKeys()
            }

            TABLE_ARTICLE_DETAILS -> dao.clearArticleDetails()
            TABLE_ARTICLE_READ_OVERRIDES -> dao.clearArticleReadOverrides()
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
            lastSyncError = lastSyncError,
            lastSyncErrorAt = lastSyncErrorAt,
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
            lastSyncError = lastSyncError,
            lastSyncErrorAt = lastSyncErrorAt,
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
            isSaved = isSaved,
            contentStatus = contentStatus,
            contentVersion = contentVersion,
        )

    private fun ArticleDetail.toArticleEntity(saved: Boolean): ArticleEntity =
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
            displayedAt = publishedAt ?: fetchedAt,
            isRead = isRead,
            isSaved = saved,
            contentStatus = contentStatus,
            contentVersion = contentVersion,
        )

    private fun String.toReadOverride(read: Boolean): ArticleReadOverrideEntity =
        ArticleReadOverrideEntity(
            articleId = this,
            read = read,
            updatedAt = System.currentTimeMillis(),
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
            isSaved = isSaved,
            contentStatus = contentStatus,
            contentVersion = contentVersion,
        )

    companion object {
        private val NON_TEXT_HTML_TAGS = setOf("iframe", "video", "audio", "embed", "object", "svg", "script", "style", "noscript")
        private const val DB_NAME = "selffeed.db"
        const val TABLE_CATEGORIES = LocalTables.CATEGORIES
        const val TABLE_FEEDS = LocalTables.FEEDS
        const val TABLE_ARTICLES = LocalTables.ARTICLES
        const val TABLE_ARTICLE_READ_OVERRIDES = LocalTables.ARTICLE_READ_OVERRIDES
        const val TABLE_ARTICLE_DETAILS = LocalTables.ARTICLE_DETAILS

        private const val MAX_ARTICLE_DETAIL_AGE_MS = 7L * 24 * 60 * 60 * 1000
        private const val MAX_CACHED_ARTICLE_QUERIES = 24
    }
}
