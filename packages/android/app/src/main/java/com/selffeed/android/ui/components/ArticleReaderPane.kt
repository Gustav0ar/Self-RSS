package com.selffeed.android.ui.components

import com.selffeed.android.ui.articles.ArticleFlags
import com.selffeed.android.ui.articles.withArticleFlags

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.content.pm.ActivityInfo
import android.view.View
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.interaction.DragInteraction
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.computedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.selffeed.android.data.local.OfflineMediaCache
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import com.selffeed.android.R
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.toArticleListItem
import com.selffeed.android.ui.ReaderAppearance
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleReaderPane(
    articles: List<ArticleListItem>,
    isVisible: Boolean = true,
    isOnline: Boolean = true,
    atFeedStart: Boolean = true,
    atFeedEnd: Boolean = true,
    selectedArticle: ArticleDetail,
    prefetchedArticles: Map<String, ArticleDetail> = emptyMap(),
    articleStates: Map<String, ArticleFlags> = emptyMap(),
    onOpenOriginal: (ArticleDetail) -> Unit,
    onToggleRead: (() -> Unit)? = null,
    onToggleSaved: (() -> Unit)? = null,
    onBackToList: (() -> Unit)? = null,
    onArticleSelected: (String) -> Unit,
    onVisibleArticleChanged: (String) -> Unit = {},
    onArticleDisplayed: (String) -> Unit = {},
    onArticleCompleted: (String) -> Unit = {},
    onArticleBodyReady: (String) -> Unit = {},
    appearance: ReaderAppearance = ReaderAppearance(),
    preferHtml: Boolean = true,
    onPreferHtmlChanged: (Boolean) -> Unit = {},
    observeOfflineText: (String) -> Flow<Boolean> = { emptyFlow() },
    loadError: String? = null,
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val lifecycleState by lifecycle.currentStateAsState()
    val foreground = isVisible && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    val customTabsPrewarmer = LocalCustomTabsPrewarmer.current
    LaunchedEffect(selectedArticle.canonicalUrl, foreground, isOnline) {
        if (foreground && isOnline) {
            customTabsPrewarmer?.mayLaunchUrl(selectedArticle.canonicalUrl)
        }
    }
    var retainAdjacentRenderers by remember { mutableStateOf(true) }
    LaunchedEffect(isVisible) {
        if (isVisible) retainAdjacentRenderers = true
    }
    val appContext = LocalContext.current.applicationContext
    DisposableEffect(appContext, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) retainAdjacentRenderers = true
        }
        val callbacks = object : ComponentCallbacks2 {
            override fun onConfigurationChanged(config: Configuration) = Unit
            @Deprecated("Only delivered on older Android versions")
            override fun onLowMemory() { retainAdjacentRenderers = false }
            override fun onTrimMemory(level: Int) {
                // Keep adjacent WebViews across brief background switches
                // (TRIM_MEMORY_UI_HIDDEN), releasing them under memory pressure
                // (RUNNING_LOW / RUNNING_CRITICAL and TRIM_MEMORY_BACKGROUND+).
                if (level != ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN &&
                    level >= TRIM_MEMORY_PRESSURE_FLOOR
                ) {
                    retainAdjacentRenderers = false
                }
            }
        }
        appContext.registerComponentCallbacks(callbacks)
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            appContext.unregisterComponentCallbacks(callbacks)
        }
    }
    val readerArticles = remember(articles, selectedArticle) {
        articles.withSelectedArticle(selectedArticle)
    }
    val selectedArticleIndex = remember(readerArticles, selectedArticle.id) {
        readerArticles.indexOfFirst { it.id == selectedArticle.id }
    }

    if (onBackToList != null) BackHandler(onBack = onBackToList)

    if (readerArticles.isEmpty() || selectedArticleIndex == -1) {
        ArticleDetailView(
            observeOfflineText = observeOfflineText,
            article = selectedArticle,
            loadError = loadError,
            onRetry = { onArticleSelected(selectedArticle.id) },
            isActive = foreground,
            isOnline = isOnline,
            onOpenOriginal = { onOpenOriginal(selectedArticle) },
            onDisplayed = { onArticleDisplayed(selectedArticle.id) },
            onCompleted = { onArticleCompleted(selectedArticle.id) },
            onBodyReady = { onArticleBodyReady(selectedArticle.id) },
            preferHtml = preferHtml,
            onPreferHtmlChanged = onPreferHtmlChanged,
            appearance = appearance,
        )
        return
    }

    val pagerState = rememberPagerState(initialPage = selectedArticleIndex) {
        readerArticles.size
    }
    val readerArticleIds = remember(readerArticles) { readerArticles.map { it.id } }
    val latestReaderArticles by rememberUpdatedState(readerArticles)
    val latestSelectedArticleId by rememberUpdatedState(selectedArticle.id)
    val latestOnArticleSelected by rememberUpdatedState(onArticleSelected)
    val latestOnVisibleArticleChanged by rememberUpdatedState(onVisibleArticleChanged)
    // Track article IDs emitted by pager swipes so their async state echoes
    // (or concurrent list/metadata refreshes while an article is loading) do not
    // call scrollToPage() and snap the user back to the loading page mid-swipe.
    val pendingPagerSelections = remember(pagerState) { ArrayDeque<String>() }
    var lastPagerSelectedId by remember(pagerState) { mutableStateOf<String?>(null) }
    var lastSyncedSelectedId by remember(pagerState) { mutableStateOf(selectedArticle.id) }

    LaunchedEffect(selectedArticle.id, readerArticleIds) {
        val selectedIdChanged = selectedArticle.id != lastSyncedSelectedId
        lastSyncedSelectedId = selectedArticle.id

        if (selectedIdChanged) {
            val echoIndex = pendingPagerSelections.indexOf(selectedArticle.id)
            if (echoIndex >= 0) {
                repeat(echoIndex + 1) { pendingPagerSelections.removeFirst() }
                return@LaunchedEffect
            }
            pendingPagerSelections.clear()
        } else if (
            pagerState.isScrollInProgress ||
            pendingPagerSelections.isNotEmpty() ||
            (lastPagerSelectedId != null && lastPagerSelectedId != selectedArticle.id)
        ) {
            // Never interrupt an active drag/fling or snap back when only the list changed.
            return@LaunchedEffect
        }

        val targetPage = readerArticleIds.indexOf(selectedArticle.id)
        if (targetPage == -1 || targetPage == pagerState.currentPage) return@LaunchedEffect

        pagerState.scrollToPage(targetPage)
        lastPagerSelectedId = selectedArticle.id
    }

    LaunchedEffect(pagerState) {
        // Guard against the article list shrinking while the user is mid-swipe
        // (e.g. SSE event marks-read + hideRead removes the current article
        // from the list). Without this bounds check the previous code threw
        // IndexOutOfBoundsException on the next frame.
        snapshotFlow { pagerState.settledPage }
            .distinctUntilChanged()
            .collect { settledPage ->
                val currentArticles = latestReaderArticles
                if (currentArticles.isEmpty()) return@collect
                val page = settledPage.coerceIn(0, currentArticles.lastIndex)
                val articleId = currentArticles[page].id
                if (articleId != latestSelectedArticleId ||
                    (lastPagerSelectedId != null && articleId != lastPagerSelectedId)
                ) {
                    if (pendingPagerSelections.size >= 8) pendingPagerSelections.removeFirst()
                    pendingPagerSelections.addLast(articleId)
                    lastPagerSelectedId = articleId
                    latestOnArticleSelected(articleId)
                }
            }
    }

    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }
            .distinctUntilChanged()
            .collect { currentPage ->
                val currentArticles = latestReaderArticles
                if (currentArticles.isEmpty()) return@collect
                val page = currentPage.coerceIn(0, currentArticles.lastIndex)
                latestOnVisibleArticleChanged(currentArticles[page].id)
            }
    }

    val selectedDetails = remember(selectedArticle, prefetchedArticles) {
        prefetchedArticles.toMutableMap().apply {
            put(
                selectedArticle.id,
                get(selectedArticle.id)?.withNonRegressiveReaderContent(selectedArticle)
                    ?: selectedArticle,
            )
        }
    }

    val boundaryPull = rememberReaderBoundaryPull(pagerState, atFeedStart, atFeedEnd)
    val pagerScope = rememberCoroutineScope()
    val readerFocusRequester = remember { FocusRequester() }
    LaunchedEffect(foreground) {
        if (foreground) runCatching { readerFocusRequester.requestFocus() }
    }
    val latestOnOpenOriginal by rememberUpdatedState(onOpenOriginal)
    val latestOnToggleRead by rememberUpdatedState(onToggleRead)
    val latestOnToggleSaved by rememberUpdatedState(onToggleSaved)
    val latestSelectedArticle by rememberUpdatedState(selectedArticle)
    Box(
        Modifier.fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .clipToBounds()
            .focusRequester(readerFocusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyUp ||
                    event.isCtrlPressed || event.isAltPressed || event.isMetaPressed
                ) {
                    return@onPreviewKeyEvent false
                }
                when (event.key) {
                    Key.J, Key.DirectionRight -> {
                        val next = pagerState.currentPage + 1
                        if (next < readerArticles.size) {
                            pagerScope.launch { pagerState.animateScrollToPage(next) }
                        }
                        true
                    }
                    Key.K, Key.DirectionLeft -> {
                        val prev = pagerState.currentPage - 1
                        if (prev >= 0) {
                            pagerScope.launch { pagerState.animateScrollToPage(prev) }
                        }
                        true
                    }
                    Key.S -> {
                        latestOnToggleSaved?.invoke() != null
                    }
                    Key.M -> {
                        latestOnToggleRead?.invoke() != null
                    }
                    Key.O -> {
                        latestOnOpenOriginal(latestSelectedArticle)
                        true
                    }
                    else -> false
                }
            }
            .nestedScroll(boundaryPull),
    ) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .graphicsLayer { translationX = boundaryPull.translation },
            beyondViewportPageCount = 1,
            // Boundary pull is handled outside the pager, including single-article feeds.
            overscrollEffect = null,
            key = { page -> readerArticles[page].id },
        ) { page ->
            if (readerArticles.isEmpty()) return@HorizontalPager
            val articleItem = readerArticles[page].withArticleFlags(articleStates[readerArticles[page].id])
            val article = selectedDetails[articleItem.id]?.withArticleFlags(articleStates[articleItem.id])
            val nextArticle = readerArticles.getOrNull(page + 1)
            if (article != null) {
                val isCurrentPage by remember(pagerState, page) {
                    computedStateOf { page == pagerState.currentPage }
                }
                val allowRenderer by remember(pagerState, page) {
                    computedStateOf {
                        val currentPage = pagerState.currentPage
                        page == currentPage ||
                            (retainAdjacentRenderers && abs(page - currentPage) == 1)
                    }
                }
                ArticleDetailView(
                    observeOfflineText = observeOfflineText,
                    article = article,
                    nextArticle = nextArticle,
                    onOpenNextArticle = if (nextArticle != null) {
                        {
                            val target = page + 1
                            if (target < readerArticles.size) {
                                pagerScope.launch { pagerState.animateScrollToPage(target) }
                            }
                        }
                    } else null,
                    loadError = loadError.takeIf { article.id == selectedArticle.id },
                    onRetry = { onArticleSelected(article.id) },
                    isActive = foreground && isCurrentPage,
                    isOnline = isOnline,
                    allowRenderer = allowRenderer,
                    onOpenOriginal = { onOpenOriginal(article) },
                    onDisplayed = { onArticleDisplayed(article.id) },
                    onCompleted = { onArticleCompleted(article.id) },
                    onBodyReady = { onArticleBodyReady(article.id) },
                    preferHtml = preferHtml,
                    onPreferHtmlChanged = onPreferHtmlChanged,
                    appearance = appearance,
                )
            } else {
                // articleItem already has read state applied from the queue
                ArticlePlaceholderView(article = articleItem)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArticleDetailView(
    article: ArticleDetail,
    isActive: Boolean,
    isOnline: Boolean = true,
    allowRenderer: Boolean = true,
    onOpenOriginal: () -> Unit,
    nextArticle: ArticleListItem? = null,
    onOpenNextArticle: (() -> Unit)? = null,
    onDisplayed: () -> Unit = {},
    onCompleted: () -> Unit = {},
    onBodyReady: () -> Unit = {},
    preferHtml: Boolean,
    onPreferHtmlChanged: (Boolean) -> Unit,
    appearance: ReaderAppearance,
    observeOfflineText: (String) -> Flow<Boolean>,
    loadError: String? = null,
    onRetry: () -> Unit = {},
) {
    // Detail refreshes/enrichment can arrive out of order. Keep the rendered
    // snapshot monotonic so a late partial response cannot remove paragraphs,
    // reload the WebView, or make already-visible media disappear.
    var retainedContent by remember(article.id) { mutableStateOf(article.readerContent()) }
    LaunchedEffect(article.contentVersion, article.contentHtml, article.contentText, article.media) {
        retainedContent = retainedContent.mergeNonRegressive(article)
    }
    val richHtml = retainedContent.html?.takeIf { preferHtml && allowRenderer }
    val bodyKind = when {
        richHtml != null -> ReaderBodyKind.Rich
        loadError != null -> ReaderBodyKind.Error
        // When offline, show any retained plain text instead of waiting on
        // enrichment that cannot run without connectivity.
        !isOnline && !retainedContent.text.isNullOrBlank() -> ReaderBodyKind.Text
        // Pager prefetch can compose a page outside the retained WebView window.
        // Keep that rich page lightweight instead of laying out its entire text
        // fallback during the current swipe. Its renderer is enabled before entry.
        preferHtml && (retainedContent.html != null || article.isRichContentPending()) -> ReaderBodyKind.PendingRich
        else -> ReaderBodyKind.Text
    }
    val scrollPosition = rememberSaveable(article.id, saver = ReaderScrollPosition.Saver) {
        ReaderScrollPosition()
    }
    val scrollState = scrollPosition.scrollState
    DisposableEffect(scrollPosition, bodyKind) {
        // Disposal runs before the replacement body is measured. Capture the
        // outgoing offset while it still belongs to the full article layout.
        onDispose { scrollPosition.retainForBodyReplacement() }
    }
    LaunchedEffect(scrollPosition) {
        scrollState.interactionSource.interactions.collect { interaction ->
            if (interaction is DragInteraction.Start) scrollPosition.onUserScroll()
        }
    }
    // Renderer retention can change while Text remains laid out. Only an
    // actual body replacement invalidates its readiness and reading position.
    var bodyPrepared by remember(article.id, bodyKind) { mutableStateOf(false) }
    var placedBody by remember(article.id, bodyKind) { mutableIntStateOf(0) }
    val bodyLaidOut = placedBody > 0
    val placedGeneration = placedBody
    LaunchedEffect(placedGeneration, scrollPosition) {
        if (placedGeneration > 0) {
            scrollPosition.restoreAfterBodyLayout()
            onBodyReady()
        }
    }
    var fullscreenMedia by remember { mutableStateOf<ReaderFullscreenMedia?>(null) }
    var zoomedImageUrl by remember(article.id) { mutableStateOf<String?>(null) }
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)
    val readingMinutes = remember(article.id, retainedContent.html, retainedContent.text) {
        estimateReadingMinutes(retainedContent.html, retainedContent.text)
    }

    LaunchedEffect(article.id, isActive) {
        if (isActive) onDisplayed()
    }

    LaunchedEffect(article.id, isActive, scrollState, bodyLaidOut) {
        if (!isActive || !bodyLaidOut) return@LaunchedEffect
        delay(5_000)
        snapshotFlow {
            if (scrollState.maxValue <= 0) 1f
            else scrollState.value.toFloat() / scrollState.maxValue.toFloat()
        }.first { it >= 0.9f }
        onCompleted()
    }

    val backgroundColor = MaterialTheme.colorScheme.background
    val textColor = MaterialTheme.colorScheme.onSurface
    val surfaceColor = MaterialTheme.colorScheme.surfaceVariant
    val mutedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
    val textScale = androidx.compose.ui.platform.LocalDensity.current.fontScale

    val progressAccent = MaterialTheme.colorScheme.primary
    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Surface(shape = RoundedCornerShape(999.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                    Text(
                        text = article.feedTitle,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                val publishedLabel = article.publishedAt?.let(::formatPublishedAt)
                val readingTimeLabel = readingMinutes?.let {
                    stringResource(R.string.reader_reading_time_minutes, it)
                }
                val metaLine = listOfNotNull(publishedLabel, readingTimeLabel).joinToString(" · ")
                if (metaLine.isNotEmpty()) {
                    Text(
                        text = metaLine,
                        modifier = Modifier.padding(start = 12.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

        val titleModifier = if (article.canonicalUrl.isNullOrBlank()) {
            Modifier
        } else {
            Modifier.clickable(
                role = Role.Button,
                onClickLabel = stringResource(R.string.reader_open_original),
                onClick = onOpenOriginal,
            )
        }
        Text(
            text = article.title,
            modifier = titleModifier,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )

        article.author?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        OfflineTextStatus(article.id, observeOfflineText)

        if (retainedContent.html != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = preferHtml,
                    onClick = { onPreferHtmlChanged(true) },
                    label = { Text(stringResource(R.string.reader_rich_mode)) },
                )
                FilterChip(
                    selected = !preferHtml,
                    onClick = { onPreferHtmlChanged(false) },
                    label = { Text(stringResource(R.string.reader_text_mode)) },
                )
            }
        }

        Box(modifier = Modifier.fillMaxWidth().onGloballyPositioned {
            // Preparation/Chromium callbacks do not prove the scroll container
            // has remeasured. Release restoration only after the body is placed.
            if (bodyPrepared && placedBody == 0) placedBody = 1
        }) {
            if (richHtml != null) {
                ReaderHtmlContent(
                    documentId = article.id,
                    html = richHtml,
                    backgroundColor = backgroundColor,
                    textColor = textColor,
                    surfaceColor = surfaceColor,
                    mutedTextColor = mutedTextColor,
                    linkColor = linkColor,
                    appearance = appearance,
                    textScale = textScale,
                    documentBaseUrl = documentBaseUrl,
                    isActive = isActive,
                    onFullscreen = { fullscreenMedia = it },
                    onImageTap = { zoomedImageUrl = it },
                    onReady = {
                        // The first body must replace the skeleton before
                        // restoring. Later documents keep that placed body.
                        if (placedBody > 0) placedBody++ else bodyPrepared = true
                    },
                    onRendererFailure = {
                        scrollPosition.retainForBodyReplacement()
                        bodyPrepared = false
                        placedBody = 0
                    },
                )
                // Cover the renderer until its first measured frame is ready.
                // Stacking the placeholder above it moved the body upward when
                // loading finished, including while an article was mid-swipe.
                if (!bodyPrepared) {
                    Box(Modifier.matchParentSize().background(backgroundColor))
                    ArticleHtmlSkeleton()
                }
            } else if (bodyKind == ReaderBodyKind.Error) {
                Column {
                    Text(loadError.orEmpty(), modifier = Modifier.testTag("reader-load-error"))
                    TextButton(onClick = onRetry) { Text(stringResource(R.string.action_retry_loading)) }
                }
            } else if (bodyKind == ReaderBodyKind.PendingRich) {
                // Keep Rich selected while the next article's detail request
                // completes. Showing the text snapshot here made navigation
                // look like an unwanted mode switch before HTML arrived.
                ArticleHtmlSkeleton(modifier = Modifier.testTag("reader-rich-loading"))
            } else {
                // Text mode is deliberately article-only. It uses the HTML
                // only to retain headings, paragraphs, and lists; embedded
                // images and video are removed before the text is rendered.
                ReaderTextContent(
                    documentId = article.id,
                    html = retainedContent.html,
                    text = retainedContent.text,
                    fallback = article.excerpt,
                    appearance = appearance,
                    documentBaseUrl = documentBaseUrl,
                    onReady = { bodyPrepared = true; placedBody++ },
                )
            }
        }

            if (isActive && nextArticle != null && onOpenNextArticle != null) {
                val nextLabel = stringResource(R.string.reader_next_article)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    HorizontalDivider(
                        thickness = 0.5.dp,
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(role = Role.Button, onClick = onOpenNextArticle)
                            .clearAndSetSemantics {
                                contentDescription = nextLabel
                                role = Role.Button
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = nextLabel,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                text = nextArticle.title,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }

        // Draw-phase reading progress hairline: updates on scroll without recomposing the pane.
        Canvas(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .height(2.dp),
        ) {
            val maxScroll = scrollState.maxValue
            if (maxScroll <= 0) return@Canvas
            val fraction = (scrollState.value.toFloat() / maxScroll.toFloat()).coerceIn(0f, 1f)
            if (fraction <= 0f) return@Canvas
            val width = size.width * fraction
            drawRect(
                color = progressAccent,
                topLeft = Offset(
                    if (layoutDirection == LayoutDirection.Ltr) 0f else size.width - width,
                    0f,
                ),
                size = Size(width, size.height),
            )
        }
    }

    zoomedImageUrl?.let { imageUrl ->
        ZoomableImageOverlay(
            imageUrl = imageUrl,
            offlineMediaCache = LocalOfflineMediaCache.current,
            onDismiss = { zoomedImageUrl = null },
        )
    }

    FullscreenMediaHost(
        media = fullscreenMedia,
        onDismiss = { media ->
            media.close()
            if (fullscreenMedia === media) fullscreenMedia = null
        },
    )
}

private enum class ReaderBodyKind { Rich, PendingRich, Text, Error }

private fun ArticleDetail.isRichContentPending(): Boolean =
    contentHtml.isNullOrBlank() &&
        (fetchedAt == null || contentStatus == "enrichment_pending")

private fun List<ArticleListItem>.withSelectedArticle(selectedArticle: ArticleDetail): List<ArticleListItem> {
    if (isEmpty() || any { it.id == selectedArticle.id }) return this
    return listOf(selectedArticle.toArticleListItem()) + this
}

@Composable
private fun ArticlePlaceholderView(article: ArticleListItem) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .testTag("reader-loading-${article.id}")
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = stringResource(R.string.reader_loading_article, article.title),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * Static placeholder for the article body. Renders
 * a stack of rounded grey blocks sized to look like paragraphs so the
 * reader pane doesn't show a blank gap while the WebView is loading
 * the full HTML. Height and visual-state callbacks signal when the
 * rich document can replace it (see [ReaderHtmlContent]).
 */
@Composable
private fun ArticleHtmlSkeleton(modifier: Modifier = Modifier) {
    val placeholder = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
    Column(
        modifier = Modifier
            .then(modifier)
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Variable-width bars mimic real prose so the layout doesn't
        // jump when the WebView swaps in.
        val widths = listOf(0.95f, 0.88f, 0.92f, 0.7f, 0.85f, 0.6f, 0.9f, 0.75f)
        widths.forEach { fraction ->
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(14.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(placeholder),
            )
        }
    }
}

@Composable
internal fun ReaderHtmlContent(
    documentId: String,
    html: String,
    backgroundColor: Color,
    textColor: Color,
    surfaceColor: Color,
    mutedTextColor: Color,
    linkColor: Color,
    appearance: ReaderAppearance = ReaderAppearance(),
    textScale: Float = 1f,
    documentBaseUrl: String,
    isActive: Boolean = true,
    fixedHeightDp: Int? = null,
    onFullscreen: (ReaderFullscreenMedia?) -> Unit = { it?.close() },
    onImageTap: (String) -> Unit = {},
    onReady: () -> Unit = {},
    onRendererFailure: () -> Unit = {},
    preparer: ReaderContentPreparer = LocalReaderContentPreparer.current,
) {
    var webViewHeightDp by remember(documentId) { mutableIntStateOf(600) }

    val input = remember(html, backgroundColor, textColor, surfaceColor, mutedTextColor, linkColor, appearance, textScale, documentBaseUrl) {
        ReaderHtmlInput(
            html, readerHtmlColors(backgroundColor, textColor, surfaceColor, mutedTextColor, linkColor),
            appearance, textScale, documentBaseUrl, backgroundColor.toArgb(),
        )
    }
    val prepared by key(documentId) {
        produceState<PreparedReaderHtml?>(null, input, preparer) {
            value = preparer.html(input)
        }
    }

    var view by remember { mutableStateOf<ReaderWebView?>(null) }
    var failures by remember(html, documentBaseUrl) { mutableIntStateOf(0) }
    val ready by rememberUpdatedState(onReady)
    val fullscreen by rememberUpdatedState(onFullscreen)
    val imageTap by rememberUpdatedState(onImageTap)
    val failed by rememberUpdatedState(onRendererFailure)
    ReaderViewLifecycle(view, isActive)
    // One automatic replacement tolerates a renderer killed under pressure.
    // A second failure keeps the retained text instead of a crash/recreate loop.
    if (failures > 1) {
        ReaderTextContent(
            documentId = documentId,
            html = html,
            text = null,
            fallback = null,
            appearance = appearance,
            documentBaseUrl = documentBaseUrl,
            preparer = preparer,
            onReady = { ready() },
        )
        return
    }
    val offlineMediaCache = LocalOfflineMediaCache.current
    val customTabsPrewarmer = LocalCustomTabsPrewarmer.current
    val document = prepared ?: return
    key(documentId, failures) {
        var hasMeasuredHeight by remember(document) { mutableStateOf(false) }
        var visualReady by remember(document) { mutableStateOf(false) }
        LaunchedEffect(document) {
            snapshotFlow { hasMeasuredHeight && visualReady }.first { it }
            ready()
        }
        AndroidView(
            modifier = Modifier.fillMaxWidth().height((fixedHeightDp ?: webViewHeightDp).dp),
            factory = { context ->
                ReaderWebView(context, offlineMediaCache, customTabsPrewarmer).also {
                    // Chromium can submit its initial surface before Compose places
                    // this body. The loading placeholder owns that interval.
                    it.alpha = 0f
                    view = it
                }
            },
            update = { renderer ->
                if (visualReady && hasMeasuredHeight) renderer.alpha = 1f
                // Enrichment can replace remembered document state without
                // replacing this view. Every callback must target that state.
                renderer.onHeight = { height ->
                    webViewHeightDp = height
                    hasMeasuredHeight = true
                }
                renderer.onReady = { visualReady = true }
                renderer.onFullscreen = { fullscreen(it) }
                renderer.onImageTap = { imageTap(it) }
                renderer.onRendererGone = {
                    view = null
                    failures += 1
                    failed()
                }
                renderer.loadDocument(document.input.baseUrl, document.document, document.input.backgroundColor)
            },
            onRelease = { renderer ->
                renderer.releaseReaderResources()
                if (view === renderer) view = null
            },
        )
    }
}

@Composable
private fun FullscreenMediaHost(
    media: ReaderFullscreenMedia?,
    onDismiss: (ReaderFullscreenMedia) -> Unit,
) {
    if (media == null) return

    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }

    DisposableEffect(media, activity) {
        val previousOrientation = activity?.requestedOrientation
        val window = activity?.window
        val insetsController = window?.let { WindowCompat.getInsetsController(it, it.decorView) }
        val previousBarsBehavior = insetsController?.systemBarsBehavior

        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
        insetsController?.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController?.hide(WindowInsetsCompat.Type.systemBars())

        onDispose {
            runCatching { media.close() }
            previousOrientation?.let { activity.requestedOrientation = it }
            previousBarsBehavior?.let { insetsController.systemBarsBehavior = it }
            insetsController?.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    Dialog(
        onDismissRequest = { onDismiss(media) },
        properties = DialogProperties(
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = {
                    media.view.detachFromParent()
                    media.view
                },
            )
        }
    }
}

/**
 * Fullscreen pinch-to-zoom image viewer for tapped article images.
 * Loads directly from [OfflineMediaCache] when cached on disk so diagrams and
 * figures stay zoomable offline.
 */
@Composable
private fun ZoomableImageOverlay(
    imageUrl: String,
    offlineMediaCache: OfflineMediaCache?,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var scale by remember(imageUrl) { mutableFloatStateOf(1f) }
    var offset by remember(imageUrl) { mutableStateOf(Offset.Zero) }
    val resolvedData by produceState<Any?>(null, imageUrl, offlineMediaCache) {
        value = withContext(Dispatchers.IO) {
            offlineMediaCache?.cachedFile(imageUrl) ?: imageUrl
        }
    }
    val imageModel = remember(context, resolvedData) {
        resolvedData?.let { data ->
            ImageRequest.Builder(context)
                .data(data)
                .build()
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            decorFitsSystemWindows = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(imageUrl) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        val nextScale = (scale * zoom).coerceIn(1f, 5f)
                        scale = nextScale
                        offset = if (nextScale <= 1.01f) {
                            Offset.Zero
                        } else {
                            val maxX = (size.width * (nextScale - 1f)) / 2f
                            val maxY = (size.height * (nextScale - 1f)) / 2f
                            Offset(
                                x = (offset.x + pan.x).coerceIn(-maxX, maxX),
                                y = (offset.y + pan.y).coerceIn(-maxY, maxY),
                            )
                        }
                    }
                }
                .pointerInput(imageUrl) {
                    detectTapGestures(
                        onTap = {
                            if (scale <= 1.01f) onDismiss()
                        },
                        onDoubleTap = {
                            if (scale > 1.2f) {
                                scale = 1f
                                offset = Offset.Zero
                            } else {
                                scale = 2.5f
                                offset = Offset.Zero
                            }
                        },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            if (imageModel != null) {
                AsyncImage(
                    model = imageModel,
                    contentDescription = stringResource(R.string.reader_image_preview_cd),
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offset.x
                            translationY = offset.y
                        },
                )
            }
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(16.dp)
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.65f)),
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = stringResource(R.string.reader_image_close_cd),
                    tint = Color.White,
                )
            }
        }
    }
}

/** Estimates reading time in whole minutes at 220 words per minute. */
internal fun estimateReadingMinutes(html: String?, text: String?): Int? {
    val source = text?.takeIf(String::isNotBlank)
        ?: html?.takeIf(String::isNotBlank)?.replace(READING_TIME_HTML_TAG_REGEX, " ")
        ?: return null
    val words = READING_TIME_WORD_REGEX.findAll(source).count()
    if (words < MIN_WORDS_FOR_READING_TIME) return null
    return ((words + WORDS_PER_MINUTE - 1) / WORDS_PER_MINUTE).coerceAtLeast(1)
}

private const val TRIM_MEMORY_PRESSURE_FLOOR = 10 // ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW
private const val WORDS_PER_MINUTE = 220
private const val MIN_WORDS_FOR_READING_TIME = 40
private val READING_TIME_HTML_TAG_REGEX = Regex("<[^>]+>")
private val READING_TIME_WORD_REGEX = Regex("[\\p{L}\\p{N}]+")

private fun View.detachFromParent() {
    (parent as? ViewGroup)?.removeView(this)
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
