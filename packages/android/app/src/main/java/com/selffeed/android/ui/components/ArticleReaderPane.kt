package com.selffeed.android.ui.components

import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.rememberScrollState
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
import coil.compose.AsyncImage
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
    val initialPage = remember {
        articles.indexOfFirst { it.id == selectedArticle.id }.coerceAtLeast(0)
    }

    val pagerState = rememberPagerState(initialPage = initialPage) {
        articles.size
    }

    BackHandler(onBack = onBackToList)

    LaunchedEffect(selectedArticle.id) {
        val targetPage = articles.indexOfFirst { it.id == selectedArticle.id }
        if (targetPage != -1 && targetPage != pagerState.currentPage) {
            pagerState.scrollToPage(targetPage)
        }
    }

    LaunchedEffect(pagerState.currentPage) {
        val articleId = articles[pagerState.currentPage].id
        if (articleId != selectedArticle.id) {
            onArticleSelected(articleId)
        }
    }

    HorizontalPager(
        state = pagerState,
        modifier = Modifier.fillMaxSize(),
        beyondViewportPageCount = 1,
    ) { page ->
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
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)

    val backgroundColor = MaterialTheme.colorScheme.background
    val textColor = MaterialTheme.colorScheme.onSurface
    val surfaceColor = MaterialTheme.colorScheme.surfaceVariant
    val mutedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
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
                SecureHtmlContent(
                    html = article.contentHtml,
                    backgroundColor = backgroundColor,
                    textColor = textColor,
                    surfaceColor = surfaceColor,
                    mutedTextColor = mutedTextColor,
                    linkColor = linkColor,
                    documentBaseUrl = documentBaseUrl,
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
}

@Composable
private fun EmbedPlayer(
    embedUrl: String,
    backgroundColor: Color,
    documentBaseUrl: String,
    modifier: Modifier = Modifier
) {
    var heightDp by remember(embedUrl) { mutableStateOf(300) }
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
                            "(function() { " +
                                "var lastHeight = 0; " +
                                "function sendHeight() { " +
                                "  var h = document.body.scrollHeight || document.documentElement.scrollHeight; " +
                                "  if (h > 0 && h !== lastHeight) { lastHeight = h; window.Android.updateHeight(h); } " +
                                "} " +
                                "new ResizeObserver(sendHeight).observe(document.body); " +
                                "setInterval(sendHeight, 1000); " +
                                "sendHeight(); " +
                                "})();"
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

@Composable
private fun SecureHtmlContent(
    html: String,
    backgroundColor: Color,
    textColor: Color,
    surfaceColor: Color,
    mutedTextColor: Color,
    linkColor: Color,
    documentBaseUrl: String,
) {
    var webViewHeightDp by remember(html) { mutableStateOf(600) }

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
                isHorizontalScrollBarEnabled = false
                setBackgroundColor(backgroundColor.toArgb())

                addJavascriptInterface(object {
                    @android.webkit.JavascriptInterface
                    fun updateHeight(height: Float) {
                        post {
                            val newHeightDp = height.toInt()
                            if (newHeightDp > 0 && newHeightDp != webViewHeightDp) {
                                webViewHeightDp = newHeightDp
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

private fun WebView.releaseReaderResources() {
    runCatching {
        stopLoading()
        loadUrl("about:blank")
        removeJavascriptInterface("Android")
        webViewClient = WebViewClient()
        destroy()
    }
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
