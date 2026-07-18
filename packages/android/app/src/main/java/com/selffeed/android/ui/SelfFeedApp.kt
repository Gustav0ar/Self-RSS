package com.selffeed.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.selffeed.android.R
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.components.openExternalUrl
import com.selffeed.android.ui.components.shareArticle
import com.selffeed.android.ui.screens.ArticleTabActions
import com.selffeed.android.ui.screens.ArticleTabState
import com.selffeed.android.ui.screens.ArticlesTab
import com.selffeed.android.ui.screens.FeedTabActions
import com.selffeed.android.ui.screens.FeedTabState
import com.selffeed.android.ui.screens.FeedsTab
import com.selffeed.android.ui.screens.SearchTabActions
import com.selffeed.android.ui.screens.SearchTabState
import com.selffeed.android.ui.screens.SearchTab
import com.selffeed.android.ui.screens.SettingsTabActions
import com.selffeed.android.ui.screens.SettingsTabState
import com.selffeed.android.ui.screens.SettingsTab
import com.selffeed.android.ui.screens.StatsTab
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class SelfFeedAppState(
    val auth: AuthUiState,
    val chrome: AppChromeState,
    val feeds: FeedsUiState,
    val articles: ArticlesUiState,
    val search: SearchUiState,
    val settings: SettingsUiState,
    val isOnline: Boolean,
)

