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
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import coil3.compose.AsyncImage
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.utils.canPreviewMedia
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
) {
    val selectedArticleIndex = remember(articles, selectedArticle.id) {
        articles.indexOfFirst { it.id == selectedArticle.id }
    }

    BackHandler(onBack = onBackToList)

    // When the selected read article is filtered out of the unread queue,
    // keep rendering it directly instead of letting the pager snap to the
    // first remaining row and replace the user's reading context.
    if (articles.isEmpty() || selectedArticleIndex == -1) {
        ArticleDetailView(
            article = selectedArticle,
            onOpenOriginal = { onOpenOriginal(selectedArticle) },
        )
        return
    }

    val pagerState = rememberPagerState(initialPage = selectedArticleIndex) {
        articles.size
    }

    LaunchedEffect(selectedArticle.id) {
        val targetPage = articles.indexOfFirst { it.id == selectedArticle.id }
        if (targetPage != -1 && targetPage != pagerState.currentPage) {
            pagerState.scrollToPage(targetPage)
        }
    }

    LaunchedEffect(pagerState.currentPage, articles) {
        // Guard against the article list shrinking while the user is mid-swipe
        // (e.g. SSE event marks-read + hideRead removes the current article
        // from the list). Without this bounds check the previous code threw
        // IndexOutOfBoundsException on the next frame.
        if (articles.isEmpty()) return@LaunchedEffect
        val page = pagerState.currentPage.coerceIn(0, articles.lastIndex)
        val articleId = articles[page].id
        if (articleId != selectedArticle.id) {
            onArticleSelected(articleId)
        }
    }

    HorizontalPager(
        state = pagerState,
        modifier = Modifier.fillMaxSize(),
        beyondViewportPageCount = 1,
    ) { page ->
        if (articles.isEmpty()) return@HorizontalPager
        val articleItem = articles[page]
        if (articleItem.id == selectedArticle.id) {
            ArticleDetailView(
                article = selectedArticle,
                onOpenOriginal = { onOpenOriginal(selectedArticle) },
            )
        } else {
            ArticlePlaceholderView(article = articleItem)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArticleDetailView(
    article: ArticleDetail,
    onOpenOriginal: () -> Unit,
) {
    val context = LocalContext.current
    var showHtml by rememberSaveable(article.id) { mutableStateOf(article.contentHtml != null) }
    val scrollState = rememberSaveable(article.id, saver = ScrollState.Saver) {
        ScrollState(initial = 0)
    }
    var fullscreenMedia by remember { mutableStateOf<FullscreenMediaView?>(null) }
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)

    val backgroundColor = MaterialTheme.colorScheme.background
    val textColor = MaterialTheme.colorScheme.onSurface
    val surfaceColor = MaterialTheme.colorScheme.surfaceVariant
    val mutedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
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

        Text(
            text = article.title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = if (!article.canonicalUrl.isNullOrBlank()) {
                Modifier.clickable { onOpenOriginal() }
            } else {
                Modifier
            }
        )

        article.author?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if ((article.contentHtml != null) && (article.contentText != null)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = showHtml, onClick = { showHtml = true }, label = { Text("Rich") })
                FilterChip(selected = !showHtml, onClick = { showHtml = false }, label = { Text("Text") })
            }
        }

        Column(modifier = Modifier.fillMaxWidth()) {
            if (showHtml && !article.contentHtml.isNullOrBlank()) {
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
                    html = article.contentHtml,
                    backgroundColor = backgroundColor,
                    textColor = textColor,
                    surfaceColor = surfaceColor,
                    mutedTextColor = mutedTextColor,
                    linkColor = linkColor,
                    documentBaseUrl = documentBaseUrl,
                    onShowFullscreenMedia = showFullscreenMedia,
                    onHideFullscreenMedia = hideFullscreenMedia,
                    onReady = { htmlReady = true },
                )
            } else {
                Text(
                    text = article.contentText ?: article.excerpt ?: "No content",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                if (article.media.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(24.dp))
                    Text("Media", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.height(12.dp))
                    article.media.take(24).forEach { media ->
                        if (media.type == "image") {
                            AsyncImage(
                                model = media.url,
                                contentDescription = null,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 8.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable { openExternalUrl(context, media.url) },
                                contentScale = ContentScale.Fit,
                            )
                        } else if (canPreviewMedia(media.provider, media.embedUrl)) {
                            EmbedPlayer(
                                embedUrl = media.embedUrl!!,
                                backgroundColor = backgroundColor,
                                documentBaseUrl = documentBaseUrl,
                                onShowFullscreenMedia = showFullscreenMedia,
                                onHideFullscreenMedia = hideFullscreenMedia,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 8.dp)
                                    .clip(RoundedCornerShape(16.dp))
                            )
                        } else {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                val label = when {
                                    media.provider.isNotBlank() && media.provider != "unknown" -> media.provider
                                    media.type == "embed" -> "Embedded Content"
                                    media.type == "video" -> "Video"
                                    else -> "Media Link"
                                }
                                androidx.compose.material3.TextButton(onClick = { openExternalUrl(context, media.url) }) {
                                    Text(label)
                                }
                            }
                        }
                    }
                }
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

