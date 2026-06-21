package com.selffeed.android.network

import com.selffeed.android.BuildConfig
import okhttp3.HttpUrl
import java.net.URI

private const val REQUIRED_API_SEGMENT = "api"
private const val REQUIRED_API_VERSION_SEGMENT = "v1"
private val REQUIRED_API_PATH = listOf(REQUIRED_API_SEGMENT, REQUIRED_API_VERSION_SEGMENT)

fun normalizeApiBaseUrl(rawBaseUrl: String): String {
    val serverHost = normalizeApiServerHost(rawBaseUrl)
    return apiBaseUrlFromServerHost(serverHost)
}

fun normalizeApiServerHost(rawServerHost: String): String {
    val authority = parseServerHost(rawServerHost)
    return formatServerHost(authority.host, authority.port)
}

fun apiBaseUrlFromServerHost(
    serverHost: String,
    defaultBaseUrl: String = BuildConfig.API_BASE_URL,
): String {
    val authority = parseServerHost(serverHost)
    val defaultBase = parseConfiguredApiBaseUrl(defaultBaseUrl)
    val hostKind = hostKind(authority.host)
    val scheme = authority.scheme
        ?: inferredScheme(hostKind = hostKind, explicitPort = authority.port)
        ?: defaultBase.url.scheme
    val port = when {
        authority.port != -1 -> authority.port
        hostKind == HostKind.PUBLIC -> -1
        defaultBase.explicitPort != -1 -> defaultBase.explicitPort
        else -> -1
    }
    val base = buildHttpUrl(
        scheme = scheme,
        host = authority.host,
        port = port,
        pathSegments = defaultBase.pathSegments,
    )
    return base.toString().trimEnd('/') + "/"
}

private fun fullApiBaseUrlToHttpUrl(rawBaseUrl: String): HttpUrl {
    return parseConfiguredApiBaseUrl(rawBaseUrl).url
}

private fun parseConfiguredApiBaseUrl(rawBaseUrl: String): ConfiguredApiBaseUrl {
    val trimmed = rawBaseUrl.trim()
    if (trimmed.isBlank()) throw invalidApiBaseUrl()

    val candidate = if (trimmed.contains("://")) trimmed else "https://$trimmed"
    val uri = runCatching { URI(candidate) }.getOrElse { throw invalidApiBaseUrl(it) }
    val scheme = uri.scheme?.lowercase() ?: throw invalidApiBaseUrl()
    val host = uri.host?.takeIf { it.isNotBlank() } ?: throw invalidApiBaseUrl()

    if (scheme != "http" && scheme != "https") {
        throw IllegalArgumentException("Server URL must use HTTP or HTTPS.")
    }
    if (!uri.userInfo.isNullOrBlank()) {
        throw IllegalArgumentException("Server URL must not include credentials.")
    }

    val pathSegments = configuredApiPathSegments(uri.path.orEmpty())
    val url = buildHttpUrl(scheme = scheme, host = host, port = uri.port, pathSegments = pathSegments)
    return ConfiguredApiBaseUrl(url = url, explicitPort = uri.port, pathSegments = pathSegments)
}

fun apiEndpointUrl(baseUrl: String, endpointPath: String): HttpUrl {
    val base = apiBaseUrlToHttpUrl(baseUrl)
    val builder = base.newBuilder()
    endpointPath.pathSegments().forEach { builder.addPathSegment(it) }
    return builder.build()
}

fun rewriteApiRequestUrl(
    original: HttpUrl,
    configuredBaseUrl: String,
    defaultBaseUrl: String = BuildConfig.API_BASE_URL,
): HttpUrl {
    val targetBase = apiBaseUrlToHttpUrl(configuredBaseUrl)
    val defaultBase = fullApiBaseUrlToHttpUrl(defaultBaseUrl)
    val originalSegments = original.pathSegments.filter { it.isNotBlank() }
    val defaultBaseSegments = defaultBase.pathSegments.filter { it.isNotBlank() }
    val targetBaseSegments = targetBase.pathSegments.filter { it.isNotBlank() }

    val relativeSegments = when {
        originalSegments.startsWithSegments(defaultBaseSegments) -> originalSegments.drop(defaultBaseSegments.size)
        originalSegments.startsWithSegments(targetBaseSegments) -> originalSegments.drop(targetBaseSegments.size)
        else -> originalSegments
    }

    val builder = targetBase.newBuilder()
        .encodedQuery(original.encodedQuery)
    relativeSegments.forEach { builder.addPathSegment(it) }
    return builder.build()
}

