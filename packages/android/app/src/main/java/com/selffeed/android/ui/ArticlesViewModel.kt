package com.selffeed.android.ui

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.cachedIn
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ArticlePageQuery
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.ui.articles.ArticleWarmingManager
import com.selffeed.android.ui.articles.EnrichmentManager
import com.selffeed.android.ui.articles.ReadStateManager
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
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject

data class ArticlesUiState(
    val items: List<ArticleListItem> = emptyList(),
    val selectedArticle: ArticleDetail? = null,
    val selectedFeedId: String? = null,
    val selectedCategoryId: String? = null,
    val loading: Boolean = false,
    val sort: String? = null,
    val hideRead: Boolean = false,
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
}

@HiltViewModel
class ArticlesViewModel @Inject constructor(
    private val repository: SelfFeedRepository,
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

    private val requestSequence = AtomicLong(0)
    private var articlePagingGeneration = 0L

    init {
        // Initialize managers with viewModelScope
        readStateManager.setScope(viewModelScope)
        enrichmentManager.setScope(viewModelScope)
        articleWarmingManager.setScope(viewModelScope)

        // Forward read state manager events to our events flow
        viewModelScope.launch {
            readStateManager.events.collect { event ->
                _events.emit(event)
            }
        }
    }

    fun setScope(feedId: String?, categoryId: String?) {
        _state.update {
            it.copy(
                selectedFeedId = feedId,
                selectedCategoryId = categoryId,
                selectedArticle = null,
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

    fun refreshArticles() {
        refreshArticlePager()
    }

    fun loadArticles() {
        val query = _state.value.articleQuery()
        val requestId = requestSequence.incrementAndGet()
        _state.update {
            it.copy(
                loading = true,
                errorMessage = null,
            )
        }
        viewModelScope.launch {
            when (
                val result = repository.articles(
                    feedId = query.feedId,
                    categoryId = query.categoryId,
                    unreadOnly = query.unreadOnly,
                    sort = query.sort,
                    limit = ARTICLE_PAGE_SIZE,
                    cursor = null,
                )
            ) {
                is AppResult.Success -> {
                    if (!isCurrentArticleRequest(requestId) || _state.value.articleQuery() != query) return@launch
                    val readStates = knownArticleReadStates()
                    val itemsWithReadStates = result.data.data.withReadStates(readStates)
                    _state.update {
                        it.copy(
                            items = itemsWithReadStates,
                            loading = false,
                        )
                    }
                    readStateManager.updateItems(itemsWithReadStates)
                    repository.prefetchHeroImages(result.data.data.map { it.heroImageUrl })
                }
                is AppResult.Error -> {
                    if (!isCurrentArticleRequest(requestId) || _state.value.articleQuery() != query) return@launch
                    _state.update { it.copy(errorMessage = result.message, loading = false) }
                }
            }
        }
    }

    fun loadMoreArticles() {
        // Article pagination is owned by Paging 3. This method remains as a
        // compatibility no-op for the fallback article tab contract.
    }

    fun updateArticleQueueSnapshot(articles: List<ArticleListItem>) {
        if (articles.isEmpty()) return
        val itemsWithReadStates = articles.withReadStates(knownArticleReadStates())
        _state.update { it.copy(items = itemsWithReadStates) }
        readStateManager.updateItems(itemsWithReadStates)
    }

    fun openArticle(id: String, forceRefresh: Boolean = false) {
        viewModelScope.launch {
            when (val result = repository.article(id, forceRefresh)) {
                is AppResult.Success -> {
                    _state.update { current ->
                        current.copy(
                            selectedArticle = result.data,
                        )
                    }
                    enrichmentManager.updateSelectedArticle(result.data)
                    readStateManager.updateSelectedArticle(result.data)

                    if (!result.data.isRead) {
                        markRead(id, true)
                    } else {
                        readStateManager.readStateStore.remember(id, true)
                        // Immediately update read state overrides for instant list update
                        _readStateOverrides.value = _readStateOverrides.value + (id to true)
                    }
                    enrichmentManager.maybeEnrichSelectedArticle(result.data)
                    articleWarmingManager.warmAdjacentArticles(id, _state.value.items)
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun closeArticle() {
        enrichmentManager.cancelEnrichment()
        articleWarmingManager.cancelWarming()
        _state.update { it.copy(selectedArticle = null) }
        enrichmentManager.updateSelectedArticle(null)
        readStateManager.updateSelectedArticle(null)
    }

    fun openAdjacentArticle(direction: Int) {
        val state = _state.value
        val selectedId = state.selectedArticle?.id ?: return
        val currentIndex = state.items.indexOfFirst { it.id == selectedId }
        if (currentIndex == -1) return
        val nextIndex = currentIndex + direction
        if (nextIndex !in state.items.indices) return
        openArticle(state.items[nextIndex].id)
    }

    fun markRead(articleId: String, read: Boolean) {
        val previousReadState = _state.value.articleReadState(articleId)
        val previousArticle = _state.value.selectedArticle?.takeIf { it.id == articleId }
        val feedId = _state.value.articleFeedId(articleId)

        readStateManager.markRead(
            articleId = articleId,
            read = read,
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
                    )
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
                // Build updated read state overrides immediately for instant list update
                val updatedOverrides = _readStateOverrides.value.toMutableMap()
                snapshot.items
                    .filter { snapshot.articleMatchesAffectedFeeds(it, affectedFeedIds) }
                    .forEach { updatedOverrides[it.id] = true }

                _state.update { current ->
                    current.items
                        .filter { current.articleMatchesAffectedFeeds(it, affectedFeedIds) }
                        .forEach { readStateManager.readStateStore.remember(it.id, true) }
                    current.selectedArticle
                        ?.takeIf { current.articleMatchesAffectedFeeds(it, affectedFeedIds) }
                        ?.let { readStateManager.readStateStore.remember(it.id, true) }

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
                        statusMessage = "Marked $markedCount articles as read",
                    )
                }
                // Apply read state overrides immediately
                _readStateOverrides.value = updatedOverrides
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
            )
        }
        // Immediately update the read state overrides so the list reflects changes instantly
        _readStateOverrides.value = _readStateOverrides.value + (articleId to isRead)
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

    private fun refreshArticlePager() {
        articlePagingGeneration += 1
        articlePagingQuery.value = _state.value.articleQuery().toArticlePageQuery(articlePagingGeneration)
    }

    private fun isCurrentArticleRequest(requestId: Long): Boolean =
        requestId == requestSequence.get()

    /**
     * Returns the current read state overrides for articles.
     * Used by ArticleReaderPane to sync read state when navigating between articles.
     */
    fun getReadStateOverrides(): Map<String, Boolean> = knownArticleReadStates()

    private fun knownArticleReadStates(): Map<String, Boolean> {
        val states = readStateManager.knownArticleReadStates()
        _readStateOverrides.value = states
        return states
    }

    private fun ArticlesUiState.articleReadState(articleId: String): Boolean? =
        selectedArticle?.takeIf { it.id == articleId }?.isRead
            ?: items.firstOrNull { it.id == articleId }?.isRead
            ?: knownArticleReadStates()[articleId]

    private fun ArticlesUiState.articleFeedId(articleId: String): String? =
        selectedArticle?.takeIf { it.id == articleId }?.feedId
            ?: items.firstOrNull { it.id == articleId }?.feedId

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
        const val TAG = "ArticlesViewModel"
        const val ARTICLE_PAGE_SIZE = 30
    }
}
