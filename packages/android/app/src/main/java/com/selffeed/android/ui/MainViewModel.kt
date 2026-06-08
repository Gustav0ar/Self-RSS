package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.selffeed.android.ui.utils.formatSyncSummary

enum class AuthMode { LOGIN, REGISTER }
enum class HomeTab { FEEDS, ARTICLES, SEARCH, SETTINGS, STATS }

data class AppUiState(
    val loading: Boolean = true,
    val isAuthenticated: Boolean = false,
    val authMode: AuthMode = AuthMode.LOGIN,
    val registrationEnabled: Boolean = false,
    val activeTab: HomeTab = HomeTab.ARTICLES,
    val isSyncingFeeds: Boolean = false,
    val user: User? = null,
    val categories: List<CategoryWithCounts> = emptyList(),
    val feeds: List<FeedWithCounts> = emptyList(),
    val articles: List<ArticleListItem> = emptyList(),
    val selectedCategoryId: String? = null,
    val selectedFeedId: String? = null,
    val selectedArticle: ArticleDetail? = null,
    val articleCursor: String? = null,
    val hasMoreArticles: Boolean = false,
    val loadingMoreArticles: Boolean = false,
    val searchQuery: String = "",
    val searchResults: List<ArticleListItem> = emptyList(),
    val searchCursor: String? = null,
    val hasMoreSearchResults: Boolean = false,
    val loadingMoreSearchResults: Boolean = false,
    val preferences: UserPreferences? = null,
    val stats: StatsResponse? = null,
    val debugResilienceSnapshot: Map<String, Long> = emptyMap(),
    val adminRegistrationLocked: Boolean? = null,
    val exportedOpml: String? = null,
    val lastOpmlImportSummary: OpmlImportSummary? = null,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
)

