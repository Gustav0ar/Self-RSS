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
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

@Composable
fun SelfFeedAppRoute(
    appViewModel: AppViewModel,
    authViewModel: AuthViewModel,
    performanceMetricsState: PerformanceMetricsState.Holder,
    benchmarkScenario: BenchmarkScenario? = null,
) {
    if (benchmarkScenario == BenchmarkScenario.READER) {
        SelfFeedTheme { BenchmarkReaderScenario() }
        return
    }
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    val chromeState by appViewModel.chrome.collectAsStateWithLifecycle()
    LaunchedEffect(chromeState.sessionReady) {
        if (chromeState.sessionReady) authViewModel.bootstrap()
    }
    val session = authState.session?.takeIf {
        authState.isAuthenticated && authViewModel.isCurrentSession(it)
    }
    LaunchedEffect(authState.loading, session?.ownerId) {
        if (!authState.loading && session == null) appViewModel.clearReadingSession()
    }
    // Always compose the host, including its empty stack, so logout pops and clears old models.
    AccountScreenScope(session?.ownerId) { ownerId ->
        AuthenticatedAppRoute(
            accountOwnerId = ownerId,
            authState = authState,
            appViewModel = appViewModel,
            authViewModel = authViewModel,
            feedsViewModel = accountViewModel(ownerId),
            articlesViewModel = accountViewModel(ownerId),
            searchViewModel = accountViewModel(ownerId),
            settingsViewModel = accountViewModel(ownerId),
            performanceMetricsState = performanceMetricsState,
        )
    }
    if (session == null) {
        SelfFeedTheme {
            ServerChangeConfirmation(chromeState, authState, appViewModel, authViewModel)
            if (authState.loading || authState.isAuthenticated) {
                LoadingScreen()
            } else {
                AuthScreen(
                    mode = authState.authMode,
                    apiBaseUrl = authState.apiBaseUrl,
                    registrationEnabled = authState.registrationEnabled,
                    errorMessage = authState.errorMessage,
                    onModeChange = authViewModel::setAuthMode,
                    onLogin = authViewModel::login,
                    onRegister = authViewModel::register,
                )
            }
        }
    }
}

@Composable
private fun ServerChangeConfirmation(
    chromeState: AppChromeState,
    authState: AuthUiState,
    appViewModel: AppViewModel,
    authViewModel: AuthViewModel,
) {
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
}

