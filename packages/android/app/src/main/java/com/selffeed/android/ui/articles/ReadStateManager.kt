package com.selffeed.android.ui.articles

import android.util.Log
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.data.repository.ReadStateRejection
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticleSavedStateChangedEvent
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.ArticlesNewEvent
import com.selffeed.android.network.ArticleUpdatedEvent
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RealtimeConnectedEvent
import com.selffeed.android.ui.ArticleReadStateStore
import com.selffeed.android.ui.ArticleFeatureEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject

/**
 * Manages article read/unread state, including:
 * - Optimistic UI updates
 * - Server synchronization
 * - SSE event handling
 * - Manually unread tracking
 */
class ReadStateManager @Inject constructor(
    private val repository: ArticleRepository,
) {
    private var scope: CoroutineScope? = null

    private val _events = MutableSharedFlow<ArticleFeatureEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<ArticleFeatureEvent> = _events.asSharedFlow()

    val readStateStore = ArticleReadStateStore()
    private val manuallyUnread = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private var incomingLocalEdits: MutableMap<String, LocalReadEdit>? = null

    private data class LocalReadEdit(val feedId: String?, val read: Boolean, val actionId: Any = Any())
    private data class ReadAction(val job: Job, val edit: LocalReadEdit)
    private val readActions = mutableMapOf<String, ReadAction>()
    private var readActionEpoch = 0L
    private val incomingReadMutex = Mutex()

    // Internal state holders
    private var currentFeedId: String? = null
    private var currentCategoryId: String? = null
    private var items: List<ArticleListItem> = emptyList()
    private var selectedArticle: ArticleDetail? = null

    fun setScope(scope: CoroutineScope) {
        this.scope = scope
    }

    fun updateScope(feedId: String?, categoryId: String?) {
        currentFeedId = feedId
        currentCategoryId = categoryId
    }

    fun updateFilter(@Suppress("UNUSED_PARAMETER") hideRead: Boolean) = Unit

    fun updateItems(items: List<ArticleListItem>) {
        this.items = items
    }

    fun updateSelectedArticle(article: ArticleDetail?) {
        selectedArticle = article
    }

    /**
     * Marks an article as read or unread with optimistic UI update.
     */
    fun markRead(
        articleId: String,
        read: Boolean,
        source: ReadStateChangeSource,
        onOptimisticUpdate: (String, String?, Boolean) -> Unit,
        onError: (String, Boolean?) -> Unit,
        onConfirm: (String, String?, Boolean, Boolean?) -> Unit,
    ) {
        if (source.isAutomatic && read && articleId in manuallyUnread) {
            return
        }

        val wasManuallyUnread = articleId in manuallyUnread
        if (source == ReadStateChangeSource.Manual) {
            if (!read) manuallyUnread.add(articleId) else manuallyUnread.remove(articleId)
        }

        val actionScope = scope ?: return
        readActionEpoch++
        val previousReadState = currentArticleReadState(articleId)
        val feedId = currentFeedId(articleId)
        val actionEdit = LocalReadEdit(feedId, read)
        val job = actionScope.launch(start = CoroutineStart.LAZY) {
            try {
                val receiptEdits = incomingLocalEdits
                val edit = actionEdit
                receiptEdits?.set(articleId, edit)

                // Apply optimistic update
                items = items.withReadState(articleId, read)
                selectedArticle = selectedArticle?.withReadState(articleId, read)
                onOptimisticUpdate(articleId, feedId, read)

                val result = repository.markRead(articleId, read, source.apiValue)
                if (!currentCoroutineContext().isActive || readActions[articleId]?.job !== currentCoroutineContext()[Job]) return@launch
                when (result) {
                    is AppResult.Success -> {
                        val confirmed = result.data
                        rememberArticleReadState(articleId, confirmed)
                        onConfirm(articleId, feedId, confirmed, previousReadState)
                    }
                    is AppResult.Error -> {
                        val local = repository.localArticleState(articleId)
                        if (!currentCoroutineContext().isActive || readActions[articleId]?.job !== currentCoroutineContext()[Job]) return@launch
                        val restored = (local as? AppResult.Success)?.data?.isRead
                        val currentEdits = incomingLocalEdits
                        if (currentEdits?.get(articleId)?.actionId === actionEdit.actionId) {
                            if (restored == null) currentEdits.remove(articleId)
                            else currentEdits[articleId] = edit.copy(read = restored)
                        }
                        if (source == ReadStateChangeSource.Manual) {
                            if (wasManuallyUnread) manuallyUnread.add(articleId) else manuallyUnread.remove(articleId)
                        }
                        restored?.let { previous ->
                            items = items.withReadState(articleId, previous)
                            selectedArticle = selectedArticle?.withReadState(articleId, previous)
                            rememberArticleReadState(articleId, previous)
                        }
                        onError(articleId, restored)
                    }
                }
            } finally {
                if (readActions[articleId]?.job === currentCoroutineContext()[Job]) {
                    readActions.remove(articleId)
                    readActionEpoch++
                }
            }
        }
        readActions.remove(articleId)?.job?.cancel()
        readActions[articleId] = ReadAction(job, actionEdit)
        job.start()
    }

    suspend fun applyReadRejection(rejection: ReadStateRejection): Boolean = incomingReadMutex.withLock {
        reconcileReadRejection(rejection)
    }

    private suspend fun reconcileReadRejection(rejection: ReadStateRejection): Boolean {
        while (true) {
            val action = readActions[rejection.articleId]
            if (action != null) { action.job.join(); continue }
            val epoch = readActionEpoch
            val local = (repository.localArticleState(rejection.articleId) as? AppResult.Success)?.data
            if (epoch != readActionEpoch) continue
            if (local?.lastReadMutationId != rejection.mutationId) return false
            val read = local.isRead
            if (read != null) {
                rememberArticleReadState(rejection.articleId, read)
                items = items.withReadState(rejection.articleId, read)
                selectedArticle = selectedArticle?.withReadState(rejection.articleId, read)
                _events.tryEmit(ArticleFeatureEvent.ArticleReadStateChanged(rejection.articleId, currentFeedId(rejection.articleId), read))
            } else {
                _events.tryEmit(ArticleFeatureEvent.ArticlesChanged(rejection.articleId))
            }
            return true
        }
    }

    /**
     * Marks all visible articles as read in the current scope.
     */
    fun markAllRead(
        selectedFeedId: String?,
        selectedCategoryId: String?,
        onSuccess: (String?, String?, Set<String>, Int) -> Unit,
        onError: (String) -> Unit,
    ) {
        scope?.launch {
            when (val result = repository.markAllRead(selectedFeedId, selectedCategoryId)) {
                is AppResult.Success -> {
                    val marked = result.data
                    val affectedFeedIds = when {
                        marked.feedIds.isNotEmpty() -> marked.feedIds.toSet()
                        selectedFeedId != null -> setOf(selectedFeedId)
                        else -> emptySet()
                    }
                    try {
                        reconcileMarkedRead(
                            affectedFeedIds,
                            com.selffeed.android.network.ReadStateScope(feedId = selectedFeedId, categoryId = selectedCategoryId),
                        )
                        onSuccess(selectedFeedId, selectedCategoryId, affectedFeedIds, marked.markedCount)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        Log.w(TAG, "Cannot reconcile completed mark-all action", error)
                        onError(error.message.orEmpty())
                    }
                }
                is AppResult.Error -> onError(result.message)
            }
        }
    }

    /** Collects until the visible host cancels; mutation work retains the model's separate scope. */
    suspend fun observeReadStateSync() {
        while (currentCoroutineContext().isActive) {
            try {
                repository.readStateEvents().collect { event ->
                    if (event.clientId != null && event.clientId == repository.clientId()) return@collect
                    applyReadStateSyncEvent(event)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Read-state sync collector crashed; restarting", e)
            }
            delay(READ_STATE_SYNC_RESTART_DELAY_MS)
        }
    }

    fun clearSessionMemory() {
        readStateStore.clear()
        manuallyUnread.clear()
    }

    fun knownArticleReadStates(): Map<String, Boolean> =
        readStateStore.snapshot(
            articles = items,
            searchResults = emptyList(),
            selectedArticle = selectedArticle,
        )

    private suspend fun applyReadStateSyncEvent(event: ReadStateSyncEvent) {
        when (event) {
            is ArticleReadStateChangedEvent -> applyArticleReadStateChanged(event)
            is ArticleSavedStateChangedEvent -> {
                repository.updateCachedSavedState(event.articleId, event.isSaved, event.revision)
                _events.emit(ArticleFeatureEvent.ArticlesChanged(event.articleId))
            }
            is ArticlesMarkedReadEvent -> reconcileMarkedRead(event.feedIds.toSet(), event.scope)
            is ArticlesNewEvent -> {
                repository.invalidateArticleContentCaches()
                _events.emit(ArticleFeatureEvent.ArticlesChanged())
            }
            is RealtimeConnectedEvent -> {
                repository.invalidateReadStateCaches()
                readStateStore.clear()
                _events.emit(ArticleFeatureEvent.ArticlesChanged())
            }
            is ArticleUpdatedEvent -> {
                repository.invalidateArticleContentCaches(event.articleId)
                _events.emit(ArticleFeatureEvent.ArticlesChanged(event.articleId))
            }
        }
    }

    private suspend fun applyArticleReadStateChanged(event: ArticleReadStateChangedEvent) = withIncomingReadEdits { localEdits ->
        val reconciled = repository.updateCachedReadState(event.articleId, event.isRead, event.revision)
        val read = localEdits[event.articleId]?.read ?: reconciled ?: return@withIncomingReadEdits
        rememberArticleReadState(event.articleId, read)
        items = items.withReadState(event.articleId, read)
        selectedArticle = selectedArticle?.withReadState(event.articleId, read)

        _events.emit(
            ArticleFeatureEvent.ArticleReadStateChanged(
                articleId = event.articleId,
                feedId = event.feedId,
                read = read,
            ),
        )
        repository.invalidateReadStateCaches(event.articleId)
    }

    private suspend fun reconcileMarkedRead(
        feedIds: Set<String>,
        readScope: com.selffeed.android.network.ReadStateScope,
    ) = withIncomingReadEdits { localEdits ->
        if (feedIds.isEmpty() && (readScope.feedId != null || readScope.categoryId != null)) return@withIncomingReadEdits
        val reconciliation = repository.markCachedArticlesReadByFeeds(feedIds)
        val affectedArticles = items.filter { articleMatchesAffectedFeeds(it, feedIds) }
            .associate { it.id to it.feedId }.toMutableMap()
        selectedArticle?.takeIf { articleMatchesAffectedFeeds(it, feedIds) }?.let {
            affectedArticles[it.id] = it.feedId
        }
        val retainedUnread = reconciliation.unreadArticleFeeds.toMutableMap()
        for ((articleId, feedId) in affectedArticles) {
            when (repository.updateCachedReadState(articleId, true)) {
                true -> retainedUnread.remove(articleId)
                false -> retainedUnread[articleId] = feedId
                null -> if (currentArticleReadState(articleId) == false) retainedUnread[articleId] = feedId
            }
        }

        // Local edits can run during either Room call. Merge them after the
        // last suspension so the receipt cannot overwrite a newer choice.
        val scopedEdits = localEdits.filterValues { feedIds.isEmpty() || it.feedId in feedIds }
        scopedEdits.forEach { (articleId, edit) ->
            if (edit.read) retainedUnread.remove(articleId)
            else edit.feedId?.let { retainedUnread[articleId] = it }
        }
        items = items.map { article ->
            if (articleMatchesAffectedFeeds(article, feedIds)) {
                val read = article.id !in retainedUnread
                rememberArticleReadState(article.id, read)
                article.copy(isRead = read)
            } else article
        }
        selectedArticle = selectedArticle?.let { article ->
            if (articleMatchesAffectedFeeds(article, feedIds)) {
                val read = article.id !in retainedUnread
                rememberArticleReadState(article.id, read)
                article.copy(isRead = read)
            } else article
        }
        _events.emit(
            ArticleFeatureEvent.ScopeMarkedRead(
                feedId = readScope.feedId,
                categoryId = readScope.categoryId,
                affectedFeedIds = feedIds,
                retainedUnreadArticleFeeds = retainedUnread,
            ),
        )
        repository.invalidateReadStateCaches()
    }

    private suspend fun withIncomingReadEdits(block: suspend (MutableMap<String, LocalReadEdit>) -> Unit) {
        incomingReadMutex.withLock {
            val edits = readActions.mapValues { it.value.edit }.toMutableMap()
            incomingLocalEdits = edits
            try { block(edits) } finally { incomingLocalEdits = null }
        }
    }

    private fun currentArticleReadState(articleId: String): Boolean? =
        selectedArticle?.takeIf { it.id == articleId }?.isRead
            ?: items.firstOrNull { it.id == articleId }?.isRead
            ?: knownArticleReadStates()[articleId]

    private fun currentFeedId(articleId: String): String? =
        selectedArticle?.takeIf { it.id == articleId }?.feedId
            ?: items.firstOrNull { it.id == articleId }?.feedId

    private fun articleMatchesAffectedFeeds(article: ArticleListItem, affectedFeedIds: Set<String>): Boolean =
        affectedFeedIds.isEmpty() || article.feedId in affectedFeedIds

    private fun articleMatchesAffectedFeeds(article: ArticleDetail, affectedFeedIds: Set<String>): Boolean =
        affectedFeedIds.isEmpty() || article.feedId in affectedFeedIds

    private fun rememberArticleReadState(articleId: String, isRead: Boolean) {
        readStateStore.remember(articleId, isRead)
    }

    private companion object {
        const val TAG = "ReadStateManager"
        const val READ_STATE_SYNC_RESTART_DELAY_MS = 10_000L
    }
}

enum class ReadStateChangeSource(val apiValue: String) {
    Manual("manual"),
    AutoOpen("auto_open"),
    ;

    val isAutomatic: Boolean
        get() = this != Manual
}

private fun List<ArticleListItem>.withReadState(articleId: String, isRead: Boolean): List<ArticleListItem> =
    map { article -> if (article.id == articleId) article.copy(isRead = isRead) else article }

private fun ArticleDetail.withReadState(articleId: String, isRead: Boolean): ArticleDetail =
    if (id == articleId) copy(isRead = isRead) else this
