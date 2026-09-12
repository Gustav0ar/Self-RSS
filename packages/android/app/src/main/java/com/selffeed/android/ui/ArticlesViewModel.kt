package com.selffeed.android.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.R
import androidx.paging.cachedIn
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ArticlePageQuery
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.ui.articles.ArticleWarmingManager
import com.selffeed.android.ui.articles.EnrichmentManager
import com.selffeed.android.ui.articles.ReadStateChangeSource
import com.selffeed.android.ui.articles.ReadStateManager
import com.selffeed.android.ui.articles.withArticleFlags
import com.selffeed.android.ui.articles.ArticleFlags
import com.selffeed.android.ui.articles.ArticleStateProjection
import com.selffeed.android.ui.components.withNonRegressiveReaderContent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject

data class ArticlesUiState(
    val items: List<ArticleListItem> = emptyList(),
    val articleStates: Map<String, ArticleFlags> = emptyMap(),
    val readerQueue: List<ArticleListItem> = emptyList(),
    val readerQueueTracksPaging: Boolean = false,
    val readerDetails: Map<String, ArticleDetail> = emptyMap(),
    val visibleReaderArticleId: String? = null,
    val selectedArticle: ArticleDetail? = null,
    val selectedFeedId: String? = null,
    val selectedCategoryId: String? = null,
    val savedOnly: Boolean = false,
    val loading: Boolean = false,
    val sort: String? = null,
    val hideRead: Boolean = false,
    val autoMarkReadMode: AutoMarkReadPreference = AutoMarkReadPreference.ON_NAVIGATE,
    val statusMessage: PresentationText? = null,
    val errorMessage: PresentationText? = null,
)

sealed interface ArticleFeatureEvent {
    data object ArticleStateRefreshRequested : ArticleFeatureEvent
    data class ArticlesChanged(val articleId: String? = null) : ArticleFeatureEvent
}