private fun apiBaseUrlToHttpUrl(rawBaseUrl: String): HttpUrl {
    val normalized = normalizeApiBaseUrl(rawBaseUrl)
    val uri = URI(normalized)
    return buildHttpUrl(
        scheme = uri.scheme.lowercase(),
        host = uri.host,
        port = uri.port,
        pathSegments = uri.path.orEmpty().pathSegments(),
    )
}

private fun parseServerHost(rawServerHost: String): ServerHost {
    val trimmed = rawServerHost.trim().trimEnd('/')
    if (trimmed.isBlank()) throw invalidServerHost()

    val hasExplicitScheme = trimmed.contains("://")
    val candidate = if (trimmed.contains("://")) {
        trimmed
    } else {
        "http://${trimmed.substringBefore('/').substringBefore('?').substringBefore('#')}"
    }
    val uri = runCatching { URI(candidate) }.getOrElse { throw invalidServerHost(it) }
    val scheme = uri.scheme?.lowercase()
    if (scheme != null && scheme != "http" && scheme != "https") {
        throw IllegalArgumentException("Server must use HTTP or HTTPS.")
    }
    if (!uri.userInfo.isNullOrBlank()) {
        throw IllegalArgumentException("Server must not include credentials.")
    }

    val host = uri.host?.takeIf { it.isNotBlank() } ?: throw invalidServerHost()
    return ServerHost(
        scheme = if (hasExplicitScheme) scheme else null,
        host = host.lowercase(),
        port = uri.port,
    )
}

private fun formatServerHost(host: String, port: Int): String {
    val displayHost = if (host.contains(":") && !host.startsWith("[")) "[$host]" else host
    return if (port != -1) "$displayHost:$port" else displayHost
}

private fun configuredApiPathSegments(path: String): List<String> {
    val segments = path.pathSegments()
    return segments.ifEmpty { REQUIRED_API_PATH }
}

private fun inferredScheme(hostKind: HostKind, explicitPort: Int): String? =
    when {
        hostKind == HostKind.PUBLIC && explicitPort == -1 -> "https"
        hostKind == HostKind.PUBLIC && explicitPort == 443 -> "https"
        hostKind == HostKind.PUBLIC && explicitPort == 80 -> "http"
        hostKind != HostKind.PUBLIC -> "http"
        else -> null
    }

private fun hostKind(host: String): HostKind =
    when {
        host == "localhost" -> HostKind.LOCAL
        host == "10.0.2.2" -> HostKind.LOCAL
        host.isPrivateIpv4Host() -> HostKind.LOCAL
        host.contains(":") -> HostKind.LOCAL
        else -> HostKind.PUBLIC
    }

private fun String.isPrivateIpv4Host(): Boolean {
    val parts = split(".").mapNotNull { it.toIntOrNull() }
    if (parts.size != 4 || parts.any { it !in 0..255 }) return false
    return when {
        parts[0] == 10 -> true
        parts[0] == 127 -> true
        parts[0] == 192 && parts[1] == 168 -> true
        parts[0] == 172 && parts[1] in 16..31 -> true
        else -> false
    }
}

private fun buildHttpUrl(
    scheme: String,
    host: String,
    port: Int,
    pathSegments: List<String>,
): HttpUrl {
    val builder = HttpUrl.Builder()
        .scheme(scheme)
        .host(host)
    if (port != -1) builder.port(port)
    pathSegments.forEach { builder.addPathSegment(it) }
    return builder.build()
}

private fun String.pathSegments(): List<String> =
    trim('/').split('/').filter { it.isNotBlank() }

private fun List<String>.startsWithSegments(prefix: List<String>): Boolean =
    prefix.isNotEmpty() && size >= prefix.size && take(prefix.size) == prefix

private fun invalidApiBaseUrl(cause: Throwable? = null): IllegalArgumentException =
    IllegalArgumentException("Enter a valid server URL.", cause)

private fun invalidServerHost(cause: Throwable? = null): IllegalArgumentException =
    IllegalArgumentException("Enter a valid server, for example 10.0.22.22:3000.", cause)

private data class ServerHost(
    val scheme: String?,
    val host: String,
    val port: Int,
)

private data class ConfiguredApiBaseUrl(
    val url: HttpUrl,
    val explicitPort: Int,
    val pathSegments: List<String>,
)

private enum class HostKind {
    LOCAL,
    PUBLIC,
}
