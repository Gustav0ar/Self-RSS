package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SearchRepository
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchUiState(
    val query: String = "",
    val results: List<ArticleListItem> = emptyList(),
    val cursor: String? = null,
    val hasMore: Boolean = false,
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Owns the search tab: query debounce, results pagination. Designed to be
 * lightweight — search has no offline cache and no SSE, just an HTTP
 * round-trip with debounce.
 */
class SearchViewModel(
    private val repository: SearchRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    private var debounceJob: Job? = null

    fun setQuery(query: String) {
        _state.update { it.copy(query = query) }
        if (query.length < MIN_QUERY_LENGTH) {
            debounceJob?.cancel()
            _state.update { it.copy(results = emptyList(), cursor = null, hasMore = false) }
        }
    }

    fun search(debounceMs: Long = 300L) {
        val query = _state.value.query.trim()
        if (query.length < MIN_QUERY_LENGTH) {
            debounceJob?.cancel()
            return
        }
        debounceJob?.cancel()
        debounceJob = viewModelScope.launch {
            delay(debounceMs)
            // Re-read latest query after debounce in case the user kept typing.
            val current = _state.value.query.trim()
            if (current != query) return@launch
            runSearch(current, cursor = null)
        }
    }

    fun loadMore() {
        val snapshot = _state.value
        if (!snapshot.hasMore || snapshot.loadingMore || snapshot.cursor == null) return
        viewModelScope.launch {
            _state.update { it.copy(loadingMore = true) }
            runSearch(snapshot.query.trim(), snapshot.cursor)
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

    private suspend fun runSearch(query: String, cursor: String?) {
        when (val result = repository.search(query, cursor = cursor)) {
            is AppResult.Success -> {
                if (cursor == null) {
                    _state.update {
                        it.copy(
                            results = result.data.data,
                            cursor = result.data.cursor,
                            hasMore = result.data.hasMore,
                            loading = false,
                            loadingMore = false,
                        )
                    }
                } else {
                    _state.update {
                        it.copy(
                            results = it.results + result.data.data,
                            cursor = result.data.cursor,
                            hasMore = result.data.hasMore,
                            loadingMore = false,
                        )
                    }
                }
            }
            is AppResult.Error -> {
                _state.update {
                    it.copy(loading = false, loadingMore = false, errorMessage = result.message)
                }
            }
        }
    }

    companion object {
        const val MIN_QUERY_LENGTH = 2
    }

    class Factory(private val repository: SearchRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            @Suppress("UNCHECKED_CAST")
            return SearchViewModel(repository) as T
        }
    }
}