@Composable
private fun EmbedPlayer(
    embedUrl: String,
    backgroundColor: Color,
    documentBaseUrl: String,
    onShowFullscreenMedia: (View, WebChromeClient.CustomViewCallback?) -> Unit,
    onHideFullscreenMedia: (View?) -> Unit,
    modifier: Modifier = Modifier
) {
    var heightDp by remember(embedUrl) { mutableIntStateOf(300) }
    var loadEmbed by rememberSaveable(embedUrl) { mutableStateOf(false) }
    val hexBackground = String.format("#%06X", 0xFFFFFF and backgroundColor.toArgb())
    val youtubeShellHtml = remember(embedUrl, hexBackground) {
        if (isYouTubeEmbedUrl(embedUrl)) {
            youtubeEmbedHtml(embedUrl = embedUrl, background = hexBackground)
        } else {
            null
        }
    }

    if (!loadEmbed) {
        DeferredEmbedPlaceholder(
            modifier = modifier,
            onLoad = { loadEmbed = true },
        )
        return
    }

    AndroidView(
        modifier = modifier.height(heightDp.dp),
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = true
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.mediaPlaybackRequiresUserGesture = false
                setBackgroundColor(backgroundColor.toArgb())
                webChromeClient = readerWebChromeClient(
                    onShowFullscreenMedia = onShowFullscreenMedia,
                    onHideFullscreenMedia = onHideFullscreenMedia,
                )

                addJavascriptInterface(object {
                    @android.webkit.JavascriptInterface
                    fun updateHeight(h: Float) {
                        post {
                            val newHeightDp = h.toInt()
                            if (newHeightDp > 0 && newHeightDp != heightDp) {
                                heightDp = newHeightDp
                            }
                        }
                    }
                }, "Android")

                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, url: String?) {
                        evaluateJavascript(
                            """
                                (function() {
                                    var lastHeight = 0;
                                    function sendHeight() {
                                        var h = document.body.scrollHeight || document.documentElement.scrollHeight;
                                        if (h > 0 && h !== lastHeight) {
                                            lastHeight = h;
                                            window.Android.updateHeight(h);
                                        }
                                    }
                                    new ResizeObserver(sendHeight).observe(document.body);
                                    var fallbackChecks = 0;
                                    var fallbackTimer = setInterval(function() {
                                        fallbackChecks += 1;
                                        sendHeight();
                                        if (fallbackChecks >= 10) clearInterval(fallbackTimer);
                                    }, 250);
                                    sendHeight();
                                })();
                            """.trimIndent()
                        ) { }
                    }
                }
            }
        },
        update = { webView ->
            val contentKey = "$documentBaseUrl\n${youtubeShellHtml ?: embedUrl}"
            if (webView.tag != contentKey) {
                webView.tag = contentKey
                if (youtubeShellHtml != null) {
                    webView.loadDataWithBaseURL(
                        documentBaseUrl,
                        youtubeShellHtml,
                        "text/html",
                        "utf-8",
                        documentBaseUrl,
                    )
                } else {
                    webView.loadUrl(embedUrl)
                }
            }
        },
        onRelease = { webView ->
            webView.releaseReaderResources()
        },
    )
}

@Composable
private fun DeferredEmbedPlaceholder(
    modifier: Modifier,
    onLoad: () -> Unit,
) {
    Surface(
        modifier = modifier.height(220.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
    ) {
        Box(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            OutlinedButton(onClick = onLoad) {
                Text("Load media")
            }
        }
    }
}

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
private fun ArticleHtmlSkeleton() {
    val placeholder = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
    Column(
        modifier = Modifier
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

private fun isYouTubeEmbedUrl(url: String): Boolean {
    val host = runCatching { java.net.URI(url).host?.lowercase() }.getOrNull() ?: return false
    return host == "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host == "youtube-nocookie.com" ||
        host.endsWith(".youtube-nocookie.com")
}

private fun youtubeEmbedHtml(embedUrl: String, background: String): String {
    val safeEmbedUrl = htmlAttribute(embedUrl)
    return """
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
            <style>
                html, body {
                    background: $background;
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                }
                #embed-container {
                    aspect-ratio: 16 / 9;
                    background: $background;
                    width: 100%;
                }
                iframe {
                    border: 0;
                    display: block;
                    height: 100%;
                    width: 100%;
                }
            </style>
        </head>
        <body>
            <div id="embed-container">
                <iframe
                    src="$safeEmbedUrl"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
                    allowfullscreen
                    referrerpolicy="strict-origin-when-cross-origin"></iframe>
            </div>
            <script>
                function postHeight() {
                    const container = document.getElementById('embed-container');
                    if (container) {
                        window.Android.updateHeight(Math.ceil(container.getBoundingClientRect().height));
                    }
                }
                window.addEventListener('load', postHeight);
                window.addEventListener('resize', postHeight);
                new ResizeObserver(postHeight).observe(document.getElementById('embed-container'));
                postHeight();
            </script>
        </body>
        </html>
    """.trimIndent()
}

private fun htmlAttribute(value: String): String =
    value
        .replace("&", "&amp;")
        .replace("\"", "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
