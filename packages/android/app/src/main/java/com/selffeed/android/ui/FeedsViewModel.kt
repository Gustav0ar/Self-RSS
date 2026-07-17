package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.FeedRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.CreateCategoryRequest
import com.selffeed.android.network.CreateFeedRequest
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

data class FeedsUiState(
    val loading: Boolean = false,
    val categories: List<CategoryWithCounts> = emptyList(),
    val feeds: List<FeedWithCounts> = emptyList(),
    val lastSyncSummary: SyncResponse? = null,
    val syncRevision: Long = 0L,
    val articleRevision: Long = 0L,
    val syncInBackground: Boolean = false,
    val syncTotalFeeds: Int = 0,
    val syncCompletedFeeds: Int = 0,
    val syncNewArticles: Int = 0,
    val lastImportSummary: OpmlImportSummary? = null,
    val errorMessage: String? = null,
    val statusMessage: String? = null,
)

/**
 * Owns the Feeds drawer: categories, feeds, category CRUD, feed CRUD, sync,
 * and OPML import/export. Read paths mirror the relevant subset of
 * the app shell consumes this ViewModel through a focused state/actions
 * contract instead of routing feed operations through a root ViewModel.
 */
@HiltViewModel
class FeedsViewModel @Inject constructor(
    private val repository: FeedRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(FeedsUiState())
    val state: StateFlow<FeedsUiState> = _state.asStateFlow()
    private val _opmlExports = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val opmlExports: SharedFlow<String> = _opmlExports.asSharedFlow()
    private var syncMonitorJob: Job? = null

    fun loadCategories() {
        viewModelScope.launch {
            when (val result = repository.categories()) {
                is AppResult.Success -> _state.update { it.copy(categories = result.data) }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadFeeds() {
        viewModelScope.launch {
            when (val result = repository.feeds(null)) {
                is AppResult.Success -> _state.update { it.copy(feeds = result.data) }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun refreshFeedHealth() {
        viewModelScope.launch {
            when (val result = repository.refreshFeeds(null)) {
                is AppResult.Success -> _state.update { it.copy(feeds = result.data) }
                // Background health polling must not replace an otherwise
                // usable cached drawer with a global connection error.
                is AppResult.Error -> Unit
            }
        }
    }

    /** Restores refresh UX for work started by another client or WorkManager. */
    fun reconcileSyncStatus() {
        if (_state.value.loading || syncMonitorJob?.isActive == true) return
        viewModelScope.launch {
            when (val status = repository.syncAllFeedsStatus()) {
                is AppResult.Success -> {
                    if (status.data.stale) {
                        _state.update {
                            it.copy(
                                loading = false,
                                syncInBackground = false,
                                errorMessage = "Feed sync stalled. Please try again.",
                            )
                        }
                        return@launch
                    }
                    if (status.data.active) {
                        publishActiveSync(status.data)
                        startSyncMonitor()
                    }
                }
                // This is background reconciliation. Existing offline/error UX
                // remains authoritative when the server cannot be reached.
                is AppResult.Error -> Unit
            }
        }
    }

    fun createCategory(name: String, parentCategoryId: String? = null) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.createCategory(name.trim(), parentCategoryId)) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Category created") }
                    loadCategories()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateCategory(id: String, name: String, parentCategoryId: String? = null) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.updateCategory(id, name.trim(), parentCategoryId)) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Category updated") }
                    loadCategories()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun deleteCategory(id: String) {
        viewModelScope.launch {
            when (val result = repository.deleteCategory(id)) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Category deleted") }
                    loadCategories()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun createFeed(feedUrl: String, categoryId: String, title: String?) {
        if (feedUrl.isBlank()) return
        viewModelScope.launch {
            val destinationCategoryId = if (categoryId.isBlank()) {
                when (val result = repository.createCategory("Uncategorized", null)) {
                    is AppResult.Success -> result.data.id
                    is AppResult.Error -> {
                        _state.update { it.copy(errorMessage = result.message) }
                        return@launch
                    }
                }
            } else categoryId
            when (val result = repository.createFeed(feedUrl.trim(), destinationCategoryId, title?.trim()?.ifBlank { null })) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Feed added") }
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateFeed(id: String, feedUrl: String, title: String?, categoryId: String?, pollingIntervalMinutes: Int?) {
        if (feedUrl.isBlank()) return
        viewModelScope.launch {
            when (
                val result = repository.updateFeed(
                    id = id,
                    feedUrl = feedUrl.trim(),
                    categoryId = categoryId,
                    title = title?.trim()?.ifBlank { null },
                    pollingIntervalMinutes = pollingIntervalMinutes,
                )
            ) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Feed updated") }
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun deleteFeed(id: String) {
        viewModelScope.launch {
            when (val result = repository.deleteFeed(id)) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Feed removed") }
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun syncAllFeeds(feedId: String? = null, categoryId: String? = null) {
        if (_state.value.loading) return
        if (_state.value.syncInBackground) {
            _state.update {
                it.copy(
                    statusMessage = backgroundSyncMessage(
                        completed = it.syncCompletedFeeds,
                        total = it.syncTotalFeeds,
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(loading = true, errorMessage = null) }
            val queueRequest = async { repository.syncAllFeeds(feedId, categoryId) }
            val result = withTimeoutOrNull(REFRESH_QUEUE_TIMEOUT_MS) {
                queueRequest.await()
            }
            if (result == null) {
                // The queue endpoint is intentionally tiny, but a saturated
                // VPS can still delay the response. Release pull-to-refresh,
                // but keep the request alive so a slow response cannot silently
                // cancel the refresh the user explicitly requested.
                _state.update {
                    it.copy(
                        loading = false,
                        syncInBackground = true,
                        statusMessage = "Checking background refresh",
                    )
                }
                when (val eventualResult = queueRequest.await()) {
                    is AppResult.Success -> {
                        _state.update {
                            it.copy(
                                lastSyncSummary = eventualResult.data,
                                statusMessage = "Refreshing feeds in the background",
                            )
                        }
                        startSyncMonitor()
                    }
                    is AppResult.Error -> _state.update {
                        it.copy(
                            syncInBackground = false,
                            errorMessage = eventualResult.message,
                        )
                    }
                }
                return@launch
            }
            when (result) {
                is AppResult.Success -> {
                    _state.update {
                        it.copy(
                            loading = false,
                            syncInBackground = true,
                            syncTotalFeeds = 0,
                            syncCompletedFeeds = 0,
                            syncNewArticles = 0,
                            lastSyncSummary = result.data,
                            statusMessage = "Refreshing feeds in the background",
                        )
                    }
                    startSyncMonitor()
                }
                is AppResult.Error -> _state.update { it.copy(loading = false, errorMessage = result.message) }
            }
        }
    }

    private fun startSyncMonitor() {
        if (syncMonitorJob?.isActive == true) return
        syncMonitorJob = viewModelScope.launch { monitorQueuedSync() }
    }

    private fun publishActiveSync(status: FeedSyncAllStatus) {
        _state.update {
            it.copy(
                loading = false,
                syncInBackground = true,
                syncTotalFeeds = status.totalFeeds,
                syncCompletedFeeds = status.completedFeeds,
                syncNewArticles = status.newArticles,
                statusMessage = backgroundSyncMessage(status.completedFeeds, status.totalFeeds),
            )
        }
        if (status.articleRevision > _state.value.articleRevision) {
            _state.update { it.copy(articleRevision = status.articleRevision) }
        }
    }

    private suspend fun monitorQueuedSync() {
        var poll = 0
        var elapsedMs = 0L
        var reportedLongRunningSync = false
        while (currentCoroutineContext().isActive) {
            if (elapsedMs >= SYNC_STATUS_MAX_MONITOR_MS) {
                _state.update {
                    it.copy(
                        loading = false,
                        syncInBackground = false,
                        errorMessage = "Feed refresh status timed out. Please try again.",
                    )
                }
                return
            }
            when (val status = repository.syncAllFeedsStatus()) {
                is AppResult.Success -> {
                    if (status.data.stale) {
                        _state.update {
                            it.copy(
                                syncInBackground = false,
                                errorMessage = "Feed sync stalled. Please try again.",
                            )
                        }
                        return
                    }
                    if (!status.data.active) {
                        _state.update {
                            it.copy(
                                syncInBackground = false,
                                syncRevision = it.syncRevision + 1,
                                statusMessage = if (status.data.newArticles > 0) {
                                    "${status.data.newArticles} new articles"
                                } else {
                                    "Feeds are up to date"
                                },
                            )
                        }
                        refreshFeedHealth()
                        return
                    }
                    publishActiveSync(status.data)
                }
                is AppResult.Error -> {
                    // A transient status request must not make an active backend
                    // refresh disappear from the UI. Keep the animation visible
                    // and retry within the bounded backend deadline.
                    _state.update {
                        it.copy(
                            loading = false,
                            syncInBackground = true,
                            statusMessage = "Refreshing feeds in the background",
                        )
                    }
                }
            }

            poll += 1
            // Fast polling keeps normal pull-to-refresh responsive. A very
            // large feed collection can legitimately take longer, so keep
            // monitoring at a lower cadence instead of losing the completion
            // signal and leaving the list stale.
            if (poll == SYNC_STATUS_MAX_FAST_POLLS && !reportedLongRunningSync) {
                reportedLongRunningSync = true
                _state.update { it.copy(statusMessage = "Feed refresh is taking longer than usual") }
            }
            val delayMs = if (poll < SYNC_STATUS_MAX_FAST_POLLS) {
                SYNC_STATUS_FAST_POLL_MS
            } else {
                SYNC_STATUS_SLOW_POLL_MS
            }
            val boundedDelayMs = minOf(delayMs, SYNC_STATUS_MAX_MONITOR_MS - elapsedMs)
            delay(boundedDelayMs)
            elapsedMs += boundedDelayMs
        }
    }

    private companion object {
        const val SYNC_STATUS_FAST_POLL_MS = 750L
        const val SYNC_STATUS_SLOW_POLL_MS = 10_000L
        const val SYNC_STATUS_MAX_FAST_POLLS = 400
        const val SYNC_STATUS_MAX_MONITOR_MS = 5 * 60_000L + 30_000L
        const val REFRESH_QUEUE_TIMEOUT_MS = 4_000L

        fun backgroundSyncMessage(completed: Int, total: Int): String =
            if (total > 0) "Refreshing feeds in background · $completed/$total"
            else "Refreshing feeds in background"
    }

    fun applyUnreadDelta(feedId: String?, unreadDelta: Int) {
        if (feedId == null || unreadDelta == 0) return
        _state.update { state ->
            val feed = state.feeds.firstOrNull { it.id == feedId }
            state.copy(
                feeds = UnreadStateReducer.applyFeedDelta(state.feeds, feedId, unreadDelta),
                categories = feed?.let {
                    UnreadStateReducer.applyCategoryDelta(state.categories, it.categoryId, unreadDelta)
                } ?: state.categories,
            )
        }
    }

    fun applyScopeMarkedRead(feedId: String?, categoryId: String?, affectedFeedIds: Set<String>) {
        _state.update { state ->
            val targetFeedIds = when {
                affectedFeedIds.isNotEmpty() -> affectedFeedIds
                feedId != null -> setOf(feedId)
                categoryId != null -> {
                    val categoryIds = descendantCategoryIds(state.categories, categoryId)
                    state.feeds.filter { it.categoryId in categoryIds }.map { it.id }.toSet()
                }
                else -> state.feeds.map { it.id }.toSet()
            }
            val categoryDeltas = state.feeds
                .filter { it.id in targetFeedIds && it.unreadCount > 0 }
                .groupBy { it.categoryId }
                .mapValues { (_, feeds) -> -feeds.sumOf { it.unreadCount } }
            val shouldClearAllCategories = feedId == null && categoryId == null && affectedFeedIds.isEmpty()

            state.copy(
                feeds = state.feeds.map { feed ->
                    if (feed.id in targetFeedIds) feed.copy(unreadCount = 0) else feed
                },
                categories = if (shouldClearAllCategories) {
                    UnreadStateReducer.clearCategoryUnreadCounts(state.categories)
                } else {
                    UnreadStateReducer.applyCategoryDeltas(state.categories, categoryDeltas)
                },
            )
        }
    }

    fun importOpml(fileName: String, fileBytes: ByteArray) {
        viewModelScope.launch {
            when (val result = repository.importOpml(fileName, fileBytes)) {
                is AppResult.Success -> {
                    _state.update {
                        it.copy(
                            lastImportSummary = result.data,
                            statusMessage = "OPML imported: ${result.data.createdFeeds} feeds, ${result.data.createdCategories} categories",
                        )
                    }
                    loadCategories()
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun exportOpml() {
        viewModelScope.launch {
            when (val result = repository.exportOpml()) {
                is AppResult.Success -> {
                    _opmlExports.emit(result.data)
                    _state.update { it.copy(statusMessage = "OPML export is ready to share") }
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun dismissImportSummary() {
        _state.update { it.copy(lastImportSummary = null) }
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, statusMessage = null) }
    }

    private fun descendantCategoryIds(categories: List<CategoryWithCounts>, categoryId: String): Set<String> {
        val ids = mutableSetOf<String>()
        fun visit(category: CategoryWithCounts) {
            if (!ids.add(category.id)) return
            category.children.orEmpty().forEach(::visit)
        }

        fun findAndVisit(nodes: List<CategoryWithCounts>): Boolean {
            for (node in nodes) {
                if (node.id == categoryId) {
                    visit(node)
                    return true
                }
                if (findAndVisit(node.children.orEmpty())) return true
            }
            return false
        }

        return if (findAndVisit(categories)) ids else setOf(categoryId)
    }
}
