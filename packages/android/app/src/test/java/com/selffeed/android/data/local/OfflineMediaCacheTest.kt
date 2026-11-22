package com.selffeed.android.data.local

import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleMedia
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OfflineMediaCacheTest {
    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun `extractArticleMediaUrls resolves hero, structured media, and inline html assets`() {
        val detail = ArticleDetail(
            id = "a1",
            feedId = "f1",
            guid = "g1",
            canonicalUrl = "https://blog.example.com/posts/offline-guide",
            title = "Offline Guide",
            heroImageUrl = "https://cdn.example.com/hero.webp",
            contentHtml = """
                <p>Intro</p>
                <img src="/images/diagram.png?w=800&amp;q=80" />
                <img data-src="https://cdn.example.com/lazy.jpg" />
                <picture>
                    <source srcset="https://cdn.example.com/pic-480.webp 480w, https://cdn.example.com/pic-1080.webp 1080w, https://cdn.example.com/pic-3840.webp 3840w" />
                    <img src="https://cdn.example.com/fallback.jpg" />
                </picture>
                <video poster="/images/poster.jpg"></video>
                <img src="data:image/png;base64,AAAA" />
            """.trimIndent(),
            hash = "h1",
            feedTitle = "Example Blog",
            media = listOf(
                ArticleMedia("m1", "a1", "image", "direct", "https://cdn.example.com/gallery.png", position = 0),
                ArticleMedia("m2", "a1", "video", "youtube", "https://youtu.be/abc", embedUrl = "https://www.youtube.com/embed/abc", position = 1),
            ),
            isRead = false,
        )

        val urls = extractArticleMediaUrls(detail)

        assertEquals(
            listOf(
                "https://cdn.example.com/hero.webp",
                "https://cdn.example.com/gallery.png",
                "https://blog.example.com/images/diagram.png?w=800&q=80",
                "https://cdn.example.com/lazy.jpg",
                "https://cdn.example.com/pic-1080.webp",
                "https://cdn.example.com/fallback.jpg",
                "https://blog.example.com/images/poster.jpg",
            ),
            urls,
        )
    }

    @Test
    fun `prefetch caches valid media, deduplicates concurrent fetches, and serves WebResourceResponse offline`() = runBlocking {
        val requests = AtomicInteger(0)
        val payload = ByteArray(1024) { (it % 127).toByte() }
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val url = chain.request().url.toString()
                requests.incrementAndGet()
                val (contentType, bodyBytes) = when {
                    url.endsWith("image.webp") -> "image/webp" to payload
                    url.endsWith("error.html") -> "text/html" to "<html>blocked</html>".toByteArray()
                    url.endsWith("huge.png") -> "image/png" to ByteArray(50_000)
                    else -> "image/png" to payload
                }
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .header("Content-Type", contentType)
                    .body(bodyBytes.toResponseBody(contentType.toMediaType()))
                    .build()
            }
            .build()

        val cache = OfflineMediaCache(
            rootDir = tempFolder.newFolder("media-cache"),
            httpClient = client,
            maxTotalBytes = 10_000L,
            defaultMaxAssetBytes = 4_096L,
        )

        // Concurrent prefetches for the same URL share one HTTP call.
        val targetUrl = "https://cdn.example.com/image.webp"
        val results = (1..5).map { async { cache.prefetch(targetUrl) } }.awaitAll()
        assertTrue(results.any { it == payload.size.toLong() })
        assertEquals(1, requests.get())
        assertTrue(cache.contains(targetUrl))

        // Cached response is served offline with original MIME type and exact bytes.
        val webResponse = cache.openCachedResponse(targetUrl)
        assertNotNull(webResponse)
        assertEquals("image/webp", webResponse!!.mimeType)
        assertEquals(payload.toList(), webResponse.data.readBytes().toList())

        // HTML error pages and oversized payloads are never stored.
        assertEquals(0L, cache.prefetch("https://cdn.example.com/error.html"))
        assertFalse(cache.contains("https://cdn.example.com/error.html"))
        assertEquals(0L, cache.prefetch("https://cdn.example.com/huge.png"))
        assertFalse(cache.contains("https://cdn.example.com/huge.png"))
        assertNull(cache.openCachedResponse("https://cdn.example.com/huge.png"))
    }

    @Test
    fun `cache enforces LRU byte budget across prefetches`() = runBlocking {
        val payload = ByteArray(600) { 42 }
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .header("Content-Type", "image/jpeg")
                    .body(payload.toResponseBody("image/jpeg".toMediaType()))
                    .build()
            }
            .build()

        val cacheDir = tempFolder.newFolder("lru-cache")
        val cache = OfflineMediaCache(
            rootDir = cacheDir,
            httpClient = client,
            maxTotalBytes = 1_300L,
            defaultMaxAssetBytes = 1_000L,
        )

        cache.prefetchAll(
            listOf(
                "https://cdn.example.com/1.jpg",
                "https://cdn.example.com/2.jpg",
                "https://cdn.example.com/3.jpg",
            ),
            maxConcurrency = 1,
        )

        val remainingBins = cacheDir.listFiles { f -> f.name.endsWith(".bin") }.orEmpty()
        assertTrue("Expected LRU cap to keep at most 2 assets, found ${remainingBins.size}", remainingBins.size <= 2)
        assertTrue(remainingBins.sumOf { it.length() } <= 1_300L)
    }

    @Test
    fun `failed media URLs are negatively cached across back-to-back prefetch passes`() = runBlocking {
        val requests = AtomicInteger(0)
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                requests.incrementAndGet()
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(404)
                    .message("Not Found")
                    .body(ByteArray(0).toResponseBody("text/plain".toMediaType()))
                    .build()
            }
            .build()

        val cache = OfflineMediaCache(
            rootDir = tempFolder.newFolder("neg-cache"),
            httpClient = client,
        )

        val brokenUrl = "https://cdn.example.com/missing.jpg"
        assertEquals(0, cache.prefetchAll(listOf(brokenUrl)))
        assertEquals(1, requests.get())
        // A second pass skips the recently failed URL instead of re-requesting it.
        assertEquals(0, cache.prefetchAll(listOf(brokenUrl)))
        assertEquals(1, requests.get())
    }
}
