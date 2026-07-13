@file:SuppressLint("SetJavaScriptEnabled")
package com.selffeed.android.ui.components

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.ReaderAppearance
import com.selffeed.android.ui.utils.formatPublishedAt
import com.selffeed.android.ui.utils.isTrustedEmbedUrl

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleReaderPane(
    articles: List<ArticleListItem>,
    selectedArticle: ArticleDetail,
    onOpenOriginal: (ArticleDetail) -> Unit,
    onBackToList: () -> Unit,
    onArticleSelected: (String) -> Unit,
    onArticleDisplayed: (String) -> Unit = {},
    appearance: ReaderAppearance = ReaderAppearance(),
    preferHtml: Boolean = selectedArticle.contentHtml?.isNotBlank() == true,
    onPreferHtmlChanged: (Boolean) -> Unit = {},
) {
    val readerArticles = remember(articles, selectedArticle) {
        articles.withSelectedArticle(selectedArticle)
    }
    val selectedArticleIndex = remember(readerArticles, selectedArticle.id) {
        readerArticles.indexOfFirst { it.id == selectedArticle.id }
    }

    BackHandler(onBack = onBackToList)

    if (readerArticles.isEmpty() || selectedArticleIndex == -1) {
        ArticleDetailView(
            article = selectedArticle,
            onOpenOriginal = { onOpenOriginal(selectedArticle) },
            onDisplayed = { onArticleDisplayed(selectedArticle.id) },
            preferHtml = preferHtml,
            onPreferHtmlChanged = onPreferHtmlChanged,
            appearance = appearance,
        )
        return
    }

    val pagerState = rememberPagerState(initialPage = selectedArticleIndex) {
        readerArticles.size
    }

    LaunchedEffect(selectedArticle.id, readerArticles) {
        val targetPage = readerArticles.indexOfFirst { it.id == selectedArticle.id }
        if (targetPage != -1 && targetPage != pagerState.currentPage) {
            pagerState.scrollToPage(targetPage)
        }
    }

    LaunchedEffect(pagerState.currentPage, readerArticles) {
        // Guard against the article list shrinking while the user is mid-swipe
        // (e.g. SSE event marks-read + hideRead removes the current article
        // from the list). Without this bounds check the previous code threw
        // IndexOutOfBoundsException on the next frame.
        if (readerArticles.isEmpty()) return@LaunchedEffect
        val page = pagerState.currentPage.coerceIn(0, readerArticles.lastIndex)
        val articleId = readerArticles[page].id
        if (articleId != selectedArticle.id) {
            onArticleSelected(articleId)
        }
    }

    HorizontalPager(
        state = pagerState,
        modifier = Modifier.fillMaxSize(),
        beyondViewportPageCount = 1,
    ) { page ->
        if (readerArticles.isEmpty()) return@HorizontalPager
        val articleItem = readerArticles[page]
        if (articleItem.id == selectedArticle.id) {
            ArticleDetailView(
                article = selectedArticle,
                onOpenOriginal = { onOpenOriginal(selectedArticle) },
                onDisplayed = { onArticleDisplayed(selectedArticle.id) },
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
    onOpenOriginal: () -> Unit,
    onDisplayed: () -> Unit = {},
    preferHtml: Boolean,
    onPreferHtmlChanged: (Boolean) -> Unit,
    appearance: ReaderAppearance,
) {
    // Detail refreshes/enrichment can arrive out of order. Keep the rendered
    // snapshot monotonic so a late partial response cannot remove paragraphs,
    // reload the WebView, or make already-visible media disappear.
    var retainedContent by remember(article.id) { mutableStateOf(article.readerContent()) }
    LaunchedEffect(article.contentVersion, article.contentHtml, article.contentText, article.media) {
        retainedContent = retainedContent.mergeNonRegressive(article)
    }
    val scrollState = rememberSaveable(article.id, saver = ScrollState.Saver) {
        ScrollState(initial = 0)
    }
    var fullscreenMedia by remember { mutableStateOf<FullscreenMediaView?>(null) }
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)

    LaunchedEffect(article.id) {
        onDisplayed()
    }

    val backgroundColor = MaterialTheme.colorScheme.background
    val textColor = MaterialTheme.colorScheme.onSurface
    val surfaceColor = MaterialTheme.colorScheme.surfaceVariant
    val mutedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
    val textScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
    val showFullscreenMedia: (View, WebChromeClient.CustomViewCallback?) -> Unit = { view, callback ->
        val currentMedia = fullscreenMedia
        if (currentMedia?.view !== view) {
            currentMedia?.callback?.onCustomViewHidden()
            currentMedia?.view?.detachFromParent()
        }
        view.detachFromParent()
        fullscreenMedia = FullscreenMediaView(view = view, callback = callback)
    }
    val hideFullscreenMedia: (View?) -> Unit = { view ->
        val currentMedia = fullscreenMedia
        if (currentMedia != null && (view == null || currentMedia.view === view)) {
            currentMedia.view.detachFromParent()
            fullscreenMedia = null
        }
    }

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
                onClickLabel = "Open original article",
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

        if (retainedContent.html != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = preferHtml,
                    onClick = { onPreferHtmlChanged(true) },
                    label = { Text("Rich") },
                )
                FilterChip(
                    selected = !preferHtml,
                    onClick = { onPreferHtmlChanged(false) },
                    label = { Text("Text") },
                )
            }
        }

        Column(modifier = Modifier.fillMaxWidth()) {
            val html = retainedContent.html
            if (preferHtml && html != null) {
                // Show a skeleton placeholder first so the reader opens
                // instantly. The WebView (which does the HTML load +
                // layout + JS height callback) swaps in once it has a
                // first frame ready. This avoids a blank pane while the
                // article body is rendering.
                var htmlReady by rememberSaveable(article.id) { mutableStateOf(false) }
                if (!htmlReady) {
                    ArticleHtmlSkeleton()
                }
                SecureHtmlContent(
                    html = html,
                    backgroundColor = backgroundColor,
                    textColor = textColor,
                    surfaceColor = surfaceColor,
                    mutedTextColor = mutedTextColor,
                    linkColor = linkColor,
                    appearance = appearance,
                    textScale = textScale,
                    documentBaseUrl = documentBaseUrl,
                    onShowFullscreenMedia = showFullscreenMedia,
                    onHideFullscreenMedia = hideFullscreenMedia,
                    onReady = { htmlReady = true },
                )
            } else if (preferHtml && article.isRichContentPending()) {
                // Keep Rich selected while the next article's detail request
                // completes. Showing the text snapshot here made navigation
                // look like an unwanted mode switch before HTML arrived.
                ArticleHtmlSkeleton(modifier = Modifier.testTag("reader-rich-loading"))
            } else {
                // Text mode is deliberately article-only. It uses the HTML
                // only to retain headings, paragraphs, and lists; embedded
                // images and video are removed before the text is rendered.
                ReaderTextContent(
                    html = retainedContent.html,
                    text = retainedContent.text,
                    fallback = article.excerpt,
                    appearance = appearance,
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }

    FullscreenMediaHost(
        media = fullscreenMedia,
        onDismiss = { media ->
            media.callback?.onCustomViewHidden()
            if (fullscreenMedia == media) {
                media.view.detachFromParent()
                fullscreenMedia = null
            }
        },
    )
}

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
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator()
            Text(
                text = "Loading ${article.title}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * Lightweight shimmer-style placeholder for the article body. Renders
 * a stack of rounded grey blocks sized to look like paragraphs so the
 * reader pane doesn't show a blank gap while the WebView is loading
 * the full HTML. Replaced the moment `onPageFinished` fires on the
 * WebView (see [SecureHtmlContent]'s `onReady` callback).
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
private fun SecureHtmlContent(
    html: String,
    backgroundColor: Color,
    textColor: Color,
    surfaceColor: Color,
    mutedTextColor: Color,
    linkColor: Color,
    appearance: ReaderAppearance,
    textScale: Float,
    documentBaseUrl: String,
    onShowFullscreenMedia: (View, WebChromeClient.CustomViewCallback?) -> Unit,
    onHideFullscreenMedia: (View?) -> Unit,
    onReady: (() -> Unit)? = null,
) {
    var webViewHeightDp by remember(html) { mutableIntStateOf(600) }

    val processedHtml = remember(
        html,
        backgroundColor,
        textColor,
        surfaceColor,
        mutedTextColor,
        linkColor,
        appearance,
        textScale,
    ) {
        buildReaderHtmlDocument(
            html = html,
            colors = readerHtmlColors(
                backgroundColor = backgroundColor,
                textColor = textColor,
                surfaceColor = surfaceColor,
                mutedTextColor = mutedTextColor,
                linkColor = linkColor,
            ),
            appearance = appearance,
            textScale = textScale,
        )
    }

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .height(webViewHeightDp.dp),
        factory = { factoryContext ->
            WebView(factoryContext).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = true
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.mediaPlaybackRequiresUserGesture = false

                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = true
                setBackgroundColor(backgroundColor.toArgb())
                webChromeClient = readerWebChromeClient(
                    onShowFullscreenMedia = onShowFullscreenMedia,
                    onHideFullscreenMedia = onHideFullscreenMedia,
                )

                addJavascriptInterface(object {
                    @android.webkit.JavascriptInterface
                    fun updateHeight(height: Float) {
                        post {
                            val newHeightDp = height.toInt()
                            // Clamp to a sane range: 0 is "not loaded yet" (the
                            // default 600dp is used), and anything beyond
                            // 50_000dp is almost certainly a measurement bug
                            // (e.g. an element with an unbounded height in the
                            // HTML). Without the upper bound, a runaway value
                            // can produce constraints Compose refuses to
                            // satisfy ("Can't represent a width of 0 and
                            // height of N in Constraints").
                            val clampedDp = newHeightDp.coerceIn(0, 50_000)
                            if (clampedDp > 0 && clampedDp != webViewHeightDp) {
                                webViewHeightDp = clampedDp
                            }
                        }
                    }
                }, "Android")

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        val url = request?.url?.toString() ?: return true
                        if (isTrustedEmbedUrl(url)) return false
                        openExternalUrl(factoryContext, url)
                        return true
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        view?.evaluateJavascript("window.postHeight && window.postHeight();") { }
                        onReady?.invoke()
                    }
                }
            }
        },
        update = { webView ->
            val contentKey = "$documentBaseUrl\n$processedHtml"
            if (webView.tag != contentKey) {
                webView.tag = contentKey
                webView.loadDataWithBaseURL(
                    documentBaseUrl,
                    processedHtml,
                    "text/html",
                    "utf-8",
                    documentBaseUrl,
                )
            }
        },
        onRelease = { webView ->
            webView.releaseReaderResources()
        },
    )
}

