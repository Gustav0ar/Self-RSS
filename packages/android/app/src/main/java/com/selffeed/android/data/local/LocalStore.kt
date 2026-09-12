package com.selffeed.android.data.local

import android.content.Context
import androidx.paging.PagingSource
import androidx.core.text.HtmlCompat
import androidx.room.Room
import androidx.room.withTransaction
import com.selffeed.android.data.repository.BulkReadReconciliation
import com.selffeed.android.data.repository.LibraryCounts
import com.selffeed.android.data.repository.LocalArticleState
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.data.applyCategoryOrder
import com.selffeed.android.network.CategoryOrderUpdate
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleStateSnapshot
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.UserPreferences
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
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
class LocalStore internal constructor(
    private val database: LocalDatabase,
    moshi: Moshi,
    private val processingDispatcher: CoroutineDispatcher = Dispatchers.Default,
) : OfflineReadStore {
    constructor(context: Context, moshi: Moshi, processingDispatcher: CoroutineDispatcher = Dispatchers.Default) : this(
        Room.databaseBuilder(context.applicationContext, LocalDatabase::class.java, DB_NAME)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS)
            .build(),
        moshi,
        processingDispatcher,
    )
    private val dao = database.localStoreDao()
    private val counts = LocalCountStore(dao, moshi)

    private val categoryChildrenAdapter: JsonAdapter<List<CategoryWithCounts>> = moshi.adapter(
        Types.newParameterizedType(List::class.java, CategoryWithCounts::class.java),
    )
    private val articleDetailAdapter: JsonAdapter<ArticleDetail> =
        moshi.adapter(ArticleDetail::class.java)
    private val preferencesAdapter: JsonAdapter<UserPreferences> =
        moshi.adapter(UserPreferences::class.java)

    // A freshness hint, not an event log. A slow observer must not hold a database/account commit open.
    private val _invalidations = MutableSharedFlow<String>(replay = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val invalidations = _invalidations.asSharedFlow()
    private val invalidationSeq = AtomicLong(0)
    private val articleStateEpoch = AtomicLong(0)
    // Accessed only inside Room transactions. A collector owns its references until cancellation cleanup.
    private val observedArticleReferences = mutableMapOf<String, Int>()

    val articleStateRetentionEpoch: Long get() = articleStateEpoch.get()

    /** Reject responses started before watermark eviction or explicit article-context invalidation. */
    suspend fun <T : Any> acceptArticleSnapshot(epoch: Long, block: suspend () -> T): T? =
        database.withTransaction {
            if (epoch != articleStateEpoch.get()) null else block()
        }

    suspend fun readOwner(): LocalOwnerEntity? = dao.readOwner()

    suspend fun captureCountSnapshot(): CountSnapshotTicket = database.withTransaction { counts.capture() }

    suspend fun invalidateCountSnapshots() = database.withTransaction { counts.invalidateCountSnapshot() }

    suspend fun readStats(): StatsResponse? = database.withTransaction { counts.readStats() }

    fun observeLibraryCounts(): Flow<LibraryCounts> = database.invalidationTracker
        .createFlow(LocalTables.FEEDS, LocalTables.CATEGORIES, LocalTables.LOCAL_COUNT_STATE)
        .map {
            database.withTransaction {
                val categoryCounts = buildMap {
                    fun append(categories: List<CategoryWithCounts>) {
                        categories.forEach { category ->
                            put(category.id, category.unreadCount)
                            category.children?.let(::append)
                        }
                    }
                    append(readCategories())
                }
                val totals = dao.readCountState()
                LibraryCounts(
                    feedUnread = dao.readFeeds().associate { it.id to it.unreadCount.coerceAtLeast(0) },
                    categoryUnread = categoryCounts,
                    totalRead = totals?.totalRead?.coerceAtLeast(0),
                    totalUnread = totals?.totalUnread?.coerceAtLeast(0),
                )
            }
        }.distinctUntilChanged().flowOn(Dispatchers.IO)

    /** A durable generation coalesces local edits, delivery, and remote read hints without a polling loop. */
    fun observeCountRefreshRequests(): Flow<Unit> = flow {
        var initial = true
        database.invalidationTracker
            .createFlow(LocalTables.LOCAL_COUNT_STATE, LocalTables.PENDING_READ_STATE_MUTATIONS)
            .map { captureCountSnapshot() }.distinctUntilChanged().collect { ticket ->
                if (initial || !ticket.hadPendingReads) emit(Unit)
                initial = false
            }
    }.flowOn(Dispatchers.IO)

    suspend fun writeRemoteStats(stats: StatsResponse, ticket: CountSnapshotTicket) =
        database.withTransaction { counts.writeStats(stats, ticket) }

    /** Metadata remains fresh while existing count projections await settled read delivery. */
    suspend fun writeRemoteFeeds(feeds: List<FeedWithCounts>, ticket: CountSnapshotTicket, merge: Boolean = false): List<FeedWithCounts> =
        database.withTransaction {
            val previous = dao.readFeeds().associateBy { it.id }
            val acceptCounts = counts.mayAccept(ticket)
            val incoming = feeds.map { feed ->
                if (acceptCounts) feed else feed.copy(unreadCount = previous[feed.id]?.unreadCount ?: feed.unreadCount)
            }
            if (merge) mergeFeeds(incoming) else writeFeeds(incoming)
            incoming.map { it.copy(unreadCount = it.unreadCount.coerceAtLeast(0)) }
        }

    suspend fun writeRemoteCategories(categories: List<CategoryWithCounts>, ticket: CountSnapshotTicket): List<CategoryWithCounts> =
        database.withTransaction {
            val existingCounts = mutableMapOf<String, Int>()
            fun remember(nodes: List<CategoryWithCounts>) {
                nodes.forEach { category ->
                    existingCounts[category.id] = category.unreadCount
                    category.children?.let(::remember)
                }
            }
            fun project(nodes: List<CategoryWithCounts>): List<CategoryWithCounts> = nodes.map { category ->
                category.copy(
                    unreadCount = existingCounts[category.id] ?: category.unreadCount,
                    children = category.children?.let(::project),
                )
            }
            val incoming = if (counts.mayAccept(ticket)) categories else {
                remember(dao.readCategories().map { it.toModel() })
                project(categories)
            }
            writeCategories(incoming)
            incoming.map { it.withVisibleCounts() }
        }

    /** Every emission is one owner-filtered transaction, including inputs larger than SQLite's bind limit. */
    fun observeArticleStates(articleIds: Set<String>, ownerId: String): Flow<Map<String, LocalArticleState>> {
        val observedIds = articleIds.toList()
        val batches = observedIds.chunked(100)
        if (batches.isEmpty()) return flowOf(emptyMap())
        return flow {
            var registered = false
            try {
                database.withTransaction {
                    observedIds.forEach { id ->
                        observedArticleReferences[id] = (observedArticleReferences[id] ?: 0) + 1
                    }
                    registered = true
                }
                emitAll(database.invalidationTracker.createFlow(
                    LocalTables.ARTICLE_STATE_REVISIONS, LocalTables.PENDING_READ_STATE_MUTATIONS,
                    LocalTables.PENDING_SAVED_STATE_MUTATIONS, LocalTables.ARTICLES, LocalTables.CURRENT_LOCAL_OWNER,
                ).map {
                    database.withTransaction {
                        buildMap {
                            batches.forEach { ids ->
                                dao.readObservedArticleStates(ids, ownerId).forEach { put(it.articleId, it.state) }
                            }
                        }
                    }
                }.distinctUntilChanged())
            } finally {
                if (registered) withContext(NonCancellable) {
                    database.withTransaction {
                        val releasedIds = mutableListOf<String>()
                        observedIds.forEach { id ->
                            val remaining = observedArticleReferences.getValue(id) - 1
                            if (remaining == 0) {
                                observedArticleReferences.remove(id)
                                releasedIds += id
                            } else observedArticleReferences[id] = remaining
                        }
                        // A serial observer replacement releases before it registers again. Treat
                        // that release as recent use so its unchanged state enters the bounded grace set.
                        releasedIds.chunked(100).forEach { ids ->
                            val states = dao.readArticleStateRevisions(ids)
                            if (states.isNotEmpty()) dao.upsertArticleStateRevisions(states)
                        }
                        pruneArticleStateHistory()
                    }
                }
            }
        }.flowOn(Dispatchers.IO)
    }

    /** Merge one validated network batch atomically; pending choices remain the visible values. */
    suspend fun reconcileArticleStates(states: List<ArticleStateSnapshot>): Set<String> = database.withTransaction {
        var createdState = false
        var removedSave = false
        buildSet {
            states.forEach { snapshot ->
                val existing = dao.readArticleStateRevision(snapshot.id)
                val state = existing ?: stateRecord(snapshot.id).also { createdState = true }
                val read = ConfirmedArticleState(state.confirmedReadState, state.readRevision)
                val saved = ConfirmedArticleState(state.confirmedSavedState, state.savedRevision)
                if (read.merge(snapshot.isRead, snapshot.readRevision) != read) {
                    mergeReadState(snapshot.id, snapshot.isRead, snapshot.readRevision)
                    add(snapshot.id)
                }
                if (saved.merge(snapshot.isSaved, snapshot.savedRevision) != saved) {
                    mergeSavedState(snapshot.id, snapshot.isSaved, snapshot.savedRevision)
                    if (!snapshot.isSaved) removedSave = true
                    add(snapshot.id)
                }
            }
        }.also {
            if (removedSave) dao.pruneOrphanArticles()
            if (createdState || removedSave) pruneArticleStateHistory()
        }
    }

    suspend fun readArticleState(articleId: String): LocalArticleState =
        database.withTransaction {
            val state = dao.readArticleStateRevision(articleId) ?: recoverArticleState(articleId)
            val read = dao.readPendingReadStateMutation(articleId)
            val saved = dao.readPendingSavedStateMutation(articleId)
            LocalArticleState(
                read?.read ?: state.confirmedReadState,
                saved?.saved ?: state.confirmedSavedState,
                read?.mutationId,
                saved?.mutationId,
                state.lastReadMutationId,
                state.lastSavedMutationId,
                state.readRevision,
                state.savedRevision,
            )
        }

    /**
     * Adopts an existing snapshot without deleting data, or archives the previous
     * owner's queued intent and replaces the active snapshot in one transaction.
     * The repository must serialize this with all account-scoped commits.
     */
    suspend fun switchOwner(next: LocalOwnerEntity): Boolean {
        require(next.key == "current" && next.ownerId.isNotBlank() && next.apiBaseUrl.isNotBlank())
        val replaced = database.withTransaction {
            val previous = dao.readOwner()
            if (previous?.ownerId == next.ownerId) {
                require(previous.apiBaseUrl == next.apiBaseUrl) { "Owner cannot change server" }
                require(previous.userId == null || next.userId == null || previous.userId == next.userId) {
                    "Owner cannot change authenticated user"
                }
                if (previous.userId == null && next.userId != null) dao.upsertOwner(next)
                return@withTransaction false
            }
            check(!dao.hasArchivedOwner(next.ownerId)) { "Archived owner cannot become active again" }
            if (previous != null) {
                dao.archiveReadStateMutations(previous.ownerId, previous.apiBaseUrl, previous.userId)
                dao.archiveSavedStateMutations(previous.ownerId, previous.apiBaseUrl, previous.userId)
                clearActiveSnapshot()
            }
            dao.upsertOwner(next)
            previous != null
        }
        if (replaced) notifyInvalidation("all")
        return replaced
    }

    override suspend fun writeCategories(categories: List<CategoryWithCounts>) {
        database.withTransaction {
            dao.clearCategories()
            if (categories.isNotEmpty()) {
                dao.upsertCategories(categories.mapIndexed { index, category -> category.toEntity(index) })
            }
        }
        notifyInvalidation(TABLE_CATEGORIES)
    }

    override suspend fun readCategories(): List<CategoryWithCounts> = withContext(processingDispatcher) {
        dao.readCategories().map { it.toModel().withVisibleCounts() }
    }

    suspend fun reorderCategories(updates: List<CategoryOrderUpdate>) = database.withTransaction {
        writeCategories(applyCategoryOrder(dao.readCategories().map { it.toModel() }, updates))
    }

    private fun CategoryWithCounts.withVisibleCounts(): CategoryWithCounts = copy(
        unreadCount = unreadCount.coerceAtLeast(0), children = children?.map { it.withVisibleCounts() },
    )

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
        dao.readFeeds().map { it.toModel().copy(unreadCount = it.unreadCount.coerceAtLeast(0)) }

    override suspend fun mergeFeeds(feeds: List<FeedWithCounts>) {
        if (feeds.isEmpty()) return
        val replacements = feeds.associateBy(FeedWithCounts::id)
        val existing = dao.readFeeds().map { it.toModel() }
        writeFeeds(buildList {
            existing.forEach { add(replacements[it.id] ?: it) }
            feeds.filterNot { incoming -> existing.any { it.id == incoming.id } }.forEach(::add)
        })
    }

    /** Apply an accepted deletion without discarding offline bodies or queued article choices. */
    suspend fun removeFeedMetadata(feedId: String) {
        database.withTransaction {
            dao.readFeed(feedId)?.let { deleted ->
                val roots = dao.readCategories().map { it.toModel() }
                val ancestorIds = mutableSetOf<String>()
                fun findPath(category: CategoryWithCounts, ancestors: Set<String>) {
                    val path = ancestors + category.id
                    if (category.id == deleted.categoryId) ancestorIds.addAll(path)
                    category.children?.forEach { findPath(it, path) }
                }
                roots.forEach { findPath(it, emptySet()) }
                fun adjust(category: CategoryWithCounts): CategoryWithCounts = category.copy(
                    feedCount = if (category.id in ancestorIds) (category.feedCount - 1).coerceAtLeast(0) else category.feedCount,
                    // Raw signed baselines include pending choices. Clamping before subtraction loses their scope.
                    unreadCount = category.unreadCount - if (category.id in ancestorIds) deleted.unreadCount else 0,
                    children = category.children?.map(::adjust),
                )
                dao.deleteFeed(feedId)
                if (roots.isNotEmpty()) dao.upsertCategories(roots.mapIndexed { index, root -> adjust(root).toEntity(index) })
            }
            counts.forgetFeedScope(feedId)
            counts.invalidateCountSnapshot()
        }
        notifyInvalidation(TABLE_FEEDS)
        notifyInvalidation(TABLE_CATEGORIES)
    }

    /** The server accepts only empty leaf-category deletion. Preserve every other cached branch. */
    suspend fun removeCategoryMetadata(categoryId: String) {
        database.withTransaction {
            fun remove(categories: List<CategoryWithCounts>): List<CategoryWithCounts> = categories
                .filterNot { it.id == categoryId }
                .map { category -> category.copy(children = category.children?.let(::remove)) }
            writeCategories(remove(dao.readCategories().map { it.toModel() }))
            counts.invalidateCountSnapshot()
        }
    }

    fun articlePagingSource(queryKey: String, ownerId: String?): PagingSource<Int, ArticleListItem> =
        dao.articlePagingSource(queryKey, ownerId)

    fun savedArticlePagingSource(ownerId: String?): PagingSource<Int, ArticleListItem> =
        dao.savedArticlePagingSource(ownerId)

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

            // A 404 proves absence only while the captured state and intent remain unchanged.
            val state = stateRecord(articleId)
            dao.upsertArticleStateRevision(state.copy(confirmedSavedState = null))
            dao.updateArticleSavedState(articleId, false)
            dao.readArticleDetail(articleId)?.let { entity ->
                runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                    dao.upsertArticleDetail(
                        entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = false))),
                    )
                }
            }
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
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
    ): List<ArticleListItem> {
        val articles = database.withTransaction {
            val effective = mergeArticleSnapshots(payload.data)
            if (clearExisting) {
                dao.clearArticleQueryEntries(queryKey)
                dao.clearArticleRemoteKey(queryKey)
            }
            if (payload.data.isNotEmpty()) {
                dao.upsertArticles(
                    effective.map { it.toEntity() },
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
            pruneArticleStateHistory()
            effective
        }
        notifyInvalidation(TABLE_ARTICLES)
        return articles
    }

    /** Accept server snapshots without adding search results to a paged query. */
    suspend fun reconcileArticleSnapshots(articles: List<ArticleListItem>): List<ArticleListItem> =
        database.withTransaction { mergeArticleSnapshots(articles).also { pruneArticleStateHistory() } }

    private suspend fun mergeArticleSnapshots(articles: List<ArticleListItem>): List<ArticleListItem> =
        articles.map { article ->
            val state = stateRecord(article.id)
            if (state.articleFeedId != article.feedId) dao.upsertArticleStateRevision(state.copy(articleFeedId = article.feedId))
            val read = ConfirmedArticleState(state.confirmedReadState, state.readRevision)
            val saved = ConfirmedArticleState(state.confirmedSavedState, state.savedRevision)
            // Repeated and stale metadata pages must not traverse full reader bodies.
            if (read.merge(article.isRead, article.readRevision) != read) {
                mergeReadState(article.id, article.isRead, article.readRevision)
            }
            if (saved.merge(article.isSaved, article.savedRevision) != saved) {
                mergeSavedState(article.id, article.isSaved, article.savedRevision)
            }
            projectArticleSnapshot(article)
        }

    /** Cache hits already contain local projections, so they must never be readmitted as server facts. */
    suspend fun projectArticleSnapshots(articles: List<ArticleListItem>): List<ArticleListItem> =
        database.withTransaction { articles.map { projectArticleSnapshot(it) } }

    private suspend fun projectArticleSnapshot(article: ArticleListItem): ArticleListItem {
        val state = dao.readArticleStateRevision(article.id)
        return article.copy(
            isRead = dao.readPendingReadStateMutation(article.id)?.read ?: state?.confirmedReadState ?: article.isRead,
            isSaved = dao.readPendingSavedStateMutation(article.id)?.saved ?: state?.confirmedSavedState ?: article.isSaved,
            readRevision = if (state?.confirmedReadState != null) state.readRevision else article.readRevision,
            savedRevision = if (state?.confirmedSavedState != null) state.savedRevision else article.savedRevision,
        )
    }

    private suspend fun stateRecord(articleId: String): ArticleStateRevisionEntity {
        // A persisted unknown value must stay unknown, including after rejection.
        // Never recover a rejected optimistic projection as a confirmed baseline.
        dao.readArticleStateRevision(articleId)?.let { return it }
        return recoverArticleState(articleId).also { dao.upsertArticleStateRevision(it) }
    }

    /** Reading a missing state must not add another history row or scan the cache for eviction. */
    private suspend fun recoverArticleState(articleId: String): ArticleStateRevisionEntity {
        val read = dao.readPendingReadStateMutation(articleId)
        val saved = dao.readPendingSavedStateMutation(articleId)
        val article = dao.readArticle(articleId)
        val detail = if (article == null && (read == null || saved == null)
        ) dao.readArticleDetail(articleId)?.let { decodeDetail(it) } else null
        return ArticleStateRevisionEntity(
            articleId, null, null,
            confirmedReadState = if (read != null) read.previousState else article?.isRead ?: detail?.isRead,
            confirmedSavedState = if (saved != null) saved.previousState else article?.isSaved ?: detail?.isSaved,
            lastReadMutationId = read?.mutationId,
            lastSavedMutationId = saved?.mutationId,
            articleFeedId = article?.feedId ?: detail?.feedId,
        )
    }

    private fun decodeDetail(entity: ArticleDetailEntity): ArticleDetail? =
        runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()

    private suspend fun mergeReadState(articleId: String, read: Boolean, revision: Int?): Boolean? {
        val existing = stateRecord(articleId)
        val confirmed = ConfirmedArticleState(existing.confirmedReadState, existing.readRevision).merge(read, revision)
        if (confirmed != ConfirmedArticleState(existing.confirmedReadState, existing.readRevision)) counts.invalidateCountSnapshot()
        dao.upsertArticleStateRevision(existing.copy(readRevision = confirmed.revision, confirmedReadState = confirmed.value))
        val pending = dao.readPendingReadStateMutation(articleId)
        if (pending != null && pending.previousState != confirmed.value) {
            dao.upsertPendingReadStateMutation(pending.copy(previousState = confirmed.value))
        }
        val visible = pending?.read ?: confirmed.value
        if (visible != null) {
            dao.updateArticleReadState(articleId, visible)
            dao.readArticleDetail(articleId)?.let { entity ->
                decodeDetail(entity)?.let { detail ->
                    dao.upsertArticleDetail(entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = visible, readRevision = confirmed.revision))))
                }
            }
        }
        if (pending != null) dao.upsertArticleReadOverride(articleId.toReadOverride(pending.read))
        else dao.deleteArticleReadOverride(articleId)
        return visible
    }

    private suspend fun mergeSavedState(articleId: String, saved: Boolean, revision: Int?): Boolean? {
        val existing = stateRecord(articleId)
        val confirmed = ConfirmedArticleState(existing.confirmedSavedState, existing.savedRevision).merge(saved, revision)
        dao.upsertArticleStateRevision(existing.copy(savedRevision = confirmed.revision, confirmedSavedState = confirmed.value))
        val pending = dao.readPendingSavedStateMutation(articleId)
        if (pending != null && pending.previousState != confirmed.value) {
            dao.upsertPendingSavedStateMutation(pending.copy(previousState = confirmed.value))
        }
        val visible = pending?.saved ?: confirmed.value
        if (visible != null) {
            dao.updateArticleSavedState(articleId, visible)
            dao.readArticleDetail(articleId)?.let { entity ->
                decodeDetail(entity)?.let { detail ->
                    dao.upsertArticleDetail(entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isSaved = visible, savedRevision = confirmed.revision))))
                }
            }
        }
        return visible
    }

    suspend fun queueReadStateMutation(
        articleId: String,
        read: Boolean,
        source: String = "manual",
    ): PendingReadStateMutationEntity {
        lateinit var queued: PendingReadStateMutationEntity
        database.withTransaction {
            val previous = dao.readPendingReadStateMutation(articleId)
            val state = stateRecord(articleId)
            val revision = state.readRevision
            val detailEntity = dao.readArticleDetail(articleId)
            val detail = detailEntity?.let {
                runCatching { articleDetailAdapter.fromJson(it.payloadJson) }.getOrNull()
            }
            queued = PendingReadStateMutationEntity(
                articleId = articleId,
                read = read,
                mutationId = UUID.randomUUID().toString(),
                source = source,
                baseRevision = listOfNotNull(previous?.baseRevision, revision).maxOrNull(),
                previousState = state.confirmedReadState,
                updatedAt = System.currentTimeMillis(),
                countScopeJson = if (previous == null && state.confirmedReadState != null) counts.captureReadScope(articleFeedId(articleId)) else previous?.countScopeJson,
            )
            dao.upsertArticleReadOverride(articleId.toReadOverride(read))
            dao.updateArticleReadState(articleId, read)
            if (detailEntity != null && detail != null) {
                dao.upsertArticleDetail(
                    detailEntity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = read))),
                )
            }
            dao.upsertPendingReadStateMutation(queued)
            dao.upsertArticleStateRevision(state.copy(lastReadMutationId = queued.mutationId))
            counts.recordLocalReadChange(queued.countScopeJson, previous?.read ?: state.confirmedReadState, read)
            pruneArticleStateHistory()
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
            if (!saved) dao.removeLegacyOfflineArticle(articleId)
            val previous = dao.readPendingSavedStateMutation(articleId)
            val state = stateRecord(articleId)
            val revision = state.savedRevision
            val detailEntity = dao.readArticleDetail(articleId)
            val detail = detailEntity?.let {
                runCatching { articleDetailAdapter.fromJson(it.payloadJson) }.getOrNull()
            }
            val article = dao.readArticle(articleId)
            val previousState = state.confirmedSavedState
            if (article == null && detail != null) {
                dao.upsertArticles(listOf(detail.toArticleEntity(saved)))
            }
            queued = PendingSavedStateMutationEntity(
                articleId = articleId,
                saved = saved,
                mutationId = UUID.randomUUID().toString(),
                baseRevision = listOfNotNull(previous?.baseRevision, revision).maxOrNull(),
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
            dao.upsertArticleStateRevision(state.copy(lastSavedMutationId = queued.mutationId))
            pruneArticleStateHistory()
        }
        notifyInvalidation(TABLE_ARTICLES)
        return queued
    }

    suspend fun updateArticleReadState(articleId: String, read: Boolean, revision: Int? = null): Boolean? {
        val visible = database.withTransaction {
            val existing = dao.readArticleStateRevision(articleId)
            mergeReadState(articleId, read, revision).also {
                if (existing == null) pruneArticleStateHistory()
            }
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
        return visible
    }

    suspend fun updateArticleSavedState(articleId: String, saved: Boolean, revision: Int? = null): Boolean? {
        val visible = database.withTransaction {
            val existing = dao.readArticleStateRevision(articleId)
            mergeSavedState(articleId, saved, revision).also { visible ->
                val removedSave = visible == false && existing?.confirmedSavedState != false
                if (removedSave) dao.pruneOrphanArticles()
                if (existing == null || removedSave) pruneArticleStateHistory()
            }
        }
        notifyInvalidation(TABLE_ARTICLES)
        return visible
    }

    suspend fun readArticleReadOverrides(): Map<String, Boolean> =
        dao.readArticleReadOverrides().associate { it.articleId to it.read }

    suspend fun markArticlesReadByFeeds(feedIds: Collection<String>): BulkReadReconciliation {
        val result = database.withTransaction {
            pruneArticleStateHistory()
            counts.invalidateCountSnapshot()
            val pending = dao.readPendingReadStateMutations().associateBy { it.articleId }
            val scoped = dao.readArticleStatesByFeeds(feedIds.distinct(), feedIds.isEmpty())
                .associateByTo(linkedMapOf()) { it.state.articleId }
            observedArticleReferences.keys.toList().chunked(100).forEach { ids ->
                dao.readArticleStateRevisions(ids).forEach { state ->
                    scoped.putIfAbsent(state.articleId, ScopedArticleState(state, state.articleFeedId, null, true))
                }
            }
            val unreadArticleFeeds = mutableMapOf<String, String>()
            val states = ArrayList<ArticleStateRevisionEntity>(scoped.size)
            val overrides = ArrayList<ArticleReadOverrideEntity>(scoped.size)
            val affectedArticleIds = mutableSetOf<String>()
            for ((stored, metadataFeedId, cachedReadState, hasStateRecord) in scoped.values) {
                val feedId = metadataFeedId ?: dao.readArticleDetail(stored.articleId)?.let { decodeDetail(it)?.feedId }
                if (feedIds.isNotEmpty() && feedId !in feedIds) continue
                val state = if (hasStateRecord) stored else stateRecord(stored.articleId)
                affectedArticleIds += state.articleId
                // Bulk receipts carry no per-article version. They are only a refresh
                // hint once a versioned state is known, even if the value is unknown.
                val confirmed = ConfirmedArticleState(state.confirmedReadState, state.readRevision).merge(true, null)
                states += state.copy(confirmedReadState = confirmed.value)
                val mutation = pending[state.articleId]
                if (mutation != null) {
                    dao.upsertPendingReadStateMutation(mutation.copy(previousState = confirmed.value))
                }
                val visible = mutation?.read ?: confirmed.value ?: cachedReadState
                if (visible != null) overrides += state.articleId.toReadOverride(visible)
                if (visible == false && feedId != null) unreadArticleFeeds[state.articleId] = feedId
            }
            dao.upsertArticleStateRevisions(states)
            dao.upsertArticleReadOverrides(overrides)
            BulkReadReconciliation(unreadArticleFeeds, affectedArticleIds)
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
        return result
    }

    suspend fun readPendingReadStateMutations(): List<PendingReadStateMutationEntity> =
        dao.readPendingReadStateMutations()

    suspend fun readPendingSavedStateMutations(): List<PendingSavedStateMutationEntity> =
        dao.readPendingSavedStateMutations()

    suspend fun deletePendingReadStateMutation(articleId: String) {
        database.withTransaction {
            dao.readPendingReadStateMutation(articleId)?.let {
                dao.deletePendingReadStateMutation(articleId, it.mutationId)
            }
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
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
    ): ArticleStateMutationResult {
        val result = database.withTransaction {
            // Recover the old baseline before removing its pending overlay.
            val state = stateRecord(mutation.articleId)
            val pending = dao.readPendingReadStateMutation(mutation.articleId)
            val before = pending?.read ?: state.confirmedReadState
            val removed = dao.deletePendingReadStateMutation(mutation.articleId, mutation.mutationId) > 0
            val effective = mergeReadState(mutation.articleId, read, revision)
            counts.recordLocalReadChange(pending?.countScopeJson, before, effective)
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
            ArticleStateMutationResult(removed, effective)
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
        return result
    }

    suspend fun acknowledgeSavedStateMutation(
        mutation: PendingSavedStateMutationEntity,
        saved: Boolean,
        revision: Int,
    ): ArticleStateMutationResult {
        val result = database.withTransaction {
            stateRecord(mutation.articleId)
            val removed = dao.deletePendingSavedStateMutation(mutation.articleId, mutation.mutationId) > 0
            val effective = mergeSavedState(mutation.articleId, saved, revision)
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
            ArticleStateMutationResult(removed, effective)
        }
        notifyInvalidation(TABLE_ARTICLES)
        return result
    }

    suspend fun rebaseReadStateMutation(mutation: PendingReadStateMutationEntity, revision: Int, read: Boolean? = null) {
        database.withTransaction {
            if (read != null) mergeReadState(mutation.articleId, read, revision)
            val current = dao.readPendingReadStateMutation(mutation.articleId) ?: return@withTransaction
            if (current.mutationId != mutation.mutationId) return@withTransaction
            val base = maxOf(revision, current.baseRevision ?: 0, dao.readArticleStateRevision(mutation.articleId)?.readRevision ?: 0)
            // Recover legacy intent identity before rotating only the transport request ID.
            val state = stateRecord(mutation.articleId)
            if (state.lastReadMutationId == null) {
                dao.upsertArticleStateRevision(state.copy(lastReadMutationId = current.mutationId))
            }
            val rebased = current.copy(mutationId = UUID.randomUUID().toString(), baseRevision = base)
            dao.upsertPendingReadStateMutation(rebased)
        }
    }

    suspend fun rebaseSavedStateMutation(mutation: PendingSavedStateMutationEntity, revision: Int, saved: Boolean? = null) {
        database.withTransaction {
            if (saved != null) mergeSavedState(mutation.articleId, saved, revision)
            val current = dao.readPendingSavedStateMutation(mutation.articleId) ?: return@withTransaction
            if (current.mutationId != mutation.mutationId) return@withTransaction
            val base = maxOf(revision, current.baseRevision ?: 0, dao.readArticleStateRevision(mutation.articleId)?.savedRevision ?: 0)
            // Recover legacy intent identity before rotating only the transport request ID.
            val state = stateRecord(mutation.articleId)
            if (state.lastSavedMutationId == null) {
                dao.upsertArticleStateRevision(state.copy(lastSavedMutationId = current.mutationId))
            }
            val rebased = current.copy(mutationId = UUID.randomUUID().toString(), baseRevision = base)
            dao.upsertPendingSavedStateMutation(rebased)
        }
    }

    suspend fun discardReadStateMutation(mutation: PendingReadStateMutationEntity): RejectedArticleMutation? {
        val result = database.withTransaction {
            val state = stateRecord(mutation.articleId)
            val pending = dao.readPendingReadStateMutation(mutation.articleId)
            val removed = dao.deletePendingReadStateMutation(mutation.articleId, mutation.mutationId) > 0
            if (removed) {
                state.confirmedReadState?.let { confirmed ->
                    mergeReadState(mutation.articleId, confirmed, state.readRevision)
                }
                dao.deleteAcknowledgedArticleReadOverride(mutation.articleId)
                counts.recordLocalReadChange(pending?.countScopeJson, mutation.read, state.confirmedReadState)
            }
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
            if (removed) RejectedArticleMutation(state.lastReadMutationId ?: mutation.mutationId, state.confirmedReadState) else null
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
        return result
    }

    private suspend fun articleFeedId(articleId: String): String? =
        dao.readArticleStateRevision(articleId)?.articleFeedId ?: dao.readArticle(articleId)?.feedId
            ?: dao.readArticleDetail(articleId)?.let { it.feedId ?: decodeDetail(it)?.feedId }

    suspend fun discardSavedStateMutation(mutation: PendingSavedStateMutationEntity): RejectedArticleMutation? {
        val result = database.withTransaction {
            val state = stateRecord(mutation.articleId)
            val removed = dao.deletePendingSavedStateMutation(mutation.articleId, mutation.mutationId) > 0
            if (removed) {
                state.confirmedSavedState?.let { confirmed ->
                    mergeSavedState(mutation.articleId, confirmed, state.savedRevision)
                }
            }
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
            if (removed) RejectedArticleMutation(state.lastSavedMutationId ?: mutation.mutationId, state.confirmedSavedState) else null
        }
        notifyInvalidation(TABLE_ARTICLES)
        return result
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
            mergeReadState(detail.id, detail.isRead, detail.readRevision)
            mergeSavedState(detail.id, detail.isSaved, detail.savedRevision)
            val stored = projectArticleDetail(detail)
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
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
        }
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    suspend fun applyPendingArticleState(detail: ArticleDetail): ArticleDetail =
        database.withTransaction { projectArticleDetail(detail) }

    private suspend fun projectArticleDetail(detail: ArticleDetail): ArticleDetail {
        val state = dao.readArticleStateRevision(detail.id)
        return detail.copy(
            isRead = dao.readPendingReadStateMutation(detail.id)?.read ?: state?.confirmedReadState ?: detail.isRead,
            isSaved = dao.readPendingSavedStateMutation(detail.id)?.saved ?: state?.confirmedSavedState ?: detail.isSaved,
            readRevision = if (state?.confirmedReadState != null) state.readRevision else detail.readRevision,
            savedRevision = if (state?.confirmedSavedState != null) state.savedRevision else detail.savedRevision,
        )
    }

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

    override suspend fun readArticleDetail(articleId: String): ArticleDetail? = withContext(processingDispatcher) {
        readableArticleDetail(dao.readArticleDetail(articleId))
    }

    private suspend fun readableArticleDetail(detail: ArticleDetailEntity?): ArticleDetail? {
        detail ?: return null
        val parsed = decodeDetail(detail)?.let { projectArticleDetail(it) }
        if (System.currentTimeMillis() - detail.writtenAt > MAX_ARTICLE_DETAIL_AGE_MS) {
            // A saved article is an explicit offline promise. It remains readable
            // until the user unsaves it or signs out, even after normal cache TTLs.
            if (parsed?.isSaved == true || dao.isLegacyOfflineArticle(detail.id)) return parsed
            database.withTransaction {
                dao.clearArticleDetail(detail.id)
                dao.pruneOrphanArticles()
                pruneArticleStateHistory()
            }
            return null
        }
        return parsed
    }

    override suspend fun clearArticleDetail(articleId: String) {
        database.withTransaction {
            dao.clearArticleDetail(articleId)
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
        }
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    override suspend fun clearArticleDetails() {
        database.withTransaction {
            dao.clearArticleDetails()
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
        }
        notifyInvalidation(TABLE_ARTICLE_DETAILS)
    }

    suspend fun writePreferences(preferences: UserPreferences) {
        val payload = withContext(processingDispatcher) { preferencesAdapter.toJson(preferences) }
        dao.upsertPreferences(
            PreferencesEntity(payloadJson = payload, writtenAt = System.currentTimeMillis()),
        )
    }

    suspend fun readPreferences(): UserPreferences? = withContext(processingDispatcher) {
        dao.readPreferences()?.let { entity ->
            runCatching { preferencesAdapter.fromJson(entity.payloadJson) }.getOrNull()
        }
    }

    suspend fun searchArticles(query: String, categoryId: String?, limit: Int = 20): List<ArticleListItem> =
        dao.searchArticles(query.trim(), categoryId, limit).map { it.toModel() }

    override suspend fun clearAll() {
        database.withTransaction { clearActiveSnapshot() }
        notifyInvalidation("all")
    }

    /**
     * Keep a small grace set of unreferenced watermarks. Observed and durable article state is never
     * counted against that budget. REPLACE rowids give approximate write recency without a new schema.
     * The caller owns a Room transaction so eviction and its response epoch change are indivisible.
     */
    private suspend fun pruneArticleStateHistory() {
        var beforeRowId: Long? = null
        var retainedOrphans = 0
        var evicted = false
        do {
            val batch = dao.readOrphanArticleStates(beforeRowId, ARTICLE_STATE_PRUNE_BATCH_SIZE)
            val expired = batch.mapNotNull { row ->
                if (row.articleId in observedArticleReferences) null
                else row.articleId.takeIf { ++retainedOrphans > MAX_ORPHAN_ARTICLE_STATES }
            }
            if (expired.isNotEmpty()) {
                evicted = dao.deleteArticleStateRevisions(expired) > 0 || evicted
                dao.deleteArticleReadOverrides(expired)
            }
            beforeRowId = batch.lastOrNull()?.writeOrder
        } while (beforeRowId != null)

        // Old bulk receipts may have left overrides even without a revision. They are presentation
        // state for retained articles, not a second history of every article ever encountered.
        beforeRowId = null
        do {
            val batch = dao.readOrphanArticleReadOverrides(beforeRowId, ARTICLE_STATE_PRUNE_BATCH_SIZE)
            val expired = batch.mapNotNull { row -> row.articleId.takeUnless { it in observedArticleReferences } }
            if (expired.isNotEmpty()) dao.deleteArticleReadOverrides(expired)
            beforeRowId = batch.lastOrNull()?.writeOrder
        } while (beforeRowId != null)
        if (evicted) articleStateEpoch.incrementAndGet()
    }

    private suspend fun clearActiveSnapshot() {
        articleStateEpoch.incrementAndGet()
        dao.clearCategories()
        dao.clearFeeds()
        dao.clearArticles()
        dao.clearArticleQueryEntries()
        dao.clearArticleRemoteKeys()
        dao.clearPendingReadStateMutations()
        dao.clearPendingSavedStateMutations()
        dao.clearArticleStateRevisions()
        dao.clearArticleReadOverrides()
        dao.clearAllArticleDetails()
        dao.clearPreferences()
        dao.clearLegacyOfflineArticles()
        dao.clearCountState()
    }

    override suspend fun clearCategories() = clearTable(TABLE_CATEGORIES)

    override suspend fun clearFeeds() = clearTable(TABLE_FEEDS)

    override suspend fun clearArticleLists() {
        database.withTransaction {
            articleStateEpoch.incrementAndGet()
            dao.clearArticleQueryEntries()
            dao.clearArticleRemoteKeys()
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
        }
        notifyInvalidation(TABLE_ARTICLES)
    }

    override suspend fun clearFeedAndArticleData() {
        clearFeeds()
        clearCategories()
        clearArticleLists()
    }

    suspend fun clearTable(table: String) {
        database.withTransaction {
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
                else -> return@withTransaction
            }
            dao.pruneOrphanArticles()
            pruneArticleStateHistory()
        }
        notifyInvalidation(table)
    }

    fun invalidationFlow(): Flow<String> = invalidations

    private fun notifyInvalidation(table: String) {
        _invalidations.tryEmit("${invalidationSeq.incrementAndGet()}:$table")
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
        const val MAX_ORPHAN_ARTICLE_STATES = 256
        private const val ARTICLE_STATE_PRUNE_BATCH_SIZE = 100
    }
}
