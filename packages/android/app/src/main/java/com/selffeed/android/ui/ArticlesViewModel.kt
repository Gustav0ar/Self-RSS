package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
import com.selffeed.android.ui.components.withNonRegressiveReaderContent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject

data class ArticlesUiState(
    val items: List<ArticleListItem> = emptyList(),
    val readerQueue: List<ArticleListItem> = emptyList(),
    val readerDetails: Map<String, ArticleDetail> = emptyMap(),
    val visibleReaderArticleId: String? = null,
    val selectedArticle: ArticleDetail? = null,
    val selectedFeedId: String? = null,
    val selectedCategoryId: String? = null,
    val loading: Boolean = false,
    val sort: String? = null,
    val hideRead: Boolean = false,
    val autoMarkReadMode: AutoMarkReadPreference = AutoMarkReadPreference.ON_NAVIGATE,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
)

sealed interface ArticleFeatureEvent {
    data class ArticleReadStateChanged(
        val articleId: String,
        val feedId: String?,
        val read: Boolean,
        val unreadDelta: Int,
        val readDelta: Int,
    ) : ArticleFeatureEvent

    data class ScopeMarkedRead(
        val feedId: String?,
        val categoryId: String?,
        val affectedFeedIds: Set<String>,
        val markedCount: Int,
    ) : ArticleFeatureEvent

    data class ArticlesChanged(val articleId: String? = null) : ArticleFeatureEvent
}

