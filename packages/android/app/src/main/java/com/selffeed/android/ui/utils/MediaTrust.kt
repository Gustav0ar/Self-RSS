package com.selffeed.android.ui.utils

import java.net.URI

fun canPreviewMedia(provider: String, embedUrl: String?): Boolean {
    if (embedUrl.isNullOrBlank()) return false
    val isTrustedUrl = isTrustedEmbedUrl(embedUrl)
    val isTrustedProvider = when (provider.lowercase()) {
        "youtube", "vimeo", "streamable", "videopress", "twitter", "x", "instagram", "tiktok" -> true
        else -> false
    }
    return isTrustedUrl && isTrustedProvider
}

fun getYouTubeThumbnail(url: String?): String? {
    if (url == null) return null
    val regex = "(?:youtube\\.com\\/(?:watch\\?v=|embed\\/)|youtu\\.be\\/)([a-zA-Z0-9_-]+)".toRegex()
    val match = regex.find(url)
    val videoId = match?.groupValues?.get(1)
    return videoId?.let { "https://img.youtube.com/vi/$it/0.jpg" }
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
        host.endsWith("x.com") ||
        host.endsWith("instagram.com") ||
        host.endsWith("tiktok.com")
}
