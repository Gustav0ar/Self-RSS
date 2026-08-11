package com.selffeed.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Bookmark
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
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.selffeed.android.R
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.resolve
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlesTab(
    state: ArticleTabState,
    actions: ArticleTabActions,
    pagedArticles: LazyPagingItems<ArticleListItem>,
    listState: LazyListState = rememberLazyListState(),
) {
    val pullToRefreshState = rememberPullToRefreshState()
    var keepTopAfterRefresh by remember { mutableStateOf(false) }
    var wasRefreshing by remember { mutableStateOf(false) }
    val readStateOverrides = remember(state.articles) {
        state.articles.associate { it.id to it.isRead }
    }
    val savedStateOverrides = remember(state.articles) {
        state.articles.associate { it.id to it.isSaved }
    }

    val isPagingInitialLoad = pagedArticles.loadState.refresh is LoadState.Loading
    val articleCount = pagedArticles.itemCount

    LaunchedEffect(listState, pagedArticles) {
        snapshotFlow {
            val loadedArticlesById = pagedArticles.itemSnapshotList.items.associateBy { it.id }
            listState.layoutInfo.visibleItemsInfo
                .mapNotNull { item -> loadedArticlesById[item.key as? String] }
                .take(VISIBLE_ARTICLE_PREFETCH_LIMIT)
        }
            .distinctUntilChanged { previous, current ->
                previous.map { it.id } == current.map { it.id }
            }
            .collect(actions.onVisibleArticles)
    }
    // Pull-to-refresh owns only the bounded foreground list reload. Publisher
    // synchronization may continue for slow feeds, but must never capture the
    // pull gesture or leave this spinner running for minutes.
    val isRefreshing = state.isStartingFeedSync || isPagingInitialLoad
    val isEmpty = articleCount == 0 && !isRefreshing

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
            if (state.refreshBlockedGuidance == null && !state.isSyncingFeeds) actions.onRefresh()
        },
        modifier = Modifier.fillMaxSize(),
        state = pullToRefreshState,
        indicator = {
            // Use the default Material3 indicator in both states. It
            // owns the animation (arc sweep + global rotation) and the
            // pull-arrow transition. Do NOT wrap it in a custom Box
            // with `pullToRefreshIndicator` and then place a second
            // `CircularProgressIndicator` inside that Box — the second
            // indicator overlays the default one and the two together
            // render as a single static dot, which is what the user
            // sees as a "frozen spinner" during refresh.
            PullToRefreshDefaults.Indicator(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .testTag("articles-refresh-indicator"),
                isRefreshing = isRefreshing,
                state = pullToRefreshState,
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                color = MaterialTheme.colorScheme.primary,
            )
        },
    ) {
        LazyColumn(
            state = listState,
            // PullToRefreshBox draws its indicator above this list. Keep the
            // content at its normal position instead of translating it with
            // the pull distance; otherwise the active spinner appears to
            // reserve vertical space even though it is an overlay.
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
                    val isRead = readStateOverrides[article.id] ?: article.isRead
                    val displayedArticle = savedStateOverrides[article.id]
                        ?.let { article.copy(isSaved = it) }
                        ?: article
                    ArticleListRow(
                        article = displayedArticle,
                        isRead = isRead,
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
                            actions.onReadStateChanged(article.id, !read)
                        },
                        onToggleSaved = if (state.isOffline) null else {
                            {
                                actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                                actions.onToggleSaved(
                                    displayedArticle.id,
                                    !displayedArticle.isSaved
                                )
                            }
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

        if (state.isSyncingFeeds) {
            BackgroundFeedSyncIndicator(
                completedFeeds = state.syncCompletedFeeds,
                totalFeeds = state.syncTotalFeeds,
                modifier = Modifier.align(Alignment.TopEnd),
            )
        }
    }
}

@Composable
private fun BackgroundFeedSyncIndicator(
    completedFeeds: Int,
    totalFeeds: Int,
    modifier: Modifier = Modifier,
) {
    val progressLabel = if (totalFeeds > 0) {
        stringResource(
            R.string.article_sync_progress,
            completedFeeds,
            totalFeeds,
        )
    } else {
        stringResource(R.string.article_sync_progress_unknown)
    }
    val progressDescription = if (totalFeeds > 0) {
        stringResource(
            R.string.article_sync_progress_cd,
            completedFeeds,
            totalFeeds,
        )
    } else {
        stringResource(R.string.article_syncing_cd)
    }
    Surface(
        modifier = modifier
            .padding(top = 8.dp, end = 12.dp)
            .testTag("articles-background-sync")
            .semantics {
                contentDescription = progressDescription
            },
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 3.dp,
        shadowElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Text(
                text = progressLabel,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private const val VISIBLE_ARTICLE_PREFETCH_LIMIT = 4

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
@OptIn(ExperimentalMaterial3Api::class)
private fun ArticleListRow(
    article: ArticleListItem,
    isRead: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onToggleRead: (Boolean) -> Unit,
    onToggleSaved: (() -> Unit)?,
    density: DensityPreference,
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
            val color =
                if (effectiveIsRead) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
            val icon =
                if (effectiveIsRead) Icons.Default.MarkEmailUnread else Icons.Default.MarkEmailRead
            val label = stringResource(
                if (effectiveIsRead) R.string.article_mark_unread else R.string.article_mark_read,
            )

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
                .semantics { contentDescription = articleDescription }
                .clickable(onClick = onClick),
        ) {
            ArticleCard(
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
) {
    val isRead = isReadOverride ?: article.isRead
    val verticalPadding = if (density == DensityPreference.COMPACT) 8.dp else 12.dp
    val heroSize = if (density == DensityPreference.COMPACT) 44.dp else 56.dp
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
                    maxLines = if (density == DensityPreference.COMPACT) 2 else 3,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = MaterialTheme.typography.titleMedium.lineHeight * 0.9f,
                )
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
            IconButton(
                onClick = { onToggleSaved?.invoke() },
                enabled = onToggleSaved != null,
                modifier = Modifier.size(40.dp),
            ) {
                Icon(
                    imageVector = if (article.isSaved) Icons.Default.Bookmark else Icons.Outlined.BookmarkBorder,
                    contentDescription = stringResource(
                        if (article.isSaved) R.string.article_remove_saved else R.string.article_save,
                    ),
                    tint = if (article.isSaved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