@HiltViewModel
class ArticlesViewModel @Inject constructor(
    private val repository: ArticleRepository,
    private val readStateManager: ReadStateManager,
    private val enrichmentManager: EnrichmentManager,
    private val articleWarmingManager: ArticleWarmingManager,
    private val savedStateHandle: SavedStateHandle = SavedStateHandle(),
) : ViewModel() {
    // These subscriptions belong to this account, not the Activity's global chrome.
    val pendingArticleChanges: Flow<Int> = flow { emitAll(repository.observePendingArticleChanges()) }

    fun observeArticleTextAvailability(articleId: String): Flow<Boolean> =
        repository.observeArticleTextAvailability(articleId)

    fun retryPendingArticleChanges() {
        viewModelScope.launch {
            try {
                repository.retryPendingArticleChanges()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _state.update { it.copy(errorMessage = error.message?.let(PresentationText::dynamic)) }
            }
        }
    }

    private val _state = MutableStateFlow(ArticlesUiState())
    val state: StateFlow<ArticlesUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<ArticleFeatureEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<ArticleFeatureEvent> = _events.asSharedFlow()

    private val articlePagingQuery = MutableStateFlow(ArticlePageQuery())

    @OptIn(ExperimentalCoroutinesApi::class)
    val articlePagingData = articlePagingQuery
        .flatMapLatest { query -> repository.articlePagingData(query) }
        .cachedIn(viewModelScope)

    private val openArticleSequence = AtomicLong(0)
    private var openArticleJob: Job? = null
    private data class SavedAction(val job: Job, val saved: Boolean, val projection: ArticleStateProjection.Action)
    private val savedActions = mutableMapOf<String, SavedAction>()
    private val readerPublicationMutex = Mutex()
    private var savedStateEpoch = 0L
    private var articlePagingGeneration = 0L
    private val stateProjection = readStateManager.stateProjection
    private val visibleArticleIds = MutableStateFlow<Set<String>?>(null)
    private val searchArticleIds = MutableStateFlow<Set<String>>(emptySet())
    private val stateRefreshRequests = Channel<Unit>(Channel.CONFLATED)

    fun updateSearchArticleIds(articleIds: Set<String>) { searchArticleIds.value = articleIds.take(80).toSet() }


    init {
        viewModelScope.launch {
            combine(
                _state.map { current ->
                    Triple(current.items.take(100).map { it.id }.toSet(), current.readerDetails.keys, current.selectedArticle?.id)
                }.distinctUntilChanged(),
                visibleArticleIds, searchArticleIds,
            ) { (initialRows, readerIds, selected), visible, search ->
                (visible ?: initialRows) + search + readerIds + listOfNotNull(selected)
            }.distinctUntilChanged().collect(readStateManager::retainArticleIds)
        }
        viewModelScope.launch { stateProjection.flags.collect(::applyProjectedArticleStates) }

        // Initialize managers with viewModelScope
        readStateManager.setScope(viewModelScope)
        enrichmentManager.setScope(viewModelScope)
        enrichmentManager.setOnArticleRefreshed { refreshed ->
            publishReaderDetails(listOf(refreshed), isCurrent = { _state.value.selectedArticle?.id == refreshed.id }) { details ->
                _state.update { current ->
                    current.copy(
                        selectedArticle = current.selectedArticle?.withNonRegressiveReaderContent(details.single()),
                        readerDetails = retainReaderDetails(current, details),
                    )
                }
            }
        }
        articleWarmingManager.setScope(viewModelScope)
        articleWarmingManager.setOnArticlesWarmed(::retainWarmedArticles)

        viewModelScope.launch {
            repository.savedStateRejections().collect { rejection ->
                while (true) {
                    val action = savedActions[rejection.articleId]
                    if (action != null) { action.job.join(); continue }
                    val epoch = savedStateEpoch
                    val local = (repository.localArticleState(rejection.articleId) as? AppResult.Success)?.data
                    if (epoch != savedStateEpoch) continue
                    if (local?.lastSavedMutationId != rejection.mutationId) break
                    if (local.isSaved == null) stateProjection.restartObservation()
                    _state.update { it.copy(errorMessage = PresentationText.resource(R.string.article_update_saved_failed)) }
                    break
                }
            }
        }
        viewModelScope.launch {
            repository.readStateRejections().collect { rejection ->
                if (readStateManager.applyReadRejection(rejection)) {
                    _state.update { it.copy(errorMessage = PresentationText.resource(R.string.article_update_read_failed)) }
                }
            }
        }

        // Forward read state manager events to our events flow
        viewModelScope.launch {
            readStateManager.events.collect { event ->
                applyReadStateEvent(event)
                _events.emit(event)
            }
        }
    }

    private var readingSessionKey: String? = null
    private var readingSessionRestored = false
    private var preserveRestoredFiltersOnBootstrap = false

    /** Rehydrate identifiers from Room after the caller has authenticated the account. */
    suspend fun restoreReadingSession(sessionKey: String?) {
        if (sessionKey != null && readingSessionKey == sessionKey && readingSessionRestored) return
        val canRestore = sessionKey != null && savedStateHandle.get<String>("reading.session") == sessionKey
        val articleId = if (canRestore) savedStateHandle.get<String>("reading.article") else null
        val restored = if (canRestore) ArticlesUiState(
            selectedFeedId = savedStateHandle["reading.feed"],
            selectedCategoryId = savedStateHandle["reading.category"],
            savedOnly = savedStateHandle["reading.saved"] ?: false,
            sort = savedStateHandle["reading.sort"],
            hideRead = savedStateHandle["reading.hideRead"] ?: false,
        ) else ArticlesUiState()
        clearReadingSession()
        readingSessionKey = sessionKey
        preserveRestoredFiltersOnBootstrap = canRestore
        _state.value = restored
        refreshArticlePager()
        saveReadingSession()
        savedStateHandle["reading.article"] = articleId
        val requestId = openArticleSequence.get()
        if (articleId != null) {
            val article = try {
                repository.readCachedArticleDetail(articleId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                null
            }
            if (readingSessionKey != sessionKey || requestId != openArticleSequence.get()) return
            if (article != null) selectArticle(article)
        }
        readingSessionRestored = true
        saveReadingSession()
    }

    fun clearReadingSession() {
        closeArticle()
        readingSessionKey = null
        readingSessionRestored = false
        preserveRestoredFiltersOnBootstrap = false
        readStateManager.clearSessionMemory()
        readStateManager.updateItems(emptyList())
        visibleArticleIds.value = null
        searchArticleIds.value = emptySet()
        _state.value = ArticlesUiState()
        savedStateHandle.keys().filter { it.startsWith("reading.") }.forEach { savedStateHandle.remove<Any>(it) }
        refreshArticlePager()
    }

    private fun saveReadingSession() {
        val sessionKey = readingSessionKey ?: return
        val current = _state.value
        savedStateHandle["reading.session"] = sessionKey
        savedStateHandle["reading.article"] = current.visibleReaderArticleId ?: current.selectedArticle?.id
        savedStateHandle["reading.feed"] = current.selectedFeedId
        savedStateHandle["reading.category"] = current.selectedCategoryId
        savedStateHandle["reading.saved"] = current.savedOnly
        savedStateHandle["reading.sort"] = current.sort
        savedStateHandle["reading.hideRead"] = current.hideRead
    }

    fun setScope(feedId: String?, categoryId: String?) {
        val current = _state.value
        if (current.selectedFeedId == feedId && current.selectedCategoryId == categoryId) return
        cancelReaderWork()
        _state.update {
            it.copy(
                selectedFeedId = feedId,
                selectedCategoryId = categoryId,
                savedOnly = false,
                selectedArticle = null,
                items = emptyList(),
                readerQueue = emptyList(),
                readerQueueTracksPaging = false,
                readerDetails = emptyMap(),
                visibleReaderArticleId = null,
                errorMessage = null,
            )
        }
        saveReadingSession()
        refreshArticlePager()
    }

    fun setFilter(sort: String?, hideRead: Boolean?) {
        var changed = false
        _state.update {
            val nextSort = sort ?: it.sort
            val nextHideRead = hideRead ?: it.hideRead
            changed = nextSort != it.sort || nextHideRead != it.hideRead
            if (!changed) {
                it
            } else {
                it.copy(
                    sort = nextSort,
                    hideRead = nextHideRead,
                )
            }
        }
        if (changed) {
            saveReadingSession()
            refreshArticlePager()
        }
    }

    fun setSavedOnly(savedOnly: Boolean) {
        if (_state.value.savedOnly == savedOnly) return
        cancelReaderWork()
        _state.update {
            it.copy(
                selectedFeedId = if (savedOnly) null else it.selectedFeedId,
                selectedCategoryId = if (savedOnly) null else it.selectedCategoryId,
                savedOnly = savedOnly,
                selectedArticle = null,
                items = emptyList(),
                readerQueue = emptyList(),
                readerQueueTracksPaging = false,
                readerDetails = emptyMap(),
                visibleReaderArticleId = null,
                errorMessage = null,
            )
        }
        saveReadingSession()
        refreshArticlePager()
    }

    fun applyPreferences(defaultSort: String, hideRead: Boolean, autoMarkReadMode: String) {
        if (preserveRestoredFiltersOnBootstrap) {
            preserveRestoredFiltersOnBootstrap = false
        } else {
            setFilter(defaultSort, hideRead)
        }
        setAutoMarkReadMode(autoMarkReadMode)
    }

    fun setAutoMarkReadMode(mode: String?) {
        _state.update { it.copy(autoMarkReadMode = AutoMarkReadPreference.fromApiValue(mode)) }
    }

    fun refreshArticles() {
        stateProjection.restartObservation()
        refreshArticlePager()
    }

    fun warmVisibleArticles(articles: List<ArticleListItem>) {
        visibleArticleIds.value = articles.take(100).map { it.id }.toSet()
        articleWarmingManager.warmVisibleArticles(articles)
    }

    /**
     * Keeps the currently materialized Paging window for reader navigation
     * and optimistic read-state updates. Paging/Room remains the only source
     * of article-list data; this is not a second list cache.
     */
    fun updateArticleQueueSnapshot(articles: List<ArticleListItem>) {
        _state.update { current ->
            current.copy(
                items = articles,
                readerQueue = if (current.readerQueueTracksPaging) {
                    current.readerQueue.expandWith(articles)
                } else {
                    current.readerQueue
                },
            )
        }
        readStateManager.updateItems(articles)
    }

    fun openArticle(id: String, forceRefresh: Boolean = false) {
        val openRequestId = openArticleSequence.incrementAndGet()
        openArticleJob?.cancel()
        enrichmentManager.cancelEnrichment()
        val current = _state.value
        val activeQueue = current.readerQueue.takeIf { queue -> queue.any { it.id == id } }
            ?: current.items
        if (current.readerQueue !== activeQueue) {
            val activeIds = activeQueue.asSequence().map { it.id }.toSet()
            _state.update {
                it.copy(
                    readerQueue = activeQueue,
                    readerQueueTracksPaging = activeQueue === current.items,
                    readerDetails = it.readerDetails.filterKeys(activeIds::contains),
                )
            }
        }
        val optimisticArticle = (
                current.readerDetails[id]
                    ?: repository.cachedArticleDetail(id)
                    ?: activeQueue.firstOrNull { it.id == id }
                        ?.toArticleDetail(knownArticleReadStates()[id])
                )?.withReadState(knownArticleReadStates()[id])
        if (optimisticArticle != null) {
            selectArticle(optimisticArticle)
            if (
                current.autoMarkReadMode == AutoMarkReadPreference.ON_NAVIGATE &&
                !optimisticArticle.isRead
            ) {
                markReadAutomatically(id)
            }
        }

        openArticleJob = viewModelScope.launch {
            // The list row already supplied an optimistic reader snapshot.
            // Let Compose commit the navigation transition before starting
            // cache/database/network work for the canonical detail.
            yield()
            if (openRequestId != openArticleSequence.get()) return@launch
            if (optimisticArticle != null) articleWarmingManager.warmAdjacentArticles(id, activeQueue)
            when (val result = repository.article(id, forceRefresh)) {
                is AppResult.Success -> {
                    if (openRequestId != openArticleSequence.get()) return@launch
                    publishReaderDetails(listOf(result.data), isCurrent = { openRequestId == openArticleSequence.get() }) { details ->
                        val article = details.single()
                        selectArticle(article)
                        enrichmentManager.maybeEnrichSelectedArticle(article)
                        articleWarmingManager.warmAdjacentArticles(id, _state.value.readerQueue)
                    }
                }

                is AppResult.Error -> {
                    if (openRequestId != openArticleSequence.get()) return@launch
                    _state.update { it.copy(errorMessage = PresentationText.dynamic(result.message)) }
                }
            }
        }
    }

    fun openArticleFromQueue(
        id: String,
        queue: List<ArticleListItem>,
        tracksPaging: Boolean = false,
    ) {
        if (queue.isNotEmpty()) {
            val queueIds = queue.asSequence().map { it.id }.toSet()
            _state.update {
                it.copy(
                    readerQueue = queue,
                    readerQueueTracksPaging = tracksPaging,
                    readerDetails = it.readerDetails.filterKeys(queueIds::contains),
                )
            }
        }
        openArticle(id)
    }

    fun onArticleDisplayed(articleId: String) {
        val article = _state.value.selectedArticle?.takeIf { it.id == articleId } ?: return
        when {
            _state.value.autoMarkReadMode == AutoMarkReadPreference.ON_OPEN && !article.isRead -> {
                markReadAutomatically(articleId)
            }
        }
    }

    fun onArticleCompleted(articleId: String) {
        viewModelScope.launch { repository.recordArticleCompletion(articleId) }
    }

    fun onReaderPageChanged(articleId: String) {
        _state.update { current ->
            val queue = current.readerQueue.ifEmpty { current.items }
            if (queue.none { it.id == articleId }) current
            else current.copy(visibleReaderArticleId = articleId)
        }
        saveReadingSession()
    }

    fun closeArticle() {
        cancelReaderWork()
        _state.update {
            it.copy(
                selectedArticle = null,
                readerQueue = emptyList(),
                readerQueueTracksPaging = false,
                readerDetails = emptyMap(),
                visibleReaderArticleId = null,
            )
        }
        saveReadingSession()
    }

    private fun cancelReaderWork() {
        openArticleSequence.incrementAndGet()
        openArticleJob?.cancel()
        openArticleJob = null
        enrichmentManager.cancelEnrichment()
        articleWarmingManager.cancelWarming()
        enrichmentManager.updateSelectedArticle(null)
        readStateManager.updateSelectedArticle(null)
    }

    fun openAdjacentArticle(direction: Int) {
        val state = _state.value
        val selectedId = state.selectedArticle?.id ?: return
        val queue = state.readerQueue.ifEmpty { state.items }
        val currentIndex = queue.indexOfFirst { it.id == selectedId }
        if (currentIndex == -1) return
        val nextIndex = currentIndex + direction
        if (nextIndex !in queue.indices) return
        openArticle(queue[nextIndex].id)
    }

    fun markRead(articleId: String, read: Boolean) {
        markReadInternal(articleId, read, ReadStateChangeSource.Manual)
    }

    fun setSaved(articleId: String, saved: Boolean, onFailure: () -> Unit = {}) {
        val projection = stateProjection.begin(articleId, ArticleStateProjection.Field.Saved, saved, _state.value.savedState(articleId))
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            try {
                val result = repository.setSaved(articleId, saved)
                if (!currentCoroutineContext().isActive || savedActions[articleId]?.job !== currentCoroutineContext()[Job]) return@launch
                when (result) {
                    is AppResult.Success -> {
                        stateProjection.committed(projection, result.data)
                        if (_state.value.savedOnly && !saved) refreshArticlePager()
                    }
                    is AppResult.Error -> {
                        stateProjection.failed(projection)
                        stateProjection.restartObservation()
                        onFailure()
                        _state.update {
                            it.copy(errorMessage = PresentationText.resource(R.string.article_update_saved_failed))
                        }
                    }
                }
            } finally {
                if (savedActions[articleId]?.job === currentCoroutineContext()[Job]) {
                    savedActions.remove(articleId)
                    if (projection.receiptId == null) stateProjection.failed(projection)
                    savedStateEpoch++
                }
            }
        }
        savedActions.remove(articleId)?.job?.cancel()
        savedActions[articleId] = SavedAction(job, saved, projection)
        job.start()
    }

    private fun markReadAutomatically(articleId: String) {
        markReadInternal(articleId, read = true, source = ReadStateChangeSource.AutoOpen)
    }

    private fun markReadInternal(articleId: String, read: Boolean, source: ReadStateChangeSource) {
        readStateManager.markRead(
            articleId = articleId,
            read = read,
            source = source,
            onError = {
                stateProjection.restartObservation()
                _state.update {
                    it.copy(errorMessage = PresentationText.resource(R.string.article_update_read_failed))
                }
            },
            onConfirm = { confirmed, previous ->
                if (_state.value.hideRead && previous != confirmed) refreshArticlePager()
            },
        )
    }

    fun markAllRead() {
        val snapshot = _state.value
        readStateManager.markAllRead(
            selectedFeedId = snapshot.selectedFeedId,
            selectedCategoryId = snapshot.selectedCategoryId,
            onSuccess = { _, _, _, markedCount ->
                _state.update {
                    it.copy(
                        statusMessage = PresentationText.plural(
                            R.plurals.article_marked_all_read,
                            markedCount,
                        ),
                    )
                }
            },
            onError = { _ ->
                _state.update { it.copy(errorMessage = PresentationText.resource(R.string.article_update_read_failed)) }
            },
        )
    }

    fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> {
        return enrichmentManager.enrichArticle(articleId)
    }

    /** One foreground lifetime owns Room, SSE and the bounded refresh loop. */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun observeReadStateSync() = coroutineScope {
        stateProjection.restartObservation()
        try {
            launch { readStateManager.observeReadStateSync() }
            launch {
                stateProjection.observation.collectLatest { request ->
                    stateRefreshRequests.trySend(Unit)
                    repository.observeArticleStates(request.articleIds).collect { result ->
                        currentCoroutineContext().ensureActive()
                        if (result is AppResult.Success) stateProjection.accept(request, result.data)
                    }
                }
            }
            while (true) {
                stateRefreshRequests.receive()
                val ids = stateProjection.observation.value.articleIds
                if (ids.isNotEmpty()) repository.refreshArticleStates(ids)
                // Requests received during a lookup retain one successor. Errors wait for another trigger.
            }
        } finally {
            stateProjection.restartObservation()
        }
    }

    private fun applyProjectedArticleStates(flags: Map<String, ArticleFlags>) {
        savedStateEpoch++
        _state.update { current ->
            current.copy(
                articleStates = flags,
                selectedArticle = current.selectedArticle?.let { it.withArticleFlags(flags[it.id]) },
                readerDetails = current.readerDetails.mapValues { (id, detail) -> detail.withArticleFlags(flags[id]) },
            )
        }
        readStateManager.updateItems(_state.value.items)
        readStateManager.updateSelectedArticle(_state.value.selectedArticle)
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, statusMessage = null) }
    }

    override fun onCleared() {
        cancelReaderWork()
        articleWarmingManager.setOnArticlesWarmed {}
        super.onCleared()
    }

    private fun selectArticle(article: ArticleDetail) {
        _state.update { current ->
            val selectedArticle = current.selectedArticle
                ?.takeIf { it.id == article.id }
                ?.withNonRegressiveReaderContent(article)
                ?: article
            current.copy(
                selectedArticle = selectedArticle,
                readerDetails = retainReaderDetails(
                    current = current,
                    incoming = listOf(selectedArticle),
                ),
            )
        }
        val selectedArticle = _state.value.selectedArticle ?: return
        enrichmentManager.updateSelectedArticle(selectedArticle)
        readStateManager.updateSelectedArticle(selectedArticle)
        saveReadingSession()
    }

    private fun applyReadStateEvent(event: ArticleFeatureEvent) {
        when (event) {
            ArticleFeatureEvent.ArticleStateRefreshRequested -> stateProjection.restartObservation()
            is ArticleFeatureEvent.ArticlesChanged -> {
                stateProjection.restartObservation()
                val selectedId = _state.value.selectedArticle?.id
                if (selectedId != null && event.articleId == selectedId) openArticle(selectedId, forceRefresh = true)
            }
        }
    }

    private fun refreshArticlePager() {
        articlePagingGeneration += 1
        articlePagingQuery.value =
            _state.value.articleQuery().toArticlePageQuery(articlePagingGeneration)
    }

    private fun knownArticleReadStates(): Map<String, Boolean> =
        readStateManager.knownArticleReadStates()

    private fun ArticlesUiState.savedState(articleId: String): Boolean? =
        selectedArticle?.takeIf { it.id == articleId }?.isSaved
            ?: readerDetails[articleId]?.isSaved
            ?: readerQueue.firstOrNull { it.id == articleId }?.isSaved
            ?: items.firstOrNull { it.id == articleId }?.isSaved

    private fun ArticlesUiState.articleQuery(): ArticleQuery =
        ArticleQuery(
            feedId = selectedFeedId,
            categoryId = selectedCategoryId,
            unreadOnly = hideRead,
            savedOnly = savedOnly,
            sort = sort,
        )

    private fun ArticleQuery.toArticlePageQuery(generation: Long): ArticlePageQuery =
        ArticlePageQuery(
            feedId = feedId,
            categoryId = categoryId,
            unreadOnly = unreadOnly,
            savedOnly = savedOnly,
            sort = sort,
            generation = generation,
        )

    /**
     * Extends an open reader session as Paging materializes more rows. Existing
     * positions stay stable while a swipe is in progress; incoming snapshots
     * refresh row metadata and append only IDs that were not already present.
     */
    private fun List<ArticleListItem>.expandWith(snapshot: List<ArticleListItem>): List<ArticleListItem> {
        if (isEmpty()) return snapshot
        if (snapshot.isEmpty()) return this

        val incomingById = snapshot.associateBy { it.id }
        val existingIds = asSequence().map { it.id }.toHashSet()
        return map { article -> incomingById[article.id] ?: article } +
                snapshot.filterNot { it.id in existingIds }
    }

    private fun ArticleDetail.withReadState(isRead: Boolean?): ArticleDetail = copy(
        isRead = isRead ?: this.isRead,
        isSaved = stateProjection.flags.value[id]?.isSaved ?: savedActions[id]?.saved ?: this.isSaved,
    )

    private suspend fun retainWarmedArticles(articles: List<ArticleDetail>) {
        publishReaderDetails(articles) { projected ->
            _state.update { current ->
                val retained = retainReaderDetails(current, projected)
                val selected = current.selectedArticle?.let { displayed ->
                    retained[displayed.id]?.let(displayed::withNonRegressiveReaderContent) ?: displayed
                }
                current.copy(readerDetails = retained, selectedArticle = selected)
            }
        }
    }

    /** Content fetches can outlive a completed bookmark edit. Reconcile stored state at publication. */
    private suspend fun publishReaderDetails(
        incoming: List<ArticleDetail>,
        isCurrent: () -> Boolean = { true },
        publish: (List<ArticleDetail>) -> Unit,
    ) = readerPublicationMutex.withLock {
        while (isCurrent()) {
            currentCoroutineContext().ensureActive()
            val epoch = savedStateEpoch
            val projected = incoming.map { detail ->
                val result = repository.localArticleState(detail.id)
                val saved = when (result) {
                    is AppResult.Success -> result.data.isSaved ?: detail.isSaved
                    is AppResult.Error -> _state.value.savedState(detail.id) ?: detail.isSaved
                }
                val read = (result as? AppResult.Success)?.data?.isRead ?: detail.isRead
                detail.copy(isRead = read, isSaved = saved)
                    .withArticleFlags(stateProjection.flags.value[detail.id])
            }
            currentCoroutineContext().ensureActive()
            if (epoch != savedStateEpoch) continue
            if (isCurrent()) {
                publish(projected)
                savedStateEpoch++
            }
            return@withLock
        }
    }

    private fun retainReaderDetails(
        current: ArticlesUiState,
        incoming: List<ArticleDetail>,
    ): Map<String, ArticleDetail> {
        val queue = current.readerQueue.ifEmpty { current.items }
        val allowedIds = queue.asSequence().map { it.id }.toSet() +
                listOfNotNull(current.selectedArticle?.id)
        val retained = LinkedHashMap<String, ArticleDetail>()
        current.readerDetails
            .filterKeys(allowedIds::contains)
            .forEach(retained::put)
        incoming.forEach { article ->
            if (article.id in allowedIds) {
                val withReadState = article.withArticleFlags(stateProjection.flags.value[article.id])
                retained[article.id] = retained[article.id]
                    ?.withNonRegressiveReaderContent(withReadState)
                    ?: withReadState
            }
        }
        while (retained.size > READER_DETAIL_LIMIT) {
            retained.remove(retained.keys.first())
        }
        return retained
    }

    private fun ArticleListItem.toArticleDetail(isRead: Boolean?): ArticleDetail =
        ArticleDetail(
            id = id,
            feedId = feedId,
            guid = id,
            canonicalUrl = null,
            title = title,
            author = author,
            excerpt = excerpt,
            contentHtml = null,
            contentText = excerpt,
            heroImageUrl = heroImageUrl,
            publishedAt = publishedAt,
            fetchedAt = null,
            hash = id,
            feedTitle = feedTitle,
            feedFaviconUrl = feedFaviconUrl,
            feedSiteUrl = null,
            media = emptyList(),
            isRead = isRead ?: this.isRead,
            isSaved = this.isSaved,
            isEnriched = contentStatus == "full_ready",
            contentStatus = contentStatus,
            contentVersion = contentVersion,
        )

    private data class ArticleQuery(
        val feedId: String?,
        val categoryId: String?,
        val unreadOnly: Boolean,
        val savedOnly: Boolean,
        val sort: String?,
    )

    private companion object {
        const val READER_DETAIL_LIMIT = 20
    }
}
