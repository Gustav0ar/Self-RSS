package com.selffeed.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.selffeed.android.ui.components.shareOpmlContent
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.metrics.performance.PerformanceMetricsState
import com.selffeed.android.ui.theme.SelfFeedTheme

@Composable
fun SelfFeedAppRoute(
    appViewModel: AppViewModel,
    authViewModel: AuthViewModel,
    feedsViewModel: FeedsViewModel,
    articlesViewModel: ArticlesViewModel,
    searchViewModel: SearchViewModel,
    settingsViewModel: SettingsViewModel,
    performanceMetricsState: PerformanceMetricsState.Holder,
    benchmarkScenario: BenchmarkScenario? = null,
) {
    if (benchmarkScenario == BenchmarkScenario.READER) {
        SelfFeedTheme {
            BenchmarkReaderScenario()
        }
        return
    }

    val context = LocalContext.current
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    val chromeState by appViewModel.chrome.collectAsStateWithLifecycle()
    val isOnline by appViewModel.isOnline.collectAsStateWithLifecycle()
    val feedsState by feedsViewModel.state.collectAsStateWithLifecycle()
    val articlesState by articlesViewModel.state.collectAsStateWithLifecycle()
    val searchState by searchViewModel.state.collectAsStateWithLifecycle()
    val settingsState by settingsViewModel.state.collectAsStateWithLifecycle()
    val themePreference = ThemePreference.fromApiValue(settingsState.preferences?.theme).apiValue
    val darkTheme = when (themePreference) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }

    SelfFeedTheme(darkTheme = darkTheme) {
        val latestFeedsState = rememberUpdatedState(feedsState)
        val workflowCoordinator = remember { AppWorkflowCoordinator() }
        val workflowSink = object : AppWorkflowSink {
            override fun refreshAuthenticatedSession() {
                articlesViewModel.clearSessionReadStateMemory()
                feedsViewModel.loadCategories()
                feedsViewModel.loadFeeds()
                settingsViewModel.loadPreferences()
                settingsViewModel.loadStats()
                settingsViewModel.loadAuthSessions()
                settingsViewModel.loadAdminSettings()
                articlesViewModel.refreshArticles()
                articlesViewModel.startReadStateSync()
            }

            override fun clearUnauthenticatedSession() {
                articlesViewModel.stopReadStateSync()
                articlesViewModel.clearSessionReadStateMemory()
            }

            override fun applyArticlePreferences(defaultSort: String, hideRead: Boolean, autoMarkReadMode: String) {
                articlesViewModel.setFilter(sort = defaultSort, hideRead = hideRead)
                articlesViewModel.setAutoMarkReadMode(autoMarkReadMode)
            }

            override fun refreshAfterFeedSync() {
                feedsViewModel.loadCategories()
                feedsViewModel.loadFeeds()
                settingsViewModel.loadStats()
                articlesViewModel.refreshArticles()
            }

            override fun applyUnreadDelta(feedId: String?, unreadDelta: Int) {
                feedsViewModel.applyUnreadDelta(feedId, unreadDelta)
            }

            override fun applyStatsDelta(unreadDelta: Int, readDelta: Int) {
                settingsViewModel.applyStatsDelta(unreadDelta, readDelta)
            }

            override fun applyArticleReadState(articleId: String, read: Boolean) {
                searchViewModel.applyArticleReadState(articleId, read)
            }

            override fun applyScopeMarkedRead(
                feedId: String?,
                categoryId: String?,
                affectedFeedIds: Set<String>,
            ) {
                feedsViewModel.applyScopeMarkedRead(feedId, categoryId, affectedFeedIds)
            }

            override fun applySearchScopeMarkedRead(feedIds: Set<String>) {
                searchViewModel.applyScopeMarkedRead(feedIds)
            }

            override fun applyAllSearchMarkedRead() {
                searchViewModel.applyAllMarkedRead()
            }

            override fun refreshArticleContent() {
                feedsViewModel.loadCategories()
                feedsViewModel.loadFeeds()
                settingsViewModel.loadStats()
            }
        }

        LaunchedEffect(Unit) {
            authViewModel.bootstrap()
        }

        LaunchedEffect(Unit) {
            feedsViewModel.opmlExports.collect { content ->
                shareOpmlContent(context, content)
            }
        }

        LaunchedEffect(authState.isAuthenticated) {
            workflowCoordinator.onAuthenticationChanged(authState.isAuthenticated, workflowSink)
        }

        LaunchedEffect(
            settingsState.preferences?.defaultSort,
            settingsState.preferences?.hideRead,
            settingsState.preferences?.autoMarkReadMode,
        ) {
            workflowCoordinator.onPreferencesChanged(settingsState.preferences, workflowSink)
        }

        LaunchedEffect(articlesState.selectedCategoryId) {
            searchViewModel.setSelectedCategoryId(articlesState.selectedCategoryId)
        }

        LaunchedEffect(feedsState.syncRevision) {
            workflowCoordinator.onFeedSyncRevisionChanged(feedsState.syncRevision, workflowSink)
        }

        LaunchedEffect(feedsState.articleRevision) {
            if (feedsState.articleRevision > 0L) articlesViewModel.refreshArticles()
        }

        LaunchedEffect(Unit) {
            articlesViewModel.events.collect { event ->
                workflowCoordinator.onArticleEvent(
                    event = event,
                    latestFeedsState = latestFeedsState.value,
                    sink = workflowSink,
                )
            }
        }

        LaunchedEffect(chromeState.activeTab, articlesState.selectedArticle?.id) {
            performanceMetricsState.state?.putState("tab", chromeState.activeTab.name)
            performanceMetricsState.state?.putState(
                "reader",
                if (articlesState.selectedArticle == null) "closed" else "open",
            )
        }

        SelfFeedApp(
            state = SelfFeedAppState(
                auth = authState,
                chrome = chromeState,
                feeds = feedsState,
                articles = articlesState,
                search = searchState,
                settings = settingsState,
                isOnline = isOnline,
            ),
            readStateOverrides = articlesViewModel.readStateOverrides,
            actions = SelfFeedAppActions(
                onAuthModeChange = authViewModel::setAuthMode,
                onLogin = authViewModel::login,
                onRegister = authViewModel::register,
                onLogout = {
                    articlesViewModel.stopReadStateSync()
                    authViewModel.logout()
                },
                onTabSelected = appViewModel::setTab,
                onRefreshVisibleData = {
                    feedsViewModel.loadCategories()
                    feedsViewModel.loadFeeds()
                    settingsViewModel.loadStats()
                },
                onHideReadChanged = {
                    settingsViewModel.updateHideRead(it)
                    articlesViewModel.setFilter(sort = null, hideRead = it)
                },
                onCategorySelected = {
                    articlesViewModel.setScope(feedId = null, categoryId = it)
                    appViewModel.setTab(HomeTab.ARTICLES)
                },
                onFeedSelected = {
                    articlesViewModel.setScope(feedId = it, categoryId = null)
                    appViewModel.setTab(HomeTab.ARTICLES)
                },
                onCreateCategory = feedsViewModel::createCategory,
                onUpdateCategory = feedsViewModel::updateCategory,
                onDeleteCategory = feedsViewModel::deleteCategory,
                onCreateFeed = feedsViewModel::createFeed,
                onUpdateFeed = { id, title, categoryId, pollingIntervalMinutes ->
                    feedsViewModel.updateFeed(id, title, categoryId, pollingIntervalMinutes)
                },
                onDeleteFeed = feedsViewModel::deleteFeed,
                onImportOpml = feedsViewModel::importOpml,
                onExportOpml = feedsViewModel::exportOpml,
                onDismissImportSummary = feedsViewModel::dismissImportSummary,
                onRefreshArticles = {
                    feedsViewModel.syncAllFeeds(
                        feedId = articlesState.selectedFeedId,
                        categoryId = articlesState.selectedCategoryId,
                    )
                },
                onOpenArticle = {
                    val origin = if (chromeState.activeTab == HomeTab.SEARCH) HomeTab.SEARCH else HomeTab.ARTICLES
                    if (origin == HomeTab.SEARCH) {
                        articlesViewModel.openArticleFromQueue(it, searchState.results)
                    } else {
                        articlesViewModel.openArticle(it)
                    }
                    appViewModel.openReaderFrom(origin)
                },
                onOpenArticleFromQueue = { articleId, queue ->
                    articlesViewModel.openArticleFromQueue(articleId, queue)
                    appViewModel.openReaderFrom(HomeTab.ARTICLES)
                },
                onArticleDisplayed = articlesViewModel::onArticleDisplayed,
                onReaderPageChanged = articlesViewModel::onReaderPageChanged,
                onCloseArticle = {
                    articlesViewModel.closeArticle()
                    appViewModel.closeReader()
                },
                onToggleRead = articlesViewModel::markRead,
                onMarkAllRead = articlesViewModel::markAllRead,
                onArticleSnapshot = articlesViewModel::updateArticleQueueSnapshot,
                onVisibleArticles = articlesViewModel::warmVisibleArticles,
                onSearchQueryChanged = searchViewModel::setQuery,
                onSearchRequested = searchViewModel::search,
                onLoadMoreSearch = searchViewModel::loadMore,
                onSearchCurrentCategoryOnlyChanged = searchViewModel::setCurrentCategoryOnly,
                onThemeChanged = { settingsViewModel.updateTheme(it.apiValue) },
                onSortChanged = {
                    settingsViewModel.updateDefaultSort(it.apiValue)
                    articlesViewModel.setFilter(sort = it.apiValue, hideRead = null)
                },
                onDensityChanged = { settingsViewModel.updateDensity(it.apiValue) },
                onTextSizeChanged = settingsViewModel::updateTextSize,
                onFontChanged = { settingsViewModel.updateFontFamily(it.apiValue) },
                onAutoMarkReadModeChanged = {
                    settingsViewModel.updateAutoMarkReadMode(it.apiValue)
                    articlesViewModel.setAutoMarkReadMode(it.apiValue)
                },
                onRevokeAuthSession = settingsViewModel::revokeAuthSession,
                onClearMessages = {
                    authViewModel.clearMessages()
                    feedsViewModel.clearMessages()
                    articlesViewModel.clearMessages()
                    searchViewModel.clearMessages()
                    settingsViewModel.clearMessages()
                    appViewModel.clearMessages()
                },
            ),
            articlePagingData = articlesViewModel.articlePagingData,
        )
    }
}
