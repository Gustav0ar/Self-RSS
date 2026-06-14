package com.selffeed.android

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.metrics.performance.JankStats
import androidx.metrics.performance.PerformanceMetricsState
import com.selffeed.android.ui.AppViewModel
import com.selffeed.android.ui.ArticleFeatureEvent
import com.selffeed.android.ui.ArticlesViewModel
import com.selffeed.android.ui.AuthViewModel
import com.selffeed.android.ui.FeedsViewModel
import com.selffeed.android.ui.HomeTab
import com.selffeed.android.ui.SearchViewModel
import com.selffeed.android.ui.SelfFeedApp
import com.selffeed.android.ui.SelfFeedAppActions
import com.selffeed.android.ui.SelfFeedAppState
import com.selffeed.android.ui.SettingsViewModel
import com.selffeed.android.ui.ThemePreference
import com.selffeed.android.ui.theme.SelfFeedTheme

class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels {
        AppViewModel.Factory((application as SelfFeedApplication).repository)
    }
    private val authViewModel: AuthViewModel by viewModels {
        AuthViewModel.Factory((application as SelfFeedApplication).repository)
    }
    private val feedsViewModel: FeedsViewModel by viewModels {
        FeedsViewModel.Factory((application as SelfFeedApplication).repository)
    }
    private val articlesViewModel: ArticlesViewModel by viewModels {
        ArticlesViewModel.Factory((application as SelfFeedApplication).repository)
    }
    private val searchViewModel: SearchViewModel by viewModels {
        SearchViewModel.Factory((application as SelfFeedApplication).repository)
    }
    private val settingsViewModel: SettingsViewModel by viewModels {
        SettingsViewModel.Factory((application as SelfFeedApplication).repository)
    }
    private var jankStats: JankStats? = null
    private lateinit var performanceMetricsState: PerformanceMetricsState.Holder

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the splash screen *before* `super.onCreate` so the
        // system uses the theme's `windowSplashScreenBackground` for
        // the first frame. The default splash is dismissed as soon as
        // the first composition is laid out — a typical "ready to
        // show UI" marker.
        val splash = installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Keep the splash on screen while the cold-start path runs.
        // This is the smallest "frozen frame" the user will ever see;
        // for a more controlled dismissal, hook into your VM's
        // `loading` state and call `splash.setKeepOnScreenCondition`.
        var ready = false
        splash.setKeepOnScreenCondition { ready }
        // We dismiss once the very first frame is composed. Compose
        // drives its own readiness; tying this to a frame callback is
        // both simple and reliable.
        window.decorView.post {
            // Allow the next frame to render before dismissing so the
            // splash-to-content transition doesn't flash.
            window.decorView.post { ready = true }
        }
        performanceMetricsState = PerformanceMetricsState.getHolderForHierarchy(window.decorView)
        jankStats = JankStats.createAndTrack(window) { frameData ->
            if (BuildConfig.DEBUG && frameData.isJank) {
                Log.d(
                    TAG,
                    "Jank frame durationMs=${frameData.frameDurationUiNanos / NANOS_PER_MILLISECOND} states=${frameData.states}",
                )
            }
        }
        setContent {
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
    }

    override fun onResume() {
        super.onResume()
        jankStats?.isTrackingEnabled = true
    }

    override fun onPause() {
        jankStats?.isTrackingEnabled = false
        super.onPause()
    }

    private companion object {
        const val TAG = "SelfFeedJank"
        const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