data class SelfFeedAppActions(
    val onAuthModeChange: (AuthMode) -> Unit,
    val onLogin: (String, String, String) -> Unit,
    val onRegister: (String, String, String) -> Unit,
    val onLogout: () -> Unit,
    val onTabSelected: (HomeTab) -> Unit,
    val onRefreshVisibleData: () -> Unit,
    val onHideReadChanged: (Boolean) -> Unit,
    val onCategorySelected: (String?) -> Unit,
    val onFeedSelected: (String?) -> Unit,
    val onCreateCategory: (String, String?) -> Unit = { _, _ -> },
    val onUpdateCategory: (String, String, String?) -> Unit = { _, _, _ -> },
    val onDeleteCategory: (String) -> Unit = {},
    val onCreateFeed: (String, String, String?) -> Unit = { _, _, _ -> },
    val onUpdateFeed: (String, String, String?, String?, Int?) -> Unit = { _, _, _, _, _ -> },
    val onDeleteFeed: (String) -> Unit = {},
    val onImportOpml: (String, ByteArray) -> Unit = { _, _ -> },
    val onExportOpml: () -> Unit = {},
    val onDismissImportSummary: () -> Unit = {},
    val onSelectDiscoveryCandidate: (String, String) -> Unit = { _, _ -> },
    val onCancelFeedReplacement: (String) -> Unit = {},
    val onRefreshArticles: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onOpenArticleFromQueue: (String, List<ArticleListItem>) -> Unit = { id, _ -> onOpenArticle(id) },
    val onReaderPageChanged: (String) -> Unit = {},
    val onArticleDisplayed: (String) -> Unit,
    val onCloseArticle: () -> Unit,
    val onToggleRead: (String, Boolean) -> Unit,
    val onMarkAllRead: () -> Unit,
    val onArticleSnapshot: (List<ArticleListItem>) -> Unit,
    val onVisibleArticles: (List<ArticleListItem>) -> Unit = {},
    val onSearchQueryChanged: (String) -> Unit,
    val onSearchRequested: () -> Unit,
    val onLoadMoreSearch: () -> Unit,
    val onSearchCurrentCategoryOnlyChanged: (Boolean) -> Unit,
    val onThemeChanged: (ThemePreference) -> Unit,
    val onSortChanged: (ArticleSortPreference) -> Unit,
    val onDensityChanged: (DensityPreference) -> Unit,
    val onTextSizeChanged: (Int) -> Unit,
    val onFontChanged: (ReaderFontPreference) -> Unit = {},
    val onAutoMarkReadModeChanged: (AutoMarkReadPreference) -> Unit = {},
    val onRevokeAuthSession: (String) -> Unit,
    val onRetryPreferences: () -> Unit = {},
    val onClearMessages: () -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelfFeedApp(
    state: SelfFeedAppState,
    readStateOverrides: StateFlow<Map<String, Boolean>>,
    actions: SelfFeedAppActions,
    articlePagingData: Flow<PagingData<ArticleListItem>>,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val drawerState = androidx.compose.material3.rememberDrawerState(initialValue = androidx.compose.material3.DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val activeTab = state.chrome.activeTab
    val selectedArticle = state.articles.selectedArticle
    val selectedFeedId = state.articles.selectedFeedId
    val selectedCategoryId = state.articles.selectedCategoryId
    val readerFeedTitle = state.articles.currentReaderFeedTitle()
    val readStateOverrides by readStateOverrides.collectAsStateWithLifecycle()
    var confirmMarkAllRead by rememberSaveable { mutableStateOf(false) }
    val offerReadUndo: (String, Boolean, Boolean) -> Unit = remember(actions, snackbarHostState, scope) {
        { articleId, previousRead, read ->
            scope.launch {
                val message = if (read) "Marked as read" else "Marked as unread"
                if (snackbarHostState.showSnackbar(message = message, actionLabel = "Undo") == androidx.compose.material3.SnackbarResult.ActionPerformed) {
                    actions.onToggleRead(articleId, previousRead)
                }
            }
        }
    }
    val toggleReadWithUndo: (String, Boolean) -> Unit = remember(actions, offerReadUndo) {
        { articleId, read ->
            actions.onToggleRead(articleId, read)
            offerReadUndo(articleId, !read, read)
        }
    }
    val topBarLabel = remember(
        activeTab,
        selectedArticle,
        readerFeedTitle,
        selectedFeedId,
        selectedCategoryId,
        state.feeds.feeds,
        state.feeds.categories,
    ) {
        topBarLabel(
            activeTab = activeTab,
            selectedArticle = selectedArticle,
            readerFeedTitle = readerFeedTitle,
            selectedFeedId = selectedFeedId,
            selectedCategoryId = selectedCategoryId,
            feeds = state.feeds.feeds,
            categories = state.feeds.categories,
        )
    }

    val errorMessage = (if (state.auth.isAuthenticated) state.auth.errorMessage else null)
        ?: state.feeds.errorMessage
        ?: state.articles.errorMessage
        ?: state.search.errorMessage
        ?: state.settings.errorMessage
        ?: state.chrome.globalError
    val statusMessage = state.auth.statusMessage
        ?: state.feeds.statusMessage
        ?: state.articles.statusMessage
        ?: state.settings.statusMessage
        ?: state.chrome.globalStatus

    LaunchedEffect(errorMessage) {
        errorMessage?.let {
            actions.onClearMessages()
            snackbarHostState.showSnackbar(it)
        }
    }
    LaunchedEffect(statusMessage) {
        statusMessage?.let {
            actions.onClearMessages()
            snackbarHostState.showSnackbar(
                message = it,
                duration = SnackbarDuration.Short,
            )
        }
    }

    if (state.auth.loading) {
        LoadingScreen()
        return
    }

    if (!state.auth.isAuthenticated) {
        AuthScreen(
            mode = state.auth.authMode,
            apiBaseUrl = state.auth.apiBaseUrl,
            registrationEnabled = state.auth.registrationEnabled,
            errorMessage = state.auth.errorMessage,
            onModeChange = actions.onAuthModeChange,
            onLogin = actions.onLogin,
            onRegister = actions.onRegister,
        )
        return
    }

    val articlePagingItems = articlePagingData.collectAsLazyPagingItems()
    // This state belongs to the list session, not the compact list NavEntry.
    // Keeping it above list/detail navigation preserves the exact viewport
    // when the list pane leaves composition while the reader is open.
    val articleListState = rememberLazyListState()
    val articleSnapshot = articlePagingItems.itemSnapshotList.items
    val articleRefreshState = articlePagingItems.loadState.refresh
    LaunchedEffect(articleSnapshot, articleRefreshState) {
        // A completed Paging generation is authoritative even when it is
        // empty. Ignoring empty snapshots leaves the ViewModel holding rows
        // from the previous query until another scroll happens to publish a
        // non-empty window.
        settledArticleSnapshot(articleSnapshot, articleRefreshState)
            ?.let(actions.onArticleSnapshot)
    }
    val rawArticleQueue = if (selectedArticle != null && state.articles.readerQueue.isNotEmpty()) {
        state.articles.readerQueue
    } else {
        articleSnapshot
    }
    // Apply read state overrides to show articles as read without filtering them out
    val articleQueue = remember(rawArticleQueue, readStateOverrides) {
        rawArticleQueue.map { article ->
            readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
        }
    }
    val feedTabState = remember(
        state.feeds.categories,
        state.feeds.feeds,
        state.articles.hideRead,
        state.settings.stats?.totalUnread,
        selectedCategoryId,
        selectedFeedId,
        state.feeds.loading,
        state.feeds.lastImportSummary,
        state.feeds.syncStatus,
        state.feeds.lifecycleActionFeedId,
    ) {
        FeedTabState(
            categories = state.feeds.categories,
            feeds = state.feeds.feeds,
            hideRead = state.articles.hideRead,
            totalUnread = state.settings.stats?.totalUnread ?: 0,
            selectedCategoryId = selectedCategoryId,
            selectedFeedId = selectedFeedId,
            loading = state.feeds.loading,
            lastImportSummary = state.feeds.lastImportSummary,
            syncStatus = state.feeds.syncStatus,
            lifecycleActionFeedId = state.feeds.lifecycleActionFeedId,
        )
    }
    val articleTabState = remember(
        articleQueue,
        selectedArticle?.id,
        state.feeds.loading,
        state.feeds.syncInBackground,
        state.feeds.syncCompletedFeeds,
        state.feeds.syncTotalFeeds,
        state.isOnline,
        state.feeds.feeds.size,
        state.articles.loading,
        state.settings.preferences?.density,
        selectedFeedId,
        state.feeds.feeds,
    ) {
        val selectedLifecycle = state.feeds.feeds
            .firstOrNull { it.id == selectedFeedId }
            ?.let(::feedLifecyclePresentation)
        ArticleTabState(
            articles = articleQueue,
            selectedArticleId = selectedArticle?.id,
            isSyncingFeeds = state.feeds.syncInBackground,
            isStartingFeedSync = state.feeds.loading,
            syncCompletedFeeds = state.feeds.syncCompletedFeeds,
            syncTotalFeeds = state.feeds.syncTotalFeeds,
            density = DensityPreference.fromApiValue(state.settings.preferences?.density),
            isOffline = !state.isOnline,
            feedCount = state.feeds.feeds.size,
            refreshBlockedGuidance = selectedLifecycle?.takeIf { it.refreshBlocked }?.refreshGuidance,
        )
    }
    val searchTabState = remember(
        state.search.query,
        state.search.results,
        selectedArticle?.id,
        state.search.hasMore,
        state.search.loading,
        state.search.loadingMore,
        state.search.selectedCategoryId,
        state.search.currentCategoryOnly,
        state.search.resultLimitReached,
    ) {
        SearchTabState(
            query = state.search.query,
            results = state.search.results,
            selectedArticleId = selectedArticle?.id,
            hasMoreResults = state.search.hasMore,
            loadingResults = state.search.loading,
            loadingMoreResults = state.search.loadingMore,
            currentCategoryAvailable = state.search.selectedCategoryId != null,
            currentCategoryOnly = state.search.currentCategoryOnly,
            resultLimitReached = state.search.resultLimitReached,
        )
    }
    val settingsTabState = remember(
        state.settings.preferences,
        state.settings.preferencesLoading,
        state.settings.preferencesLoadError,
        state.settings.stats,
        state.settings.authSessions,
    ) {
        SettingsTabState(
            preferences = state.settings.preferences,
            preferencesLoading = state.settings.preferencesLoading,
            preferencesLoadError = state.settings.preferencesLoadError,
            stats = state.settings.stats,
            authSessions = state.settings.authSessions,
        )
    }
    val feedActions = remember(actions) {
        FeedTabActions(
            onHideReadChanged = actions.onHideReadChanged,
            onCategorySelected = actions.onCategorySelected,
            onFeedSelected = actions.onFeedSelected,
            onCreateCategory = actions.onCreateCategory,
            onUpdateCategory = actions.onUpdateCategory,
            onDeleteCategory = actions.onDeleteCategory,
            onCreateFeed = actions.onCreateFeed,
            onUpdateFeed = actions.onUpdateFeed,
            onDeleteFeed = actions.onDeleteFeed,
            onImportOpml = actions.onImportOpml,
            onExportOpml = actions.onExportOpml,
            onDismissImportSummary = actions.onDismissImportSummary,
            onSelectDiscoveryCandidate = actions.onSelectDiscoveryCandidate,
            onCancelFeedReplacement = actions.onCancelFeedReplacement,
        )
    }
    val articleActions = remember(actions, snackbarHostState, scope) {
        ArticleTabActions(
            onRefresh = actions.onRefreshArticles,
            onOpenArticle = actions.onOpenArticle,
            onOpenArticleFromQueue = actions.onOpenArticleFromQueue,
            onToggleRead = actions.onToggleRead,
            onReadStateChanged = { articleId, previousRead ->
                offerReadUndo(articleId, previousRead, !previousRead)
            },
            onArticleSnapshot = actions.onArticleSnapshot,
            onVisibleArticles = actions.onVisibleArticles,
        )
    }
    val searchActions = remember(actions) {
        SearchTabActions(
            onQueryChanged = actions.onSearchQueryChanged,
            onSearchRequested = actions.onSearchRequested,
            onOpenArticle = actions.onOpenArticle,
            onLoadMore = actions.onLoadMoreSearch,
            onCurrentCategoryOnlyChanged = actions.onSearchCurrentCategoryOnlyChanged,
        )
    }
    val settingsActions = remember(actions) {
        SettingsTabActions(
            onThemeChanged = actions.onThemeChanged,
            onHideReadChanged = actions.onHideReadChanged,
            onSortChanged = actions.onSortChanged,
            onDensityChanged = actions.onDensityChanged,
            onTextSizeChanged = actions.onTextSizeChanged,
            onFontChanged = actions.onFontChanged,
            onAutoMarkReadModeChanged = actions.onAutoMarkReadModeChanged,
            onRevokeAuthSession = actions.onRevokeAuthSession,
            onLogout = actions.onLogout,
            onRetryPreferences = actions.onRetryPreferences,
        )
    }
    val readerContent: @Composable (Boolean, (Boolean) -> Unit) -> Unit = { preferHtml, onPreferHtmlChanged ->
        selectedArticle?.let { article ->
            ArticleReaderPane(
                articles = articleQueue,
                selectedArticle = article,
                prefetchedArticles = state.articles.readerDetails,
                onOpenOriginal = { openedArticle ->
                    openedArticle.canonicalUrl?.let { url ->
                        openExternalUrl(context, url)
                    }
                },
                onBackToList = actions.onCloseArticle,
                onArticleSelected = actions.onOpenArticle,
                onVisibleArticleChanged = { articleId ->
                    actions.onReaderPageChanged(articleId)
                    if (
                        activeTab == HomeTab.ARTICLES &&
                        shouldPrefetchNextReaderPage(articleId, articleQueue)
                    ) {
                        // Unlike LazyColumn, the full-screen reader does not
                        // access LazyPagingItems as the user swipes. Reading
                        // the last presented item emits the Paging access hint
                        // that loads the next API cursor before the queue ends.
                        articlePagingItems.lastIndexOrNull()?.let { lastIndex ->
                            articlePagingItems[lastIndex]
                        }
                    }
                },
                onArticleDisplayed = actions.onArticleDisplayed,
                appearance = state.settings.preferences?.toReaderAppearance() ?: ReaderAppearance(),
                preferHtml = preferHtml,
                onPreferHtmlChanged = onPreferHtmlChanged,
            )
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = MaterialTheme.colorScheme.surface,
                drawerContentColor = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.width(320.dp),
            ) {
                FeedsTab(feedTabState, feedActions, onSelect = { scope.launch { drawerState.close() } })
            }
        },
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
            topBar = {
                AppTopBar(
                    activeTab = activeTab,
                    selectedArticle = selectedArticle,
                    currentLabel = topBarLabel,
                    showMarkAllRead = activeTab == HomeTab.ARTICLES &&
                        selectedArticle == null &&
                        articleQueue.isNotEmpty(),
                    isOnline = state.isOnline,
                    onOpenDrawer = { scope.launch { drawerState.open() } },
                    onMarkAllRead = { confirmMarkAllRead = true },
                    onBack = actions.onCloseArticle,
                    onToggleRead = {
                        selectedArticle?.let { article ->
                            toggleReadWithUndo(article.id, !article.isRead)
                        }
                    },
                    onShare = {
                        selectedArticle?.let { article ->
                            shareArticle(context, article.title, article.canonicalUrl)
                        }
                    },
                )
            },
            bottomBar = {
                AppBottomBar(
                    activeTab = activeTab,
                    onTabSelected = actions.onTabSelected,
                )
            },
        ) { paddingValues ->
            if (state.auth.isAuthenticated) {
                ResumeRefreshObserver(onResume = actions.onRefreshVisibleData)
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
            ) {
                AnimatedContent(
                    targetState = activeTab,
                    label = "android-main-tabs",
                ) { tab ->
                    when (tab) {
                        HomeTab.ARTICLES -> {
                            ArticleListDetailNavigation(
                                selectedArticleId = selectedArticle?.id,
                                onCloseArticle = actions.onCloseArticle,
                                listContent = { openReaderImmediately ->
                                    val immediateArticleActions = remember(articleActions, openReaderImmediately) {
                                        articleActions.copy(
                                            onOpenArticle = { articleId ->
                                                openReaderImmediately()
                                                articleActions.onOpenArticle(articleId)
                                            },
                                            onOpenArticleFromQueue = { articleId, queue ->
                                                openReaderImmediately()
                                                articleActions.onOpenArticleFromQueue(articleId, queue)
                                            },
                                        )
                                    }
                                    ArticlesTab(
                                        state = articleTabState,
                                        actions = immediateArticleActions,
                                        pagedArticles = articlePagingItems,
                                        listState = articleListState,
                                    )
                                },
                                detailContent = readerContent,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                        HomeTab.SEARCH -> SearchTab(searchTabState, searchActions)
                        HomeTab.SETTINGS -> SettingsTab(settingsTabState, settingsActions)
                        HomeTab.STATS -> StatsTab(settingsTabState, settingsActions)
                        HomeTab.FEEDS -> FeedsTab(feedTabState, feedActions, onSelect = { actions.onTabSelected(HomeTab.ARTICLES) })
                    }
                }
            }
        }
    }

    if (confirmMarkAllRead) {
        AlertDialog(
            onDismissRequest = { confirmMarkAllRead = false },
            title = { Text("Mark all as read?") },
            text = { Text("This marks every article in the current feed or category as read.") },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { confirmMarkAllRead = false }) { Text("Cancel") }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    actions.onArticleSnapshot(articlePagingItems.itemSnapshotList.items)
                    actions.onMarkAllRead()
                    confirmMarkAllRead = false
                }) { Text("Mark all read") }
            },
        )
    }

}

