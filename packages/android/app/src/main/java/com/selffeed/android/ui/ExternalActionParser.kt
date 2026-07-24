package com.selffeed.android.ui

import java.net.URI
import java.net.URLDecoder
import java.util.UUID

sealed interface ExternalAction {
    val key: String

    data class OpenArticle(
        val articleId: String,
        val serverOrigin: String?,
    ) : ExternalAction {
        override val key: String = "article:$articleId:${serverOrigin.orEmpty()}"
    }

    data class AddFeed(val feedUrl: String) : ExternalAction {
        override val key: String = "feed:$feedUrl"
    }
}

fun parseSelfFeedAction(raw: String): ExternalAction? {
    if (raw.length !in 1..MAX_EXTERNAL_URI_LENGTH) return null
    val uri = runCatching { URI(raw) }.getOrNull() ?: return null
    if (uri.scheme != "selffeed" || uri.userInfo != null || uri.fragment != null) return null
    val parameters = parseUniqueQuery(uri.rawQuery) ?: return null

    return when (uri.host) {
        "article" -> {
            if (parameters.keys.any { it != "server" }) return null
            val id = uri.path.removePrefix("/")
            if (uri.path != "/$id" || runCatching { UUID.fromString(id) }.isFailure) return null
            val rawServer = parameters["server"]
            val server = rawServer?.let(::validatedHttpsOrigin)
            if (rawServer != null && server == null) return null
            ExternalAction.OpenArticle(id, server)
        }
        "add-feed" -> {
            if (uri.path !in listOf("", "/") || parameters.keys != setOf("url")) return null
            val feedUrl = parameters["url"]?.let(::validatedHttpsUrl) ?: return null
            ExternalAction.AddFeed(feedUrl)
        }
        else -> null
    }
}

fun parseSharedFeedAction(raw: String?): ExternalAction.AddFeed? {
    val value = raw?.trim()?.takeIf { it.length in 1..MAX_EXTERNAL_URI_LENGTH } ?: return null
    return validatedHttpsUrl(value)?.let(ExternalAction::AddFeed)
}

private fun parseUniqueQuery(rawQuery: String?): Map<String, String>? {
    if (rawQuery.isNullOrEmpty()) return emptyMap()
    val values = linkedMapOf<String, String>()
    for (part in rawQuery.split("&")) {
        if (part.isEmpty()) return null
        val separator = part.indexOf('=')
        val rawKey = if (separator >= 0) part.substring(0, separator) else part
        val rawValue = if (separator >= 0) part.substring(separator + 1) else ""
        val key = decode(rawKey) ?: return null
        val value = decode(rawValue) ?: return null
        if (key.isBlank() || values.put(key, value) != null) return null
    }
    return values
}

private fun decode(value: String): String? =
    runCatching { URLDecoder.decode(value, "UTF-8") }.getOrNull()

private fun validatedHttpsOrigin(raw: String): String? {
    val uri = runCatching { URI(raw) }.getOrNull() ?: return null
    if (
        uri.scheme != "https" ||
        uri.host.isNullOrBlank() ||
        uri.userInfo != null ||
        uri.fragment != null ||
        uri.query != null ||
        uri.path !in listOf("", "/")
    ) return null
    return uri.toString().removeSuffix("/")
}

private fun validatedHttpsUrl(raw: String): String? {
    val uri = runCatching { URI(raw) }.getOrNull() ?: return null
    if (
        uri.scheme != "https" ||
        uri.host.isNullOrBlank() ||
        uri.userInfo != null ||
        uri.fragment != null
    ) return null
    return uri.toString()
}

private const val MAX_EXTERNAL_URI_LENGTH = 2_048
