package com.selffeed.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.selffeed.android.R
import com.selffeed.android.ui.components.shareOpmlContent
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.metrics.performance.PerformanceMetricsState
import com.selffeed.android.ui.theme.SelfFeedTheme
import kotlinx.coroutines.delay

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
        chromeState.serverChangeConfirmation?.let { confirmation ->
            val requestedServer = confirmation.serverOrigin.orEmpty()
            AlertDialog(
                onDismissRequest = appViewModel::cancelExternalServerChange,
                title = { Text(stringResource(R.string.external_link_switch_server_title)) },
                text = {
                    Text(
                        stringResource(
                            R.string.external_link_switch_server_detail,
                            requestedServer,
                            authState.apiBaseUrl,
                        ),
                    )
                },
                dismissButton = {
                    TextButton(onClick = appViewModel::cancelExternalServerChange) {
                        Text(stringResource(R.string.action_cancel))
                    }
                },
                confirmButton = {
                    Button(
                        onClick = {
                            appViewModel.confirmExternalServerChange()
                            authViewModel.switchServerForExternalAction(requestedServer)
                        },
                    ) {
                        Text(stringResource(R.string.external_link_switch_server_action))
                    }
                },
            )
        }
        val latestFeedsState = rememberUpdatedState(feedsState)
        val workflowCoordinator = remember { AppWorkflowCoordinator() }
        val workflowSink = object : AppWorkflowSink {
            override fun refreshAuthenticatedSession() {
                articlesViewModel.clearSessionReadStateMemory()
                feedsViewModel.loadCategories()
                feedsViewModel.loadFeeds()
                feedsViewModel.reconcileSyncStatus()
                settingsViewModel.loadPreferences()
                settingsViewModel.loadStats()
                settingsViewModel.loadAuthSessions()
                if (authState.user?.role == "admin") {
                    settingsViewModel.loadAdminSettings()
                }
                articlesViewModel.refreshArticles()
                articlesViewModel.startReadStateSync()
            }

            override fun clearUnauthenticatedSession() {
                articlesViewModel.stopReadStateSync()
                articlesViewModel.clearSessionReadStateMemory()
            }

            override fun applyArticlePreferences(
                defaultSort: String,
                hideRead: Boolean,
                autoMarkReadMode: String
            ) {
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
                refreshArticleContentSurfaces(
                    loadCategories = feedsViewModel::loadCategories,
                    loadFeeds = feedsViewModel::loadFeeds,
                    refreshArticles = articlesViewModel::refreshArticles,
                    loadStats = settingsViewModel::loadStats,
                )
            }
        }

        LaunchedEffect(chromeState.sessionReady) {
            if (chromeState.sessionReady) {
                authViewModel.bootstrap()
            }
        }

        LaunchedEffect(Unit) {
            feedsViewModel.opmlExports.collect { content ->
                shareOpmlContent(context, content)
            }
        }

        LaunchedEffect(authState.isAuthenticated) {
            workflowCoordinator.onAuthenticationChanged(authState.isAuthenticated, workflowSink)
        }

        LaunchedEffect(authState.passwordChangeGeneration) {
            if (authState.passwordChangeGeneration > 0) {
                settingsViewModel.loadAuthSessions()
            }
        }

        LaunchedEffect(authState.isAuthenticated, chromeState.pendingExternalAction?.key) {
            if (!authState.isAuthenticated) return@LaunchedEffect
            when (val action = appViewModel.consumeExternalAction()) {
                is ExternalAction.OpenArticle -> {
                    articlesViewModel.openArticle(action.articleId)
                    appViewModel.openReaderFrom(HomeTab.ARTICLES)
                }

                is ExternalAction.AddFeed -> {
                    feedsViewModel.offerExternalFeed(action.feedUrl)
                    appViewModel.setTab(HomeTab.FEEDS)
                }

                null -> Unit
            }
        }

        LaunchedEffect(authState.isAuthenticated) {
            if (!authState.isAuthenticated) return@LaunchedEffect
            while (true) {
                delay(60_000L)
                feedsViewModel.refreshFeedHealth()
                feedsViewModel.reconcileSyncStatus()
            }
        }

        LaunchedEffect(chromeState.activeTab, authState.isAuthenticated) {
            if (
                authState.isAuthenticated &&
                chromeState.activeTab == HomeTab.SETTINGS &&
                settingsState.preferences == null
            ) {
                settingsViewModel.loadPreferences()
            }
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

        // articleRevision is observed only while this ViewModel is polling a
        // user-initiated sync, so early publisher results can become visible
        // without waiting for the entire background batch.
        LaunchedEffect(feedsState.articleRevision) {
            if (feedsState.articleRevision > 0L && feedsState.syncInBackground) {
                articlesViewModel.refreshArticles()
            }
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
                onTabSelected = { tab ->
                    when (tab) {
                        HomeTab.SAVED -> articlesViewModel.setSavedOnly(true)
                        HomeTab.ARTICLES -> articlesViewModel.setSavedOnly(false)
                        else -> Unit
                    }
                    appViewModel.setTab(tab)
                },
                onRefreshVisibleData = {
                    feedsViewModel.loadCategories()
                    feedsViewModel.loadFeeds()
                    feedsViewModel.reconcileSyncStatus()
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
                onUpdateFeed = { id, feedUrl, title, categoryId, pollingIntervalMinutes ->
                    feedsViewModel.updateFeed(
                        id,
                        feedUrl,
                        title,
                        categoryId,
                        pollingIntervalMinutes
                    )
                },
                onDeleteFeed = feedsViewModel::deleteFeed,
                onImportOpml = feedsViewModel::importOpml,
                onExportOpml = feedsViewModel::exportOpml,
                onDismissImportSummary = feedsViewModel::dismissImportSummary,
                onSelectDiscoveryCandidate = feedsViewModel::selectDiscoveryCandidate,
                onCancelFeedReplacement = feedsViewModel::cancelFeedReplacement,
                onConsumeExternalFeed = feedsViewModel::consumeExternalFeed,
                onLoadFeedSyncHistory = feedsViewModel::loadFeedSyncHistory,
                onRefreshArticles = {
                    // Refresh the API/Room list immediately. Publisher fetches
                    // continue independently and publish revisions as they land.
                    articlesViewModel.refreshArticles()
                    if (!articlesState.savedOnly) {
                        feedsViewModel.syncAllFeeds(
                            feedId = articlesState.selectedFeedId,
                            categoryId = articlesState.selectedCategoryId,
                        )
                    }
                },
                onOpenArticle = {
                    val origin = when (chromeState.activeTab) {
                        HomeTab.SEARCH -> HomeTab.SEARCH
                        HomeTab.SAVED -> HomeTab.SAVED
                        else -> HomeTab.ARTICLES
                    }
                    if (origin == HomeTab.SEARCH) {
                        articlesViewModel.openArticleFromQueue(it, searchState.results)
                    } else {
                        articlesViewModel.openArticle(it)
                    }
                    appViewModel.openReaderFrom(origin)
                },
                onOpenArticleFromQueue = { articleId, queue ->
                    articlesViewModel.openArticleFromQueue(
                        id = articleId,
                        queue = queue,
                        tracksPaging = true,
                    )
                    appViewModel.openReaderFrom(
                        if (chromeState.activeTab == HomeTab.SAVED) HomeTab.SAVED else HomeTab.ARTICLES,
                    )
                },
                onArticleDisplayed = articlesViewModel::onArticleDisplayed,
                onArticleCompleted = articlesViewModel::onArticleCompleted,
                onReaderPageChanged = articlesViewModel::onReaderPageChanged,
                onCloseArticle = {
                    articlesViewModel.closeArticle()
                    appViewModel.closeReader()
                },
                onToggleRead = articlesViewModel::markRead,
                onToggleSaved = { articleId, saved ->
                    articlesViewModel.setSaved(articleId, saved) {
                        searchViewModel.updateSavedState(articleId, !saved)
                    }
                    searchViewModel.updateSavedState(articleId, saved)
                },
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
                onRegistrationLockChanged = settingsViewModel::toggleRegistrationLock,
                onRetryFeedSync = { feedId ->
                    feedsViewModel.syncAllFeeds(feedId = feedId, categoryId = null)
                    settingsViewModel.loadStats()
                },
                onCreateAdminUser = settingsViewModel::createAdminUser,
                onUpdateAdminUser = settingsViewModel::updateAdminUser,
                onResetAdminPassword = settingsViewModel::resetAdminPassword,
                onChangePassword = authViewModel::changePassword,
                onRetryPreferences = settingsViewModel::loadPreferences,
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