internal fun settledArticleSnapshot(
    snapshot: List<ArticleListItem>,
    refreshState: LoadState,
): List<ArticleListItem>? = snapshot.takeIf { refreshState is LoadState.NotLoading }

internal fun shouldPrefetchNextReaderPage(
    visibleArticleId: String,
    readerQueue: List<ArticleListItem>,
): Boolean {
    val visibleIndex = readerQueue.indexOfFirst { it.id == visibleArticleId }
    return visibleIndex >= 0 && visibleIndex >= readerQueue.size - READER_PAGE_PREFETCH_DISTANCE
}

private fun <T : Any> androidx.paging.compose.LazyPagingItems<T>.lastIndexOrNull(): Int? =
    (itemCount - 1).takeIf { it >= 0 }

private const val READER_PAGE_PREFETCH_DISTANCE = 8

@Composable
private fun LoadingScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Loading your reading workspace",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Tiny 8dp dot indicating offline state. Kept minimal so it doesn't
 * compete with the title; the dot's color is the theme's error tone so it
 * reads as a warning without text.
 */
@Composable
private fun OnlineDot() {
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.error)
            .semantics { contentDescription = "Offline" },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppTopBar(
    activeTab: HomeTab,
    selectedArticle: ArticleDetail?,
    currentLabel: String,
    showMarkAllRead: Boolean,
    isOnline: Boolean,
    onOpenDrawer: () -> Unit,
    onMarkAllRead: () -> Unit,
    onBack: () -> Unit,
    onToggleRead: () -> Unit,
    onShare: () -> Unit,
) {
    val isArticleSelected = activeTab == HomeTab.ARTICLES && selectedArticle != null
    // The Navigation 3 list-detail scene keeps the list visible at this
    // width, so a Back button would be redundant and could incorrectly send
    // a search-origin reader away from its visible context. System Back still
    // follows the Navigation 3 stack.
    val showReaderBack = isArticleSelected && LocalConfiguration.current.screenWidthDp < 600

    CenterAlignedTopAppBar(
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = currentLabel,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!isOnline) {
                    Spacer(modifier = Modifier.width(8.dp))
                    OnlineDot()
                }
            }
        },
        navigationIcon = {
            if (showReaderBack) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to list")
                }
            } else {
                IconButton(onClick = onOpenDrawer) {
                    Icon(Icons.Default.Menu, contentDescription = "Open feeds")
                }
            }
        },
        actions = {
            if (isArticleSelected) {
                IconButton(onClick = onShare) {
                    Icon(Icons.Default.Share, contentDescription = "Share article")
                }
                IconButton(onClick = onToggleRead) {
                    val isRead = selectedArticle?.isRead == true
                    val icon = if (isRead) Icons.Default.MarkEmailRead else Icons.Default.Email
                    val description = if (isRead) "Mark as unread" else "Mark as read"
                    Icon(
                        imageVector = icon,
                        contentDescription = description,
                        tint = if (isRead) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                }
            } else if (showMarkAllRead) {
                IconButton(onClick = onMarkAllRead) {
                    Icon(Icons.Default.MarkEmailRead, contentDescription = "Mark all as read")
                }
            } else {
                Spacer(modifier = Modifier.width(48.dp))
            }
        },
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
            containerColor = MaterialTheme.colorScheme.background,
            titleContentColor = MaterialTheme.colorScheme.onSurface,
            navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
            actionIconContentColor = MaterialTheme.colorScheme.onSurface,
        ),
        modifier = Modifier.windowInsetsPadding(WindowInsets.statusBars),
    )
}