internal fun WebView.releaseReaderResources() {
    runCatching {
        stopLoading()
        // Call cleanup function to remove event listeners and disconnect observers
        evaluateJavascript("if (window.SelfFeedApp && typeof window.SelfFeedApp.cleanup === 'function') { window.SelfFeedApp.cleanup(); }", null)
        loadUrl("about:blank")
        removeJavascriptInterface("Android")
        webChromeClient = WebChromeClient()
        webViewClient = WebViewClient()
        destroy()
    }
}

private data class FullscreenMediaView(
    val view: View,
    val callback: WebChromeClient.CustomViewCallback?,
)

@Composable
private fun FullscreenMediaHost(
    media: FullscreenMediaView?,
    onDismiss: (FullscreenMediaView) -> Unit,
) {
    if (media == null) return

    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }

    androidx.compose.runtime.DisposableEffect(media, activity) {
        val previousOrientation = activity?.requestedOrientation
        val window = activity?.window
        val insetsController = window?.let { WindowCompat.getInsetsController(it, it.decorView) }
        val previousBarsBehavior = insetsController?.systemBarsBehavior

        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
        insetsController?.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController?.hide(WindowInsetsCompat.Type.systemBars())

        onDispose {
            media.view.detachFromParent()
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

private fun readerWebChromeClient(
    onShowFullscreenMedia: (View, WebChromeClient.CustomViewCallback?) -> Unit,
    onHideFullscreenMedia: (View?) -> Unit,
): WebChromeClient = object : WebChromeClient() {
    private var customView: View? = null

    override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        if (view == null || customView != null) {
            callback?.onCustomViewHidden()
            return
        }

        customView = view
        onShowFullscreenMedia(view, callback)
    }

    override fun onShowCustomView(
        view: View?,
        requestedOrientation: Int,
        callback: CustomViewCallback?,
    ) {
        onShowCustomView(view, callback)
    }

    override fun onHideCustomView() {
        val view = customView
        customView = null
        onHideFullscreenMedia(view)
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