@Composable
private fun AuthenticatedAppRoute(
    accountOwnerId: String,
    authState: AuthUiState,
    appViewModel: AppViewModel,
    authViewModel: AuthViewModel,
    feedsViewModel: FeedsViewModel,
    articlesViewModel: ArticlesViewModel,
    searchViewModel: SearchViewModel,
    settingsViewModel: SettingsViewModel,
    performanceMetricsState: PerformanceMetricsState.Holder,
) {
    if (authState.session?.ownerId != accountOwnerId) return
    val context = LocalContext.current
    val chromeState by appViewModel.chrome.collectAsStateWithLifecycle()
    val isOnline by appViewModel.isOnline.collectAsStateWithLifecycle()
    val feedsState by feedsViewModel.state.collectAsStateWithLifecycle()
    val articlesState by articlesViewModel.state.collectAsStateWithLifecycle()
    val searchState by searchViewModel.state.collectAsStateWithLifecycle()
    val settingsState by settingsViewModel.state.collectAsStateWithLifecycle()
    val readingSessionKey = authState.session?.ownerId.takeIf { authState.isAuthenticated }
    val themePreference = ThemePreference.fromApiValue(settingsState.preferences?.theme).apiValue
    val darkTheme = when (themePreference) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }

    SelfFeedTheme(darkTheme = darkTheme) {
        ServerChangeConfirmation(chromeState, authState, appViewModel, authViewModel)
        val latestFeedsState = rememberUpdatedState(feedsState)
        val contentRefreshRequests = remember { Channel<Unit>(Channel.CONFLATED) }
        val workflowCoordinator = remember { AppWorkflowCoordinator() }
        val workflowSink = object : AppWorkflowSink {
            override fun refreshAuthenticatedSession() {
                articlesViewModel.clearSessionReadStateMemory()
                settingsViewModel.loadPreferences()
                settingsViewModel.loadAuthSessions()
                if (authState.user?.role == "admin") {
                    settingsViewModel.loadAdminSettings()
                }
                articlesViewModel.refreshArticles()
            }

            override fun clearUnauthenticatedSession() {
                articlesViewModel.clearReadingSession()
                appViewModel.clearReadingSession()
            }

            override fun applyArticlePreferences(
                defaultSort: String,
                hideRead: Boolean,
                autoMarkReadMode: String
            ) {
                articlesViewModel.applyPreferences(defaultSort, hideRead, autoMarkReadMode)
            }

            override fun refreshAfterFeedSync() {
                contentRefreshRequests.trySend(Unit)
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

            override fun applyArticleSavedState(articleId: String, saved: Boolean) {
                searchViewModel.updateSavedState(articleId, saved)
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
                contentRefreshRequests.trySend(Unit)
                articlesViewModel.refreshArticles()
            }
        }

        LaunchedEffect(feedsViewModel, accountOwnerId) {
            feedsViewModel.opmlExports.collect { content ->
                if (authState.session?.let(authViewModel::isCurrentSession) == true) {
                    shareOpmlContent(context, content)
                }
            }
        }

        LaunchedEffect(authState.loading, authState.isAuthenticated, readingSessionKey) {
            if (authState.loading) return@LaunchedEffect
            if (authState.isAuthenticated) {
                appViewModel.bindReadingSession(readingSessionKey)
                articlesViewModel.restoreReadingSession(readingSessionKey)
                currentCoroutineContext().ensureActive()
                appViewModel.finishReadingSessionRestore()
            }
            workflowCoordinator.onAuthenticationChanged(authState.isAuthenticated, workflowSink)
        }

        LaunchedEffect(authState.passwordChangeGeneration) {
            if (authState.passwordChangeGeneration > 0) {
                settingsViewModel.loadAuthSessions()
            }
        }

        LaunchedEffect(authState.isAuthenticated, chromeState.restoringReadingSession, chromeState.pendingExternalAction?.key) {
            if (!authState.isAuthenticated || !appViewModel.hasReadingSession(readingSessionKey)) return@LaunchedEffect
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

        ForegroundWorkEffect(accountOwnerId) {
            launch { articlesViewModel.observeReadStateSync() }
            launch { feedsViewModel.observeForeground() }
            // Resume always reconciles once, including offline sessions with no SSE handshake.
            // Keep later requests buffered while a read is in flight so an event is not lost.
            contentRefreshRequests.tryReceive()
            while (true) {
                coroutineScope {
                    launch { feedsViewModel.refreshCategories() }
                    launch { feedsViewModel.refreshFeedHealth() }
                    launch { settingsViewModel.refreshStats() }
                }
                contentRefreshRequests.receive()
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
            authState.isAuthenticated,
            chromeState.restoringReadingSession,
            settingsState.preferences?.defaultSort,
            settingsState.preferences?.hideRead,
            settingsState.preferences?.autoMarkReadMode,
        ) {
            if (!authState.isAuthenticated || !appViewModel.hasReadingSession(readingSessionKey)) return@LaunchedEffect
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

        LaunchedEffect(articlesViewModel, accountOwnerId) {
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
                auth = authState.copy(
                    loading = authState.loading || authState.isAuthenticated && !appViewModel.hasReadingSession(readingSessionKey),
                ),
                chrome = chromeState,
                feeds = feedsState,
                articles = articlesState,
                search = searchState,
                settings = settingsState,
                isOnline = isOnline,
            ),
            pendingArticleChanges = articlesViewModel.pendingArticleChanges,
            observeOfflineText = remember(articlesViewModel) { articlesViewModel::observeArticleTextAvailability },
            onRetryPendingChanges = articlesViewModel::retryPendingArticleChanges,
            readStateOverrides = articlesViewModel.readStateOverrides,
            actions = SelfFeedAppActions(
                onAuthModeChange = authViewModel::setAuthMode,
                onLogin = authViewModel::login,
                onRegister = authViewModel::register,
                onLogout = {
                    articlesViewModel.clearReadingSession()
                    appViewModel.clearReadingSession()
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
                onMoveCategory = feedsViewModel::moveCategory,
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
                    settingsViewModel.clearMessages()
                    appViewModel.clearMessages()
                },
            ),
            articlePagingData = articlesViewModel.articlePagingData,
        )
    }
}
