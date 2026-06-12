@file:SuppressLint("SetJavaScriptEnabled")
package com.selffeed.android.ui.components

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.ui.utils.canPreviewMedia
import com.selffeed.android.ui.utils.formatPublishedAt
import com.selffeed.android.ui.utils.isTrustedEmbedUrl

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleReaderDialog(
    article: ArticleDetail,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    var showHtml by rememberSaveable(article.id) { mutableStateOf(article.contentHtml != null) }
    var previewEmbedUrl by rememberSaveable(article.id) { mutableStateOf<String?>(null) }
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)
    val readerBackgroundColor = MaterialTheme.colorScheme.surface
    val readerTextColor = MaterialTheme.colorScheme.onSurface
    val readerSurfaceColor = MaterialTheme.colorScheme.surfaceVariant
    val readerMutedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
    val readerLinkColor = MaterialTheme.colorScheme.primary

    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = {
            TextButton(onClick = onClose) {
                Text("Close")
            }
        },
        dismissButton = {
            if (!article.canonicalUrl.isNullOrBlank()) {
                TextButton(onClick = { openExternalUrl(context, article.canonicalUrl) }) {
                    Text("Open original")
                }
            }
        },
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(article.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Text(
                            text = article.feedTitle,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    article.publishedAt?.let {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                        ) {
                            Text(
                                text = formatPublishedAt(it),
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Text(
                        text = article.author ?: "Unknown author",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (article.contentHtml != null && article.contentText != null) {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(
                                selected = showHtml,
                                onClick = { showHtml = true },
                                label = { Text("Rich") },
                            )
                            FilterChip(
                                selected = !showHtml,
                                onClick = { showHtml = false },
                                label = { Text("Text") },
                            )
                        }
                    }
                }

                item {
                    Surface(
                        shape = RoundedCornerShape(24.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            if (showHtml && !article.contentHtml.isNullOrBlank()) {
                                SecureHtmlContent(
                                    html = article.contentHtml,
                                    backgroundColor = readerBackgroundColor,
                                    textColor = readerTextColor,
                                    surfaceColor = readerSurfaceColor,
                                    mutedTextColor = readerMutedTextColor,
                                    linkColor = readerLinkColor,
                                    documentBaseUrl = documentBaseUrl,
                                )
                            } else {
                                Text(
                                    text = article.contentText ?: article.excerpt ?: "No content",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                    }
                }

                if (article.media.isNotEmpty()) {
                    item {
                        Text("Media", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    }
                    items(article.media.take(8)) { media ->
                        Surface(
                            shape = RoundedCornerShape(20.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                TextButton(onClick = { openExternalUrl(context, media.url) }) {
                                    Text(media.provider.ifBlank { media.url })
                                }
                                if (canPreviewMedia(media.provider, media.embedUrl)) {
                                    TextButton(onClick = { previewEmbedUrl = media.embedUrl }) {
                                        Text("Preview")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    )

    previewEmbedUrl?.let { embedUrl ->
        AlertDialog(
            onDismissRequest = { previewEmbedUrl = null },
            confirmButton = {
                TextButton(onClick = { previewEmbedUrl = null }) { Text("Close") }
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
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(
                                    view: WebView?,
                                    request: WebResourceRequest?,
                                ): Boolean {
                                    val url = request?.url?.toString()
                                    return if (isTrustedEmbedUrl(url)) {
                                        false
                                    } else {
                                        openExternalUrl(factoryContext, url)
                                        true
                                    }
                                }
                            }
                        }
                    },
                    update = { webView ->
                        if (isTrustedEmbedUrl(embedUrl)) {
                            webView.loadUrl(embedUrl)
                        }
                    },
                )
            },
        )
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
    val processedHtml = buildReaderHtmlDocument(
        html = html,
        colors = readerHtmlColors(
            backgroundColor = backgroundColor,
            textColor = textColor,
            surfaceColor = surfaceColor,
            mutedTextColor = mutedTextColor,
            linkColor = linkColor,
        ),
    )

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .height(420.dp),
        factory = { factoryContext ->
            WebView(factoryContext).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = false
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.safeBrowsingEnabled = true
                settings.loadsImagesAutomatically = true
                settings.builtInZoomControls = false
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                setBackgroundColor(backgroundColor.toArgb())
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): Boolean {
                        openExternalUrl(factoryContext, request?.url?.toString())
                        return true
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
    )
}
