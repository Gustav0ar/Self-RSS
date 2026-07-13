package com.selffeed.android.ui.screens

import android.content.Context
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.ui.ArticleSortPreference
import com.selffeed.android.ui.AutoMarkReadPreference
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.ReaderFontPreference
import com.selffeed.android.ui.ThemePreference
import com.selffeed.android.ui.theme.WarningAmber
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import java.io.ByteArrayOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlesTab(
    state: ArticleTabState,
    actions: ArticleTabActions,
    pagedArticles: LazyPagingItems<ArticleListItem>,
) {
    val listState = rememberLazyListState()
    val pullToRefreshState = rememberPullToRefreshState()
    val density = LocalDensity.current
    var keepTopAfterRefresh by remember { mutableStateOf(false) }
    var wasRefreshing by remember { mutableStateOf(false) }
    val readStateOverrides = remember(state.articles) {
        state.articles.associate { it.id to it.isRead }
    }

    val isPagingInitialLoad = pagedArticles.loadState.refresh is LoadState.Loading
    val articleCount = pagedArticles.itemCount
    // A pull starts feed synchronization first; the Paging refresh only
    // begins after that background job publishes new data. Treat both phases
    // as one refresh so Material switches from the stationary pull arrow to
    // its indeterminate animated spinner immediately and keeps it moving.
    val isRefreshing = state.isSyncingFeeds || (isPagingInitialLoad && articleCount > 0)
    val isEmpty = articleCount == 0 && !isPagingInitialLoad && !isRefreshing && !state.isSyncingFeeds

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
            // Use the default Material3 indicator in both states. It
            // owns the animation (arc sweep + global rotation) and the
            // pull-arrow transition. Do NOT wrap it in a custom Box
            // with `pullToRefreshIndicator` and then place a second
            // `CircularProgressIndicator` inside that Box — the second
            // indicator overlays the default one and the two together
            // render as a single static dot, which is what the user
            // sees as a "frozen spinner" during refresh.
            PullToRefreshDefaults.Indicator(
                modifier = Modifier.align(Alignment.TopCenter),
                isRefreshing = isRefreshing,
                state = pullToRefreshState,
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                color = MaterialTheme.colorScheme.primary,
            )
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
            if (state.isOffline) {
                item(key = "articles-offline-status") {
                    OfflineArticlesBanner()
                }
            }

            if (state.isSyncingFeeds) {
                item(key = "articles-background-sync") {
                    FeedRefreshBanner()
                }
            }

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
                                contentDescription = "No articles",
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = if (state.feedCount == 0) "Start by adding a feed" else "No articles left to read",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = if (state.feedCount == 0) {
                                    "Open Feeds to add a subscription or import an OPML file."
                                } else {
                                    "Your queue is empty. Pull down to refresh or check other feeds."
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            val retainedArticles = state.articles.takeIf { articleCount == 0 && it.isNotEmpty() }
            if (retainedArticles != null) {
                items(retainedArticles, key = { it.id }, contentType = { "retained-article-row" }) { article ->
                    val isRead = readStateOverrides[article.id] ?: article.isRead
                    ArticleListRow(
                        article = article,
                        isRead = isRead,
                        selected = state.selectedArticleId == article.id,
                        onClick = { actions.onOpenArticle(article.id) },
                        onToggleRead = { read ->
                            actions.onToggleRead(article.id, read)
                            actions.onReadStateChanged(article.id, !read)
                        },
                        density = state.density,
                    )
                }
            } else {
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
                                actions.onReadStateChanged(article.id, !read)
                            },
                            density = state.density,
                        )
                    }
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
        }
    }
}

@Composable
private fun OfflineArticlesBanner() {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = "Offline — showing saved articles. Read changes will sync when you reconnect.",
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

@Composable
private fun FeedRefreshBanner() {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.primaryContainer,
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = "Refreshing feeds in the background. New articles will appear as they arrive.",
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
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
        val readState = if (effectiveIsRead) "Read" else "Unread"
        Column(
            modifier = Modifier
                .semantics { contentDescription = "$readState article: ${article.title}, from ${article.feedTitle}" }
                .clickable(onClick = onClick),
        ) {
            ArticleCard(
                article = article,
                selected = selected,
                onClick = {}, // click handled by parent Column
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
        }
    }
}
