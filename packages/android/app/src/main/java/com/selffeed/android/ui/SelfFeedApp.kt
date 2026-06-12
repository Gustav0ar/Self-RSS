package com.selffeed.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.paging.compose.collectAsLazyPagingItems
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.components.openExternalUrl
import com.selffeed.android.ui.components.shareOpmlContent
import com.selffeed.android.ui.screens.ArticlesTab
import com.selffeed.android.ui.screens.FeedsTab
import com.selffeed.android.ui.screens.SearchTab
import com.selffeed.android.ui.screens.SettingsTab
import com.selffeed.android.ui.screens.StatsTab
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelfFeedApp(state: AppUiState, viewModel: MainViewModel) {
    val snackbarHostState = remember { SnackbarHostState() }
    val drawerState = androidx.compose.material3.rememberDrawerState(initialValue = androidx.compose.material3.DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val topBarLabel = remember(
        state.activeTab,
        state.selectedArticle,
        state.selectedFeedId,
        state.selectedCategoryId,
        state.feeds,
        state.categories,
    ) {
        topBarLabel(state)
    }

    // Snackbar messages are now driven by a sequence counter so that a new
    // message arriving while an earlier one is still showing doesn't get
    // silently dropped. The previous implementation keyed the effect on
    // (errorMessage, statusMessage), which left the second message invisible
    // when the keys collided before the first was dismissed.
    val errorSequence = remember(state.errorMessagesShown) { state.errorMessagesShown }
    val statusSequence = remember(state.statusMessagesShown) { state.statusMessagesShown }

    LaunchedEffect(errorSequence, state.errorMessage) {
        state.errorMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.acknowledgeError()
        }
    }
    LaunchedEffect(statusSequence, state.statusMessage) {
        state.statusMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.acknowledgeStatus()
        }
    }

    LaunchedEffect(state.exportedOpml) {
        state.exportedOpml?.let { content ->
            shareOpmlContent(context, content)
            viewModel.consumeExportedOpml()
        }
    }

    if (state.loading) {
        LoadingScreen()
        return
    }

    if (!state.isAuthenticated) {
        AuthScreen(
            mode = state.authMode,
            registrationEnabled = state.registrationEnabled,
            errorMessage = state.errorMessage,
            onModeChange = viewModel::setAuthMode,
            onLogin = viewModel::login,
            onRegister = viewModel::register,
        )
        return
    }

    val articlePagingItems = viewModel.articlePagingData.collectAsLazyPagingItems()

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = MaterialTheme.colorScheme.surface,
                drawerContentColor = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.width(320.dp),
            ) {
                FeedsTab(state, viewModel, onSelect = { scope.launch { drawerState.close() } })
            }
        },
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
            topBar = {
                AppTopBar(
                    activeTab = state.activeTab,
                    selectedArticle = state.selectedArticle,
                    currentLabel = topBarLabel,
                    showMarkAllRead = state.activeTab == HomeTab.ARTICLES &&
                        state.selectedArticle == null &&
                        state.articles.isNotEmpty(),
                    isOnline = state.isOnline,
                    onOpenDrawer = { scope.launch { drawerState.open() } },
                    onMarkAllRead = viewModel::markAllRead,
                    onBack = viewModel::closeArticle,
                    onToggleRead = {
                        state.selectedArticle?.let { article ->
                            viewModel.markRead(article.id, !article.isRead)
                        }
                    },
                )
            },
            bottomBar = {
                AppBottomBar(
                    activeTab = state.activeTab,
                    onTabSelected = viewModel::setTab,
                )
            },
        ) { paddingValues ->
            // Mount the resume observer whenever the user is authenticated —
            // the previous condition (`state.errorMessage == null`) would
            // unmount the observer on any error, leaving the app stale on
            // the next foreground.
            if (state.isAuthenticated) {
                ResumeRefreshObserver(onResume = viewModel::refreshVisibleData)
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
            ) {
                AnimatedContent(
                    targetState = state.activeTab,
                    label = "android-main-tabs",
                ) { tab ->
                    when (tab) {
                        HomeTab.ARTICLES -> {
                            val selectedArticle = state.selectedArticle
                            if (selectedArticle != null) {
                                ArticleReaderPane(
                                    articles = state.articles,
                                    selectedArticle = selectedArticle,
                                    onOpenOriginal = { article ->
                                        article.canonicalUrl?.let { url ->
                                            openExternalUrl(context, url)
                                        }
                                    },
                                    onBackToList = viewModel::closeArticle,
                                    onArticleSelected = { id ->
                                        viewModel.openArticle(id)
                                    },
                                )
                            } else {
                                ArticlesTab(state, viewModel, articlePagingItems)
                            }
                        }
                        HomeTab.SEARCH -> SearchTab(state, viewModel)
                        HomeTab.SETTINGS -> SettingsTab(state, viewModel)
                        HomeTab.STATS -> StatsTab(state, viewModel)
                        HomeTab.FEEDS -> FeedsTab(state, viewModel, onSelect = { viewModel.setTab(HomeTab.ARTICLES) })
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
            androidx.compose.material3.CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
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
            icon = { Icon(Icons.Default.GridView, contentDescription = null) },
            label = { Text("Articles") },
        )
        NavigationBarItem(
            selected = activeTab == HomeTab.SEARCH,
            onClick = { onTabSelected(HomeTab.SEARCH) },
            icon = { Icon(Icons.Default.Search, contentDescription = null) },
            label = { Text("Search") },
        )
        NavigationBarItem(
            selected = activeTab == HomeTab.FEEDS,
            onClick = { onTabSelected(HomeTab.FEEDS) },
            icon = { Icon(Icons.Default.RssFeed, contentDescription = null) },
            label = { Text("Feeds") },
        )
        NavigationBarItem(
            selected = activeTab == HomeTab.SETTINGS,
            onClick = { onTabSelected(HomeTab.SETTINGS) },
            icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
            label = { Text("Settings") },
        )
    }
}

private fun topBarLabel(state: AppUiState): String = when (state.activeTab) {
    HomeTab.ARTICLES -> when {
        state.selectedArticle != null -> state.selectedArticle.feedTitle
        state.selectedFeedId != null -> state.feeds.find { it.id == state.selectedFeedId }?.title ?: "Feed"
        state.selectedCategoryId != null ->
            state.categories.find { it.id == state.selectedCategoryId }?.name ?: "Category"
        else -> "All Feeds"
    }
    HomeTab.SEARCH -> "Search"
    HomeTab.FEEDS -> "Manage Feeds"
    HomeTab.SETTINGS -> "Settings"
    HomeTab.STATS -> "Stats"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AuthScreen(
    mode: AuthMode,
    registrationEnabled: Boolean,
    errorMessage: String?,
    onModeChange: (AuthMode) -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

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
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.RssFeed, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
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
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    leadingIcon = { Icon(Icons.Default.Password, contentDescription = null) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(20.dp),
                )
                Button(
                    onClick = {
                        if (mode == AuthMode.LOGIN) onLogin(email, password) else onRegister(email, password)
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
