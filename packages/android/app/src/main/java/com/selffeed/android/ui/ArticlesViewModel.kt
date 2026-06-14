package com.selffeed.android.ui

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.cachedIn
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ArticlePageQuery
import com.selffeed.android.data.repository.ArticleRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.ReadStateSyncEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
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
    private val repository: ArticleRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(ArticlesUiState())
    val state: StateFlow<ArticlesUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<ArticleFeatureEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<ArticleFeatureEvent> = _events.asSharedFlow()

    private val articlePagingQuery = MutableStateFlow(ArticlePageQuery())
    @OptIn(ExperimentalCoroutinesApi::class)
    val articlePagingData = articlePagingQuery
        .flatMapLatest { query -> repository.articlePagingData(query, ::knownArticleReadStates) }
        .cachedIn(viewModelScope)

    private val requestSequence = AtomicLong(0)
    private val manuallyUnread = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private val articleReadStates = ArticleReadStateStore()
    private val backgroundEnrichAttemptedAt = java.util.Collections.synchronizedMap(mutableMapOf<String, Long>())
    private var articlePagingGeneration = 0L
    private var enrichArticleJob: Job? = null
    private var warmNextArticlesJob: Job? = null
    private var readStateSyncJob: Job? = null

    fun setScope(feedId: String?, categoryId: String?) {
        _state.update {
            it.copy(
                selectedFeedId = feedId,
                selectedCategoryId = categoryId,
                selectedArticle = null,
                errorMessage = null,
            )
        }
        refreshArticlePager()
        loadArticles()
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
            refreshArticlePager()
            loadArticles()
        }
    }

    fun refreshArticles() {
        loadArticles()
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
                    _state.update {
                        it.copy(
                            items = result.data.data.withReadStates(readStates),
                            loading = false,
                        )
                    }
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
        _state.update { it.copy(items = articles.withReadStates(knownArticleReadStates())) }
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
                    if (!result.data.isRead) {
                        markRead(id, true)
                    } else {
                        rememberArticleReadState(id, true)
                    }
                    maybeEnrichSelectedArticle(result.data)
                    warmAdjacentArticles(id)
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun closeArticle() {
        enrichArticleJob?.cancel()
        warmNextArticlesJob?.cancel()
        _state.update { it.copy(selectedArticle = null) }
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
        if (!read) manuallyUnread.add(articleId) else manuallyUnread.remove(articleId)

        viewModelScope.launch {
            val previousReadState = _state.value.articleReadState(articleId)
            val previousArticle = _state.value.selectedArticle?.takeIf { it.id == articleId }
            applyArticleReadState(
                articleId = articleId,
                feedId = _state.value.articleFeedId(articleId),
                isRead = read,
                previousReadState = previousReadState,
                emitEvent = false,
            )
            when (val result = repository.markRead(articleId, read)) {
                is AppResult.Success -> {
                    val confirmed = result.data
                    rememberArticleReadState(articleId, confirmed)
                    applyArticleReadState(
                        articleId = articleId,
                        feedId = _state.value.articleFeedId(articleId),
                        isRead = confirmed,
                        previousReadState = previousReadState,
                        emitEvent = true,
                    )
                }
                is AppResult.Error -> _state.update { state ->
                    state.copy(
                        items = previousReadState?.let { previous ->
                            state.items.map { if (it.id == articleId) it.copy(isRead = previous) else it }
                        } ?: state.items,
                        selectedArticle = previousArticle ?: state.selectedArticle,
                        errorMessage = result.message,
                    )
                }
            }
        }
    }

    fun markAllRead() {
        viewModelScope.launch {
            val snapshot = _state.value
            when (val result = repository.markAllRead(snapshot.selectedFeedId, snapshot.selectedCategoryId)) {
                is AppResult.Success -> {
                    val affectedFeedIds = snapshot.selectedFeedId?.let(::setOf).orEmpty()
                    _state.update { current ->
                        current.items
                            .filter { current.articleMatchesCurrentScope(it) }
                            .forEach { rememberArticleReadState(it.id, true) }
                        current.selectedArticle
                            ?.takeIf { current.articleMatchesCurrentScope(it) }
                            ?.let { rememberArticleReadState(it.id, true) }

                        current.copy(
                            items = current.items.map { article ->
                                if (current.articleMatchesCurrentScope(article)) article.copy(isRead = true) else article
                            },
                            selectedArticle = current.selectedArticle?.let { article ->
                                if (current.articleMatchesCurrentScope(article)) article.copy(isRead = true) else article
                            },
                            statusMessage = "Marked ${result.data} articles as read",
                        )
                    }
                    _events.emit(
                        ArticleFeatureEvent.ScopeMarkedRead(
                            feedId = snapshot.selectedFeedId,
                            categoryId = snapshot.selectedCategoryId,
                            affectedFeedIds = affectedFeedIds,
                            markedCount = result.data,
                        ),
                    )
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> {
        viewModelScope.launch {
            when (repository.enrichArticle(articleId)) {
                is AppResult.Success, is AppResult.Error -> Unit
            }
        }
        return AppResult.Success(EnrichArticleResponse(success = false, reason = "queued"))
    }

    fun startReadStateSync() {
        if (readStateSyncJob?.isActive == true) return
        readStateSyncJob = viewModelScope.launch {
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

    fun clearSessionReadStateMemory() {
        articleReadStates.clear()
        manuallyUnread.clear()
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, statusMessage = null) }
    }

    override fun onCleared() {
        enrichArticleJob?.cancel()
        warmNextArticlesJob?.cancel()
        stopReadStateSync()
        super.onCleared()
    }

    private suspend fun applyReadStateSyncEvent(event: ReadStateSyncEvent) {
        when (event) {
            is ArticleReadStateChangedEvent -> applyArticleReadStateChanged(event)
            is ArticlesMarkedReadEvent -> applyArticlesMarkedRead(event)
        }
    }

    private suspend fun applyArticleReadStateChanged(event: ArticleReadStateChangedEvent) {
        repository.invalidateReadStateCaches(event.articleId)
        val previous = _state.value.articleReadState(event.articleId)
        rememberArticleReadState(event.articleId, event.isRead)
        var shouldReloadArticles = false
        _state.update { state ->
            shouldReloadArticles = !event.isRead &&
                state.hideRead &&
                state.isFeedVisible(event.feedId) &&
                state.items.none { it.id == event.articleId }
            state.copy(
                items = state.items.map {
                    if (it.id == event.articleId) it.copy(isRead = event.isRead) else it
                },
                selectedArticle = state.selectedArticle?.let {
                    if (it.id == event.articleId) it.copy(isRead = event.isRead) else it
                },
            )
        }
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
        if (shouldReloadArticles) loadArticles()
    }

    private suspend fun applyArticlesMarkedRead(event: ArticlesMarkedReadEvent) {
        repository.invalidateReadStateCaches()
        val feedIds = event.feedIds.toSet()
        _state.update { state ->
            state.copy(
                items = state.items.map { article ->
                    if (article.feedId in feedIds) {
                        rememberArticleReadState(article.id, true)
                        article.copy(isRead = true)
                    } else {
                        article
                    }
                },
                selectedArticle = state.selectedArticle?.let { article ->
                    if (article.feedId in feedIds) {
                        rememberArticleReadState(article.id, true)
                        article.copy(isRead = true)
                    } else {
                        article
                    }
                },
            )
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

    private fun applyArticleReadState(
        articleId: String,
        feedId: String?,
        isRead: Boolean,
        previousReadState: Boolean?,
        emitEvent: Boolean,
    ) {
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
        if (emitEvent) {
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
    }

    private fun maybeEnrichSelectedArticle(article: ArticleDetail) {
        if (article.isEnriched || article.canonicalUrl.isNullOrBlank()) return
        enrichArticleJob?.cancel()
        enrichArticleJob = viewModelScope.launch {
            when (repository.enrichArticle(article.id)) {
                is AppResult.Success -> {
                    delay(ARTICLE_ENRICH_REFRESH_DELAY_MS)
                    when (val refreshed = repository.article(article.id, forceRefresh = true)) {
                        is AppResult.Success -> _state.update {
                            if (it.selectedArticle?.id == article.id) it.copy(selectedArticle = refreshed.data) else it
                        }
                        is AppResult.Error -> Unit
                    }
                }
                is AppResult.Error -> Unit
            }
        }
    }

    private fun warmAdjacentArticles(articleId: String) {
        val state = _state.value
        val currentIndex = state.items.indexOfFirst { it.id == articleId }
        if (currentIndex == -1) return

        val previous = state.items
            .asReversed()
            .drop(state.items.size - 1 - currentIndex)
            .take(NEXT_ARTICLE_WARM_LIMIT)
        val next = state.items
            .drop(currentIndex + 1)
            .take(NEXT_ARTICLE_WARM_LIMIT)
        val articlesToWarm = (previous + next).distinct()
        if (articlesToWarm.isEmpty()) return

        repository.prefetchHeroImages(articlesToWarm.map { it.heroImageUrl })
        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = viewModelScope.launch {
            for (nextArticleId in articlesToWarm.map { it.id }) {
                val detail = repository.cachedArticleDetail(nextArticleId)
                    ?: when (val prefetched = repository.prefetchArticle(nextArticleId)) {
                        is AppResult.Success -> prefetched.data
                        is AppResult.Error -> continue
                    }
                repository.prefetchHeroImages(listOf(detail.heroImageUrl))
                if (!shouldAttemptBackgroundEnrichment(detail)) continue
                when (val enriched = repository.enrichArticle(nextArticleId, invalidateCaches = false)) {
                    is AppResult.Success -> {
                        if (enriched.data.success || enriched.data.reason == "already_enriched") {
                            delay(ARTICLE_ENRICH_REFRESH_DELAY_MS)
                            repository.refreshArticleDetail(nextArticleId)
                        }
                    }
                    is AppResult.Error -> Unit
                }
            }
        }
    }

    private fun shouldAttemptBackgroundEnrichment(article: ArticleDetail): Boolean {
        if (article.isEnriched || article.canonicalUrl.isNullOrBlank()) return false
        val now = System.currentTimeMillis()
        backgroundEnrichAttemptedAt.entries.removeIf {
            now - it.value >= ARTICLE_BACKGROUND_ENRICH_RETRY_MS
        }
        val lastAttemptAt = backgroundEnrichAttemptedAt[article.id]
        if (lastAttemptAt != null && now - lastAttemptAt < ARTICLE_BACKGROUND_ENRICH_RETRY_MS) return false
        backgroundEnrichAttemptedAt[article.id] = now
        return true
    }

    private fun refreshArticlePager() {
        articlePagingGeneration += 1
        articlePagingQuery.value = _state.value.articleQuery().toArticlePageQuery(articlePagingGeneration)
    }

    private fun isCurrentArticleRequest(requestId: Long): Boolean =
        requestId == requestSequence.get()

    private fun rememberArticleReadState(articleId: String, isRead: Boolean) {
        if (articleId in manuallyUnread && isRead) return
        articleReadStates.remember(articleId, isRead)
    }

    private fun knownArticleReadStates(): Map<String, Boolean> =
        _state.value.let {
            articleReadStates.snapshot(
                articles = it.items,
                searchResults = emptyList(),
                selectedArticle = it.selectedArticle,
            )
        }

    private fun ArticlesUiState.articleReadState(articleId: String): Boolean? =
        selectedArticle?.takeIf { it.id == articleId }?.isRead
            ?: items.firstOrNull { it.id == articleId }?.isRead
            ?: knownArticleReadStates()[articleId]

    private fun ArticlesUiState.articleFeedId(articleId: String): String? =
        selectedArticle?.takeIf { it.id == articleId }?.feedId
            ?: items.firstOrNull { it.id == articleId }?.feedId

    private fun ArticlesUiState.isFeedVisible(feedId: String): Boolean =
        selectedFeedId == null || selectedFeedId == feedId

    private fun ArticlesUiState.articleMatchesCurrentScope(article: ArticleListItem): Boolean {
        return selectedFeedId == null || article.feedId == selectedFeedId
    }

    private fun ArticlesUiState.articleMatchesCurrentScope(article: ArticleDetail): Boolean {
        return selectedFeedId == null || article.feedId == selectedFeedId
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
        const val ARTICLE_ENRICH_REFRESH_DELAY_MS = 600L
        const val ARTICLE_BACKGROUND_ENRICH_RETRY_MS = 10 * 60 * 1000L
        const val NEXT_ARTICLE_WARM_LIMIT = 2
        const val READ_STATE_SYNC_RESTART_DELAY_MS = 10_000L
    }
}
