package com.selffeed.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.pullToRefreshIndicator
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.ui.ArticleSortPreference
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.ThemePreference
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged

data class FeedTabState(
    val categories: List<CategoryWithCounts>,
    val feeds: List<FeedWithCounts>,
    val hideRead: Boolean,
    val totalUnread: Int,
    val selectedCategoryId: String?,
    val selectedFeedId: String?,
)

data class ArticleTabState(
    val articles: List<ArticleListItem>,
    val selectedArticleId: String?,
    val hasMoreArticles: Boolean,
    val loadingMoreArticles: Boolean,
    val isSyncingFeeds: Boolean,
)

data class SearchTabState(
    val query: String,
    val results: List<ArticleListItem>,
    val selectedArticleId: String?,
    val hasMoreResults: Boolean,
    val loadingMoreResults: Boolean,
)

data class SettingsTabState(
    val preferences: UserPreferences?,
    val stats: StatsResponse?,
)

data class FeedTabActions(
    val onHideReadChanged: (Boolean) -> Unit,
    val onCategorySelected: (String?) -> Unit,
    val onFeedSelected: (String?) -> Unit,
)

data class ArticleTabActions(
    val onRefresh: () -> Unit,
    val onLoadMore: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onToggleRead: (String, Boolean) -> Unit,
    val onArticleSnapshot: (List<ArticleListItem>) -> Unit,
)

data class SearchTabActions(
    val onQueryChanged: (String) -> Unit,
    val onSearchRequested: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onLoadMore: () -> Unit,
)

data class SettingsTabActions(
    val onThemeChanged: (ThemePreference) -> Unit,
    val onHideReadChanged: (Boolean) -> Unit,
    val onSortChanged: (ArticleSortPreference) -> Unit,
    val onDensityChanged: (DensityPreference) -> Unit,
    val onTextSizeChanged: (Int) -> Unit,
    val onLogout: () -> Unit,
)

