package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.FeedRepository
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.CreateCategoryRequest
import com.selffeed.android.network.CreateFeedRequest
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.UpdateCategoryRequest
import com.selffeed.android.network.UpdateFeedRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FeedsUiState(
    val loading: Boolean = false,
    val categories: List<CategoryWithCounts> = emptyList(),
    val feeds: List<FeedWithCounts> = emptyList(),
    val lastSyncSummary: SyncResponse? = null,
    val errorMessage: String? = null,
    val statusMessage: String? = null,
)

/**
 * Owns the Feeds drawer: categories, feeds, category CRUD, feed CRUD, sync,
 * and OPML import/export. Read paths mirror the relevant subset of
 * the app shell consumes this ViewModel through a focused state/actions
 * contract instead of routing feed operations through a root ViewModel.
 */
class FeedsViewModel(
    private val repository: FeedRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(FeedsUiState())
    val state: StateFlow<FeedsUiState> = _state.asStateFlow()

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

    fun createCategory(name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.createCategory(name.trim(), null)) {
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
        if (feedUrl.isBlank() || categoryId.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.createFeed(feedUrl.trim(), categoryId, title?.trim()?.ifBlank { null })) {
                is AppResult.Success -> {
                    _state.update { it.copy(statusMessage = "Feed added") }
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateFeed(id: String, title: String?, categoryId: String?, pollingIntervalMinutes: Int?) {
        viewModelScope.launch {
            when (
                val result = repository.updateFeed(
                    id = id,
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

    fun syncAllFeeds() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, errorMessage = null) }
            when (val result = repository.syncAllFeeds()) {
                is AppResult.Success -> {
                    _state.update { it.copy(loading = false, lastSyncSummary = result.data) }
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(loading = false, errorMessage = result.message) }
            }
        }
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
                categoryId != null -> state.feeds.filter { it.categoryId == categoryId }.map { it.id }.toSet()
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
                    state.categories.map { it.copy(unreadCount = 0) }
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
                    _state.update { it.copy(statusMessage = "OPML imported: ${result.data.createdFeeds} feeds, ${result.data.createdCategories} categories") }
                    loadCategories()
                    loadFeeds()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, statusMessage = null) }
    }

    class Factory(private val repository: FeedRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            @Suppress("UNCHECKED_CAST")
            return FeedsViewModel(repository) as T
        }
    }
}