class MainViewModel(
    private val repository: RssRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()
    private var searchJob: Job? = null
    private var enrichArticleJob: Job? = null
    private val manuallyUnread = mutableSetOf<String>()

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            if (!repository.isLoggedIn()) {
                val registrationEnabled = loadRegistrationEnabled()
                _uiState.update {
                    it.copy(
                        loading = false,
                        isAuthenticated = false,
                        authMode = if (registrationEnabled) it.authMode else AuthMode.LOGIN,
                        registrationEnabled = registrationEnabled,
                    )
                }
                return@launch
            }

            when (val me = repository.me()) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            loading = false,
                            isAuthenticated = true,
                            user = me.data,
                        )
                    }
                    refreshAll()
                }

                is AppResult.Error -> {
                    val registrationEnabled = loadRegistrationEnabled()
                    _uiState.update {
                        it.copy(
                            loading = false,
                            isAuthenticated = false,
                            authMode = if (registrationEnabled) it.authMode else AuthMode.LOGIN,
                            registrationEnabled = registrationEnabled,
                            errorMessage = "Session expired. Please login again.",
                        )
                    }
                }
            }
        }
    }

    fun setAuthMode(mode: AuthMode) {
        if (mode == AuthMode.REGISTER && !_uiState.value.registrationEnabled) {
            _uiState.update {
                it.copy(authMode = AuthMode.LOGIN, errorMessage = "Registration is currently closed")
            }
            return
        }
        _uiState.update { it.copy(authMode = mode, errorMessage = null) }
    }

    fun setTab(tab: HomeTab) {
        _uiState.update { it.copy(activeTab = tab, errorMessage = null, statusMessage = null) }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, errorMessage = null, statusMessage = null) }
            when (val result = repository.login(email.trim(), password)) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            loading = false,
                            isAuthenticated = true,
                            user = result.data,
                            statusMessage = "Welcome back",
                        )
                    }
                    refreshAll()
                }

                is AppResult.Error -> {
                    _uiState.update { it.copy(loading = false, errorMessage = result.message) }
                }
            }
        }
    }

    fun register(email: String, password: String) {
        if (!_uiState.value.registrationEnabled) {
            _uiState.update {
                it.copy(
                    loading = false,
                    authMode = AuthMode.LOGIN,
                    errorMessage = "Registration is currently closed",
                    statusMessage = null,
                )
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, errorMessage = null, statusMessage = null) }
            when (val result = repository.register(email.trim(), password)) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            loading = false,
                            isAuthenticated = true,
                            user = result.data,
                            statusMessage = "Account created",
                        )
                    }
                    refreshAll()
                }

                is AppResult.Error -> {
                    _uiState.update { it.copy(loading = false, errorMessage = result.message) }
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            _uiState.value = AppUiState(
                loading = false,
                registrationEnabled = loadRegistrationEnabled(),
            )
        }
    }

    fun refreshAll() {
        loadCategories()
        loadFeeds()
        loadArticles()
        loadPreferences()
        loadStats()
        loadAdminSettings()
        loadDebugResilienceSnapshot()
    }

    fun refreshVisibleData() {
        if (!_uiState.value.isAuthenticated || !repository.isLoggedIn()) return

        loadCategories()
        loadFeeds()
        loadArticles()
        _uiState.value.selectedArticle?.id?.let { openArticle(it, forceRefresh = true) }
    }

    fun loadCategories() {
        viewModelScope.launch {
            when (val result = repository.categories()) {
                is AppResult.Success -> _uiState.update { it.copy(categories = result.data) }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun createCategory(name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.createCategory(name.trim())) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(statusMessage = "Category created") }
                    loadCategories()
                    loadStats()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun deleteCategory(id: String) {
        viewModelScope.launch {
            when (val result = repository.deleteCategory(id)) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            statusMessage = "Category deleted",
                            selectedCategoryId = null,
                        )
                    }
                    loadCategories()
                    loadFeeds()
                    loadArticles()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateCategory(id: String, name: String, parentCategoryId: String? = null) {
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.updateCategory(id, name.trim(), parentCategoryId)) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(statusMessage = "Category updated") }
                    loadCategories()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadFeeds() {
        viewModelScope.launch {
            // Always load all feeds to keep the navigation drawer populated correctly
            when (val result = repository.feeds(null)) {
                is AppResult.Success -> _uiState.update { it.copy(feeds = result.data) }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun createFeed(feedUrl: String, categoryId: String, title: String?) {
        if (feedUrl.isBlank() || categoryId.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.createFeed(feedUrl.trim(), categoryId, title?.trim()?.ifBlank { null })) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(statusMessage = "Feed added") }
                    loadFeeds()
                    loadArticles()
                    loadCategories()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun deleteFeed(id: String) {
        viewModelScope.launch {
            when (val result = repository.deleteFeed(id)) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(statusMessage = "Feed removed", selectedFeedId = null) }
                    loadFeeds()
                    loadArticles()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
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
                    _uiState.update { it.copy(statusMessage = "Feed updated") }
                    loadFeeds()
                    loadArticles()
                    loadCategories()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun syncAllFeeds() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSyncingFeeds = true, errorMessage = null) }
            when (val result = repository.syncAllFeeds()) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isSyncingFeeds = false,
                            statusMessage = formatSyncSummary(
                                synced = result.data.syncedFeeds,
                                failed = result.data.failedFeeds,
                            ),
                        )
                    }
                    loadFeeds()
                    loadArticles()
                    loadStats()
                    _uiState.value.selectedArticle?.id?.let { openArticle(it, forceRefresh = true) }
                }

                is AppResult.Error -> _uiState.update { it.copy(isSyncingFeeds = false, errorMessage = result.message) }
            }
        }
    }

    fun importOpml(fileName: String, fileBytes: ByteArray) {
        viewModelScope.launch {
            when (val result = repository.importOpml(fileName, fileBytes)) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            statusMessage = "Imported OPML: ${result.data.createdFeeds} feeds, ${result.data.createdCategories} categories",
                            lastOpmlImportSummary = result.data,
                        )
                    }
                    loadCategories()
                    loadFeeds()
                    loadArticles()
                    loadStats()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun exportOpml() {
        viewModelScope.launch {
            when (val result = repository.exportOpml()) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            exportedOpml = result.data,
                            statusMessage = "OPML export ready",
                        )
                    }
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun consumeExportedOpml() {
        _uiState.update { it.copy(exportedOpml = null) }
    }

    fun clearOpmlImportSummary() {
        _uiState.update { it.copy(lastOpmlImportSummary = null) }
    }

    fun selectCategory(id: String?) {
        _uiState.update { it.copy(selectedCategoryId = id, selectedFeedId = null, selectedArticle = null) }
        loadArticles()
    }

    fun selectFeed(id: String?) {
        _uiState.update { it.copy(selectedFeedId = id, selectedCategoryId = null, selectedArticle = null) }
        loadArticles()
    }

    fun loadArticles() {
        _uiState.update {
            it.copy(
                articleCursor = null,
                hasMoreArticles = false,
                loadingMoreArticles = false,
            )
        }
        viewModelScope.launch {
            val state = _uiState.value
            when (
                val result = repository.articles(
                    feedId = state.selectedFeedId,
                    categoryId = state.selectedCategoryId,
                    unreadOnly = state.preferences?.hideRead == true,
                    sort = state.preferences?.defaultSort,
                    limit = 30,
                )
            ) {
                is AppResult.Success -> _uiState.update {
                    it.copy(
                        articles = result.data.data,
                        articleCursor = result.data.cursor,
                        hasMoreArticles = result.data.hasMore,
                        loadingMoreArticles = false,
                    )
                }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadMoreArticles() {
        val snapshot = _uiState.value
        if (!snapshot.hasMoreArticles || snapshot.loadingMoreArticles || snapshot.articleCursor.isNullOrBlank()) {
            return
        }

        _uiState.update { it.copy(loadingMoreArticles = true) }
        viewModelScope.launch {
            val state = _uiState.value
            when (
                val result = repository.articles(
                    feedId = state.selectedFeedId,
                    categoryId = state.selectedCategoryId,
                    unreadOnly = state.preferences?.hideRead == true,
                    sort = state.preferences?.defaultSort,
                    limit = 30,
                    cursor = state.articleCursor,
                )
            ) {
                is AppResult.Success -> _uiState.update {
                    it.copy(
                        articles = it.articles + result.data.data,
                        articleCursor = result.data.cursor,
                        hasMoreArticles = result.data.hasMore,
                        loadingMoreArticles = false,
                    )
                }

                is AppResult.Error -> _uiState.update {
                    it.copy(
                        errorMessage = result.message,
                        loadingMoreArticles = false,
                    )
                }
            }
        }
    }

    fun openArticle(id: String, forceRefresh: Boolean = false) {
        viewModelScope.launch {
            when (val result = repository.article(id, forceRefresh = forceRefresh)) {
                is AppResult.Success -> {
                    _uiState.update { current ->
                        current.copy(
                            selectedArticle = result.data,
                            articles = current.articles.map { article ->
                                if (article.id == id) article.copy(isRead = true) else article
                            },
                        )
                    }
                    if (!result.data.isRead) {
                        markRead(id, true)
                    }
                    maybeEnrichSelectedArticle(result.data)
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun closeArticle() {
        enrichArticleJob?.cancel()
        _uiState.update { it.copy(selectedArticle = null) }
    }

    fun openAdjacentArticle(direction: Int) {
        val state = _uiState.value
        val selectedId = state.selectedArticle?.id ?: return
        val currentIndex = state.articles.indexOfFirst { it.id == selectedId }
        if (currentIndex == -1) return
        val nextIndex = currentIndex + direction
        if (nextIndex !in state.articles.indices) return
        openArticle(state.articles[nextIndex].id)
    }

    fun markRead(articleId: String, read: Boolean) {
        if (!read) {
            manuallyUnread.add(articleId)
        } else {
            manuallyUnread.remove(articleId)
        }

        viewModelScope.launch {
            when (val result = repository.markRead(articleId, read)) {
                is AppResult.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            articles = state.articles.map {
                                if (it.id == articleId) it.copy(isRead = result.data) else it
                            },
                            searchResults = state.searchResults.map {
                                if (it.id == articleId) it.copy(isRead = result.data) else it
                            },
                            selectedArticle = state.selectedArticle?.takeIf { it.id != articleId } ?: state.selectedArticle?.copy(isRead = result.data),
                        )
                    }
                    repository.invalidateArticleCaches(articleId)
                    loadCategories()
                    loadStats()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun markAllRead() {
        viewModelScope.launch {
            val state = _uiState.value
            when (val result = repository.markAllRead(state.selectedFeedId, state.selectedCategoryId)) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(statusMessage = "Marked ${result.data} articles as read") }
                    loadArticles()
                    loadCategories()
                    loadStats()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    private fun maybeEnrichSelectedArticle(article: ArticleDetail) {
        if (article.isEnriched || article.canonicalUrl.isNullOrBlank()) {
            return
        }

        enrichArticleJob?.cancel()
        enrichArticleJob = viewModelScope.launch {
            when (repository.enrichArticle(article.id)) {
                is AppResult.Success -> {
                    delay(800)
                    when (val refreshed = repository.article(article.id, forceRefresh = true)) {
                        is AppResult.Success -> {
                            _uiState.update { current ->
                                if (current.selectedArticle?.id != article.id) {
                                    current
                                } else {
                                    current.copy(selectedArticle = refreshed.data)
                                }
                            }
                        }
                        is AppResult.Error -> Unit
                    }
                }
                is AppResult.Error -> Unit
            }
        }
    }

    fun updateSearchQuery(query: String) {
        if (query.length < 2) {
            searchJob?.cancel()
        }
        _uiState.update {
            it.copy(
                searchQuery = query,
                searchCursor = null,
                hasMoreSearchResults = false,
                loadingMoreSearchResults = false,
                searchResults = if (query.length < 2) emptyList() else it.searchResults,
            )
        }
    }

    fun search() {
        val query = _uiState.value.searchQuery.trim()
        if (query.length < 2) {
            searchJob?.cancel()
            _uiState.update {
                it.copy(
                    searchResults = emptyList(),
                    searchCursor = null,
                    hasMoreSearchResults = false,
                    loadingMoreSearchResults = false,
                )
            }
            return
        }

        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            val latestQuery = _uiState.value.searchQuery.trim()
            if (latestQuery.length < 2) {
                return@launch
            }
            when (val result = repository.search(latestQuery, _uiState.value.selectedCategoryId)) {
                is AppResult.Success -> _uiState.update {
                    it.copy(
                        searchResults = result.data.data,
                        searchCursor = result.data.cursor,
                        hasMoreSearchResults = result.data.hasMore,
                        loadingMoreSearchResults = false,
                    )
                }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadMoreSearch() {
        val snapshot = _uiState.value
        val query = snapshot.searchQuery.trim()
        if (
            query.length < 2 ||
            !snapshot.hasMoreSearchResults ||
            snapshot.loadingMoreSearchResults ||
            snapshot.searchCursor.isNullOrBlank()
        ) {
            return
        }

        _uiState.update { it.copy(loadingMoreSearchResults = true) }
        viewModelScope.launch {
            val state = _uiState.value
            when (
                val result = repository.search(
                    query = query,
                    categoryId = state.selectedCategoryId,
                    cursor = state.searchCursor,
                )
            ) {
                is AppResult.Success -> _uiState.update {
                    it.copy(
                        searchResults = it.searchResults + result.data.data,
                        searchCursor = result.data.cursor,
                        hasMoreSearchResults = result.data.hasMore,
                        loadingMoreSearchResults = false,
                    )
                }

                is AppResult.Error -> _uiState.update {
                    it.copy(
                        errorMessage = result.message,
                        loadingMoreSearchResults = false,
                    )
                }
            }
        }
    }

    fun loadPreferences() {
        viewModelScope.launch {
            when (val result = repository.preferences()) {
                is AppResult.Success -> _uiState.update { it.copy(preferences = result.data) }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateHideRead(hideRead: Boolean) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(hideRead = hideRead))) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(preferences = result.data, statusMessage = "Preferences updated") }
                    loadArticles()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateTextSize(textSize: Int) {
        val clamped = textSize.coerceIn(12, 24)
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(textSize = clamped))) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(preferences = result.data, statusMessage = "Text size updated") }
                    loadArticles()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateDensity(density: String) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(density = density))) {
                is AppResult.Success -> _uiState.update { it.copy(preferences = result.data, statusMessage = "Density updated") }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateDefaultSort(defaultSort: String) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(defaultSort = defaultSort))) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(preferences = result.data, statusMessage = "Sort updated") }
                    loadArticles()
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateAutoMarkReadMode(mode: String) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(autoMarkReadMode = mode))) {
                is AppResult.Success -> _uiState.update { it.copy(preferences = result.data, statusMessage = "Auto mark updated") }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateFontFamily(fontFamily: String) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(fontFamily = fontFamily))) {
                is AppResult.Success -> _uiState.update { it.copy(preferences = result.data, statusMessage = "Font updated") }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateTheme(theme: String) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(theme = theme))) {
                is AppResult.Success -> _uiState.update { it.copy(preferences = result.data, statusMessage = "Theme updated") }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadStats() {
        viewModelScope.launch {
            when (val result = repository.stats()) {
                is AppResult.Success -> _uiState.update { it.copy(stats = result.data) }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
            loadDebugResilienceSnapshot()
        }
    }

    private fun loadDebugResilienceSnapshot() {
        if (!BuildConfig.DEBUG) return
        _uiState.update {
            it.copy(debugResilienceSnapshot = repository.getDebugResilienceSnapshot())
        }
    }

    fun resetDebugResilienceMetrics() {
        if (!BuildConfig.DEBUG) return
        repository.resetDebugResilienceMetrics()
        loadDebugResilienceSnapshot()
        _uiState.update { it.copy(statusMessage = "Debug resilience metrics reset") }
    }

    fun loadAdminSettings() {
        viewModelScope.launch {
            when (val result = repository.adminSettings()) {
                is AppResult.Success -> _uiState.update { it.copy(adminRegistrationLocked = result.data.registrationLocked) }
                is AppResult.Error -> Unit
            }
        }
    }

    fun toggleRegistrationLock(locked: Boolean) {
        viewModelScope.launch {
            when (val result = repository.updateAdminSettings(locked)) {
                is AppResult.Success -> {
                    _uiState.update {
                        it.copy(
                            adminRegistrationLocked = result.data.registrationLocked,
                            statusMessage = "Admin settings updated",
                        )
                    }
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(statusMessage = null, errorMessage = null) }
    }

    private suspend fun loadRegistrationEnabled(): Boolean =
        when (val result = repository.registrationStatus()) {
            is AppResult.Success -> result.data.registrationEnabled
            is AppResult.Error -> false
        }
}

class MainViewModelFactory(
    private val repository: RssRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MainViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
