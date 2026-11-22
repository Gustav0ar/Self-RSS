package com.selffeed.android.data.local

import android.content.Context
import android.util.AtomicFile
import android.util.Log
import android.webkit.WebResourceResponse
import com.selffeed.android.BuildConfig
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.ui.components.readerDocumentBaseUrl
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Snapshot of persistent offline media storage usage. */
data class OfflineMediaCacheStats(
    val fileCount: Int = 0,
    val totalBytes: Long = 0L,
)

/**
 * Persistent, app-owned disk cache for offline article images and media.
 *
 * Streams raw compressed bytes straight from third-party publisher hosts to
 * `filesDir/offline_media` via an unauthenticated [OkHttpClient] (never leaking
 * SelfFeed credentials or cookies) and serves them directly to [ReaderWebView]
 * via `shouldInterceptRequest` without bitmap decoding overhead.
 */
class OfflineMediaCache(
    private val rootDir: File,
    private val httpClientProvider: () -> OkHttpClient = { sharedMediaHttpClient },
    private val maxTotalBytes: Long = DEFAULT_MAX_TOTAL_BYTES,
    private val maxEntries: Int = DEFAULT_MAX_ENTRIES,
    private val defaultMaxAssetBytes: Long = DEFAULT_MAX_ASSET_BYTES,
) {
    constructor(
        rootDir: File,
        httpClient: OkHttpClient,
        maxTotalBytes: Long = DEFAULT_MAX_TOTAL_BYTES,
        maxEntries: Int = DEFAULT_MAX_ENTRIES,
        defaultMaxAssetBytes: Long = DEFAULT_MAX_ASSET_BYTES,
    ) : this(
        rootDir = rootDir,
        httpClientProvider = { httpClient },
        maxTotalBytes = maxTotalBytes,
        maxEntries = maxEntries,
        defaultMaxAssetBytes = defaultMaxAssetBytes,
    )

    constructor(
        context: Context,
        httpClient: OkHttpClient? = null,
    ) : this(
        rootDir = File(context.filesDir, ROOT_DIR),
        httpClientProvider = { httpClient ?: sharedMediaHttpClient },
    )

    private val inFlight = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
    private val recentFailures = ConcurrentHashMap<String, Long>()
    private val backgroundPrefetchScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val backgroundPrefetchSemaphore = Semaphore(BACKGROUND_PREFETCH_CONCURRENCY)
    private val writesSincePrune = AtomicInteger(0)
    private val pruneLock = Any()

    init {
        rootDir.mkdirs()
    }

    /** Fast existence check without reading file payloads. */
    fun contains(url: String): Boolean {
        val normalized = normalizeCacheableUrl(url) ?: return false
        val key = cacheKey(normalized)
        return dataFile(key).isFile && metaFile(key).isFile
    }

    private fun isRecentlyFailed(normalizedUrl: String, nowMs: Long = System.currentTimeMillis()): Boolean {
        val failedAt = recentFailures[normalizedUrl] ?: return false
        if (nowMs - failedAt < FAILURE_COOLDOWN_MS) return true
        recentFailures.remove(normalizedUrl, failedAt)
        return false
    }

    private fun recordFailure(normalizedUrl: String) {
        if (recentFailures.size >= MAX_TRACKED_FAILURES) {
            val cutoff = System.currentTimeMillis() - FAILURE_COOLDOWN_MS
            recentFailures.entries.removeIf { it.value < cutoff }
            if (recentFailures.size >= MAX_TRACKED_FAILURES) recentFailures.clear()
        }
        recentFailures[normalizedUrl] = System.currentTimeMillis()
    }

    /**
     * Streams a single media asset to disk if not already cached.
     * Concurrent callers for the same URL share one in-flight HTTP request.
     */
    suspend fun prefetch(
        url: String,
        maxAssetBytes: Long = defaultMaxAssetBytes,
    ): Long = withContext(Dispatchers.IO) {
        val normalized = normalizeCacheableUrl(url) ?: return@withContext 0L
        val key = cacheKey(normalized)
        val existing = dataFile(key)
        if (existing.isFile && metaFile(key).isFile) {
            existing.setLastModified(System.currentTimeMillis())
            return@withContext 0L
        }
        if (isRecentlyFailed(normalized)) return@withContext 0L

        val mine = CompletableDeferred<Boolean>()
        val active = inFlight.putIfAbsent(normalized, mine)
        if (active != null) {
            active.await()
            return@withContext 0L
        }

        var downloadedBytes = 0L
        try {
            downloadedBytes = downloadToCache(normalized, key, maxAssetBytes)
            if (downloadedBytes > 0L) {
                recentFailures.remove(normalized)
            } else {
                recordFailure(normalized)
            }
            mine.complete(downloadedBytes > 0L)
        } catch (error: Throwable) {
            mine.complete(false)
            if (error is kotlinx.coroutines.CancellationException) throw error
            recordFailure(normalized)
            debugLog("Media prefetch failed for $normalized: ${error.message}")
        } finally {
            inFlight.remove(normalized, mine)
        }
        downloadedBytes
    }

    /**
     * Warms a single URL asynchronously without blocking Chromium's IO thread.
     */
    fun prefetchInBackground(
        url: String,
        maxAssetBytes: Long = defaultMaxAssetBytes,
    ) {
        val normalized = normalizeCacheableUrl(url) ?: return
        if (contains(normalized) || isRecentlyFailed(normalized) || inFlight.containsKey(normalized)) return
        backgroundPrefetchScope.launch {
            backgroundPrefetchSemaphore.withPermit {
                prefetch(normalized, maxAssetBytes = maxAssetBytes)
            }
        }
    }

    /**
     * Prefetches a batch of media URLs with bounded concurrency, an optional
     * per-run byte budget (for cellular/metered discipline), and an optional
     * wall-clock duration budget so slow publisher hosts never stall sync.
     */
    suspend fun prefetchAll(
        urls: Iterable<String>,
        maxConcurrency: Int = DEFAULT_CONCURRENCY,
        maxAssetBytes: Long = defaultMaxAssetBytes,
        maxTotalDownloadBytes: Long = Long.MAX_VALUE,
        maxDurationMs: Long = Long.MAX_VALUE,
    ): Int {
        val distinctUrls = urls.asSequence()
            .mapNotNull(::normalizeCacheableUrl)
            .distinct()
            .filterNot(::contains)
            .filterNot(::isRecentlyFailed)
            .toList()
        if (distinctUrls.isEmpty()) return 0

        val semaphore = Semaphore(maxConcurrency.coerceAtLeast(1))
        val downloadedBytes = AtomicLong(0L)
        val downloadedCount = AtomicInteger(0)
        val deadlineMs = if (maxDurationMs == Long.MAX_VALUE) Long.MAX_VALUE else System.currentTimeMillis() + maxDurationMs

        val runBatch: suspend () -> Unit = {
            coroutineScope {
                distinctUrls.map { url ->
                    async(Dispatchers.IO) {
                        if (downloadedBytes.get() >= maxTotalDownloadBytes) return@async
                        if (System.currentTimeMillis() >= deadlineMs) return@async
                        semaphore.withPermit {
                            currentCoroutineContext().ensureActive()
                            if (System.currentTimeMillis() >= deadlineMs) return@withPermit
                            val remaining = maxTotalDownloadBytes - downloadedBytes.get()
                            if (remaining <= 0L) return@withPermit
                            val assetCap = minOf(maxAssetBytes, remaining)
                            val bytes = prefetch(url, maxAssetBytes = assetCap)
                            if (bytes > 0L) {
                                downloadedBytes.addAndGet(bytes)
                                downloadedCount.incrementAndGet()
                            }
                        }
                    }
                }.awaitAll()
            }
        }

        if (maxDurationMs == Long.MAX_VALUE) {
            runBatch()
        } else {
            withTimeoutOrNull(maxDurationMs) { runBatch() }
        }

        if (downloadedCount.get() > 0) pruneIfNeeded(force = true)
        return downloadedCount.get()
    }

    /**
     * Synchronous cache lookup for Chromium's IO thread (`shouldInterceptRequest`).
     * Never hits the network.
     */
    fun openCachedResponse(url: String): WebResourceResponse? {
        val normalized = normalizeCacheableUrl(url) ?: return null
        val key = cacheKey(normalized)
        val data = dataFile(key)
        val meta = metaFile(key)
        if (!data.isFile || !meta.isFile) return null
        val mimeType = runCatching { meta.readText(Charsets.UTF_8).trim() }
            .getOrNull()
            ?.takeIf(String::isNotBlank)
            ?: return null
        return runCatching {
            val stream: InputStream = FileInputStream(data)
            data.setLastModified(System.currentTimeMillis())
            WebResourceResponse(
                mimeType,
                null,
                200,
                "OK",
                mapOf(
                    "Cache-Control" to "public, max-age=604800",
                    "X-SelfFeed-Offline-Cache" to "hit",
                ),
                stream,
            )
        }.getOrNull()
    }

    /**
     * Serves from disk if cached; otherwise downloads synchronously on Chromium's
     * background IO thread, stores it atomically, and serves from disk so live
     * reads also populate the offline cache immediately.
     */
    fun fetchAndOpenResponse(
        url: String,
        maxAssetBytes: Long = defaultMaxAssetBytes,
    ): WebResourceResponse? {
        openCachedResponse(url)?.let { return it }
        val normalized = normalizeCacheableUrl(url) ?: return null
        runCatching {
            runBlocking(Dispatchers.IO) {
                prefetch(normalized, maxAssetBytes = maxAssetBytes)
            }
        }
        return openCachedResponse(normalized)
    }

    /** Returns the cached local payload file when present so offline image viewers avoid network I/O. */
    fun cachedFile(url: String): File? {
        val normalized = normalizeCacheableUrl(url) ?: return null
        val key = cacheKey(normalized)
        val data = dataFile(key)
        if (!data.isFile || !metaFile(key).isFile) return null
        data.setLastModified(System.currentTimeMillis())
        return data
    }

    /** Computes current cached media file count and byte usage on disk. */
    suspend fun stats(): OfflineMediaCacheStats = withContext(Dispatchers.IO) {
        synchronized(pruneLock) {
            val files = rootDir.listFiles { file -> file.isFile && file.name.endsWith(".bin") }
                ?: return@synchronized OfflineMediaCacheStats()
            OfflineMediaCacheStats(
                fileCount = files.size,
                totalBytes = files.sumOf { it.length().coerceAtLeast(0L) },
            )
        }
    }

    suspend fun clearAll() = withContext(Dispatchers.IO) {
        recentFailures.clear()
        synchronized(pruneLock) {
            rootDir.listFiles()?.forEach { it.delete() }
        }
    }

    private fun downloadToCache(url: String, key: String, maxAssetBytes: Long): Long {
        if (!rootDir.exists()) rootDir.mkdirs()
        val request = Request.Builder()
            .url(url)
            .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            .header("User-Agent", MEDIA_USER_AGENT)
            .build()

        httpClientProvider().newCall(request).execute().use { response ->
            if (!response.isSuccessful) return 0L
            val body = response.body
            val contentLength = body.contentLength()
            if (contentLength > maxAssetBytes) return 0L

            val mimeType = resolveCacheableMimeType(
                headerContentType = response.header("Content-Type"),
                url = url,
            ) ?: return 0L

            val dataTarget = dataFile(key)
            val atomicData = AtomicFile(dataTarget)
            var out: java.io.FileOutputStream? = null
            var totalBytes = 0L
            try {
                val stream = atomicData.startWrite()
                out = stream
                val buffer = ByteArray(16 * 1024)
                body.byteStream().use { input ->
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        totalBytes += read
                        if (totalBytes > maxAssetBytes) {
                            atomicData.failWrite(stream)
                            out = null
                            return 0L
                        }
                        stream.write(buffer, 0, read)
                    }
                }
                if (totalBytes == 0L) {
                    atomicData.failWrite(stream)
                    out = null
                    return 0L
                }
                atomicData.finishWrite(stream)
                out = null
            } catch (e: IOException) {
                out?.let(atomicData::failWrite)
                throw e
            }

            val atomicMeta = AtomicFile(metaFile(key))
            var metaOut: java.io.FileOutputStream? = null
            try {
                metaOut = atomicMeta.startWrite()
                metaOut.write(mimeType.toByteArray(Charsets.UTF_8))
                atomicMeta.finishWrite(metaOut)
                metaOut = null
            } catch (e: IOException) {
                metaOut?.let(atomicMeta::failWrite)
                dataTarget.delete()
                throw e
            }

            if (writesSincePrune.incrementAndGet() >= PRUNE_EVERY_N_WRITES) {
                pruneIfNeeded(force = false)
            }
            return totalBytes
        }
    }

    private fun pruneIfNeeded(force: Boolean) {
        if (!force && writesSincePrune.get() < PRUNE_EVERY_N_WRITES) return
        synchronized(pruneLock) {
            writesSincePrune.set(0)
            val dataFiles = rootDir.listFiles { file -> file.isFile && file.name.endsWith(".bin") }
                ?.toMutableList()
                ?: return

            // Remove orphaned .meta files.
            val validKeys = dataFiles.mapTo(mutableSetOf()) { it.name.removeSuffix(".bin") }
            rootDir.listFiles { file -> file.isFile && file.name.endsWith(".meta") }?.forEach { meta ->
                if (meta.name.removeSuffix(".meta") !in validKeys) meta.delete()
            }

            if (dataFiles.isEmpty()) return
            var totalBytes = dataFiles.sumOf { it.length() }
            if (dataFiles.size <= maxEntries && totalBytes <= maxTotalBytes) return

            dataFiles.sortBy { it.lastModified() }
            var remainingCount = dataFiles.size
            for (victim in dataFiles) {
                if (remainingCount <= maxEntries && totalBytes <= maxTotalBytes) break
                val size = victim.length()
                val key = victim.name.removeSuffix(".bin")
                if (victim.delete()) {
                    metaFile(key).delete()
                    totalBytes -= size
                    remainingCount -= 1
                }
            }
        }
    }

    private fun dataFile(key: String) = File(rootDir, "$key.bin")

    private fun metaFile(key: String) = File(rootDir, "$key.meta")

    private fun cacheKey(url: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray(Charsets.UTF_8))
        return buildString(digest.size * 2) {
            for (b in digest) {
                val i = b.toInt() and 0xFF
                append(HEX_CHARS[i ushr 4])
                append(HEX_CHARS[i and 0x0F])
            }
        }
    }

    private fun debugLog(message: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, message)
    }

    companion object {
        private const val TAG = "OfflineMediaCache"
        private const val ROOT_DIR = "offline_media"
        private const val DEFAULT_CONCURRENCY = 4
        private const val BACKGROUND_PREFETCH_CONCURRENCY = 2
        private const val PRUNE_EVERY_N_WRITES = 16
        private const val FAILURE_COOLDOWN_MS = 30L * 60 * 1000 // 30 minutes
        private const val MAX_TRACKED_FAILURES = 512
        const val DEFAULT_MAX_TOTAL_BYTES = 120L * 1024 * 1024 // 120 MB
        const val DEFAULT_MAX_ENTRIES = 1500
        const val DEFAULT_MAX_ASSET_BYTES = 8L * 1024 * 1024 // 8 MB
        const val METERED_MAX_ASSET_BYTES = 2L * 1024 * 1024 // 2 MB
        private const val MEDIA_USER_AGENT = "SelfFeed-Android-OfflineMedia/1.0"
        private val HEX_CHARS = "0123456789abcdef".toCharArray()

        private val sharedMediaHttpClient: OkHttpClient by lazy { createMediaHttpClient() }

        fun createMediaHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(false)
            .build()

        internal fun normalizeCacheableUrl(raw: String?): String? {
            val trimmed = raw?.trim()?.takeIf(String::isNotBlank) ?: return null
            val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
            if (scheme != "https" && scheme != "http") return null
            if (uri.host.isNullOrBlank()) return null
            return uri.toASCIIString()
        }

        internal fun resolveCacheableMimeType(headerContentType: String?, url: String): String? {
            val rawType = headerContentType
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase(Locale.US)
                ?.takeIf(String::isNotBlank)

            if (rawType != null) {
                if (rawType.startsWith("image/") || rawType.startsWith("audio/") || rawType.startsWith("video/")) {
                    return rawType
                }
                if (rawType != "application/octet-stream" && rawType != "binary/octet-stream") {
                    return null
                }
            }
            return inferMediaMimeTypeFromUrl(url)
        }

        internal fun isLikelyImageUrl(url: String): Boolean {
            val path = runCatching { URI(url).path }.getOrNull()?.lowercase(Locale.US) ?: return false
            return IMAGE_EXTENSIONS.any { path.endsWith(it) }
        }

        private fun inferMediaMimeTypeFromUrl(url: String): String? {
            val path = runCatching { URI(url).path }.getOrNull()?.lowercase(Locale.US) ?: return null
            return when {
                path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
                path.endsWith(".png") -> "image/png"
                path.endsWith(".webp") -> "image/webp"
                path.endsWith(".gif") -> "image/gif"
                path.endsWith(".avif") -> "image/avif"
                path.endsWith(".svg") -> "image/svg+xml"
                path.endsWith(".ico") -> "image/x-icon"
                path.endsWith(".mp4") || path.endsWith(".m4v") -> "video/mp4"
                path.endsWith(".webm") -> "video/webm"
                path.endsWith(".mp3") -> "audio/mpeg"
                path.endsWith(".m4a") -> "audio/mp4"
                path.endsWith(".ogg") -> "audio/ogg"
                else -> null
            }
        }

        private val IMAGE_EXTENSIONS = setOf(".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg", ".ico")
    }
}

