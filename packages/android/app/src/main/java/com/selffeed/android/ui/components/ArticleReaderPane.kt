package com.selffeed.android.ui.components

import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
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

    // Sync external selection to pager (e.g. if list changes or initial load)
    LaunchedEffect(selectedArticle.id) {
        val targetPage = articles.indexOfFirst { it.id == selectedArticle.id }
        if (targetPage != -1 && targetPage != pagerState.currentPage) {
            pagerState.scrollToPage(targetPage)
        }
    }

    // Sync pager to external selection (when swiping)
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
    var previewEmbedUrl by rememberSaveable(article.id) { mutableStateOf<String?>(null) }

    val backgroundColor = MaterialTheme.colorScheme.background
    val textColor = MaterialTheme.colorScheme.onSurface

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
                    textColor = textColor
                )
            } else {
                Text(
                    text = article.contentText ?: article.excerpt ?: "No content",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            if (article.media.isNotEmpty()) {
                Spacer(modifier = Modifier.height(24.dp))
                Text("Media", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(12.dp))
                article.media.take(8).forEach { media ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        androidx.compose.material3.TextButton(onClick = { openExternalUrl(context, media.url) }) {
                            Text(media.provider.ifBlank { media.url })
                        }
                        if (canPreviewMedia(media.provider, media.embedUrl)) {
                            androidx.compose.material3.TextButton(onClick = { previewEmbedUrl = media.embedUrl }) {
                                Text("Preview")
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }

    previewEmbedUrl?.let { embedUrl ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { previewEmbedUrl = null },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = { previewEmbedUrl = null }) { Text("Close") }
            },
            title = { Text("Embedded Media") },
            text = {
                AndroidView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp),
                    factory = { factoryContext ->
                        WebView(factoryContext).apply {
                            settings.javaScriptEnabled = true
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            settings.domStorageEnabled = true
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            settings.safeBrowsingEnabled = true
                            settings.mediaPlaybackRequiresUserGesture = true
                            setBackgroundColor(Color.Transparent.hashCode())
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                    val url = request?.url?.toString()
                                    return if (isTrustedEmbedUrl(url)) false else {
                                        openExternalUrl(factoryContext, url)
                                        true
                                    }
                                }
                            }
                        }
                    },
                    update = { webView ->
                        if (isTrustedEmbedUrl(embedUrl)) webView.loadUrl(embedUrl)
                    },
                )
            },
        )
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
    textColor: Color
) {
    val hexBackground = String.format("#%06X", 0xFFFFFF and backgroundColor.toArgb())
    val hexText = String.format("#%06X", 0xFFFFFF and textColor.toArgb())

    val processedHtml = """
        <html>
        <head>
            <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
            <style>
                body { background: $hexBackground; color: $hexText; margin: 0; padding: 0; }
                a { color: #9BB0FF; }
                img, video, iframe { max-width: 100%; height: auto; border-radius: 16px; }
            </style>
        </head>
        <body>$html</body>
        </html>
    """.trimIndent()

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .height(520.dp),
        factory = { factoryContext ->
            WebView(factoryContext).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = false
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.safeBrowsingEnabled = true
                settings.loadsImagesAutomatically = true
                settings.builtInZoomControls = false
                setBackgroundColor(backgroundColor.toArgb())
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        openExternalUrl(factoryContext, request?.url?.toString())
                        return true
                    }
                }
            }
        },
        update = { webView ->
            webView.loadDataWithBaseURL(null, processedHtml, "text/html", "utf-8", null)
        },
    )
}
