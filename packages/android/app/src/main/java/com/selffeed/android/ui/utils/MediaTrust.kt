package com.selffeed.android.ui.utils

import java.net.URI

fun canPreviewMedia(provider: String, embedUrl: String?): Boolean {
    if (embedUrl.isNullOrBlank()) return false
    val isTrustedUrl = isTrustedEmbedUrl(embedUrl)
    val isTrustedProvider = when (provider.lowercase()) {
        "youtube", "vimeo", "streamable", "videopress", "twitter", "x" -> true
        else -> false
    }
    return isTrustedUrl && isTrustedProvider
}

fun isTrustedEmbedUrl(url: String?): Boolean {
    if (url.isNullOrBlank()) return false
    val host = runCatching { URI(url).host?.lowercase() }.getOrNull() ?: return false
    return host.endsWith("youtube.com") ||
        host.endsWith("youtu.be") ||
        host.endsWith("player.vimeo.com") ||
        host.endsWith("vimeo.com") ||
        host.endsWith("streamable.com") ||
        host.endsWith("videopress.com") ||
        host.endsWith("videos.files.wordpress.com") ||
        host.endsWith("videos.wordpress.com") ||
        host.endsWith("platform.twitter.com") ||
        host.endsWith("twitter.com") ||
        host.endsWith("x.com")
}
