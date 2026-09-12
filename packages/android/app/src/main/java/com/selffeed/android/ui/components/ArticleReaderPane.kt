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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
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
import com.selffeed.android.ui.ReaderAppearance
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleReaderPane(
    articles: List<ArticleListItem>,
    isVisible: Boolean = true,
    selectedArticle: ArticleDetail,
    prefetchedArticles: Map<String, ArticleDetail> = emptyMap(),
    articleStates: Map<String, ArticleFlags> = emptyMap(),
    onOpenOriginal: (ArticleDetail) -> Unit,
    onBackToList: () -> Unit,
    onArticleSelected: (String) -> Unit,
    onVisibleArticleChanged: (String) -> Unit = {},
    onArticleDisplayed: (String) -> Unit = {},
    onArticleCompleted: (String) -> Unit = {},
    onArticleBodyReady: (String) -> Unit = {},
    appearance: ReaderAppearance = ReaderAppearance(),
    preferHtml: Boolean = true,
    onPreferHtmlChanged: (Boolean) -> Unit = {},
    observeOfflineText: (String) -> Flow<Boolean> = { emptyFlow() },
) {
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val foreground = isVisible && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    var retainAdjacentRenderers by remember { mutableStateOf(true) }
    val appContext = LocalContext.current.applicationContext
    DisposableEffect(appContext) {
        val callbacks = object : ComponentCallbacks2 {
            override fun onConfigurationChanged(config: Configuration) = Unit
            override fun onLowMemory() { retainAdjacentRenderers = false }
            override fun onTrimMemory(level: Int) {
                if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) retainAdjacentRenderers = false
            }
        }
        appContext.registerComponentCallbacks(callbacks)
        onDispose { appContext.unregisterComponentCallbacks(callbacks) }
    }
    val readerArticles = remember(articles, selectedArticle) {
        articles.withSelectedArticle(selectedArticle)
    }
    val selectedArticleIndex = remember(readerArticles, selectedArticle.id) {
        readerArticles.indexOfFirst { it.id == selectedArticle.id }
    }

    BackHandler(onBack = onBackToList)

    if (readerArticles.isEmpty() || selectedArticleIndex == -1) {
        ArticleDetailView(
            observeOfflineText = observeOfflineText,
            article = selectedArticle,
            isActive = foreground,
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
    val latestSelectedArticleId by rememberUpdatedState(selectedArticle.id)
    val latestOnArticleSelected by rememberUpdatedState(onArticleSelected)
    val latestOnVisibleArticleChanged by rememberUpdatedState(onVisibleArticleChanged)

    LaunchedEffect(selectedArticle.id, readerArticles) {
        val targetPage = readerArticles.indexOfFirst { it.id == selectedArticle.id }
        if (targetPage != -1 && targetPage != pagerState.currentPage) {
            pagerState.scrollToPage(targetPage)
        }
    }

    LaunchedEffect(pagerState, readerArticles) {
        // Guard against the article list shrinking while the user is mid-swipe
        // (e.g. SSE event marks-read + hideRead removes the current article
        // from the list). Without this bounds check the previous code threw
        // IndexOutOfBoundsException on the next frame.
        snapshotFlow { pagerState.settledPage }
            .distinctUntilChanged()
            .collect { settledPage ->
                if (readerArticles.isEmpty()) return@collect
                val page = settledPage.coerceIn(0, readerArticles.lastIndex)
                val articleId = readerArticles[page].id
                if (articleId != latestSelectedArticleId) {
                    latestOnArticleSelected(articleId)
                }
            }
    }

    LaunchedEffect(pagerState, readerArticles) {
        snapshotFlow { pagerState.currentPage }
            .distinctUntilChanged()
            .collect { currentPage ->
                if (readerArticles.isEmpty()) return@collect
                val page = currentPage.coerceIn(0, readerArticles.lastIndex)
                latestOnVisibleArticleChanged(readerArticles[page].id)
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

    HorizontalPager(
        state = pagerState,
        modifier = Modifier.fillMaxSize(),
        beyondViewportPageCount = 1,
        key = { page -> readerArticles[page].id },
    ) { page ->
        if (readerArticles.isEmpty()) return@HorizontalPager
        val articleItem = readerArticles[page].withArticleFlags(articleStates[readerArticles[page].id])
        val article = selectedDetails[articleItem.id]?.withArticleFlags(articleStates[articleItem.id])
        if (article != null) {
            ArticleDetailView(
                observeOfflineText = observeOfflineText,
                article = article,
                isActive = foreground && page == pagerState.currentPage,
                allowRenderer = page == pagerState.currentPage ||
                    (retainAdjacentRenderers && abs(page - pagerState.currentPage) <= 1),
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArticleDetailView(
    article: ArticleDetail,
    isActive: Boolean,
    allowRenderer: Boolean = true,
    onOpenOriginal: () -> Unit,
    onDisplayed: () -> Unit = {},
    onCompleted: () -> Unit = {},
    onBodyReady: () -> Unit = {},
    preferHtml: Boolean,
    onPreferHtmlChanged: (Boolean) -> Unit,
    appearance: ReaderAppearance,
    observeOfflineText: (String) -> Flow<Boolean>,
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
        preferHtml && article.isRichContentPending() -> ReaderBodyKind.PendingRich
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
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)

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
            article.publishedAt?.let {
                Text(
                    text = formatPublishedAt(it),
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

        Column(modifier = Modifier.fillMaxWidth().onGloballyPositioned {
            // Preparation/Chromium callbacks do not prove the scroll container
            // has remeasured. Release restoration only after the body is placed.
            if (bodyPrepared && placedBody == 0) placedBody = 1
        }) {
            if (richHtml != null) {
                // Keep the static placeholder until the renderer has a
                // measured first frame. Restoration follows its removal
                // and the placement of the resulting body layout.
                if (!bodyPrepared) {
                    ArticleHtmlSkeleton()
                }
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
                    onReady = { bodyPrepared = true; placedBody++ },
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }

    FullscreenMediaHost(
        media = fullscreenMedia,
        onDismiss = { media ->
            media.close()
            if (fullscreenMedia === media) fullscreenMedia = null
        },
    )
}

private enum class ReaderBodyKind { Rich, PendingRich, Text }

private fun ArticleDetail.isRichContentPending(): Boolean =
    contentHtml.isNullOrBlank() &&
        (fetchedAt == null || contentStatus == "enrichment_pending")

private fun List<ArticleListItem>.withSelectedArticle(selectedArticle: ArticleDetail): List<ArticleListItem> {
    if (isEmpty() || any { it.id == selectedArticle.id }) return this
    return listOf(selectedArticle.toArticleListItem()) + this
}

private fun ArticleDetail.toArticleListItem(): ArticleListItem =
    ArticleListItem(
        id = id,
        feedId = feedId,
        feedTitle = feedTitle,
        feedFaviconUrl = feedFaviconUrl,
        title = title,
        author = author,
        excerpt = excerpt,
        heroImageUrl = heroImageUrl,
        publishedAt = publishedAt,
        isRead = isRead,
        contentStatus = contentStatus,
        contentVersion = contentVersion,
    )

@Composable
private fun ArticlePlaceholderView(article: ArticleListItem) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .testTag("reader-loading-${article.id}")
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator()
            Text(
                text = stringResource(R.string.reader_loading_article, article.title),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
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
    val failed by rememberUpdatedState(onRendererFailure)
    ReaderViewLifecycle(view, isActive)
    // One automatic replacement tolerates a renderer killed under pressure.
    // A second failure keeps the retained text instead of a crash/recreate loop.
    if (failures > 1) {
        ReaderTextContent(documentId = documentId, html = html, text = null, fallback = null, appearance = appearance, preparer = preparer, onReady = { ready() })
        return
    }
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
                ReaderWebView(context).also { view = it }
            },
            update = { renderer ->
                // Enrichment can replace remembered document state without
                // replacing this view. Every callback must target that state.
                renderer.onHeight = { height ->
                    webViewHeightDp = height
                    hasMeasuredHeight = true
                }
                renderer.onReady = { visualReady = true }
                renderer.onFullscreen = { fullscreen(it) }
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
            previousOrientation?.let { activity?.requestedOrientation = it }
            previousBarsBehavior?.let { insetsController?.systemBarsBehavior = it }
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

private fun View.detachFromParent() {
    (parent as? ViewGroup)?.removeView(this)
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