@Composable
private fun AppBottomBar(
    activeTab: HomeTab,
    onTabSelected: (HomeTab) -> Unit,
) {
    NavigationBar(
        modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars),
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
    ) {
        NavigationBarItem(
            selected = activeTab == HomeTab.ARTICLES,
            onClick = { onTabSelected(HomeTab.ARTICLES) },
            icon = { Icon(Icons.Default.GridView, contentDescription = "Articles tab") },
            label = { Text("Articles") },
        )
        NavigationBarItem(
            selected = activeTab == HomeTab.SEARCH,
            onClick = { onTabSelected(HomeTab.SEARCH) },
            icon = { Icon(Icons.Default.Search, contentDescription = "Search tab") },
            label = { Text("Search") },
        )
        NavigationBarItem(
            selected = activeTab == HomeTab.FEEDS,
            onClick = { onTabSelected(HomeTab.FEEDS) },
            icon = { Icon(Icons.Default.RssFeed, contentDescription = "Feeds tab") },
            label = { Text("Feeds") },
        )
        NavigationBarItem(
            selected = activeTab == HomeTab.SETTINGS,
            onClick = { onTabSelected(HomeTab.SETTINGS) },
            icon = { Icon(Icons.Outlined.Settings, contentDescription = "Settings tab") },
            label = { Text("Settings") },
        )
    }
}

