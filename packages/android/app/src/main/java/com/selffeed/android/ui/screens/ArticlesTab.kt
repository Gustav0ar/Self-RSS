package com.selffeed.android.ui.screens

import androidx.compose.animation.CapturedAnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.progressSemantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxDefaults
import androidx.compose.material3.SwipeToDismissBoxState
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.dimensionResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import com.selffeed.android.ui.components.OfflineTextStatus
import com.selffeed.android.R
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.ReadingMotionEasing
import com.selffeed.android.ui.articles.withArticleFlags
import com.selffeed.android.ui.components.ArticleBookmarkIcon
import com.selffeed.android.ui.resolve
import com.selffeed.android.ui.shouldOfferUnreadUndo
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ArticlesTab(
    state: ArticleTabState,
    actions: ArticleTabActions,
    pagedArticles: LazyPagingItems<ArticleListItem>,
    listState: LazyListState = rememberLazyListState(),
    observeOfflineText: (String) -> Flow<Boolean> = { emptyFlow() },
) {
    val haptic = LocalHapticFeedback.current
    val pullToRefreshState = rememberPullToRefreshState()
    val refreshState = pagedArticles.loadState.refresh
    val articleCount = pagedArticles.itemCount
    val firstArticleId = pagedArticles.itemSnapshotList.items.firstOrNull()?.id
    var refreshAnchorId by remember(state.queryKey) { mutableStateOf<String?>(null) }
    var settledEmpty by remember(state.queryKey) { mutableStateOf(false) }
    if ((refreshState is LoadState.NotLoading && !state.isManualRefreshInProgress) || articleCount > 0) {
        settledEmpty = articleCount == 0
    }

    LaunchedEffect(listState, pagedArticles) {
        snapshotFlow {
            // Warming and state reconciliation belong to the settled viewport.
            // Rows passing during a fling should not start network requests.
            if (listState.isScrollInProgress) null else listState.layoutInfo.visibleItemsInfo
                .mapNotNull { it.key as? String }
                .take(100)
        }
            .filterNotNull()
            // Layout changes on every scroll frame. Resolve the loaded articles
            // only when visible keys change, not for each pixel of movement.
            .distinctUntilChanged()
            .map { visibleKeys ->
                val loadedArticlesById = pagedArticles.itemSnapshotList.items.associateBy { it.id }
                visibleKeys.mapNotNull(loadedArticlesById::get)
            }
            .distinctUntilChanged { previous, current ->
                previous.map { it.id } == current.map { it.id }
            }
            .collect(actions.onVisibleArticles)
    }
    // Automatic paging and backend reconciliation never drive this indicator.
    // A manual refresh owns it continuously until that operation completes.
    val isRefreshing = state.isManualRefreshInProgress
    // An empty result is content too. Keep it mounted while the same query
    // revalidates, without claiming a new query is empty before it has loaded.
    val isEmpty = articleCount == 0 && refreshState !is LoadState.Error && settledEmpty

    fun refreshAnchorAtTop() = firstArticleId.takeIf {
        listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0
    }

    LaunchedEffect(isRefreshing, state.queryKey) {
        if (isRefreshing && refreshAnchorId == null) refreshAnchorId = refreshAnchorAtTop()
    }
    LaunchedEffect(isRefreshing, firstArticleId, refreshAnchorId) {
        val previousFirstId = refreshAnchorId ?: return@LaunchedEffect
        // Feed sync can finish while Paging is still presenting the old head.
        if (isRefreshing || firstArticleId == null || firstArticleId == previousFirstId) return@LaunchedEffect

        refreshAnchorId = null
        val visibleIndex = listState.firstVisibleItemIndex
        val visibleKey = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == visibleIndex }?.key
        if (
            !listState.isScrollInProgress && listState.firstVisibleItemScrollOffset == 0 &&
            (visibleIndex == 0 || visibleKey == previousFirstId)
        ) {
            listState.requestScrollToItem(0)
        }
    }

    LaunchedEffect(pullToRefreshState, isRefreshing) {
        if (isRefreshing) return@LaunchedEffect
        var armed = pullToRefreshState.distanceFraction >= 1f
        snapshotFlow { pullToRefreshState.distanceFraction >= 1f }
            .distinctUntilChanged()
            .collect { reached ->
                if (reached && !armed) {
                    haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                }
                armed = reached
            }
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            if (state.refreshBlockedGuidance == null && !state.isSyncingFeeds) {
                refreshAnchorId = refreshAnchorAtTop()
                actions.onRefresh()
            }
        },
        modifier = Modifier.fillMaxSize(),
        state = pullToRefreshState,
        indicator = {
            var suppressPullLine by remember { mutableStateOf(isRefreshing) }
            LaunchedEffect(isRefreshing) {
                // Material retracts from the refresh threshold after completion.
                if (isRefreshing) {
                    suppressPullLine = true
                } else if (suppressPullLine) {
                    snapshotFlow { pullToRefreshState.distanceFraction }.first { it == 0f }
                    suppressPullLine = false
                }
            }
            val accent = MaterialTheme.colorScheme.primary
            if (!isRefreshing && !suppressPullLine) {
                Canvas(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(2.dp)) {
                    val fraction = pullToRefreshState.distanceFraction.coerceIn(0f, 1f)
                    val width = size.width * fraction
                    drawRect(
                        color = accent,
                        topLeft = Offset(
                            if (layoutDirection == LayoutDirection.Ltr) 0f else size.width - width,
                            0f,
                        ),
                        size = Size(width, size.height),
                    )
                }
            }
            CapturedAnimatedVisibility(
                visible = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                enter = slideInVertically(tween(150, easing = ReadingMotionEasing)) { -it / 2 } +
                    fadeIn(tween(150)),
                exit = fadeOut(tween(110)),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 38.dp)
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        .progressSemantics()
                        .semantics { liveRegion = LiveRegionMode.Polite }
                        .testTag("articles-refresh-indicator")
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(
                        text = stringResource(R.string.feeds_refreshing),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        },
    ) {
        val articleCacheWindow = remember {
            LazyLayoutCacheWindow(aheadFraction = 1f, behindFraction = 0.5f)
        }
        LazyColumn(
            state = listState,
            // Pre-compose 1x viewport ahead and retain 0.5x behind for smooth 120Hz flings.
            cacheWindow = articleCacheWindow,
            // PullToRefreshBox draws its indicator above this list. Keep the
            // content at its normal position so the refresh status never
            // shifts the list.
            modifier = Modifier
                .fillMaxSize()
                .testTag("articles-list"),
            verticalArrangement = Arrangement.Top,
        ) {
            state.refreshBlockedGuidance?.let { guidance ->
                item(key = "feed-refresh-guidance") {
                    Surface(
                        modifier = Modifier.fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    ) {
                        Text(
                            text = guidance.resolve(),
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (state.isOffline) {
                item(key = "articles-offline-status") {
                    OfflineArticlesBanner()
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
                                contentDescription = stringResource(R.string.article_empty_cd),
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = stringResource(
                                    if (state.feedCount == 0) {
                                        R.string.article_empty_no_feeds_title
                                    } else if (state.savedOnly) {
                                        R.string.article_empty_saved_title
                                    } else {
                                        R.string.article_empty_queue_title
                                    },
                                ),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = stringResource(
                                    if (state.feedCount == 0) {
                                        R.string.article_empty_no_feeds_detail
                                    } else if (state.savedOnly) {
                                        R.string.article_empty_saved_detail
                                    } else {
                                        R.string.article_empty_queue_detail
                                    },
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

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
                    val displayedArticle = article.withArticleFlags(state.articleStates[article.id])
                    ArticleListRow(
                        modifier = if (index == 0) {
                            // Stable keys distinguish a new leading article
                            // from one that just scrolled into view.
                            Modifier.animateItem(
                                fadeInSpec = tween(175, easing = ReadingMotionEasing),
                                placementSpec = null,
                                fadeOutSpec = null,
                            )
                        } else Modifier,
                        observeOfflineText = observeOfflineText,
                        article = displayedArticle,
                        isRead = displayedArticle.isRead,
                        selected = state.selectedArticleId == article.id,
                        onClick = {
                            actions.onOpenArticleFromQueue(
                                article.id,
                                readerQueueForTappedArticle(
                                    snapshot = pagedArticles.itemSnapshotList.items,
                                    tappedArticle = article,
                                ),
                            )
                        },
                        onToggleRead = { read ->
                            actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                            actions.onToggleRead(article.id, read)
                            if (shouldOfferUnreadUndo(read)) actions.onMarkedUnread(article.id)
                        },
                        onToggleSaved = {
                            actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                            actions.onToggleSaved(displayedArticle, !displayedArticle.isSaved)
                        },
                        density = state.density,
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
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp
                            )
                        } else if (appendLoadState is LoadState.Error) {
                            AssistChip(
                                onClick = pagedArticles::retry,
                                label = {
                                    Text(
                                        appendLoadState.error.message
                                            ?: stringResource(R.string.action_retry_loading),
                                    )
                                },
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
                            label = {
                                Text(
                                    refreshLoadState.error.message
                                        ?: stringResource(R.string.action_retry),
                                )
                            },
                        )
                    }
                }
            }
        }

    }
}


internal fun readerQueueForTappedArticle(
    snapshot: List<ArticleListItem>,
    tappedArticle: ArticleListItem,
): List<ArticleListItem> = if (snapshot.any { it.id == tappedArticle.id }) {
    snapshot
} else {
    listOf(tappedArticle) + snapshot.filterNot { it.id == tappedArticle.id }
}

@Composable
private fun OfflineArticlesBanner() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.WifiOff,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(R.string.article_offline_notice),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ArticleListRow(
    article: ArticleListItem,
    isRead: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onToggleRead: (Boolean) -> Unit,
    onToggleSaved: (() -> Unit)?,
    density: DensityPreference,
    observeOfflineText: (String) -> Flow<Boolean>,
    modifier: Modifier = Modifier,
) {
    val swipeDensity = LocalDensity.current
    val positionalThreshold = SwipeToDismissBoxDefaults.positionalThreshold
    // A saved dismissed position replays the toggle when this row returns to the viewport.
    val dismissState = remember(swipeDensity) {
        SwipeToDismissBoxState(
            initialValue = SwipeToDismissBoxValue.Settled,
            positionalThreshold = positionalThreshold,
        )
    }
    val haptic = LocalHapticFeedback.current
    var pendingRead by remember { mutableStateOf<Boolean?>(null) }
    var pendingSave by remember { mutableStateOf(false) }
    val currentIsRead by rememberUpdatedState(isRead)
    val currentIsSaved by rememberUpdatedState(article.isSaved)
    val currentOnToggleRead by rememberUpdatedState(onToggleRead)
    val currentOnToggleSaved by rememberUpdatedState(onToggleSaved)

    LaunchedEffect(dismissState) {
        var armed = dismissState.targetValue != SwipeToDismissBoxValue.Settled
        snapshotFlow { dismissState.targetValue != SwipeToDismissBoxValue.Settled }
            .distinctUntilChanged()
            .collect { crossed ->
                if (crossed && !armed && dismissState.settledValue == SwipeToDismissBoxValue.Settled) {
                    haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                }
                armed = crossed
            }
    }

    LaunchedEffect(dismissState) {
        snapshotFlow { dismissState.settledValue }.collect { value ->
            when (value) {
                SwipeToDismissBoxValue.EndToStart -> {
                    haptic.performHapticFeedback(HapticFeedbackType.Confirm)
                    val read = !currentIsRead
                    pendingRead = read
                    // Apply the action before resetting, since it can remove this row from the list.
                    currentOnToggleRead(read)
                    dismissState.reset()
                    pendingRead = null
                }
                SwipeToDismissBoxValue.StartToEnd -> {
                    val toggleSaved = currentOnToggleSaved
                    if (toggleSaved != null) {
                        haptic.performHapticFeedback(
                            if (currentIsSaved) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn,
                        )
                        pendingSave = true
                        toggleSaved()
                    }
                    dismissState.reset()
                    pendingSave = false
                }
                SwipeToDismissBoxValue.Settled -> Unit
            }
        }
    }

    val effectiveIsRead = pendingRead ?: isRead

    SwipeToDismissBox(
        state = dismissState,
        modifier = modifier,
        enableDismissFromStartToEnd = onToggleSaved != null,
        gesturesEnabled = pendingRead == null && !pendingSave,
        backgroundContent = {
            val direction = dismissState.dismissDirection
            if (direction == SwipeToDismissBoxValue.Settled) {
                Box(Modifier.fillMaxSize())
                return@SwipeToDismissBox
            }
            val isStartToEnd = direction == SwipeToDismissBoxValue.StartToEnd
            val color = when {
                isStartToEnd -> MaterialTheme.colorScheme.tertiary
                effectiveIsRead -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.secondary
            }
            val icon = when {
                isStartToEnd && article.isSaved -> Icons.Outlined.BookmarkBorder
                isStartToEnd -> Icons.Default.Bookmark
                effectiveIsRead -> Icons.Default.MarkEmailUnread
                else -> Icons.Default.MarkEmailRead
            }
            val label = stringResource(
                when {
                    isStartToEnd && article.isSaved -> R.string.article_swipe_unsave
                    isStartToEnd -> R.string.article_swipe_save
                    effectiveIsRead -> R.string.article_mark_unread
                    else -> R.string.article_mark_read
                },
            )

            Box(
                Modifier
                    .fillMaxSize()
                    .background(color.copy(alpha = 0.9f))
                    .padding(horizontal = 24.dp),
                contentAlignment = if (isStartToEnd) Alignment.CenterStart else Alignment.CenterEnd,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.graphicsLayer {
                        this.alpha = (dismissState.progress * 2f - 1f).coerceIn(0f, 1f)
                        val shift = (1f - dismissState.progress) * 100f
                        this.translationX = if (isStartToEnd) -shift else shift
                    },
                ) {
                    if (isStartToEnd) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.graphicsLayer {
                                val scale = dismissState.progress.coerceIn(0.8f, 1.2f)
                                scaleX = scale
                                scaleY = scale
                            },
                        )
                        Text(
                            text = label,
                            color = Color.White,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                    } else {
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
                            modifier = Modifier.graphicsLayer {
                                val scale = dismissState.progress.coerceIn(0.8f, 1.2f)
                                scaleX = scale
                                scaleY = scale
                            },
                        )
                    }
                }
            }
        },
    ) {
        val readState = stringResource(
            if (effectiveIsRead) R.string.article_read_state_read else R.string.article_read_state_unread,
        )
        val articleDescription = stringResource(
            R.string.article_accessibility_label,
            readState,
            article.title,
            article.feedTitle,
        )
        Column(
            modifier = Modifier
                .background(MaterialTheme.colorScheme.background)
                .semantics { contentDescription = articleDescription }
                .clickable(onClick = onClick),
        ) {
            ArticleCard(
                observeOfflineText = observeOfflineText,
                article = article,
                selected = selected,
                onClick = {}, // click handled by parent Column
                onToggleSaved = onToggleSaved,
                isReadOverride = effectiveIsRead,
                density = density,
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
internal fun ArticleCard(
    article: ArticleListItem,
    selected: Boolean,
    onClick: () -> Unit,
    onToggleSaved: (() -> Unit)? = null,
    isReadOverride: Boolean? = null,
    density: DensityPreference = DensityPreference.COMFORTABLE,
    observeOfflineText: (String) -> Flow<Boolean> = { emptyFlow() },
) {
    val isRead = isReadOverride ?: article.isRead
    val verticalPadding = if (density == DensityPreference.COMPACT) 8.dp else 12.dp
    val heroSize = dimensionResource(
        if (density == DensityPreference.COMPACT) R.dimen.article_thumbnail_size_compact
        else R.dimen.article_thumbnail_size,
    )
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isRead && !selected) 0.6f else 1f)
                .padding(horizontal = 16.dp, vertical = verticalPadding),
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
                    val timestamp = article.displayedAt ?: article.publishedAt
                    val formattedTimestamp = remember(timestamp) { formatPublishedAt(timestamp) }
                    Text(
                        text = formattedTimestamp,
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
                    maxLines = if (density == DensityPreference.COMPACT) 2 else 3,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = MaterialTheme.typography.titleMedium.lineHeight * 0.9f,
                )
                OfflineTextStatus(article.id, observeOfflineText)
                article.excerpt?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                        maxLines = if (density == DensityPreference.COMPACT) 1 else 2,
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
                val imageSizePx = with(LocalDensity.current) { heroSize.roundToPx() }
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
                        .size(heroSize)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentScale = ContentScale.Crop,
                )
            }
            val haptic = LocalHapticFeedback.current
            IconButton(
                onClick = {
                    val toggle = onToggleSaved ?: return@IconButton
                    haptic.performHapticFeedback(
                        if (article.isSaved) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn,
                    )
                    toggle()
                },
                enabled = onToggleSaved != null,
                modifier = Modifier.size(40.dp),
            ) {
                ArticleBookmarkIcon(articleId = article.id, isSaved = article.isSaved)
            }
        }
    }
}
