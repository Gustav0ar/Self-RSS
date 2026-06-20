package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SearchRepository
import com.selffeed.android.network.ArticleListItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUiState(
    val query: String = "",
    val results: List<ArticleListItem> = emptyList(),
    val cursor: String? = null,
    val hasMore: Boolean = false,
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val selectedCategoryId: String? = null,
    val currentCategoryOnly: Boolean = false,
    val resultLimitReached: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Owns the search tab: query debounce, results pagination. Designed to be
 * lightweight — search has no offline cache and no SSE, just an HTTP
 * round-trip with debounce.
 */
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repository: SearchRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    private var debounceJob: Job? = null
    private var requestGeneration = 0L

    fun setQuery(query: String) {
        _state.update { it.copy(query = query) }
        if (query.length < MIN_QUERY_LENGTH) {
            debounceJob?.cancel()
            requestGeneration += 1
            _state.update {
                it.copy(
                    results = emptyList(),
                    cursor = null,
                    hasMore = false,
                    loading = false,
                    loadingMore = false,
                    resultLimitReached = false,
                )
            }
        }
    }

    fun search(debounceMs: Long = 300L) {
        val snapshot = _state.value
        val query = snapshot.query.trim()
        if (query.length < MIN_QUERY_LENGTH) {
            debounceJob?.cancel()
            return
        }
        val categoryId = activeCategoryId(snapshot)
        val generation = ++requestGeneration
        debounceJob?.cancel()
        _state.update {
            it.copy(
                cursor = null,
                hasMore = false,
                loading = true,
                loadingMore = false,
                errorMessage = null,
                resultLimitReached = false,
            )
        }
        debounceJob = viewModelScope.launch {
            delay(debounceMs)
            // Re-read latest query after debounce in case the user kept typing.
            val current = _state.value
            if (
                current.query.trim() != query ||
                activeCategoryId(current) != categoryId ||
                generation != requestGeneration
            ) {
                return@launch
            }
            runSearch(query, categoryId, cursor = null, generation = generation)
        }
    }

    fun loadMore() {
        val snapshot = _state.value
        if (!snapshot.hasMore || snapshot.loadingMore || snapshot.cursor == null) return
        val generation = requestGeneration
        val categoryId = activeCategoryId(snapshot)
        viewModelScope.launch {
            _state.update { it.copy(loadingMore = true) }
            runSearch(snapshot.query.trim(), categoryId, snapshot.cursor, generation)
        }
    }

    fun setSelectedCategoryId(categoryId: String?) {
        val before = _state.value
        val beforeActiveCategory = activeCategoryId(before)
        _state.update {
            it.copy(
                selectedCategoryId = categoryId,
                currentCategoryOnly = if (categoryId == null) false else it.currentCategoryOnly,
            )
        }
        val after = _state.value
        if (
            beforeActiveCategory != activeCategoryId(after) &&
            after.query.trim().length >= MIN_QUERY_LENGTH
        ) {
            search(debounceMs = 0L)
        }
    }

    fun setCurrentCategoryOnly(enabled: Boolean) {
        val snapshot = _state.value
        if (enabled && snapshot.selectedCategoryId == null) return
        if (snapshot.currentCategoryOnly == enabled) return
        _state.update { it.copy(currentCategoryOnly = enabled) }
        if (snapshot.query.trim().length >= MIN_QUERY_LENGTH) {
            search(debounceMs = 0L)
        }
    }

    fun applyArticleReadState(articleId: String, read: Boolean) {
        _state.update { state ->
            state.copy(
                results = state.results.map { article ->
                    if (article.id == articleId) article.copy(isRead = read) else article
                },
            )
        }
    }

    fun applyScopeMarkedRead(feedIds: Set<String>) {
        if (feedIds.isEmpty()) return
        _state.update { state ->
            state.copy(
                results = state.results.map { article ->
                    if (article.feedId in feedIds) article.copy(isRead = true) else article
                },
            )
        }
    }

    fun applyAllMarkedRead() {
        _state.update { state ->
            state.copy(results = state.results.map { it.copy(isRead = true) })
        }
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null) }
    }

    private suspend fun runSearch(
        query: String,
        categoryId: String?,
        cursor: String?,
        generation: Long,
    ) {
        when (val result = repository.search(query, categoryId = categoryId, cursor = cursor)) {
            is AppResult.Success -> {
                if (!isCurrentRequest(query, categoryId, generation)) return
                if (cursor == null) {
                    val page = result.data.data
                    val capped = page.take(MAX_RESULTS)
                    val reachedLimit = capped.size >= MAX_RESULTS && (result.data.hasMore || page.size > MAX_RESULTS)
                    _state.update {
                        it.copy(
                            results = capped,
                            cursor = result.data.cursor,
                            hasMore = result.data.hasMore && !reachedLimit,
                            resultLimitReached = reachedLimit,
                            loading = false,
                            loadingMore = false,
                        )
                    }
                } else {
                    _state.update {
                        val uncapped = it.results + result.data.data
                        val combined = uncapped.take(MAX_RESULTS)
                        val reachedLimit = combined.size >= MAX_RESULTS &&
                            (result.data.hasMore || uncapped.size > MAX_RESULTS)
                        it.copy(
                            results = combined,
                            cursor = result.data.cursor,
                            hasMore = result.data.hasMore && !reachedLimit,
                            resultLimitReached = reachedLimit,
                            loadingMore = false,
                        )
                    }
                }
            }
            is AppResult.Error -> {
                if (!isCurrentRequest(query, categoryId, generation)) return
                _state.update {
                    it.copy(loading = false, loadingMore = false, errorMessage = result.message)
                }
            }
        }
    }

    private fun activeCategoryId(state: SearchUiState): String? =
        if (state.currentCategoryOnly) state.selectedCategoryId else null

    private fun isCurrentRequest(query: String, categoryId: String?, generation: Long): Boolean {
        val current = _state.value
        return generation == requestGeneration &&
            current.query.trim() == query &&
            activeCategoryId(current) == categoryId
    }

    companion object {
        const val MIN_QUERY_LENGTH = 2
        const val MAX_RESULTS = 80
    }
}
