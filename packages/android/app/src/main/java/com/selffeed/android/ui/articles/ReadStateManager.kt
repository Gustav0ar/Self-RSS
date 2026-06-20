package com.selffeed.android.ui.articles

import android.util.Log
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.ui.ArticleReadStateStore
import com.selffeed.android.ui.ArticleFeatureEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
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
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages article read/unread state, including:
 * - Optimistic UI updates
 * - Server synchronization
 * - SSE event handling
 * - Manually unread tracking
 */
@Singleton
class ReadStateManager @Inject constructor(
    private val repository: SelfFeedRepository,
) {
    private var scope: CoroutineScope? = null

    private val _events = MutableSharedFlow<ArticleFeatureEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<ArticleFeatureEvent> = _events.asSharedFlow()

    val readStateStore = ArticleReadStateStore()
    private val manuallyUnread = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private var readStateSyncJob: Job? = null

    // Internal state holders
    private var currentFeedId: String? = null
    private var currentCategoryId: String? = null
    private var hideRead: Boolean = false
    private var items: List<ArticleListItem> = emptyList()
    private var selectedArticle: ArticleDetail? = null

    fun setScope(scope: CoroutineScope) {
        this.scope = scope
    }

    fun updateScope(feedId: String?, categoryId: String?) {
        currentFeedId = feedId
        currentCategoryId = categoryId
    }

    fun updateFilter(hideRead: Boolean) {
        this.hideRead = hideRead
    }

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
        onOptimisticUpdate: (String, String?, Boolean) -> Unit,
        onError: (String, Boolean?, ArticleDetail?) -> Unit,
        onConfirm: (String, String?, Boolean, Boolean) -> Unit,
    ) {
        if (!read) manuallyUnread.add(articleId) else manuallyUnread.remove(articleId)

        scope?.launch {
            val previousReadState = currentArticleReadState(articleId)
            val previousArticle = selectedArticle?.takeIf { it.id == articleId }
            val feedId = currentFeedId(articleId)

            // Apply optimistic update
            onOptimisticUpdate(articleId, feedId, read)

            when (val result = repository.markRead(articleId, read)) {
                is AppResult.Success -> {
                    val confirmed = result.data
                    rememberArticleReadState(articleId, confirmed)
                    onConfirm(articleId, feedId, confirmed, previousReadState)
                }
                is AppResult.Error -> {
                    // Revert optimistic update
                    onError(articleId, previousReadState, previousArticle)
                }
            }
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
                    onSuccess(selectedFeedId, selectedCategoryId, affectedFeedIds, marked.markedCount)
                }
                is AppResult.Error -> onError(result.message)
            }
        }
    }

    fun startReadStateSync() {
        if (readStateSyncJob?.isActive == true) return
        readStateSyncJob = scope?.launch {
            val job = currentCoroutineContext()[Job]
            while (job?.isActive == true) {
                try {
                    repository.readStateEvents().collect { event ->
                        if (event.clientId != null && event.clientId == repository.clientId()) return@collect
                        applyReadStateSyncEvent(event)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    Log.w(TAG, "Read-state sync collector crashed; restarting", e)
                }
                delay(READ_STATE_SYNC_RESTART_DELAY_MS)
            }
        }
    }

    fun stopReadStateSync() {
        readStateSyncJob?.cancel()
        readStateSyncJob = null
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
            is ArticlesMarkedReadEvent -> applyArticlesMarkedRead(event)
        }
    }

    private suspend fun applyArticleReadStateChanged(event: ArticleReadStateChangedEvent) {
        repository.invalidateReadStateCaches(event.articleId)
        val previous = currentArticleReadState(event.articleId)
        rememberArticleReadState(event.articleId, event.isRead)

        val shouldReload = !event.isRead && hideRead && isFeedVisible(event.feedId) &&
            items.none { it.id == event.articleId }

        items = items.map { if (it.id == event.articleId) it.copy(isRead = event.isRead) else it }
        selectedArticle = selectedArticle?.let { if (it.id == event.articleId) it.copy(isRead = event.isRead) else it }

        val changed = previous?.let { it != event.isRead } ?: true
        val unreadDelta = if (!changed) 0 else if (event.isRead) -1 else 1
        _events.emit(
            ArticleFeatureEvent.ArticleReadStateChanged(
                articleId = event.articleId,
                feedId = event.feedId,
                read = event.isRead,
                unreadDelta = unreadDelta,
                readDelta = if (!changed) 0 else if (event.isRead) 1 else -1,
            ),
        )

        if (shouldReload) {
            _events.emit(
                ArticleFeatureEvent.ScopeMarkedRead(
                    feedId = currentFeedId,
                    categoryId = currentCategoryId,
                    affectedFeedIds = emptySet(),
                    markedCount = 0,
                ),
            )
        }
    }

    private suspend fun applyArticlesMarkedRead(event: ArticlesMarkedReadEvent) {
        repository.invalidateReadStateCaches()
        val feedIds = event.feedIds.toSet()

        items = items.map { article ->
            if (article.feedId in feedIds) {
                rememberArticleReadState(article.id, true)
                article.copy(isRead = true)
            } else {
                article
            }
        }
        selectedArticle = selectedArticle?.let { article ->
            if (article.feedId in feedIds) {
                rememberArticleReadState(article.id, true)
                article.copy(isRead = true)
            } else {
                article
            }
        }
        _events.emit(
            ArticleFeatureEvent.ScopeMarkedRead(
                feedId = event.scope.feedId,
                categoryId = event.scope.categoryId,
                affectedFeedIds = feedIds,
                markedCount = event.markedCount,
            ),
        )
    }

    private fun currentArticleReadState(articleId: String): Boolean? =
        selectedArticle?.takeIf { it.id == articleId }?.isRead
            ?: items.firstOrNull { it.id == articleId }?.isRead
            ?: knownArticleReadStates()[articleId]

    private fun currentFeedId(articleId: String): String? =
        selectedArticle?.takeIf { it.id == articleId }?.feedId
            ?: items.firstOrNull { it.id == articleId }?.feedId

    private fun isFeedVisible(feedId: String): Boolean =
        currentFeedId == null || currentFeedId == feedId

    private fun articleMatchesAffectedFeeds(article: ArticleListItem, affectedFeedIds: Set<String>): Boolean =
        affectedFeedIds.isEmpty() || article.feedId in affectedFeedIds

    private fun articleMatchesAffectedFeeds(article: ArticleDetail, affectedFeedIds: Set<String>): Boolean =
        affectedFeedIds.isEmpty() || article.feedId in affectedFeedIds

    fun rememberArticlesReadState(articles: List<ArticleListItem>, affectedFeedIds: Set<String>) {
        articles
            .filter { articleMatchesAffectedFeeds(it, affectedFeedIds) }
            .forEach { rememberArticleReadState(it.id, true) }
    }

    fun rememberSelectedArticleReadState(affectedFeedIds: Set<String>) {
        selectedArticle
            ?.takeIf { articleMatchesAffectedFeeds(it, affectedFeedIds) }
            ?.let { rememberArticleReadState(it.id, true) }
    }

    private fun rememberArticleReadState(articleId: String, isRead: Boolean) {
        if (articleId in manuallyUnread && isRead) return
        readStateStore.remember(articleId, isRead)
    }

    private companion object {
        const val TAG = "ReadStateManager"
        const val READ_STATE_SYNC_RESTART_DELAY_MS = 10_000L
    }
}