/**
 * Extracts cacheable media URLs (hero image, structured media entries, and
 * inline HTML `<img>`, `<source>`, and `<video poster>` references) from an
 * [ArticleDetail], resolving relative paths against the article's base URL.
 */
internal fun extractArticleMediaUrls(
    detail: ArticleDetail,
    maxUrlsPerArticle: Int = DEFAULT_MAX_MEDIA_PER_ARTICLE,
): List<String> {
    val baseUri = runCatching {
        URI(readerDocumentBaseUrl(detail.canonicalUrl, detail.feedSiteUrl))
    }.getOrNull()

    fun resolve(raw: String?): String? {
        val candidate = raw?.trim()
            ?.replace("&amp;", "&")
            ?.takeIf(String::isNotBlank)
            ?: return null
        if (candidate.startsWith("data:", ignoreCase = true) ||
            candidate.startsWith("javascript:", ignoreCase = true) ||
            candidate.startsWith("blob:", ignoreCase = true)
        ) return null
        val resolved = runCatching {
            val parsed = URI(candidate)
            if (parsed.isAbsolute) parsed.toASCIIString()
            else baseUri?.resolve(parsed)?.toASCIIString()
        }.getOrNull()
        return OfflineMediaCache.normalizeCacheableUrl(resolved)
    }

    val urls = LinkedHashSet<String>()
    fun add(raw: String?) {
        if (urls.size >= maxUrlsPerArticle) return
        resolve(raw)?.let(urls::add)
    }

    add(detail.heroImageUrl)

    for (media in detail.media) {
        if (urls.size >= maxUrlsPerArticle) break
        when (media.type.lowercase(Locale.US)) {
            "image" -> add(media.url)
            "audio", "video" -> {
                // Only cache direct media files, never iframe embed player pages.
                if (media.embedUrl.isNullOrBlank()) add(media.url)
            }
        }
    }

    val html = detail.contentHtml
    if (!html.isNullOrBlank() && urls.size < maxUrlsPerArticle) {
        MEDIA_TAG_REGEX.findAll(html).forEach { match ->
            if (urls.size >= maxUrlsPerArticle) return@forEach
            val tag = match.value
            val tagName = match.groupValues[1].lowercase(Locale.US)
            when (tagName) {
                "img" -> {
                    extractAttribute(tag, ATTR_SRC_REGEX)?.let(::add)
                    extractAttribute(tag, ATTR_DATA_SRC_REGEX)?.let(::add)
                    extractAttribute(tag, ATTR_SRCSET_REGEX)?.let { selectBestSrcsetUrl(it) }?.let(::add)
                }
                "source" -> {
                    extractAttribute(tag, ATTR_SRC_REGEX)?.let(::add)
                    extractAttribute(tag, ATTR_SRCSET_REGEX)?.let { selectBestSrcsetUrl(it) }?.let(::add)
                }
                "video" -> {
                    extractAttribute(tag, ATTR_POSTER_REGEX)?.let(::add)
                }
            }
        }
    }

    return urls.toList()
}

