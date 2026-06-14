package com.selffeed.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
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
) {
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
        val latestFeedsState by rememberUpdatedState(feedsState)

        LaunchedEffect(Unit) {
            authViewModel.bootstrap()
        }

        LaunchedEffect(authState.isAuthenticated) {
            if (authState.isAuthenticated) {
                articlesViewModel.clearSessionReadStateMemory()
                feedsViewModel.loadCategories()
                feedsViewModel.loadFeeds()
                settingsViewModel.loadPreferences()
                settingsViewModel.loadStats()
                settingsViewModel.loadAdminSettings()
                articlesViewModel.loadArticles()
                articlesViewModel.startReadStateSync()
            } else {
                articlesViewModel.stopReadStateSync()
                articlesViewModel.clearSessionReadStateMemory()
            }
        }

        LaunchedEffect(settingsState.preferences?.defaultSort, settingsState.preferences?.hideRead) {
            settingsState.preferences?.let {
                articlesViewModel.setFilter(sort = it.defaultSort, hideRead = it.hideRead)
            }
        }

        LaunchedEffect(feedsState.lastSyncSummary) {
            if (feedsState.lastSyncSummary != null) {
                feedsViewModel.loadCategories()
                feedsViewModel.loadFeeds()
                settingsViewModel.loadStats()
                articlesViewModel.refreshArticles()
            }
        }

        LaunchedEffect(Unit) {
            articlesViewModel.events.collect { event ->
                when (event) {
                    is ArticleFeatureEvent.ArticleReadStateChanged -> {
                        feedsViewModel.applyUnreadDelta(event.feedId, event.unreadDelta)
                        settingsViewModel.applyStatsDelta(event.unreadDelta, event.readDelta)
                        searchViewModel.applyArticleReadState(event.articleId, event.read)
                    }

                    is ArticleFeatureEvent.ScopeMarkedRead -> {
                        feedsViewModel.applyScopeMarkedRead(
                            feedId = event.feedId,
                            categoryId = event.categoryId,
                            affectedFeedIds = event.affectedFeedIds,
                        )
                        settingsViewModel.applyStatsDelta(
                            unreadDelta = -event.markedCount,
                            readDelta = event.markedCount,
                        )
                        val searchFeedIds = when {
                            event.affectedFeedIds.isNotEmpty() -> event.affectedFeedIds
                            event.feedId != null -> setOf(event.feedId)
                            event.categoryId != null -> latestFeedsState.feeds
                                .filter { it.categoryId == event.categoryId }
                                .map { it.id }
                                .toSet()

                            else -> emptySet()
                        }
                        if (
                            event.feedId == null &&
                            event.categoryId == null &&
                            event.affectedFeedIds.isEmpty()
                        ) {
                            searchViewModel.applyAllMarkedRead()
                        } else {
                            searchViewModel.applyScopeMarkedRead(searchFeedIds)
                        }
                    }
                }
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
                    articlesViewModel.refreshArticles()
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
                onRefreshArticles = {
                    feedsViewModel.syncAllFeeds()
                },
                onLoadMoreArticles = articlesViewModel::loadMoreArticles,
                onOpenArticle = {
                    articlesViewModel.openArticle(it)
                    appViewModel.setTab(HomeTab.ARTICLES)
                },
                onCloseArticle = articlesViewModel::closeArticle,
                onToggleRead = articlesViewModel::markRead,
                onMarkAllRead = articlesViewModel::markAllRead,
                onArticleSnapshot = articlesViewModel::updateArticleQueueSnapshot,
                onSearchQueryChanged = searchViewModel::setQuery,
                onSearchRequested = searchViewModel::search,
                onLoadMoreSearch = searchViewModel::loadMore,
                onThemeChanged = { settingsViewModel.updateTheme(it.apiValue) },
                onSortChanged = {
                    settingsViewModel.updateDefaultSort(it.apiValue)
                    articlesViewModel.setFilter(sort = it.apiValue, hideRead = null)
                },
                onDensityChanged = { settingsViewModel.updateDensity(it.apiValue) },
                onTextSizeChanged = settingsViewModel::updateTextSize,
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
