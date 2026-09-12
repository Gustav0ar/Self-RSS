package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.selffeed.android.R
import com.selffeed.android.data.repository.LibraryCounts
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.OpmlExportStore
import com.selffeed.android.data.PreparedOpmlExport
import com.selffeed.android.data.CategoryMoveDirection
import com.selffeed.android.data.categoryMoveUpdates
import com.selffeed.android.data.applyCategoryOrder
import com.selffeed.android.data.repository.FeedRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.CreateCategoryRequest
import com.selffeed.android.network.CreateFeedRequest
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.SyncRun
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import com.selffeed.android.ui.screens.OpmlDocumentReader
import kotlinx.coroutines.isActive
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

data class FeedsUiState(
    val loading: Boolean = false,
    val reorderingCategories: Boolean = false,
    val categories: List<CategoryWithCounts> = emptyList(),
    val feeds: List<FeedWithCounts> = emptyList(),
    val lastSyncSummary: SyncResponse? = null,
    val syncRevision: Long = 0L,
    val articleRevision: Long = 0L,
    val syncInBackground: Boolean = false,
    val syncTotalFeeds: Int = 0,
    val syncCompletedFeeds: Int = 0,
    val syncNewArticles: Int = 0,
    val syncStatus: FeedSyncAllStatus? = null,
    val lifecycleActionFeedId: String? = null,
    val lastImportSummary: OpmlImportSummary? = null,
    val importReadError: PresentationText? = null,
    val errorMessage: PresentationText? = null,
    val statusMessage: PresentationText? = null,
    val externalFeedUrl: String? = null,
    val syncHistoryByFeed: Map<String, List<SyncRun>> = emptyMap(),
    val syncHistoryLoadingFeedId: String? = null,
    val syncHistoryErrorByFeed: Map<String, PresentationText> = emptyMap(),
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
    private val opmlReader: OpmlDocumentReader,
    private val opmlExportStore: OpmlExportStore,
) : ViewModel() {
    private val _state = MutableStateFlow(FeedsUiState())
    val state: StateFlow<FeedsUiState> = _state.asStateFlow()
    private val _opmlExports = MutableStateFlow<PreparedOpmlExport?>(null)
    val opmlExports: StateFlow<PreparedOpmlExport?> = _opmlExports.asStateFlow()
    private val syncMonitorRequests = Channel<Unit>(Channel.CONFLATED)
    private var syncSubmission: Job? = null
    private var syncSubmissionRevision = 0L
    private val healthReads = Mutex()
    private var categoryLoadRevision = 0L
    private var categoryReloadPending = false
    private var importJob: Job? = null
    private var exportJob: Job? = null

    private var libraryCounts = LibraryCounts()

    suspend fun observeCountRefreshRequests(onRefresh: () -> Unit) {
        repository.countRefreshRequests().collect { onRefresh() }
    }

    suspend fun observeLibraryCounts() {
        repository.libraryCounts().collect {
            libraryCounts = it
            _state.update { state -> state.withLibraryCounts(libraryCounts) }
        }
    }

    private inline fun updateState(transform: (FeedsUiState) -> FeedsUiState) {
        _state.update { current ->
            val updated = transform(current)
            if (current.feeds === updated.feeds && current.categories === updated.categories) updated
            else updated.withLibraryCounts(libraryCounts)
        }
    }

    fun offerExternalFeed(url: String) {
        updateState { it.copy(externalFeedUrl = url) }
    }

    fun consumeExternalFeed() {
        updateState { it.copy(externalFeedUrl = null) }
    }

    fun loadFeedSyncHistory(feedId: String) {
        viewModelScope.launch {
            updateState {
                it.copy(
                    syncHistoryLoadingFeedId = feedId,
                    syncHistoryErrorByFeed = it.syncHistoryErrorByFeed - feedId,
                )
            }
            when (val result = repository.feedSyncHistory(feedId)) {
                is AppResult.Success -> updateState {
                    it.copy(
                        syncHistoryByFeed = it.syncHistoryByFeed + (feedId to result.data.runs),
                        syncHistoryLoadingFeedId = null,
                    )
                }
                is AppResult.Error -> updateState {
                    it.copy(
                        syncHistoryLoadingFeedId = null,
                        syncHistoryErrorByFeed = it.syncHistoryErrorByFeed +
                            (feedId to PresentationText.dynamic(result.message)),
                    )
                }
            }
        }
    }

    fun loadCategories() {
        viewModelScope.launch { refreshCategories() }
    }

    suspend fun refreshCategories() {
        if (_state.value.reorderingCategories) {
            categoryReloadPending = true
            return
        }
        val revision = ++categoryLoadRevision
        repository.categoryUpdates().collect { result ->
            if (revision == categoryLoadRevision) {
                when (result) {
                    is AppResult.Success -> updateState {
                        it.copy(categories = result.data)
                    }
                    is AppResult.Error -> updateState {
                        it.copy(errorMessage = PresentationText.dynamic(result.message))
                    }
                }
            }
        }
    }

    fun loadFeeds() {
        viewModelScope.launch { refreshFeedHealth() }
    }

    suspend fun refreshFeedHealth() = healthReads.withLock {
        repository.feedUpdates().collect { result ->
            when (result) {
                is AppResult.Success -> updateState {
                    it.copy(feeds = result.data)
                }
                // Health polling must preserve a usable cached drawer during network failure.
                is AppResult.Error -> Unit
            }
        }
    }

    /** The visible host owns both loops and their actual requests. Queue submission is separate. */
    suspend fun observeForeground() = coroutineScope {
        launch {
            while (currentCoroutineContext().isActive) {
                delay(FEED_HEALTH_INTERVAL_MS)
                refreshFeedHealth()
            }
        }
        // A queued refresh from the background is covered by the immediate reconciliation.
        syncMonitorRequests.tryReceive()
        while (currentCoroutineContext().isActive) {
            reconcileSyncStatus()
            withTimeoutOrNull(FEED_HEALTH_INTERVAL_MS) { syncMonitorRequests.receive() }
        }
    }

    /** Restores refresh UX for work started by another client or WorkManager. */
    suspend fun reconcileSyncStatus() {
        if (syncSubmission != null) return
        val revision = syncSubmissionRevision
        val status = repository.syncAllFeedsStatus()
        if (syncSubmission != null || revision != syncSubmissionRevision) return
        when (status) {
            is AppResult.Success -> {
                if (status.data.stale) {
                    updateState {
                        it.copy(
                            loading = false,
                            syncInBackground = false,
                            syncStatus = status.data,
                            statusMessage = PresentationText.resource(R.string.feeds_sync_stale),
                        )
                    }
                    return
                }
                if (status.data.active) {
                    monitorQueuedSync(status)
                } else if (_state.value.syncInBackground || _state.value.syncStatus?.active == true) {
                    publishCompletedSync(status.data)
                }
            }
            // Existing offline/error UX remains authoritative when the server is unreachable.
            is AppResult.Error -> if (_state.value.syncInBackground) monitorQueuedSync(status)
        }
    }

    fun moveCategory(id: String, direction: CategoryMoveDirection) {
        if (_state.value.reorderingCategories) return
        val updates = categoryMoveUpdates(_state.value.categories, id, direction) ?: return
        categoryLoadRevision++
        updateState { it.copy(reorderingCategories = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                when (val result = repository.reorderCategories(updates)) {
                    is AppResult.Success -> updateState {
                        it.copy(
                            categories = applyCategoryOrder(it.categories, updates),
                            statusMessage = PresentationText.resource(
                                if (direction == CategoryMoveDirection.UP) R.string.feeds_category_moved_up
                                else R.string.feeds_category_moved_down,
                            ),
                        )
                    }
                    is AppResult.Error -> updateState {
                        it.copy(errorMessage = PresentationText.dynamic(result.message))
                    }
                }
            } finally {
                updateState { it.copy(reorderingCategories = false) }
                if (categoryReloadPending) {
                    categoryReloadPending = false
                    loadCategories()
                }
            }
        }
    }

    fun createCategory(name: String, parentCategoryId: String? = null) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.createCategory(name.trim(), parentCategoryId)) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(statusMessage = PresentationText.resource(R.string.feeds_category_created))
                    }
                    loadCategories()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun updateCategory(id: String, name: String, parentCategoryId: String? = null) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.updateCategory(id, name.trim(), parentCategoryId)) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(statusMessage = PresentationText.resource(R.string.feeds_category_updated))
                    }
                    loadCategories()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun deleteCategory(id: String) {
        viewModelScope.launch {
            when (val result = repository.deleteCategory(id)) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(statusMessage = PresentationText.resource(R.string.feeds_category_deleted))
                    }
                    loadCategories()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun createFeed(feedUrl: String, categoryId: String, title: String?) {
        if (feedUrl.isBlank()) return
        viewModelScope.launch {
            val destinationCategoryId = if (categoryId.isBlank()) {
                // Canonical persisted server value, not display-only copy. It
                // must remain locale-independent to avoid duplicate defaults.
                when (val result = repository.createCategory("Uncategorized", null)) {
                    is AppResult.Success -> result.data.id
                    is AppResult.Error -> {
                        updateState { it.copy(errorMessage = PresentationText.dynamic(result.message)) }
                        return@launch
                    }
                }
            } else categoryId
            when (val result = repository.createFeed(feedUrl.trim(), destinationCategoryId, title?.trim()?.ifBlank { null })) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(
                            statusMessage = PresentationText.resource(
                                if (result.data.lifecycleStatus == "pending") {
                                    R.string.feeds_created_validation_queued
                                } else {
                                    R.string.feeds_created
                                },
                            ),
                        )
                    }
                    loadFeeds()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
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
                    updateState {
                        it.copy(
                            statusMessage = PresentationText.resource(
                                if (result.data.lifecycleStatus == "replacement_pending") {
                                    R.string.feeds_updated_validation_queued
                                } else {
                                    R.string.feeds_updated
                                },
                            ),
                        )
                    }
                    loadFeeds()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun deleteFeed(id: String) {
        viewModelScope.launch {
            when (val result = repository.deleteFeed(id)) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(statusMessage = PresentationText.resource(R.string.feeds_removed))
                    }
                    loadFeeds()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun selectDiscoveryCandidate(feedId: String, candidateId: String) {
        if (_state.value.lifecycleActionFeedId != null) return
        viewModelScope.launch {
            updateState { it.copy(lifecycleActionFeedId = feedId, errorMessage = null) }
            when (val result = repository.selectDiscoveryCandidate(candidateId)) {
                is AppResult.Success -> updateState { state ->
                    state.copy(
                        lifecycleActionFeedId = null,
                        feeds = state.feeds.map { if (it.id == feedId) result.data else it },
                        statusMessage = PresentationText.resource(R.string.feeds_selected_validation_queued),
                    )
                }
                is AppResult.Error -> updateState {
                    it.copy(
                        lifecycleActionFeedId = null,
                        errorMessage = PresentationText.dynamic(result.message),
                    )
                }
            }
        }
    }

    fun cancelFeedReplacement(feedId: String) {
        if (_state.value.lifecycleActionFeedId != null) return
        viewModelScope.launch {
            updateState { it.copy(lifecycleActionFeedId = feedId, errorMessage = null) }
            when (val result = repository.cancelFeedReplacement(feedId)) {
                is AppResult.Success -> updateState { state ->
                    state.copy(
                        lifecycleActionFeedId = null,
                        feeds = state.feeds.map { if (it.id == feedId) result.data else it },
                        statusMessage = PresentationText.resource(R.string.feeds_replacement_cancelled),
                    )
                }
                is AppResult.Error -> updateState {
                    it.copy(
                        lifecycleActionFeedId = null,
                        errorMessage = PresentationText.dynamic(result.message),
                    )
                }
            }
        }
    }

    fun syncAllFeeds(feedId: String? = null, categoryId: String? = null) {
        if (syncSubmission != null) return
        if (refreshScopesOverlap(feedId, categoryId, _state.value.syncStatus, _state.value.feeds)) {
            updateState {
                it.copy(statusMessage = backgroundSyncMessage(it.syncCompletedFeeds, it.syncTotalFeeds))
            }
            return
        }
        if (_state.value.syncInBackground) {
            updateState {
                it.copy(
                    statusMessage = backgroundSyncMessage(
                        completed = it.syncCompletedFeeds,
                        total = it.syncTotalFeeds,
                    ),
                )
            }
            return
        }
        val submission = viewModelScope.launch(start = CoroutineStart.LAZY) {
            updateState { it.copy(loading = true, errorMessage = null) }
            val queueRequest = async { repository.syncAllFeeds(feedId, categoryId) }
            val result = withTimeoutOrNull(REFRESH_QUEUE_TIMEOUT_MS) {
                queueRequest.await()
            }
            if (result == null) {
                // The queue endpoint is intentionally tiny, but a saturated
                // VPS can still delay the response. Release pull-to-refresh,
                // but keep the request alive so a slow response cannot silently
                // cancel the refresh the user explicitly requested.
                updateState {
                    it.copy(
                        loading = false,
                        syncInBackground = true,
                        statusMessage = PresentationText.resource(R.string.feeds_sync_checking),
                    )
                }
                when (val eventualResult = queueRequest.await()) {
                    is AppResult.Success -> {
                        updateState {
                            it.copy(
                                lastSyncSummary = eventualResult.data,
                                statusMessage = PresentationText.resource(R.string.feeds_sync_background),
                            )
                        }
                    }
                    is AppResult.Error -> updateState {
                        it.copy(
                            syncInBackground = false,
                            errorMessage = PresentationText.dynamic(eventualResult.message),
                        )
                    }
                }
                return@launch
            }
            when (result) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(
                            loading = false,
                            syncInBackground = true,
                            syncTotalFeeds = 0,
                            syncCompletedFeeds = 0,
                            syncNewArticles = 0,
                            lastSyncSummary = result.data,
                            statusMessage = PresentationText.resource(R.string.feeds_sync_background),
                        )
                    }
                }
                is AppResult.Error -> updateState {
                    it.copy(
                        loading = false,
                        errorMessage = PresentationText.dynamic(result.message),
                    )
                }
            }
        }
        syncSubmission = submission
        syncSubmissionRevision++
        submission.invokeOnCompletion {
            if (syncSubmission === submission) syncSubmission = null
            if (!submission.isCancelled && _state.value.syncInBackground) syncMonitorRequests.trySend(Unit)
        }
        submission.start()
    }

    private fun publishActiveSync(status: FeedSyncAllStatus) {
        updateState {
            it.copy(
                loading = false,
                syncInBackground = true,
                syncTotalFeeds = status.totalFeeds,
                syncCompletedFeeds = status.completedFeeds,
                syncNewArticles = status.newArticles,
                syncStatus = status,
                statusMessage = backgroundSyncMessage(status.completedFeeds, status.totalFeeds),
            )
        }
        if (status.articleRevision > _state.value.articleRevision) {
            updateState { it.copy(articleRevision = status.articleRevision) }
        }
    }

    private suspend fun monitorQueuedSync(initial: AppResult<FeedSyncAllStatus>) {
        var poll = 0
        var elapsedMs = 0L
        var reportedLongRunningSync = false
        var nextStatus = initial
        while (currentCoroutineContext().isActive) {
            if (elapsedMs >= SYNC_STATUS_MAX_MONITOR_MS) {
                updateState {
                    it.copy(
                        loading = false,
                        syncInBackground = false,
                        statusMessage = PresentationText.resource(R.string.feeds_sync_continues),
                    )
                }
                return
            }
            when (val status = nextStatus) {
                is AppResult.Success -> {
                    if (status.data.stale) {
                        updateState {
                            it.copy(
                                syncInBackground = false,
                                syncStatus = status.data,
                                statusMessage = PresentationText.resource(R.string.feeds_sync_stale),
                            )
                        }
                        return
                    }
                    if (!status.data.active) {
                        publishCompletedSync(status.data)
                        refreshFeedHealth()
                        return
                    }
                    publishActiveSync(status.data)
                }
                is AppResult.Error -> {
                    // A transient status request must not make an active backend
                    // refresh disappear from the UI. Keep the animation visible
                    // and retry within the bounded backend deadline.
                    updateState {
                        it.copy(
                            loading = false,
                            syncInBackground = true,
                            statusMessage = PresentationText.resource(R.string.feeds_sync_background),
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
                updateState {
                    it.copy(statusMessage = PresentationText.resource(R.string.feeds_sync_slow))
                }
            }
            val delayMs = if (poll < SYNC_STATUS_MAX_FAST_POLLS) {
                SYNC_STATUS_FAST_POLL_MS
            } else {
                SYNC_STATUS_SLOW_POLL_MS
            }
            val boundedDelayMs = minOf(delayMs, SYNC_STATUS_MAX_MONITOR_MS - elapsedMs)
            delay(boundedDelayMs)
            elapsedMs += boundedDelayMs
            if (elapsedMs < SYNC_STATUS_MAX_MONITOR_MS) nextStatus = repository.syncAllFeedsStatus()
        }
    }

    private fun completedSyncMessage(status: FeedSyncAllStatus): PresentationText {
        val outcomes = buildList {
            if (status.newArticles > 0) {
                add(PresentationText.plural(R.plurals.feeds_sync_new_articles, status.newArticles))
            }
            if (status.failedFeeds > 0) {
                add(PresentationText.plural(R.plurals.feeds_sync_failed_feeds, status.failedFeeds))
            }
            if (status.skippedFeeds > 0) {
                add(PresentationText.plural(R.plurals.feeds_sync_skipped_feeds, status.skippedFeeds))
            }
        }
        return if (outcomes.isEmpty()) {
            PresentationText.resource(R.string.feeds_up_to_date)
        } else {
            PresentationText.joined(outcomes)
        }
    }

    private fun publishCompletedSync(status: FeedSyncAllStatus) {
        updateState {
            it.copy(
                loading = false,
                syncInBackground = false,
                syncRevision = it.syncRevision + 1,
                syncTotalFeeds = status.totalFeeds,
                syncCompletedFeeds = status.completedFeeds,
                syncNewArticles = status.newArticles,
                syncStatus = status,
                statusMessage = completedSyncMessage(status),
            )
        }
    }

    private companion object {
        const val FEED_HEALTH_INTERVAL_MS = 60_000L
        const val SYNC_STATUS_FAST_POLL_MS = 750L
        const val SYNC_STATUS_SLOW_POLL_MS = 10_000L
        const val SYNC_STATUS_MAX_FAST_POLLS = 8
        const val SYNC_STATUS_MAX_MONITOR_MS = 5 * 60_000L + 30_000L
        const val REFRESH_QUEUE_TIMEOUT_MS = 4_000L

        fun backgroundSyncMessage(completed: Int, total: Int): PresentationText =
            if (total > 0) {
                PresentationText.resource(R.string.feeds_sync_background_progress, completed, total)
            } else {
                PresentationText.resource(R.string.feeds_sync_background)
            }
    }

    fun importOpml(uri: Uri) {
        importJob?.cancel()
        updateState { it.copy(importReadError = null) }
        importJob = viewModelScope.launch {
            val file = opmlReader.read(uri)
            currentCoroutineContext().ensureActive()
            if (file == null) {
                updateState { it.copy(importReadError = PresentationText.resource(R.string.feeds_read_opml_error)) }
                return@launch
            }
            val result = repository.importOpml(file.fileName, file.bytes)
            currentCoroutineContext().ensureActive()
            when (result) {
                is AppResult.Success -> {
                    updateState {
                        it.copy(
                            lastImportSummary = result.data,
                            statusMessage = PresentationText.resource(
                                R.string.feeds_import_status,
                                result.data.createdFeeds,
                                result.data.createdCategories,
                            ),
                        )
                    }
                    loadCategories()
                    loadFeeds()
                }
                is AppResult.Error -> updateState {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun exportOpml() {
        if (exportJob?.isActive == true || _opmlExports.value != null) return
        exportJob = viewModelScope.launch {
            var prepared: PreparedOpmlExport? = null
            try {
                val result = repository.exportOpml()
                currentCoroutineContext().ensureActive()
                when (result) {
                    is AppResult.Success -> {
                        prepared = opmlExportStore.prepare(result.data)
                        currentCoroutineContext().ensureActive()
                        _opmlExports.value = prepared
                        prepared = null // Ownership transfers to the pending screen state.
                    }
                    is AppResult.Error -> updateState {
                        it.copy(errorMessage = PresentationText.dynamic(result.message))
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                showExportFailure()
            } finally {
                prepared?.let { opmlExportStore.release(it, shared = false) }
            }
        }
    }

    /** Refresh retention before a chooser can background the process. */
    suspend fun prepareOpmlHandoff(export: PreparedOpmlExport): Boolean {
        if (_opmlExports.value !== export) return false
        return try {
            opmlExportStore.renewRetention(export)
            currentCoroutineContext().ensureActive()
            _opmlExports.value === export
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            completeOpmlExport(export, shared = false)
            false
        }
    }

    /** The resumed screen acknowledges this exact file after its synchronous chooser launch. */
    fun completeOpmlExport(export: PreparedOpmlExport, shared: Boolean) {
        if (_opmlExports.value !== export) return
        _opmlExports.value = null
        opmlExportStore.release(export, shared)
        if (shared) {
            updateState { it.copy(statusMessage = PresentationText.resource(R.string.feeds_export_ready)) }
        } else {
            showExportFailure()
        }
    }

    private fun showExportFailure() {
        updateState { it.copy(errorMessage = PresentationText.resource(R.string.feeds_export_error)) }
    }

    override fun onCleared() {
        _opmlExports.value?.let { opmlExportStore.release(it, shared = false) }
        _opmlExports.value = null
    }

    fun dismissImportSummary() {
        updateState { it.copy(lastImportSummary = null) }
    }

    fun dismissImportReadError() {
        updateState { it.copy(importReadError = null) }
    }

    fun clearMessages() {
        updateState { it.copy(errorMessage = null, statusMessage = null) }
    }


}

internal fun refreshScopesOverlap(
    feedId: String?,
    categoryId: String?,
    status: FeedSyncAllStatus?,
    feeds: List<FeedWithCounts>,
): Boolean {
    if (status?.active != true) return false
    val active = status.scope
    if (active.feedId == null && active.categoryId == null) return true
    if (feedId == null && categoryId == null) return true
    if (feedId != null && active.feedId != null) return feedId == active.feedId
    if (categoryId != null && active.categoryId != null) return categoryId == active.categoryId
    val comparedFeedId = feedId ?: active.feedId
    val comparedCategoryId = categoryId ?: active.categoryId
    return feeds.any { it.id == comparedFeedId && it.categoryId == comparedCategoryId }
}
