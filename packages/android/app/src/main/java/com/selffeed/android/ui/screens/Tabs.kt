package com.selffeed.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.ui.AppUiState
import com.selffeed.android.ui.MainViewModel
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun FeedsTab(
    state: AppUiState,
    viewModel: MainViewModel,
    onSelect: () -> Unit = {},
) {
    val expandedCategories = remember { mutableStateMapOf<String, Boolean>() }
    val prefs = state.preferences

    LaunchedEffect(state.categories) {
        state.categories.forEach { category ->
            if (!expandedCategories.containsKey(category.id)) {
                expandedCategories[category.id] = true
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            FeedSurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Unread only",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Switch(
                        checked = prefs?.hideRead ?: false,
                        onCheckedChange = { viewModel.updateHideRead(it) }
                    )
                }
            }
        }

        item {
            FeedSurfaceCard {
                DrawerItem(
                    icon = { Icon(Icons.Default.RssFeed, null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary) },
                    label = "All Feeds",
                    subtitle = "Everything in one stream",
                    count = state.stats?.totalUnread ?: 0,
                    selected = state.selectedCategoryId == null && state.selectedFeedId == null,
                    onClick = {
                        viewModel.selectCategory(null)
                        onSelect()
                    },
                )
            }
        }

        items(state.categories, key = { it.id }) { category ->
            val isExpanded = expandedCategories[category.id] ?: true
            FeedSurfaceCard {
                DrawerItem(
                    icon = {
                        Icon(
                            if (isExpanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                            null,
                            modifier = Modifier.size(20.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    label = category.name,
                    subtitle = "${category.feedCount} feeds",
                    count = category.unreadCount,
                    selected = state.selectedCategoryId == category.id,
                    onClick = {
                        viewModel.selectCategory(category.id)
                        onSelect()
                    },
                    onExpand = {
                        expandedCategories[category.id] = !isExpanded
                    }
                )

                AnimatedVisibility(visible = isExpanded) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Spacer(modifier = Modifier.height(4.dp))
                        state.feeds.filter { it.categoryId == category.id }.forEach { feed ->
                            FeedRow(
                                feed = feed,
                                selected = state.selectedFeedId == feed.id,
                                onSelect = {
                                    viewModel.selectFeed(feed.id)
                                    onSelect()
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FeedSurfaceCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(10.dp),
            content = content,
        )
    }
}

@Composable
private fun DrawerItem(
    icon: @Composable () -> Unit,
    label: String,
    subtitle: String,
    count: Int,
    selected: Boolean = false,
    onClick: () -> Unit,
    onExpand: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .then(if (onExpand != null) Modifier.clickable(onClick = onExpand) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            icon()
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(text = subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (count > 0) {
            Surface(shape = CircleShape, color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    text = count.toString(),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun FeedRow(
    feed: FeedWithCounts,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(onClick = onSelect)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = feed.faviconUrl,
            contentDescription = null,
            modifier = Modifier
                .size(24.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentScale = ContentScale.Crop,
        )
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = feed.title,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = feed.description ?: feed.feedUrl,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (feed.unreadCount > 0) {
            Surface(
                shape = CircleShape,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            ) {
                Text(
                    text = feed.unreadCount.toString(),
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlesTab(state: AppUiState, viewModel: MainViewModel) {
    val listState = rememberLazyListState()

    PullToRefreshBox(
        isRefreshing = state.isSyncingFeeds,
        onRefresh = { viewModel.syncAllFeeds() },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Top,
        ) {
            if (state.articles.isEmpty() && !state.isSyncingFeeds) {
                item {
                    Box(
                        modifier = Modifier
                            .fillParentMaxSize()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.MarkEmailRead,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "No articles left to read",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Your queue is empty. Pull down to refresh or check other feeds.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }
            }

            items(state.articles, key = { it.id }) { article ->
                val dismissState = rememberSwipeToDismissBoxState()
                
                // Track if we should update to avoid visual jumps during animation
                var pendingToggle by remember { mutableStateOf(false) }

                LaunchedEffect(dismissState.currentValue) {
                    if (dismissState.currentValue == SwipeToDismissBoxValue.EndToStart) {
                        pendingToggle = true
                        delay(250) // Wait for settle animation
                        viewModel.markRead(article.id, !article.isRead)
                        dismissState.reset()
                        pendingToggle = false
                    }
                }

                SwipeToDismissBox(
                    state = dismissState,
                    enableDismissFromStartToEnd = false,
                    backgroundContent = {
                        val isRead = article.isRead
                        val color = if (isRead) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
                        val icon = if (isRead) Icons.Default.MarkEmailUnread else Icons.Default.MarkEmailRead
                        val label = if (isRead) "Mark unread" else "Mark read"
                        
                        Box(
                            Modifier
                                .fillMaxSize()
                                .background(color.copy(alpha = 0.9f))
                                .padding(horizontal = 24.dp),
                            contentAlignment = Alignment.CenterEnd
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                modifier = Modifier.graphicsLayer {
                                    this.alpha = (dismissState.progress * 2f - 1f).coerceIn(0f, 1f)
                                    this.translationX = (1f - dismissState.progress) * 100f
                                }
                            ) {
                                Text(
                                    text = label,
                                    color = Color.White,
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.Bold
                                )
                                Icon(
                                    icon,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.scale(dismissState.progress.coerceIn(0.8f, 1.2f))
                                )
                            }
                        }
                    }
                ) {
                    // Content
                    val effectiveIsRead = if (pendingToggle) !article.isRead else article.isRead
                    Column {
                        ArticleCard(
                            article = article.copy(isRead = effectiveIsRead),
                            selected = state.selectedArticle?.id == article.id,
                            onClick = { viewModel.openArticle(article.id) },
                        )
                        HorizontalDivider(
                            modifier = Modifier.padding(horizontal = 16.dp),
                            thickness = 0.5.dp,
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f)
                        )
                    }
                }
            }

            if (state.hasMoreArticles) {
                item {
                    Box(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                        if (state.loadingMoreArticles) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        } else {
                            AssistChip(
                                onClick = viewModel::loadMoreArticles,
                                label = { Text("Load more") },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ArticleCard(
    article: ArticleListItem,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val isRead = article.isRead
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isRead && !selected) 0.6f else 1f)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!article.isRead) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary),
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                        }
                        Text(
                            text = article.feedTitle,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Text(
                        text = formatPublishedAt(article.displayedAt ?: article.publishedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(start = if (article.isRead) 0.dp else 14.dp)
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (article.isRead) FontWeight.Normal else FontWeight.SemiBold,
                    color = if (isRead && !selected) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = MaterialTheme.typography.titleMedium.lineHeight * 0.9f
                )
                article.excerpt?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            article.heroImageUrl?.let { imageUrl ->
                AsyncImage(
                    model = imageUrl,
                    contentDescription = null,
                    modifier = Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentScale = ContentScale.Crop,
                )
            }
        }
    }
}

@Composable
fun SearchTab(state: AppUiState, viewModel: MainViewModel) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            FeedSurfaceCard {
                OutlinedTextField(
                    value = state.searchQuery,
                    onValueChange = {
                        viewModel.updateSearchQuery(it)
                        if (it.length >= 2) viewModel.search()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Search titles and article content") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
                )
            }
        }

        item {
            if (state.searchQuery.length >= 2) {
                Text(
                    text = "${state.searchResults.size} results",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }

        items(state.searchResults, key = { it.id }) { article ->
            ArticleCard(
                article = article,
                selected = state.selectedArticle?.id == article.id,
                onClick = { viewModel.openArticle(article.id) },
            )
        }

        if (state.hasMoreSearchResults) {
            item {
                Box(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    if (state.loadingMoreSearchResults) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        AssistChip(onClick = viewModel::loadMoreSearch, label = { Text("Load more results") })
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsTab(state: AppUiState, viewModel: MainViewModel) {
    val prefs = state.preferences ?: return
    val selectedTheme = normalizeThemePreference(prefs.theme)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            FeedSurfaceCard {
                Text("Preferences", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    "Control theme, density, sorting, and whether read items stay visible in your queue.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        item {
            FeedSurfaceCard {
                Text("Theme", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedTheme == "light", onClick = { viewModel.updateTheme("light") }, label = { Text("Light") }, leadingIcon = { Icon(Icons.Outlined.LightMode, contentDescription = null) })
                    FilterChip(selected = selectedTheme == "dark", onClick = { viewModel.updateTheme("dark") }, label = { Text("Dark") }, leadingIcon = { Icon(Icons.Outlined.DarkMode, contentDescription = null) })
                    FilterChip(selected = selectedTheme == "system", onClick = { viewModel.updateTheme("system") }, label = { Text("System") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Hide read articles", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text("Keep the main queue focused on unread items.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = prefs.hideRead, onCheckedChange = viewModel::updateHideRead)
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Sort order", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = prefs.defaultSort == "latest", onClick = { viewModel.updateDefaultSort("latest") }, label = { Text("Newest") })
                    FilterChip(selected = prefs.defaultSort == "oldest", onClick = { viewModel.updateDefaultSort("oldest") }, label = { Text("Oldest") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Density", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = prefs.density == "comfortable", onClick = { viewModel.updateDensity("comfortable") }, label = { Text("Comfortable") })
                    FilterChip(selected = prefs.density == "compact", onClick = { viewModel.updateDensity("compact") }, label = { Text("Compact") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Reader text size", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                androidx.compose.material3.Slider(
                    value = prefs.textSize.toFloat(),
                    onValueChange = { viewModel.updateTextSize(it.toInt()) },
                    valueRange = 12f..24f,
                )
                Text("${prefs.textSize}sp", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        item {
            FeedSurfaceCard {
                Text("Activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Unread", (state.stats?.totalUnread ?: 0).toString(), Modifier.weight(1f))
                    StatCard("Read", (state.stats?.totalRead ?: 0).toString(), Modifier.weight(1f))
                }
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Feeds", (state.stats?.totalFeeds ?: 0).toString(), Modifier.weight(1f))
                    StatCard("Categories", (state.stats?.totalCategories ?: 0).toString(), Modifier.weight(1f))
                }
            }
        }

        item {
            FeedSurfaceCard {
                Button(
                    onClick = viewModel::logout,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Logout")
                }
            }
        }
    }
}

private fun normalizeThemePreference(theme: String): String =
    if (theme == "amoled") "dark" else theme

@Composable
fun StatsTab(state: AppUiState, viewModel: MainViewModel) {
    SettingsTab(state, viewModel)
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(modifier = Modifier.height(10.dp))
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
    }
}