private fun topBarLabel(
    activeTab: HomeTab,
    selectedArticle: ArticleDetail?,
    readerFeedTitle: String?,
    selectedFeedId: String?,
    selectedCategoryId: String?,
    feeds: List<FeedWithCounts>,
    categories: List<CategoryWithCounts>,
): String = when (activeTab) {
    HomeTab.ARTICLES -> when {
        selectedArticle != null -> readerFeedTitle ?: selectedArticle.feedTitle
        selectedFeedId != null -> feeds.find { it.id == selectedFeedId }?.title ?: "Feed"
        selectedCategoryId != null -> categories.find { it.id == selectedCategoryId }?.name ?: "Category"
        else -> "All Feeds"
    }
    HomeTab.SEARCH -> "Search"
    HomeTab.FEEDS -> "Manage Feeds"
    HomeTab.SETTINGS -> "Settings"
    HomeTab.STATS -> "Stats"
}

internal fun ArticlesUiState.currentReaderFeedTitle(): String? {
    val articleId = visibleReaderArticleId ?: selectedArticle?.id ?: return null
    return readerQueue.firstOrNull { it.id == articleId }?.feedTitle
        ?: readerDetails[articleId]?.feedTitle
        ?: items.firstOrNull { it.id == articleId }?.feedTitle
        ?: selectedArticle?.takeIf { it.id == articleId }?.feedTitle
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AuthScreen(
    mode: AuthMode,
    apiBaseUrl: String,
    registrationEnabled: Boolean,
    errorMessage: String?,
    onModeChange: (AuthMode) -> Unit,
    onLogin: (String, String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
) {
    var serverUrl by rememberSaveable(apiBaseUrl) { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val configuredServer = apiBaseUrl.trim()
    val serverPlaceholder = configuredServer.ifEmpty { "10.0.22.22:3000" }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                    ),
                ),
            )
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(32.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        painter = painterResource(R.drawable.ic_self_feed_logo),
                        contentDescription = "SelfFeed app logo",
                        modifier = Modifier.size(56.dp),
                    )
                }
                Text(
                    "SelfFeed",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "A modern reading experience with synced feeds, search, and rich article views.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = mode == AuthMode.LOGIN,
                        onClick = { onModeChange(AuthMode.LOGIN) },
                        label = { Text("Login") },
                    )
                    if (registrationEnabled) {
                        FilterChip(
                            selected = mode == AuthMode.REGISTER,
                            onClick = { onModeChange(AuthMode.REGISTER) },
                            label = { Text("Register") },
                        )
                    }
                }

                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Server") },
                    placeholder = { Text(serverPlaceholder) },
                    leadingIcon = { Icon(Icons.Default.RssFeed, contentDescription = "Server address") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    leadingIcon = { Icon(Icons.Default.Email, contentDescription = "Email address") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    leadingIcon = { Icon(Icons.Default.Password, contentDescription = "Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(20.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                )
                Button(
                    onClick = {
                        val submittedServer = serverUrl.trim().ifEmpty { configuredServer }
                        if (mode == AuthMode.LOGIN) {
                            onLogin(email, password, submittedServer)
                        } else {
                            onRegister(email, password, submittedServer)
                        }
                        password = ""
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                ) {
                    Text(if (mode == AuthMode.LOGIN) "Continue" else "Create account")
                }
                AnimatedVisibility(visible = !errorMessage.isNullOrBlank()) {
                    Text(
                        text = errorMessage.orEmpty(),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