@Composable
fun FeedsTab(
    state: FeedTabState,
    actions: FeedTabActions,
    onSelect: () -> Unit = {},
) {
    val expandedCategories = remember { mutableStateMapOf<String, Boolean>() }

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
                        checked = state.hideRead,
                        onCheckedChange = actions.onHideReadChanged,
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
                    count = state.totalUnread,
                    selected = state.selectedCategoryId == null && state.selectedFeedId == null,
                    onClick = {
                        actions.onCategorySelected(null)
                        onSelect()
                    },
                )
            }
        }

        // Build a single ordered list that interleaves each category with
        // its feeds when expanded. The previous implementation rendered
        // all expanded feeds as a single flat block at the bottom of the
        // list, which broke the visual hierarchy — feeds should sit
        // directly under the category they belong to.
        val rows = buildList<Any> {
            state.categories.forEach { category ->
                add(category)
                if (expandedCategories[category.id] ?: true) {
                    state.feeds
                        .filter { it.categoryId == category.id }
                        .forEach { add(it) }
                }
            }
        }
        items(
            items = rows,
            key = { row ->
                when (row) {
                    is com.selffeed.android.network.CategoryWithCounts -> "cat-${row.id}"
                    is com.selffeed.android.network.FeedWithCounts -> "feed-${row.id}"
                    else -> row.hashCode().toString()
                }
            },
            contentType = { row ->
                when (row) {
                    is com.selffeed.android.network.CategoryWithCounts -> "category"
                    is com.selffeed.android.network.FeedWithCounts -> "feed"
                    else -> "unknown"
                }
            },
        ) { row ->
            when (row) {
                is com.selffeed.android.network.CategoryWithCounts -> {
                    val isExpanded = expandedCategories[row.id] ?: true
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
                            label = row.name,
                            subtitle = "${row.feedCount} feeds",
                            count = row.unreadCount,
                            selected = state.selectedCategoryId == row.id,
                            onClick = {
                                actions.onCategorySelected(row.id)
                                onSelect()
                            },
                            onExpand = {
                                expandedCategories[row.id] = !isExpanded
                            }
                        )
                    }
                }
                is com.selffeed.android.network.FeedWithCounts -> {
                    FeedRow(
                        feed = row,
                        selected = state.selectedFeedId == row.id,
                        onSelect = {
                            actions.onFeedSelected(row.id)
                            onSelect()
                        },
                    )
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
fun ArticlesTab(
    state: ArticleTabState,
    actions: ArticleTabActions,
    pagedArticles: LazyPagingItems<ArticleListItem>? = null,
) {
    val listState = rememberLazyListState()
    val pullToRefreshState = rememberPullToRefreshState()
    val density = LocalDensity.current
    var keepTopAfterRefresh by remember { mutableStateOf(false) }
    var wasRefreshing by remember { mutableStateOf(false) }
    val readStateOverrides = remember(state.articles) {
        state.articles.associate { it.id to it.isRead }
    }

    LaunchedEffect(
        listState,
        pagedArticles,
        state.articles.size,
        state.hasMoreArticles,
        state.loadingMoreArticles,
    ) {
        if (pagedArticles != null) return@LaunchedEffect
        snapshotFlow {
            val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            state.hasMoreArticles &&
                !state.loadingMoreArticles &&
                state.articles.isNotEmpty() &&
                lastVisibleIndex >= state.articles.lastIndex - AUTO_LOAD_MORE_THRESHOLD
        }
            .distinctUntilChanged()
            .collect { shouldLoadMore ->
                if (shouldLoadMore) {
                    actions.onLoadMore()
                }
            }
    }

    val isPagingInitialLoad = pagedArticles?.loadState?.refresh is LoadState.Loading
    val articleCount = pagedArticles?.itemCount ?: state.articles.size
    val isRefreshing = state.isSyncingFeeds || (isPagingInitialLoad && articleCount > 0)
    val isEmpty = articleCount == 0 && !isPagingInitialLoad && !isRefreshing

    LaunchedEffect(isRefreshing, articleCount) {
        if (!wasRefreshing && isRefreshing && listState.firstVisibleItemIndex == 0) {
            keepTopAfterRefresh = true
        }
        if (wasRefreshing && !isRefreshing && keepTopAfterRefresh && articleCount > 0) {
            listState.scrollToItem(0)
            keepTopAfterRefresh = false
        }
        wasRefreshing = isRefreshing
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            keepTopAfterRefresh = listState.firstVisibleItemIndex == 0
            actions.onRefresh()
        },
        modifier = Modifier.fillMaxSize(),
        state = pullToRefreshState,
        indicator = {
            if (isRefreshing) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .pullToRefreshIndicator(
                            state = pullToRefreshState,
                            isRefreshing = true,
                            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.5.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            } else {
                PullToRefreshDefaults.Indicator(
                    modifier = Modifier.align(Alignment.TopCenter),
                    isRefreshing = false,
                    state = pullToRefreshState,
                )
            }
        },
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val progress = pullToRefreshState.distanceFraction
                    if (progress > 0f) {
                        // Create the "rubber band" effect by offsetting and scaling the list
                        translationY = with(density) {
                            val offset = if (progress <= 1f) {
                                progress * 80.dp.toPx()
                            } else {
                                // Resistive pull beyond threshold
                                80.dp.toPx() + (progress - 1f) * 24.dp.toPx()
                            }
                            offset
                        }

                        val scale = 1f + (progress * 0.01f).coerceAtMost(0.015f)
                        scaleX = scale
                        scaleY = scale
                    }
                },
            verticalArrangement = Arrangement.Top,
        ) {
            if (isPagingInitialLoad && articleCount == 0) {
                item(key = "articles-loading") {
                    Box(
                        modifier = Modifier
                            .fillParentMaxSize()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
                    }
                }
            }

            if (isEmpty) {
                item(key = "articles-empty") {
                    Box(
                        modifier = Modifier
                            .fillParentMaxSize()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Default.MarkEmailRead,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "No articles left to read",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Your queue is empty. Pull down to refresh or check other feeds.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            if (pagedArticles != null) {
                items(
                    count = pagedArticles.itemCount,
                    // `peek` does not trigger a load on the paging source;
                    // calling `pagedArticles[index]` instead forces a load
                    // and is paid for twice (once here, once in the body).
                    key = { index -> pagedArticles.peek(index)?.id ?: "article-placeholder-$index" },
                    contentType = { index ->
                        if (pagedArticles.peek(index) == null) "article-placeholder"
                        else "article-row"
                    },
                ) { index ->
                    val article = pagedArticles[index]
                    if (article == null) {
                        ArticlePlaceholderRow()
                    } else {
                        val isRead = readStateOverrides[article.id] ?: article.isRead
                        ArticleListRow(
                            article = article,
                            isRead = isRead,
                            selected = state.selectedArticleId == article.id,
                            onClick = {
                                actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                                actions.onOpenArticle(article.id)
                            },
                            onToggleRead = { read ->
                                actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                                actions.onToggleRead(article.id, read)
                            },
                        )
                    }
                }

                val appendLoadState = pagedArticles.loadState.append
                if (appendLoadState is LoadState.Loading || appendLoadState is LoadState.Error) {
                    item(key = "articles-paging-footer") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 16.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (appendLoadState is LoadState.Loading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else if (appendLoadState is LoadState.Error) {
                                AssistChip(
                                    onClick = pagedArticles::retry,
                                    label = { Text(appendLoadState.error.message ?: "Retry loading") },
                                )
                            }
                        }
                    }
                }

                val refreshLoadState = pagedArticles.loadState.refresh
                if (refreshLoadState is LoadState.Error && pagedArticles.itemCount == 0) {
                    item(key = "articles-refresh-error") {
                        Box(
                            modifier = Modifier
                                .fillParentMaxSize()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            AssistChip(
                                onClick = pagedArticles::retry,
                                label = { Text(refreshLoadState.error.message ?: "Retry") },
                            )
                        }
                    }
                }
            } else {
                items(
                    items = state.articles,
                    key = { it.id },
                    contentType = { "article-row" },
                ) { article ->
                    ArticleListRow(
                        article = article,
                        isRead = article.isRead,
                        selected = state.selectedArticleId == article.id,
                        onClick = { actions.onOpenArticle(article.id) },
                        onToggleRead = { read -> actions.onToggleRead(article.id, read) },
                    )
                }

                if (state.hasMoreArticles) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                            if (state.loadingMoreArticles) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else {
                                AssistChip(
                                    onClick = actions.onLoadMore,
                                    label = { Text("Load more") },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun ArticleListRow(
    article: ArticleListItem,
    isRead: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onToggleRead: (Boolean) -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState()
    var pendingToggle by remember { mutableStateOf(false) }
    // Snapshot the read state at the moment the user started the swipe so
    // a fast double-swipe (or a recomposition that flips `isRead`) cannot
    // toggle the article twice in a row.
    val readAtSwipeStart = remember { mutableStateOf(isRead) }

    LaunchedEffect(dismissState.currentValue) {
        if (dismissState.currentValue == SwipeToDismissBoxValue.EndToStart && !pendingToggle) {
            readAtSwipeStart.value = isRead
            pendingToggle = true
            delay(250)
            onToggleRead(!readAtSwipeStart.value)
            dismissState.reset()
            pendingToggle = false
        }
    }

    val effectiveIsRead = if (pendingToggle) !isRead else isRead

    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            val color = if (effectiveIsRead) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
            val icon = if (effectiveIsRead) Icons.Default.MarkEmailUnread else Icons.Default.MarkEmailRead
            val label = if (effectiveIsRead) "Mark unread" else "Mark read"

            Box(
                Modifier
                    .fillMaxSize()
                    .background(color.copy(alpha = 0.9f))
                    .padding(horizontal = 24.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.graphicsLayer {
                        this.alpha = (dismissState.progress * 2f - 1f).coerceIn(0f, 1f)
                        this.translationX = (1f - dismissState.progress) * 100f
                    },
                ) {
                    Text(
                        text = label,
                        color = Color.White,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.scale(dismissState.progress.coerceIn(0.8f, 1.2f)),
                    )
                }
            }
        },
    ) {
        Column {
            ArticleCard(
                article = article,
                selected = selected,
                onClick = onClick,
                isReadOverride = effectiveIsRead,
            )
            HorizontalDivider(
                modifier = Modifier.padding(horizontal = 16.dp),
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f),
            )
        }
    }
}

@Composable
private fun ArticlePlaceholderRow() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .weight(1f, fill = true)
                    .widthIn(min = 0.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.35f)
                        .height(12.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
                Spacer(modifier = Modifier.height(8.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(18.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
                Spacer(modifier = Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.72f)
                        .height(14.dp)
                        .clip(RoundedCornerShape(7.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)),
                )
            }
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
        }
    }
}

@Composable
private fun ArticleCard(
    article: ArticleListItem,
    selected: Boolean,
    onClick: () -> Unit,
    isReadOverride: Boolean? = null,
) {
    val isRead = isReadOverride ?: article.isRead
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
            // Text column. The `widthIn(min = 0)` lets Compose shrink
            // the column below its intrinsic width when the row gets
            // narrow (small phones, large text-size), so the title
            // and date can wrap to multiple lines instead of being
            // clipped. Without this guard, narrow screens render the
            // text as "7 GB" + clipped fragments like "Co" / "Pli" /
            // "Vi" at the right edge.
            Column(
                modifier = Modifier
                    .weight(1f, fill = true)
                    .widthIn(min = 0.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!isRead) {
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
                            modifier = Modifier.weight(1f, fill = true),
                        )
                    }
                    Text(
                        text = formatPublishedAt(article.displayedAt ?: article.publishedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(start = if (isRead) 0.dp else 14.dp),
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isRead) FontWeight.Normal else FontWeight.SemiBold,
                    color = if (isRead && !selected) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = MaterialTheme.typography.titleMedium.lineHeight * 0.9f,
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

            // Hero image. Sized to 56dp instead of 72dp so the text
            // column has at least 56 + 16 (gap) = 72 more dp on small
            // screens. Hidden entirely when the article has no image
            // URL, which is the common case for older feed entries.
            article.heroImageUrl?.let { imageUrl ->
                val context = LocalContext.current
                val imageSizePx = with(LocalDensity.current) { 56.dp.roundToPx() }
                val imageRequest = remember(context, imageUrl, imageSizePx) {
                    ImageRequest.Builder(context)
                        .data(imageUrl)
                        .size(imageSizePx)
                        .memoryCachePolicy(CachePolicy.ENABLED)
                        .diskCachePolicy(CachePolicy.ENABLED)
                        .build()
                }
                AsyncImage(
                    model = imageRequest,
                    contentDescription = null,
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentScale = ContentScale.Crop,
                )
            }
        }
    }
}

@Composable
fun SearchTab(state: SearchTabState, actions: SearchTabActions) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            FeedSurfaceCard {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = {
                        actions.onQueryChanged(it)
                        if (it.length >= 2) actions.onSearchRequested()
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
            if (state.query.length >= 2) {
                Text(
                    text = "${state.results.size} results",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }

        items(
            items = state.results,
            key = { it.id },
            contentType = { "search-result-row" },
        ) { article ->
            ArticleCard(
                article = article,
                selected = state.selectedArticleId == article.id,
                onClick = { actions.onOpenArticle(article.id) },
            )
        }

        if (state.hasMoreResults) {
            item {
                Box(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    if (state.loadingMoreResults) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        AssistChip(onClick = actions.onLoadMore, label = { Text("Load more results") })
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsTab(state: SettingsTabState, actions: SettingsTabActions) {
    val prefs = state.preferences ?: return
    val selectedTheme = ThemePreference.fromApiValue(prefs.theme)
    val selectedSort = ArticleSortPreference.fromApiValue(prefs.defaultSort)
    val selectedDensity = DensityPreference.fromApiValue(prefs.density)

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
                    FilterChip(selected = selectedTheme == ThemePreference.LIGHT, onClick = { actions.onThemeChanged(ThemePreference.LIGHT) }, label = { Text("Light") }, leadingIcon = { Icon(Icons.Outlined.LightMode, contentDescription = null) })
                    FilterChip(selected = selectedTheme == ThemePreference.DARK, onClick = { actions.onThemeChanged(ThemePreference.DARK) }, label = { Text("Dark") }, leadingIcon = { Icon(Icons.Outlined.DarkMode, contentDescription = null) })
                    FilterChip(selected = selectedTheme == ThemePreference.SYSTEM, onClick = { actions.onThemeChanged(ThemePreference.SYSTEM) }, label = { Text("System") })
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
                    Switch(checked = prefs.hideRead, onCheckedChange = actions.onHideReadChanged)
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Sort order", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedSort == ArticleSortPreference.LATEST, onClick = { actions.onSortChanged(ArticleSortPreference.LATEST) }, label = { Text("Newest") })
                    FilterChip(selected = selectedSort == ArticleSortPreference.OLDEST, onClick = { actions.onSortChanged(ArticleSortPreference.OLDEST) }, label = { Text("Oldest") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Density", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedDensity == DensityPreference.COMFORTABLE, onClick = { actions.onDensityChanged(DensityPreference.COMFORTABLE) }, label = { Text("Comfortable") })
                    FilterChip(selected = selectedDensity == DensityPreference.COMPACT, onClick = { actions.onDensityChanged(DensityPreference.COMPACT) }, label = { Text("Compact") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Reader text size", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                androidx.compose.material3.Slider(
                    value = prefs.textSize.toFloat(),
                    onValueChange = { actions.onTextSizeChanged(it.toInt()) },
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
                    onClick = actions.onLogout,
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

private const val AUTO_LOAD_MORE_THRESHOLD = 5

@Composable
fun StatsTab(state: SettingsTabState, actions: SettingsTabActions) {
    SettingsTab(state, actions)
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
