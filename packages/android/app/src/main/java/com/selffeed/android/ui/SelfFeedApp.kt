package com.selffeed.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.selffeed.android.R
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.components.openExternalUrl
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
import kotlinx.coroutines.flow.Flow
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
    val onRefreshArticles: () -> Unit,
    val onLoadMoreArticles: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onCloseArticle: () -> Unit,
    val onToggleRead: (String, Boolean) -> Unit,
    val onMarkAllRead: () -> Unit,
    val onArticleSnapshot: (List<ArticleListItem>) -> Unit,
    val onSearchQueryChanged: (String) -> Unit,
    val onSearchRequested: () -> Unit,
    val onLoadMoreSearch: () -> Unit,
    val onSearchCurrentCategoryOnlyChanged: (Boolean) -> Unit,
    val onThemeChanged: (ThemePreference) -> Unit,
    val onSortChanged: (ArticleSortPreference) -> Unit,
    val onDensityChanged: (DensityPreference) -> Unit,
    val onTextSizeChanged: (Int) -> Unit,
    val onRevokeAuthSession: (String) -> Unit,
    val onClearMessages: () -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelfFeedApp(
    state: SelfFeedAppState,
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
    val topBarLabel = remember(
        activeTab,
        selectedArticle,
        selectedFeedId,
        selectedCategoryId,
        state.feeds.feeds,
        state.feeds.categories,
    ) {
        topBarLabel(
            activeTab = activeTab,
            selectedArticle = selectedArticle,
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
            snackbarHostState.showSnackbar(it)
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
    val articleQueue = articlePagingItems.itemSnapshotList.items
        .takeIf { it.isNotEmpty() }
        ?: state.articles.items
    val feedTabState = remember(
        state.feeds.categories,
        state.feeds.feeds,
        state.articles.hideRead,
        state.settings.stats?.totalUnread,
        selectedCategoryId,
        selectedFeedId,
    ) {
        FeedTabState(
            categories = state.feeds.categories,
            feeds = state.feeds.feeds,
            hideRead = state.articles.hideRead,
            totalUnread = state.settings.stats?.totalUnread ?: 0,
            selectedCategoryId = selectedCategoryId,
            selectedFeedId = selectedFeedId,
        )
    }
    val articleTabState = remember(
        articleQueue,
        selectedArticle?.id,
        state.feeds.loading,
        state.articles.loading,
    ) {
        val isRefreshingArticles = state.feeds.loading || state.articles.loading
        ArticleTabState(
            articles = articleQueue,
            selectedArticleId = selectedArticle?.id,
            hasMoreArticles = false,
            loadingMoreArticles = false,
            isSyncingFeeds = isRefreshingArticles,
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
        state.settings.stats,
        state.settings.authSessions,
    ) {
        SettingsTabState(
            preferences = state.settings.preferences,
            stats = state.settings.stats,
            authSessions = state.settings.authSessions,
        )
    }
    val feedActions = remember(actions) {
        FeedTabActions(
            onHideReadChanged = actions.onHideReadChanged,
            onCategorySelected = actions.onCategorySelected,
            onFeedSelected = actions.onFeedSelected,
        )
    }
    val articleActions = remember(actions) {
        ArticleTabActions(
            onRefresh = actions.onRefreshArticles,
            onLoadMore = actions.onLoadMoreArticles,
            onOpenArticle = actions.onOpenArticle,
            onToggleRead = actions.onToggleRead,
            onArticleSnapshot = actions.onArticleSnapshot,
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
            onRevokeAuthSession = actions.onRevokeAuthSession,
            onLogout = actions.onLogout,
        )
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
                    onMarkAllRead = {
                        actions.onArticleSnapshot(articlePagingItems.itemSnapshotList.items)
                        actions.onMarkAllRead()
                    },
                    onBack = actions.onCloseArticle,
                    onToggleRead = {
                        selectedArticle?.let { article ->
                            actions.onToggleRead(article.id, !article.isRead)
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
                            if (selectedArticle != null) {
                                ArticleReaderPane(
                                    articles = articleQueue,
                                    selectedArticle = selectedArticle,
                                    onOpenOriginal = { article ->
                                        article.canonicalUrl?.let { url ->
                                            openExternalUrl(context, url)
                                        }
                                    },
                                    onBackToList = actions.onCloseArticle,
                                    onArticleSelected = actions.onOpenArticle,
                                )
                            } else {
                                ArticlesTab(articleTabState, articleActions, articlePagingItems)
                            }
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

}

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
            .background(MaterialTheme.colorScheme.error),
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
) {
    val isArticleSelected = activeTab == HomeTab.ARTICLES && selectedArticle != null

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
            if (isArticleSelected) {
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
    selectedFeedId: String?,
    selectedCategoryId: String?,
    feeds: List<FeedWithCounts>,
    categories: List<CategoryWithCounts>,
): String = when (activeTab) {
    HomeTab.ARTICLES -> when {
        selectedArticle != null -> selectedArticle.feedTitle
        selectedFeedId != null -> feeds.find { it.id == selectedFeedId }?.title ?: "Feed"
        selectedCategoryId != null -> categories.find { it.id == selectedCategoryId }?.name ?: "Category"
        else -> "All Feeds"
    }
    HomeTab.SEARCH -> "Search"
    HomeTab.FEEDS -> "Manage Feeds"
    HomeTab.SETTINGS -> "Settings"
    HomeTab.STATS -> "Stats"
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
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    leadingIcon = { Icon(Icons.Default.Email, contentDescription = "Email address") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
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
