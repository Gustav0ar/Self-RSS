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
    val uri = url.toTrustedUri() ?: return null
    val host = uri.host?.lowercase() ?: return null
    val segments = uri.path.orEmpty().split('/').filter { it.isNotBlank() }
    val videoId = when {
        host in setOf("youtube.com", "www.youtube.com", "m.youtube.com") && segments.firstOrNull() == "watch" ->
            uri.rawQuery
                ?.split('&')
                ?.firstOrNull { it.startsWith("v=") }
                ?.substringAfter("v=")
        host in setOf("youtube.com", "www.youtube.com", "m.youtube.com") &&
            segments.firstOrNull() in setOf("embed", "shorts") ->
            segments.getOrNull(1)
        host == "youtu.be" -> segments.firstOrNull()
        else -> null
    }?.takeIf { YOUTUBE_ID_REGEX.matches(it) }
    return videoId?.let { "https://img.youtube.com/vi/$it/0.jpg" }
}

fun isTrustedEmbedUrl(url: String?): Boolean {
    val uri = url.toTrustedUri() ?: return false
    val host = uri.host?.lowercase()?.removeSuffix(".") ?: return false
    return host in TRUSTED_EMBED_HOSTS
}

private fun String?.toTrustedUri(): URI? {
    if (isNullOrBlank()) return null
    val uri = runCatching { URI(trim()) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return null
    return uri
}

private val TRUSTED_EMBED_HOSTS = setOf(
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "player.vimeo.com",
    "vimeo.com",
    "www.vimeo.com",
    "streamable.com",
    "www.streamable.com",
    "videopress.com",
    "www.videopress.com",
    "videos.files.wordpress.com",
    "videos.wordpress.com",
    "platform.twitter.com",
    "twitter.com",
    "www.twitter.com",
    "x.com",
    "www.x.com",
    "instagram.com",
    "www.instagram.com",
    "tiktok.com",
    "www.tiktok.com",
    "vm.tiktok.com",
)

private val YOUTUBE_ID_REGEX = Regex("^[a-zA-Z0-9_-]{1,128}$")
