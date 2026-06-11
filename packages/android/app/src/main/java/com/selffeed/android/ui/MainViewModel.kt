package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.cachedIn
import android.os.SystemClock
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ArticlePageQuery
import com.selffeed.android.data.ArticlePagingSource
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.selffeed.android.ui.utils.formatSyncSummary
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.util.concurrent.atomic.AtomicLong

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

data class ArticlesUiState(
    val articles: List<ArticleListItem> = emptyList(),
    val selectedArticle: ArticleDetail? = null,
    val hasMoreArticles: Boolean = false,
    val loadingMoreArticles: Boolean = false,
    val isSyncingFeeds: Boolean = false,
)

data class ReaderUiState(
    val selectedArticle: ArticleDetail? = null,
    val articles: List<ArticleListItem> = emptyList(),
)

data class ChromeUiState(
    val activeTab: HomeTab = HomeTab.ARTICLES,
    val selectedFeedId: String? = null,
    val selectedCategoryId: String? = null,
    val selectedArticle: ArticleDetail? = null,
    val articlesLoaded: Boolean = false,
    val feeds: List<FeedWithCounts> = emptyList(),
    val categories: List<CategoryWithCounts> = emptyList(),
)

class MainViewModel(
    private val repository: RssRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()
    val themePreference: StateFlow<String> = uiState
        .map { normalizeThemePreference(it.preferences?.theme ?: "system") }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "system")
    val articlesState: StateFlow<ArticlesUiState> = uiState
        .map {
            ArticlesUiState(
                articles = it.articles,
                selectedArticle = it.selectedArticle,
                hasMoreArticles = it.hasMoreArticles,
                loadingMoreArticles = it.loadingMoreArticles,
                isSyncingFeeds = it.isSyncingFeeds,
            )
        }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ArticlesUiState())
    val readerState: StateFlow<ReaderUiState> = uiState
        .map { ReaderUiState(selectedArticle = it.selectedArticle, articles = it.articles) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ReaderUiState())
    val chromeState: StateFlow<ChromeUiState> = uiState
        .map {
            ChromeUiState(
                activeTab = it.activeTab,
                selectedFeedId = it.selectedFeedId,
                selectedCategoryId = it.selectedCategoryId,
                selectedArticle = it.selectedArticle,
                articlesLoaded = it.articles.isNotEmpty(),
                feeds = it.feeds,
                categories = it.categories,
            )
        }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ChromeUiState())
    private val articlePagingQuery = MutableStateFlow(ArticlePageQuery())
    @OptIn(ExperimentalCoroutinesApi::class)
    val articlePagingData = articlePagingQuery
        .flatMapLatest { query ->
            Pager(
                config = PagingConfig(
                    pageSize = ARTICLE_PAGE_SIZE,
                    initialLoadSize = ARTICLE_PAGE_SIZE,
                    prefetchDistance = ARTICLE_PAGING_PREFETCH_DISTANCE,
                    enablePlaceholders = false,
                ),
                pagingSourceFactory = { ArticlePagingSource(repository, query) },
            ).flow
        }
        .cachedIn(viewModelScope)
    private var searchJob: Job? = null
    private var enrichArticleJob: Job? = null
    private var warmNextArticlesJob: Job? = null
    private var readStateSyncJob: Job? = null
    // Atomic request counter. The legacy `loadArticles`/`loadMoreArticles`
    // snapshot path and the Pager share the same backing data, so the two
    // must not race. We track the latest request id atomically and discard
    // stale results on completion.
    private val articleRequestSequence = AtomicLong(0)
    private var articlePagingGeneration = 0L
    private var lastVisibleRefreshAtMs = 0L
    private val manuallyUnread = mutableSetOf<String>()
    private val backgroundEnrichAttemptedAt = mutableMapOf<String, Long>()

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
                    startReadStateSync()
                }

                is AppResult.Error -> {
                    stopReadStateSync()
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
                    startReadStateSync()
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
                    startReadStateSync()
                }

                is AppResult.Error -> {
                    _uiState.update { it.copy(loading = false, errorMessage = result.message) }
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            stopReadStateSync()
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
        // Re-drive the Pager with the current scope so the UI list and the
        // snapshot stay in sync. Using setArticleScope here (not
        // loadArticles) ensures the Pager's first page is also re-fetched
        // after login.
        val current = _uiState.value
        setArticleScope(feedId = current.selectedFeedId, categoryId = current.selectedCategoryId)
        loadPreferences()
        loadStats()
        loadAdminSettings()
        loadDebugResilienceSnapshot()
    }

    fun refreshVisibleData() {
        if (!_uiState.value.isAuthenticated || !repository.isLoggedIn()) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastVisibleRefreshAtMs < RESUME_REFRESH_MIN_INTERVAL_MS) return
        lastVisibleRefreshAtMs = now

        loadCategories()
        loadFeeds()
        val current = _uiState.value
        setArticleScope(feedId = current.selectedFeedId, categoryId = current.selectedCategoryId)
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
        setArticleScope(feedId = null, categoryId = id)
    }

    fun selectFeed(id: String?) {
        setArticleScope(feedId = id, categoryId = null)
    }

    /**
     * Refresh the snapshot article list for the current scope. Does *not*
     * drive the Pager — callers that need a Pager refresh on a real scope
     * change should use [setArticleScope] or [setArticleFilter] instead.
     * Background refreshes (after CRUD operations, mark-all-read, sync) use
     * this method so they do not race the Pager's own first-page fetch.
     */
    fun loadArticles() {
        val query = _uiState.value.articleQuery()
        val requestId = articleRequestSequence.incrementAndGet()
        _uiState.update {
            it.copy(
                articleCursor = null,
                hasMoreArticles = false,
                loadingMoreArticles = false,
            )
        }
        viewModelScope.launch {
            when (
                val result = repository.articles(
                    feedId = query.feedId,
                    categoryId = query.categoryId,
                    unreadOnly = query.unreadOnly,
                    sort = query.sort,
                    limit = 30,
                )
            ) {
                is AppResult.Success -> _uiState.update { current ->
                    if (!isCurrentArticleRequest(requestId) || current.articleQuery() != query) {
                        current
                    } else {
                        current.copy(
                            articles = result.data.data,
                            articleCursor = result.data.cursor,
                            hasMoreArticles = result.data.hasMore,
                            loadingMoreArticles = false,
                        )
                    }
                }
                is AppResult.Error -> _uiState.update { current ->
                    if (!isCurrentArticleRequest(requestId) || current.articleQuery() != query) {
                        current
                    } else {
                        current.copy(errorMessage = result.message)
                    }
                }
            }
        }
    }

    /**
     * Apply a new visible scope (feed / category) and refresh both the
     * legacy snapshot list and the Pager. Pager and snapshot are kept in
     * lock-step so the UI can read from either without risking a stale
     * state. The Pager is only re-driven on a true scope change so a
     * background refresh that calls [loadArticles] does not re-fetch the
     * Pager's first page on top of itself.
     */
    fun setArticleScope(feedId: String?, categoryId: String?) {
        val previous = _uiState.value
        val scopeChanged =
            previous.selectedFeedId != feedId || previous.selectedCategoryId != categoryId
        _uiState.update {
            it.copy(
                selectedFeedId = feedId,
                selectedCategoryId = categoryId,
                selectedArticle = null,
            )
        }
        if (scopeChanged) {
            val query = _uiState.value.articleQuery()
            articlePagingGeneration += 1
            articlePagingQuery.value = query.toArticlePageQuery(articlePagingGeneration)
        }
        loadArticles()
    }

    /**
     * Apply a new sort or hide-read filter. The Pager is re-driven so the
     * UI list and snapshot stay in sync. Callers are expected to have
     * already updated the prefs in [_uiState]; this method just re-fetches
     * the article list under the new query. Pass `null` for either
     * parameter to keep the current value.
     */
    fun setArticleFilter(sort: String?, hideRead: Boolean?) {
        val previous = _uiState.value
        val currentPrefs = previous.preferences
        val nextSort = sort ?: currentPrefs?.defaultSort
        val nextHideRead = hideRead ?: currentPrefs?.hideRead ?: false
        val query = ArticleQuery(
            feedId = previous.selectedFeedId,
            categoryId = previous.selectedCategoryId,
            unreadOnly = nextHideRead,
            sort = nextSort,
        )
        articlePagingGeneration += 1
        articlePagingQuery.value = query.toArticlePageQuery(articlePagingGeneration)
        loadArticles()
    }

    fun loadMoreArticles() {
        val snapshot = _uiState.value
        if (!snapshot.hasMoreArticles || snapshot.loadingMoreArticles || snapshot.articleCursor.isNullOrBlank()) {
            return
        }

        val requestId = articleRequestSequence.incrementAndGet()
        val query = snapshot.articleQuery()
        val cursor = snapshot.articleCursor
        _uiState.update { it.copy(loadingMoreArticles = true) }
        viewModelScope.launch {
            when (
                val result = repository.articles(
                    feedId = query.feedId,
                    categoryId = query.categoryId,
                    unreadOnly = query.unreadOnly,
                    sort = query.sort,
                    limit = 30,
                    cursor = cursor,
                )
            ) {
                is AppResult.Success -> _uiState.update { current ->
                    if (!isCurrentArticleRequest(requestId) || current.articleQuery() != query) {
                        current
                    } else {
                        current.copy(
                            articles = current.articles + result.data.data,
                            articleCursor = result.data.cursor,
                            hasMoreArticles = result.data.hasMore,
                            loadingMoreArticles = false,
                        )
                    }
                }

                is AppResult.Error -> _uiState.update { current ->
                    if (!isCurrentArticleRequest(requestId) || current.articleQuery() != query) {
                        current
                    } else {
                        current.copy(
                            errorMessage = result.message,
                            loadingMoreArticles = false,
                        )
                    }
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
                    warmNextArticlesAfter(id)
                }

                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateArticleQueueSnapshot(articles: List<ArticleListItem>) {
        if (articles.isEmpty()) return
        _uiState.update { current ->
            val readStates = current.articles.associate { it.id to it.isRead }
            current.copy(
                articles = articles.map { article ->
                    readStates[article.id]?.let { article.copy(isRead = it) } ?: article
                },
            )
        }
    }

    fun closeArticle() {
        enrichArticleJob?.cancel()
        warmNextArticlesJob?.cancel()
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
                    delay(ARTICLE_ENRICH_REFRESH_DELAY_MS)
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

    private fun warmNextArticlesAfter(articleId: String) {
        val state = _uiState.value
        val currentIndex = state.articles.indexOfFirst { it.id == articleId }
        if (currentIndex == -1) {
            return
        }

        val articlesToWarm = state.articles
            .drop(currentIndex + 1)
            .take(NEXT_ARTICLE_WARM_LIMIT)
        if (articlesToWarm.isEmpty()) {
            return
        }

        repository.prefetchHeroImages(articlesToWarm.map { it.heroImageUrl })
        val articleIds = articlesToWarm.map { it.id }.distinct()
        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = viewModelScope.launch {
            for (nextArticleId in articleIds) {
                val detail = repository.cachedArticleDetail(nextArticleId)
                    ?: when (val prefetched = repository.prefetchArticle(nextArticleId)) {
                        is AppResult.Success -> prefetched.data
                        is AppResult.Error -> continue
                    }
                repository.prefetchHeroImages(listOf(detail.heroImageUrl))

                if (!shouldAttemptBackgroundEnrichment(detail)) {
                    continue
                }

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
        if (article.isEnriched || article.canonicalUrl.isNullOrBlank()) {
            return false
        }

        val now = System.currentTimeMillis()
        backgroundEnrichAttemptedAt.entries.removeIf {
            now - it.value >= ARTICLE_BACKGROUND_ENRICH_RETRY_MS
        }
        val lastAttemptAt = backgroundEnrichAttemptedAt[article.id]
        if (lastAttemptAt != null && now - lastAttemptAt < ARTICLE_BACKGROUND_ENRICH_RETRY_MS) {
            return false
        }

        backgroundEnrichAttemptedAt[article.id] = now
        return true
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
                is AppResult.Success -> {
                    val previousQuery = _uiState.value.articleQuery()
                    val normalizedPreferences = result.data.withNormalizedTheme()
                    _uiState.update { it.copy(preferences = normalizedPreferences) }
                    if (result.data.theme != normalizedPreferences.theme) {
                        persistNormalizedTheme(normalizedPreferences.theme)
                    }
                    val currentQuery = _uiState.value.articleQuery()
                    if (_uiState.value.isAuthenticated && currentQuery != previousQuery) {
                        // The server returned a different sort or hide-read
                        // than we have cached. Re-drive the Pager so the UI
                        // list and snapshot stay in sync.
                        articlePagingGeneration += 1
                        articlePagingQuery.value =
                            currentQuery.toArticlePageQuery(articlePagingGeneration)
                        loadArticles()
                    }
                }
                is AppResult.Error -> _uiState.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateHideRead(hideRead: Boolean) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(hideRead = hideRead))) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(preferences = result.data, statusMessage = "Preferences updated") }
                    setArticleFilter(sort = null, hideRead = hideRead)
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
                    setArticleFilter(sort = defaultSort, hideRead = null)
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
        val normalizedTheme = normalizeThemePreference(theme)
        viewModelScope.launch {
            when (val result = repository.updatePreferences(UpdatePreferencesRequest(theme = normalizedTheme))) {
                is AppResult.Success -> _uiState.update {
                    it.copy(
                        preferences = result.data.withNormalizedTheme(),
                        statusMessage = "Theme updated",
                    )
                }
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

    override fun onCleared() {
        enrichArticleJob?.cancel()
        warmNextArticlesJob?.cancel()
        stopReadStateSync()
        super.onCleared()
    }

    private fun startReadStateSync() {
        if (readStateSyncJob?.isActive == true) return
        readStateSyncJob = viewModelScope.launch {
            repository.readStateEvents().collect { event ->
                if (event.clientId != null && event.clientId == repository.clientId()) {
                    return@collect
                }
                applyReadStateSyncEvent(event)
            }
        }
    }

    private fun stopReadStateSync() {
        readStateSyncJob?.cancel()
        readStateSyncJob = null
    }

    private suspend fun applyReadStateSyncEvent(event: ReadStateSyncEvent) {
        when (event) {
            is ArticleReadStateChangedEvent -> applyArticleReadStateChanged(event)
            is ArticlesMarkedReadEvent -> applyArticlesMarkedRead(event)
        }
    }

    private suspend fun applyArticleReadStateChanged(event: ArticleReadStateChangedEvent) {
        repository.invalidateReadStateCaches(event.articleId)
        var shouldReloadArticles = false

        _uiState.update { state ->
            val previousReadState = state.articleReadState(event.articleId)
            val changed = previousReadState?.let { it != event.isRead } ?: true
            val unreadDelta = if (!changed) 0 else if (event.isRead) -1 else 1
            val feed = state.feeds.firstOrNull { it.id == event.feedId }
            val hideRead = state.preferences?.hideRead == true
            val visibleFeed = state.isFeedVisible(event.feedId)
            shouldReloadArticles = !event.isRead &&
                hideRead &&
                visibleFeed &&
                state.articles.none { it.id == event.articleId }

            state.copy(
                articles = state.articles.map { article ->
                    if (article.id == event.articleId) article.copy(isRead = event.isRead) else article
                },
                searchResults = state.searchResults.map { article ->
                    if (article.id == event.articleId) article.copy(isRead = event.isRead) else article
                },
                selectedArticle = state.selectedArticle?.let { article ->
                    if (article.id == event.articleId) article.copy(isRead = event.isRead) else article
                },
                feeds = if (unreadDelta == 0) {
                    state.feeds
                } else {
                    state.feeds.map { currentFeed ->
                        if (currentFeed.id == event.feedId) {
                            currentFeed.copy(
                                unreadCount = (currentFeed.unreadCount + unreadDelta).coerceAtLeast(0),
                            )
                        } else {
                            currentFeed
                        }
                    }
                },
                categories = if (unreadDelta == 0 || feed == null) {
                    state.categories
                } else {
                    state.categories.withUnreadDelta(feed.categoryId, unreadDelta)
                },
                stats = if (unreadDelta == 0) {
                    state.stats
                } else {
                    state.stats?.withReadDelta(
                        unreadDelta = unreadDelta,
                        readDelta = if (event.isRead) 1 else -1,
                    )
                },
            )
        }

        if (shouldReloadArticles) {
            loadArticles()
        }
    }

    private suspend fun applyArticlesMarkedRead(event: ArticlesMarkedReadEvent) {
        repository.invalidateReadStateCaches()
        val feedIds = event.feedIds.toSet()

        _uiState.update { state ->
            val hideRead = state.preferences?.hideRead == true
            val categoryDeltas = state.feeds
                .filter { it.id in feedIds && it.unreadCount > 0 }
                .groupBy { it.categoryId }
                .mapValues { (_, feeds) -> -feeds.sumOf { it.unreadCount } }

            state.copy(
                articles = if (hideRead) {
                    state.articles.filterNot { it.feedId in feedIds }
                } else {
                    state.articles.map { article ->
                        if (article.feedId in feedIds) article.copy(isRead = true) else article
                    }
                },
                searchResults = state.searchResults.map { article ->
                    if (article.feedId in feedIds) article.copy(isRead = true) else article
                },
                selectedArticle = state.selectedArticle?.let { article ->
                    if (article.feedId in feedIds) article.copy(isRead = true) else article
                },
                feeds = state.feeds.map { feed ->
                    if (feed.id in feedIds) feed.copy(unreadCount = 0) else feed
                },
                categories = state.categories.withUnreadDeltas(categoryDeltas),
                stats = state.stats?.withReadDelta(
                    unreadDelta = -event.markedCount,
                    readDelta = event.markedCount,
                ),
            )
        }
    }

    private fun AppUiState.articleReadState(articleId: String): Boolean? =
        selectedArticle?.takeIf { it.id == articleId }?.isRead
            ?: articles.firstOrNull { it.id == articleId }?.isRead
            ?: searchResults.firstOrNull { it.id == articleId }?.isRead

    private fun AppUiState.isFeedVisible(feedId: String): Boolean {
        selectedFeedId?.let { return it == feedId }
        val feed = feeds.firstOrNull { it.id == feedId } ?: return selectedCategoryId == null
        selectedCategoryId?.let { return it == feed.categoryId }
        return true
    }

    private fun List<CategoryWithCounts>.withUnreadDelta(
        categoryId: String,
        delta: Int,
    ): List<CategoryWithCounts> = withUnreadDeltas(mapOf(categoryId to delta))

    private fun List<CategoryWithCounts>.withUnreadDeltas(
        deltas: Map<String, Int>,
    ): List<CategoryWithCounts> = map { category ->
        val children = category.children?.withUnreadDeltas(deltas)
        val delta = deltas[category.id] ?: 0
        if (delta == 0 && children == category.children) {
            category
        } else {
            category.copy(
                unreadCount = (category.unreadCount + delta).coerceAtLeast(0),
                children = children,
            )
        }
    }

    private fun StatsResponse.withReadDelta(unreadDelta: Int, readDelta: Int): StatsResponse =
        copy(
            totalUnread = (totalUnread + unreadDelta).coerceAtLeast(0),
            totalRead = (totalRead + readDelta).coerceAtLeast(0),
        )

    private fun isCurrentArticleRequest(requestId: Long): Boolean =
        requestId == articleRequestSequence.get()

    private fun AppUiState.articleQuery(): ArticleQuery =
        ArticleQuery(
            feedId = selectedFeedId,
            categoryId = selectedCategoryId,
            unreadOnly = preferences?.hideRead == true,
            sort = preferences?.defaultSort,
        )

    private fun ArticleQuery.toArticlePageQuery(generation: Long): ArticlePageQuery =
        ArticlePageQuery(
            feedId = feedId,
            categoryId = categoryId,
            unreadOnly = unreadOnly,
            sort = sort,
            generation = generation,
        )

    private suspend fun persistNormalizedTheme(theme: String) {
        when (val result = repository.updatePreferences(UpdatePreferencesRequest(theme = theme))) {
            is AppResult.Success -> _uiState.update {
                it.copy(preferences = result.data.withNormalizedTheme())
            }
            is AppResult.Error -> Unit
        }
    }

    private fun UserPreferences.withNormalizedTheme(): UserPreferences {
        val normalizedTheme = normalizeThemePreference(theme)
        return if (theme == normalizedTheme) this else copy(theme = normalizedTheme)
    }

    private fun normalizeThemePreference(theme: String): String =
        if (theme == "amoled") "dark" else theme

    private suspend fun loadRegistrationEnabled(): Boolean =
        when (val result = repository.registrationStatus()) {
            is AppResult.Success -> result.data.registrationEnabled
            is AppResult.Error -> false
        }

    private data class ArticleQuery(
        val feedId: String?,
        val categoryId: String?,
        val unreadOnly: Boolean,
        val sort: String?,
    )

    private companion object {
        const val NEXT_ARTICLE_WARM_LIMIT = 5
        const val ARTICLE_PAGE_SIZE = 30
        const val ARTICLE_PAGING_PREFETCH_DISTANCE = 5
        const val ARTICLE_ENRICH_REFRESH_DELAY_MS = 800L
        const val ARTICLE_BACKGROUND_ENRICH_RETRY_MS = 5 * 60_000L
        const val RESUME_REFRESH_MIN_INTERVAL_MS = 60_000L
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
