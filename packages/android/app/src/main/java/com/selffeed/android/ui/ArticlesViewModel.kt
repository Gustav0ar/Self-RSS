package com.selffeed.android.ui

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
import com.selffeed.android.ui.articles.ReadStateChangeSource
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
    private val openArticleSequence = AtomicLong(0)
    private var articlePagingGeneration = 0L

    init {
        // Initialize managers with viewModelScope
        readStateManager.setScope(viewModelScope)
        enrichmentManager.setScope(viewModelScope)
        articleWarmingManager.setScope(viewModelScope)

        // Forward read state manager events to our events flow
        viewModelScope.launch {
            readStateManager.events.collect { event ->
                applyReadStateEvent(event)
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
                    publishReadStateOverrides()
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
        publishReadStateOverrides()
    }

    fun openArticle(id: String, forceRefresh: Boolean = false) {
        val openRequestId = openArticleSequence.incrementAndGet()
        val optimisticArticle = _state.value.items
            .firstOrNull { it.id == id }
            ?.toArticleDetail(knownArticleReadStates()[id])
        if (optimisticArticle != null) {
            selectArticle(optimisticArticle)
            articleWarmingManager.warmAdjacentArticles(id, _state.value.items)
        }

        viewModelScope.launch {
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
                    articleWarmingManager.warmAdjacentArticles(id, _state.value.items)
                }
                is AppResult.Error -> {
                    if (openRequestId != openArticleSequence.get()) return@launch
                    _state.update { it.copy(errorMessage = result.message) }
                }
            }
        }
    }

    fun onArticleDisplayed(articleId: String) {
        val article = _state.value.selectedArticle?.takeIf { it.id == articleId } ?: return
        if (!article.isRead) {
            markReadAutomatically(articleId)
        } else {
            readStateManager.readStateStore.remember(articleId, true)
            publishReadStateOverrides(articleId to true)
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
        publishReadStateOverrides(articleId to isRead)
    }

    private fun selectArticle(article: ArticleDetail) {
        _state.update { current ->
            current.copy(selectedArticle = article)
        }
        enrichmentManager.updateSelectedArticle(article)
        readStateManager.updateSelectedArticle(article)
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
            )
        }
        publishReadStateOverrides(*rememberedReadStates.toTypedArray())
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
            isEnriched = false,
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
        const val ARTICLE_PAGE_SIZE = 30
    }
}
