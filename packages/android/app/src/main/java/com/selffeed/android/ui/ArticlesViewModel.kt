package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.EnrichArticleResponse
import com.selffeed.android.network.MarkAllReadRequest
import com.selffeed.android.network.MarkReadRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong

data class ArticlesUiState(
    val items: List<ArticleListItem> = emptyList(),
    val selectedArticle: ArticleDetail? = null,
    val selectedFeedId: String? = null,
    val selectedCategoryId: String? = null,
    val articleCursor: String? = null,
    val hasMoreArticles: Boolean = false,
    val loadingMoreArticles: Boolean = false,
    val loading: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Owns the article list and reader: scope selection (category/feed), filter
 * (sort/hideRead), pagination, mark-read, mark-all-read, enrich. The actual
 * Pager is still driven by [MainViewModel] for now — this VM owns the
 * snapshot view used by the reader and the read/write operations.
 */
class ArticlesViewModel(
    private val repository: RssRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(ArticlesUiState())
    val state: StateFlow<ArticlesUiState> = _state.asStateFlow()

    private val requestSequence = AtomicLong(0)

    fun setScope(feedId: String?, categoryId: String?) {
        _state.update {
            it.copy(
                selectedFeedId = feedId,
                selectedCategoryId = categoryId,
                articleCursor = null,
                hasMoreArticles = false,
            )
        }
    }

    fun loadArticles() {
        val snapshot = _state.value
        val requestId = requestSequence.incrementAndGet()
        _state.update { it.copy(articleCursor = null, hasMoreArticles = false, loadingMoreArticles = false) }
        viewModelScope.launch {
            when (
                val result = repository.articles(
                    feedId = snapshot.selectedFeedId,
                    categoryId = snapshot.selectedCategoryId,
                    limit = 30,
                )
            ) {
                is AppResult.Success -> {
                    if (requestId != requestSequence.get()) return@launch
                    _state.update {
                        it.copy(
                            items = result.data.data,
                            articleCursor = result.data.cursor,
                            hasMoreArticles = result.data.hasMore,
                        )
                    }
                }
                is AppResult.Error -> {
                    if (requestId != requestSequence.get()) return@launch
                    _state.update { it.copy(errorMessage = result.message) }
                }
            }
        }
    }

    fun loadMoreArticles() {
        val snapshot = _state.value
        if (!snapshot.hasMoreArticles || snapshot.loadingMoreArticles) return
        val cursor = snapshot.articleCursor ?: return
        val requestId = requestSequence.incrementAndGet()
        _state.update { it.copy(loadingMoreArticles = true) }
        viewModelScope.launch {
            when (
                val result = repository.articles(
                    feedId = snapshot.selectedFeedId,
                    categoryId = snapshot.selectedCategoryId,
                    limit = 30,
                    cursor = cursor,
                )
            ) {
                is AppResult.Success -> {
                    if (requestId != requestSequence.get()) return@launch
                    _state.update {
                        it.copy(
                            items = it.items + result.data.data,
                            articleCursor = result.data.cursor,
                            hasMoreArticles = result.data.hasMore,
                            loadingMoreArticles = false,
                        )
                    }
                }
                is AppResult.Error -> {
                    if (requestId != requestSequence.get()) return@launch
                    _state.update { it.copy(loadingMoreArticles = false, errorMessage = result.message) }
                }
            }
        }
    }

    fun openArticle(id: String, forceRefresh: Boolean = false) {
        viewModelScope.launch {
            when (val result = repository.article(id, forceRefresh)) {
                is AppResult.Success -> {
                    _state.update {
                        it.copy(
                            selectedArticle = result.data,
                            items = it.items.map { a -> if (a.id == id) a.copy(isRead = true) else a },
                        )
                    }
                    if (forceRefresh) {
                        loadArticles()
                    } else {
                        // Optimistic local update; the repository's
                        // markRead handles persistence + the server round-trip.
                        markReadLocally(id, true)
                        repository.markRead(id, true)
                    }
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun closeArticle() {
        _state.update { it.copy(selectedArticle = null) }
    }

    fun markRead(articleId: String, read: Boolean) {
        viewModelScope.launch {
            when (val result = repository.markRead(articleId, read)) {
                is AppResult.Success -> {
                    markReadLocally(articleId, read)
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun markAllRead(feedId: String? = null, categoryId: String? = null) {
        viewModelScope.launch {
            when (val result = repository.markAllRead(feedId, categoryId)) {
                is AppResult.Success -> loadArticles()
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> {
        // Enrich is fire-and-forget at the repository level; this returns
        // immediately and updates state in the background. For UI status, the
        // call site should listen to state changes.
        viewModelScope.launch {
            when (val result = repository.enrichArticle(articleId)) {
                is AppResult.Success, is AppResult.Error -> Unit
            }
        }
        return AppResult.Success(EnrichArticleResponse(success = false, reason = "queued"))
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null) }
    }

    private fun markReadLocally(articleId: String, read: Boolean) {
        _state.update { state ->
            state.copy(
                items = state.items.map { a -> if (a.id == articleId) a.copy(isRead = read) else a },
                selectedArticle = state.selectedArticle?.let { sa -> if (sa.id == articleId) sa.copy(isRead = read) else sa },
            )
        }
    }

    class Factory(private val repository: RssRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            @Suppress("UNCHECKED_CAST")
            return ArticlesViewModel(repository) as T
        }
    }
}