private fun extractAttribute(tag: String, regex: Regex): String? {
    val match = regex.find(tag) ?: return null
    return match.groupValues.drop(1).firstOrNull { it.isNotEmpty() }
}

private fun htmlAttributeRegex(name: String): Regex = Regex(
    """\b$name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))""",
    RegexOption.IGNORE_CASE,
)

private val ATTR_SRC_REGEX = htmlAttributeRegex("src")
private val ATTR_DATA_SRC_REGEX = htmlAttributeRegex("data-src")
private val ATTR_SRCSET_REGEX = htmlAttributeRegex("srcset")
private val ATTR_POSTER_REGEX = htmlAttributeRegex("poster")

/**
 * Picks one sensible mobile-resolution candidate from an HTML `srcset`
 * attribute (targeting ~1080w when width descriptors are provided) so offline
 * prefetch avoids downloading 4K desktop images while matching what mobile
 * Chromium selects.
 */
internal fun selectBestSrcsetUrl(srcset: String): String? {
    data class Candidate(val url: String, val width: Int?)
    val candidates = srcset.split(',')
        .mapNotNull { entry ->
            val parts = entry.trim().split(Regex("\\s+")).filter(String::isNotBlank)
            val url = parts.firstOrNull() ?: return@mapNotNull null
            val descriptor = parts.getOrNull(1)
            val width = descriptor
                ?.takeIf { it.endsWith("w", ignoreCase = true) }
                ?.dropLast(1)
                ?.toIntOrNull()
            Candidate(url, width)
        }
    if (candidates.isEmpty()) return null
    val withWidths = candidates.filter { it.width != null }
    if (withWidths.isEmpty()) return candidates.first().url

    // Prefer the smallest candidate >= 720w and <= 1440w, else closest to 1080w.
    return withWidths
        .filter { it.width!! in 720..1440 }
        .minByOrNull { kotlin.math.abs(it.width!! - 1080) }
        ?.url
        ?: withWidths.minByOrNull { kotlin.math.abs(it.width!! - 1080) }?.url
        ?: candidates.first().url
}

private const val DEFAULT_MAX_MEDIA_PER_ARTICLE = 16

private val MEDIA_TAG_REGEX = Regex(
    """<\s*(img|source|video)\b[^>]*>""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
)
