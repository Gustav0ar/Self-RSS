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
import com.selffeed.android.ui.ArticleFeatureEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Persists local choices and admits remote state through Room. Events carry freshness hints only. */
class ReadStateManager @Inject constructor(private val repository: ArticleRepository) {
    private var scope: CoroutineScope? = null
    private val _events = MutableSharedFlow<ArticleFeatureEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<ArticleFeatureEvent> = _events.asSharedFlow()
    internal val stateProjection = ArticleStateProjection()
    // An explicit session choice must survive scrolling away and returning.
    private val manuallyUnread = mutableSetOf<String>()
    private val readActions = mutableMapOf<String, Job>()
    private var readActionEpoch = 0L
    private var items: List<ArticleListItem> = emptyList()
    private var selectedArticle: ArticleDetail? = null

    fun setScope(scope: CoroutineScope) { this.scope = scope }
    fun updateItems(items: List<ArticleListItem>) { this.items = items }
    fun updateSelectedArticle(article: ArticleDetail?) { selectedArticle = article }

    internal fun retainArticleIds(articleIds: Set<String>) {
        stateProjection.retain(articleIds)
    }

    fun markRead(
        articleId: String,
        read: Boolean,
        source: ReadStateChangeSource,
        onError: () -> Unit,
        onConfirm: (Boolean, Boolean?) -> Unit,
    ) {
        if (source.isAutomatic && read && articleId in manuallyUnread) return
        val actionScope = scope ?: return
        val wasManuallyUnread = articleId in manuallyUnread
        if (source == ReadStateChangeSource.Manual) {
            if (!read) manuallyUnread.add(articleId) else manuallyUnread.remove(articleId)
        }
        val previous = currentReadState(articleId)
        readActionEpoch++
        val action = stateProjection.begin(articleId, ArticleStateProjection.Field.Read, read, previous)
        val job = actionScope.launch(start = CoroutineStart.LAZY) {
            try {
                val result = repository.markRead(articleId, read, source.apiValue)
                if (!isCurrentAction(articleId)) return@launch
                when (result) {
                    is AppResult.Success -> {
                        stateProjection.committed(action, result.data)
                        onConfirm(read, previous)
                    }
                    is AppResult.Error -> {
                        stateProjection.failed(action)
                        if (source == ReadStateChangeSource.Manual) {
                            if (wasManuallyUnread) manuallyUnread.add(articleId) else manuallyUnread.remove(articleId)
                        }
                        onError()
                    }
                }
            } finally {
                if (readActions[articleId] === currentCoroutineContext()[Job]) {
                    readActions.remove(articleId)
                    readActionEpoch++
                    // A completed receipt stays until Room observes it. Cancelled submissions do not.
                    if (action.receiptId == null) stateProjection.failed(action)
                }
            }
        }
        readActions.remove(articleId)?.cancel()
        readActions[articleId] = job
        job.start()
    }

    private suspend fun isCurrentAction(articleId: String): Boolean =
        currentCoroutineContext().isActive && readActions[articleId] === currentCoroutineContext()[Job]

    /** Rejections only request feedback. Observed Room values supply any rollback. */
    suspend fun applyReadRejection(rejection: ReadStateRejection): Boolean {
        while (true) {
            val action = readActions[rejection.articleId]
            if (action != null) { action.join(); continue }
            val epoch = readActionEpoch
            val local = (repository.localArticleState(rejection.articleId) as? AppResult.Success)?.data
            if (epoch != readActionEpoch) continue
            val matches = local?.lastReadMutationId == rejection.mutationId
            if (matches && local?.isRead == null) stateProjection.restartObservation()
            return matches
        }
    }

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
                    val feedIds = marked.feedIds.toSet().ifEmpty { listOfNotNull(selectedFeedId).toSet() }
                    try {
                        if (feedIds.isNotEmpty() || (selectedFeedId == null && selectedCategoryId == null)) {
                            repository.markCachedArticlesReadByFeeds(feedIds)
                        }
                        _events.emit(ArticleFeatureEvent.ArticleStateRefreshRequested)
                        onSuccess(selectedFeedId, selectedCategoryId, feedIds, marked.markedCount)
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

    /** The visible host owns collection; user action jobs keep their separate ViewModel scope. */
    suspend fun observeReadStateSync() {
        while (currentCoroutineContext().isActive) {
            try {
                repository.readStateEvents().collect { event ->
                    if (event.clientId != null && event.clientId == repository.clientId()) return@collect
                    applyReadStateSyncEvent(event)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(TAG, "Read-state sync collector crashed; restarting", error)
            }
            delay(READ_STATE_SYNC_RESTART_DELAY_MS)
        }
    }

    fun clearSessionMemory() {
        manuallyUnread.clear()
        stateProjection.clear()
    }

    fun knownArticleReadStates(): Map<String, Boolean> = stateProjection.flags.value.mapNotNull { (id, state) ->
        state.isRead?.let { id to it }
    }.toMap()

    private fun currentReadState(articleId: String): Boolean? = stateProjection.flags.value[articleId]?.isRead
        ?: selectedArticle?.takeIf { it.id == articleId }?.isRead
        ?: items.firstOrNull { it.id == articleId }?.isRead

    private suspend fun applyReadStateSyncEvent(event: ReadStateSyncEvent) {
        when (event) {
            is ArticleReadStateChangedEvent -> {
                repository.updateCachedReadState(event.articleId, event.isRead, event.revision)
                if (event.revision == null) _events.emit(ArticleFeatureEvent.ArticleStateRefreshRequested)
            }
            is ArticleSavedStateChangedEvent -> {
                repository.updateCachedSavedState(event.articleId, event.isSaved, event.revision)
                // An unseen saved article needs metadata before Room can include it in Saved.
                _events.emit(ArticleFeatureEvent.ArticlesChanged())
            }
            is ArticlesMarkedReadEvent -> {
                val feeds = event.feedIds.toSet()
                if (feeds.isNotEmpty() || (event.scope.feedId == null && event.scope.categoryId == null)) {
                    repository.markCachedArticlesReadByFeeds(feeds)
                }
                _events.emit(ArticleFeatureEvent.ArticleStateRefreshRequested)
            }
            is RealtimeConnectedEvent -> {
                repository.invalidateReadStateCaches()
                // Realtime has no replay, so known flags cannot recover missed list membership.
                _events.emit(ArticleFeatureEvent.ArticlesChanged())
            }
            is ArticlesNewEvent -> {
                repository.invalidateArticleContentCaches()
                _events.emit(ArticleFeatureEvent.ArticlesChanged())
            }
            is ArticleUpdatedEvent -> {
                repository.invalidateArticleContentCaches(event.articleId)
                _events.emit(ArticleFeatureEvent.ArticlesChanged(event.articleId))
            }
        }
    }

    private companion object {
        const val TAG = "ReadStateManager"
        const val READ_STATE_SYNC_RESTART_DELAY_MS = 10_000L
    }
}

enum class ReadStateChangeSource(val apiValue: String) {
    Manual("manual"), AutoOpen("auto_open");
    val isAutomatic: Boolean get() = this != Manual
}