@HiltViewModel
class ArticlesViewModel @Inject constructor(
    private val repository: ArticleRepository,
    private val readStateManager: ReadStateManager,
    private val enrichmentManager: EnrichmentManager,
    private val articleWarmingManager: ArticleWarmingManager,
) : ViewModel() {
    private val _state = MutableStateFlow(ArticlesUiState())
    val state: StateFlow<ArticlesUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<ArticleFeatureEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<ArticleFeatureEvent> = _events.asSharedFlow()

    // Exposes current read state overrides for sync with ArticleReaderPane
    private val _readStateOverrides = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val readStateOverrides: StateFlow<Map<String, Boolean>> = _readStateOverrides.asStateFlow()

    private val articlePagingQuery = MutableStateFlow(ArticlePageQuery())
    @OptIn(ExperimentalCoroutinesApi::class)
    val articlePagingData = articlePagingQuery
        .flatMapLatest { query -> repository.articlePagingData(query, ::knownArticleReadStates) }
        .cachedIn(viewModelScope)

    private val openArticleSequence = AtomicLong(0)
    private var articlePagingGeneration = 0L

    init {
        // Initialize managers with viewModelScope
        readStateManager.setScope(viewModelScope)
        enrichmentManager.setScope(viewModelScope)
        enrichmentManager.setOnArticleRefreshed { refreshed ->
            _state.update { current ->
                val retainedDetails = retainReaderDetails(current, listOf(refreshed))
                if (current.selectedArticle?.id == refreshed.id) {
                    val displayed = current.selectedArticle.withNonRegressiveReaderContent(refreshed)
                    current.copy(
                        selectedArticle = displayed.withReadState(knownArticleReadStates()[refreshed.id]),
                        readerDetails = retainedDetails,
                    )
                } else {
                    current.copy(readerDetails = retainedDetails)
                }
            }
        }
        articleWarmingManager.setScope(viewModelScope)
        articleWarmingManager.setOnArticlesWarmed(::retainWarmedArticles)

        // Forward read state manager events to our events flow
        viewModelScope.launch {
            readStateManager.events.collect { event ->
                applyReadStateEvent(event)
                _events.emit(event)
            }
        }
    }

    fun setScope(feedId: String?, categoryId: String?) {
        val current = _state.value
        if (current.selectedFeedId == feedId && current.selectedCategoryId == categoryId) return
        _state.update {
            it.copy(
                selectedFeedId = feedId,
                selectedCategoryId = categoryId,
                selectedArticle = null,
                items = emptyList(),
                readerQueue = emptyList(),
                readerDetails = emptyMap(),
                visibleReaderArticleId = null,
                errorMessage = null,
            )
        }
        readStateManager.updateScope(feedId, categoryId)
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
            readStateManager.updateFilter(_state.value.hideRead)
            refreshArticlePager()
        }
    }

    fun setAutoMarkReadMode(mode: String?) {
        _state.update { it.copy(autoMarkReadMode = AutoMarkReadPreference.fromApiValue(mode)) }
    }

    fun refreshArticles() {
        refreshArticlePager()
    }

    fun warmVisibleArticles(articles: List<ArticleListItem>) {
        articleWarmingManager.warmVisibleArticles(articles)
    }

    /**
     * Keeps the currently materialized Paging window for reader navigation
     * and optimistic read-state updates. Paging/Room remains the only source
     * of article-list data; this is not a second list cache.
     */
    fun updateArticleQueueSnapshot(articles: List<ArticleListItem>) {
        val itemsWithReadStates = articles.withReadStates(knownArticleReadStates())
        _state.update { it.copy(items = itemsWithReadStates) }
        readStateManager.updateItems(itemsWithReadStates)
        publishReadStateOverrides()
    }

    fun openArticle(id: String, forceRefresh: Boolean = false) {
        val openRequestId = openArticleSequence.incrementAndGet()
        val current = _state.value
        val activeQueue = current.readerQueue.takeIf { queue -> queue.any { it.id == id } }
            ?: current.items
        if (current.readerQueue !== activeQueue) {
            val activeIds = activeQueue.asSequence().map { it.id }.toSet()
            _state.update {
                it.copy(
                    readerQueue = activeQueue,
                    readerDetails = it.readerDetails.filterKeys(activeIds::contains),
                )
            }
        }
        val optimisticArticle = (
            current.readerDetails[id]
                ?: repository.cachedArticleDetail(id)
                ?: activeQueue.firstOrNull { it.id == id }?.toArticleDetail(knownArticleReadStates()[id])
            )?.withReadState(knownArticleReadStates()[id])
        if (optimisticArticle != null) {
            selectArticle(optimisticArticle)
            if (
                current.autoMarkReadMode == AutoMarkReadPreference.ON_NAVIGATE &&
                !optimisticArticle.isRead
            ) {
                markReadAutomatically(id)
            }
            viewModelScope.launch {
                yield()
                articleWarmingManager.warmAdjacentArticles(id, activeQueue)
            }
        }

        viewModelScope.launch {
            // The list row already supplied an optimistic reader snapshot.
            // Let Compose commit the navigation transition before starting
            // cache/database/network work for the canonical detail.
            yield()
            if (openRequestId != openArticleSequence.get()) return@launch
            when (val result = repository.article(id, forceRefresh)) {
                is AppResult.Success -> {
                    if (openRequestId != openArticleSequence.get()) return@launch
                    val article = result.data.withReadState(knownArticleReadStates()[id])
                    selectArticle(article)

                    if (article.isRead) {
                        readStateManager.readStateStore.remember(id, article.isRead)
                        publishReadStateOverrides(id to article.isRead)
                    }
                    enrichmentManager.maybeEnrichSelectedArticle(article)
                    articleWarmingManager.warmAdjacentArticles(id, _state.value.readerQueue)
                }
                is AppResult.Error -> {
                    if (openRequestId != openArticleSequence.get()) return@launch
                    _state.update { it.copy(errorMessage = result.message) }
                }
            }
        }
    }

    fun openArticleFromQueue(id: String, queue: List<ArticleListItem>) {
        if (queue.isNotEmpty()) {
            val queueIds = queue.asSequence().map { it.id }.toSet()
            _state.update {
                it.copy(
                    readerQueue = queue,
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
            article.isRead -> {
            readStateManager.readStateStore.remember(articleId, true)
            publishReadStateOverrides(articleId to true)
            }
        }
    }

    fun onReaderPageChanged(articleId: String) {
        _state.update { current ->
            val queue = current.readerQueue.ifEmpty { current.items }
            if (queue.none { it.id == articleId }) current
            else current.copy(visibleReaderArticleId = articleId)
        }
    }

    fun closeArticle() {
        enrichmentManager.cancelEnrichment()
        articleWarmingManager.cancelWarming()
        _state.update {
            it.copy(
                selectedArticle = null,
                readerQueue = emptyList(),
                readerDetails = emptyMap(),
                visibleReaderArticleId = null,
            )
        }
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

    private fun markReadAutomatically(articleId: String) {
        markReadInternal(articleId, read = true, source = ReadStateChangeSource.AutoOpen)
    }

    private fun markReadInternal(articleId: String, read: Boolean, source: ReadStateChangeSource) {
        readStateManager.markRead(
            articleId = articleId,
            read = read,
            source = source,
            onOptimisticUpdate = { id, fId, isRead ->
                applyArticleReadStateOptimistic(id, isRead)
            },
            onError = { id, prevState, prevArticle ->
                _state.update { state ->
                    state.copy(
                        items = prevState?.let { previous ->
                            state.items.map { if (it.id == id) it.copy(isRead = previous) else it }
                        } ?: state.items,
                        selectedArticle = prevArticle ?: state.selectedArticle,
                        readerDetails = if (prevState == null) {
                            state.readerDetails
                        } else {
                            state.readerDetails.mapValues { (articleId, article) ->
                                if (articleId == id) article.copy(isRead = prevState) else article
                            }
                        },
                    )
                }
                if (prevState != null) {
                    publishReadStateOverrides(id to prevState)
                } else {
                    publishReadStateOverridesWithout(id)
                }
                // Emit error message
                _state.update { it.copy(errorMessage = "Failed to update read state") }
            },
            onConfirm = { id, fId, confirmed, prevState ->
                applyArticleReadStateConfirmed(id, fId, confirmed, prevState)
            },
        )
    }

    fun markAllRead() {
        val snapshot = _state.value
        readStateManager.markAllRead(
            selectedFeedId = snapshot.selectedFeedId,
            selectedCategoryId = snapshot.selectedCategoryId,
            onSuccess = { feedId, categoryId, affectedFeedIds, markedCount ->
                applyScopeReadState(affectedFeedIds)
                _state.update { it.copy(statusMessage = "Marked $markedCount articles as read") }
                _events.tryEmit(
                    ArticleFeatureEvent.ScopeMarkedRead(
                        feedId = feedId,
                        categoryId = categoryId,
                        affectedFeedIds = affectedFeedIds,
                        markedCount = markedCount,
                    ),
                )
            },
            onError = { message ->
                _state.update { it.copy(errorMessage = message) }
            },
        )
    }

    fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> {
        return enrichmentManager.enrichArticle(articleId)
    }

    fun startReadStateSync() {
        readStateManager.startReadStateSync()
    }

    fun stopReadStateSync() {
        readStateManager.stopReadStateSync()
    }

    fun clearSessionReadStateMemory() {
        readStateManager.clearSessionMemory()
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, statusMessage = null) }
    }

    override fun onCleared() {
        enrichmentManager.cancelEnrichment()
        articleWarmingManager.cancelWarming()
        articleWarmingManager.setOnArticlesWarmed {}
        readStateManager.stopReadStateSync()
        super.onCleared()
    }

    private fun applyArticleReadStateOptimistic(articleId: String, isRead: Boolean) {
        _state.update { state ->
            state.copy(
                items = state.items.map {
                    if (it.id == articleId) it.copy(isRead = isRead) else it
                },
                selectedArticle = state.selectedArticle?.let {
                    if (it.id == articleId) it.copy(isRead = isRead) else it
                },
                readerDetails = state.readerDetails.mapValues { (id, article) ->
                    if (id == articleId) article.copy(isRead = isRead) else article
                },
            )
        }
        publishReadStateOverrides(articleId to isRead)
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
    }

    private fun applyArticleReadStateConfirmed(
        articleId: String,
        feedId: String?,
        isRead: Boolean,
        previousReadState: Boolean?,
    ) {
        val (unreadDelta, readDelta) = readDelta(previousReadState, isRead)
        _events.tryEmit(
            ArticleFeatureEvent.ArticleReadStateChanged(
                articleId = articleId,
                feedId = feedId,
                read = isRead,
                unreadDelta = unreadDelta,
                readDelta = readDelta,
            ),
        )
    }

    private fun applyReadStateEvent(event: ArticleFeatureEvent) {
        when (event) {
            is ArticleFeatureEvent.ArticleReadStateChanged -> {
                applyArticleReadStateOptimistic(event.articleId, event.read)
            }
            is ArticleFeatureEvent.ScopeMarkedRead -> {
                applyScopeReadState(event.affectedFeedIds)
            }
            is ArticleFeatureEvent.ArticlesChanged -> {
                // Realtime data invalidates caches for the next explicit
                // refresh, but never replaces the list the user is browsing.
                val selectedId = _state.value.selectedArticle?.id
                if (selectedId != null && event.articleId == selectedId) {
                    openArticle(selectedId, forceRefresh = true)
                }
            }
        }
    }

    private fun applyScopeReadState(affectedFeedIds: Set<String>) {
        val rememberedReadStates = mutableListOf<Pair<String, Boolean>>()
        _state.update { current ->
            current.items
                .filter { current.articleMatchesAffectedFeeds(it, affectedFeedIds) }
                .forEach {
                    readStateManager.readStateStore.remember(it.id, true)
                    rememberedReadStates += it.id to true
                }
            current.selectedArticle
                ?.takeIf { current.articleMatchesAffectedFeeds(it, affectedFeedIds) }
                ?.let {
                    readStateManager.readStateStore.remember(it.id, true)
                    rememberedReadStates += it.id to true
                }

            current.copy(
                items = current.items.map { article ->
                    if (current.articleMatchesAffectedFeeds(article, affectedFeedIds)) {
                        article.copy(isRead = true)
                    } else {
                        article
                    }
                },
                selectedArticle = current.selectedArticle?.let { article ->
                    if (current.articleMatchesAffectedFeeds(article, affectedFeedIds)) {
                        article.copy(isRead = true)
                    } else {
                        article
                    }
                },
                readerDetails = current.readerDetails.mapValues { (_, article) ->
                    if (current.articleMatchesAffectedFeeds(article, affectedFeedIds)) {
                        article.copy(isRead = true)
                    } else {
                        article
                    }
                },
            )
        }
        publishReadStateOverrides(*rememberedReadStates.toTypedArray())
    }

    private fun refreshArticlePager() {
        articlePagingGeneration += 1
        articlePagingQuery.value = _state.value.articleQuery().toArticlePageQuery(articlePagingGeneration)
    }

    /**
     * Returns the current read state overrides for articles.
     * Used by ArticleReaderPane to sync read state when navigating between articles.
     */
    fun getReadStateOverrides(): Map<String, Boolean> = knownArticleReadStates()

    private fun knownArticleReadStates(): Map<String, Boolean> =
        readStateManager.knownArticleReadStates()

    private fun publishReadStateOverrides(vararg changedStates: Pair<String, Boolean>) {
        val snapshot = knownArticleReadStates().toMutableMap()
        for ((articleId, isRead) in changedStates) {
            snapshot[articleId] = isRead
        }
        _readStateOverrides.value = snapshot
    }

    private fun publishReadStateOverridesWithout(articleId: String) {
        _readStateOverrides.value = knownArticleReadStates().toMutableMap().apply {
            remove(articleId)
        }
    }

    private fun ArticlesUiState.articleMatchesAffectedFeeds(
        article: ArticleListItem,
        affectedFeedIds: Set<String>,
    ): Boolean {
        return affectedFeedIds.isEmpty() || article.feedId in affectedFeedIds
    }

    private fun ArticlesUiState.articleMatchesAffectedFeeds(
        article: ArticleDetail,
        affectedFeedIds: Set<String>,
    ): Boolean {
        return affectedFeedIds.isEmpty() || article.feedId in affectedFeedIds
    }

    private fun ArticlesUiState.articleQuery(): ArticleQuery =
        ArticleQuery(
            feedId = selectedFeedId,
            categoryId = selectedCategoryId,
            unreadOnly = hideRead,
            sort = sort,
        )

    private fun ArticleQuery.toArticlePageQuery(generation: Long): ArticlePageQuery =
        ArticlePageQuery(
            feedId = feedId,
            categoryId = categoryId,
            unreadOnly = unreadOnly,
            sort = sort,
            generation = generation,
        )

    private fun List<ArticleListItem>.withReadStates(readStates: Map<String, Boolean>): List<ArticleListItem> =
        map { article -> readStates[article.id]?.let { article.copy(isRead = it) } ?: article }

    private fun ArticleDetail.withReadState(isRead: Boolean?): ArticleDetail =
        isRead?.let { copy(isRead = it) } ?: this

    private fun retainWarmedArticles(articles: List<ArticleDetail>) {
        _state.update { current ->
            val retained = retainReaderDetails(current, articles)
            val selected = current.selectedArticle?.let { displayed ->
                retained[displayed.id]?.let(displayed::withNonRegressiveReaderContent) ?: displayed
            }
            current.copy(readerDetails = retained, selectedArticle = selected)
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
                val withReadState = article.withReadState(knownArticleReadStates()[article.id])
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
            isEnriched = contentStatus == "full_ready",
            contentStatus = contentStatus,
            contentVersion = contentVersion,
        )

    private fun readDelta(previousReadState: Boolean?, newReadState: Boolean): Pair<Int, Int> {
        val changed = previousReadState?.let { it != newReadState } ?: false
        if (!changed) return 0 to 0
        return if (newReadState) -1 to 1 else 1 to -1
    }

    private data class ArticleQuery(
        val feedId: String?,
        val categoryId: String?,
        val unreadOnly: Boolean,
        val sort: String?,
    )

    private companion object {
        const val READER_DETAIL_LIMIT = 20
    }
}
