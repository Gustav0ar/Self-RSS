package com.selffeed.android.data.local

import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.squareup.moshi.Moshi
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OfflineCacheStoreTest {
    private lateinit var context: android.content.Context
    private lateinit var store: OfflineCacheStore
    // Use the production Moshi which includes the reflective
    // KotlinJsonAdapterFactory as a fallback for DTOs whose generated
    // adapters aren't on the test classpath. Without this fallback the
    // generated-adapter lookup fails for every payload in this test.
    private val moshi = com.selffeed.android.network.NetworkModule.provideMoshi()

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        // Each test gets a fresh store with a tight TTL so we can verify
        // expiry behavior in real time.
        store = OfflineCacheStore(
            context = context,
            moshi = moshi,
            maxAgeMs = 1_000L, // 1 second
            maxTotalBytes = 8 * 1024L, // 8 KB cap to exercise eviction
        )
        runBlocking { store.clearAll() }
    }

    @After
    fun teardown() {
        runBlocking { store.clearAll() }
    }

    @Test
    fun `write and read round-trips categories`() = runBlocking {
        val categories = listOf(
            sampleCategory(id = "c-1", name = "Tech"),
            sampleCategory(id = "c-2", name = "News"),
        )
        store.writeCategories(categories)
        val read = store.readCategories()
        assertEquals(2, read.size)
        assertEquals("Tech", read[0].name)
    }

    @Test
    fun `write and read round-trips feeds`() = runBlocking {
        val feeds = listOf(sampleFeed(id = "f-1", categoryId = "c-1"))
        store.writeFeeds(feeds)
        val read = store.readFeeds()
        assertEquals(1, read.size)
        assertEquals("f-1", read[0].id)
    }

    @Test
    fun `write and read round-trips articles`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(sampleArticle(id = "a-1")),
            cursor = "next",
            hasMore = true,
        )
        store.writeArticles("key-1", payload)
        val read = store.readArticles("key-1")
        assertNotNull(read)
        assertEquals(1, read!!.data.size)
        assertEquals("next", read.cursor)
        assertTrue(read.hasMore)
    }

    @Test
    fun `write and read round-trips article details`() = runBlocking {
        val detail = ArticleDetail(
            id = "a-1",
            feedId = "f-1",
            guid = "guid",
            canonicalUrl = null,
            title = "T",
            author = null,
            excerpt = null,
            contentHtml = "<p>html</p>",
            contentText = "text",
            heroImageUrl = null,
            publishedAt = null,
            fetchedAt = null,
            hash = "h",
            feedTitle = "F",
            feedFaviconUrl = null,
            feedSiteUrl = null,
            media = emptyList(),
            isRead = false,
            isEnriched = false,
        )
        store.writeArticleDetail(detail)
        val read = store.readArticleDetail("a-1")
        assertNotNull(read)
        assertEquals("T", read!!.title)
    }

    @Test
    fun `stale entries are treated as misses`() = runBlocking {
        val categories = listOf(sampleCategory(id = "c-1", name = "Tech"))
        store.writeCategories(categories)
        // Within the 1s TTL.
        assertEquals(1, store.readCategories().size)
        // Sleep past the TTL.
        Thread.sleep(1_500)
        val read = store.readCategories()
        assertTrue("stale read should return empty list", read.isEmpty())
    }

    @Test
    fun `clearByPrefix removes only matching files`() = runBlocking {
        store.writeCategories(listOf(sampleCategory(id = "c-1")))
        store.writeFeeds(listOf(sampleFeed(id = "f-1", categoryId = "c-1")))
        store.writeArticleDetail(
            ArticleDetail(
                id = "a-1",
                feedId = "f-1",
                guid = "g",
                canonicalUrl = null,
                title = "t",
                author = null,
                excerpt = null,
                contentHtml = null,
                contentText = null,
                heroImageUrl = null,
                publishedAt = null,
                fetchedAt = null,
                hash = "h",
                feedTitle = "f",
                feedFaviconUrl = null,
                feedSiteUrl = null,
                media = emptyList(),
                isRead = false,
                isEnriched = false,
            ),
        )
        store.clearByPrefix("article-")
        assertEquals(1, store.readCategories().size)
        assertEquals(1, store.readFeeds().size)
        assertNull(store.readArticleDetail("a-1"))
    }

    @Test
    fun `clearAll removes every file`() = runBlocking {
        store.writeCategories(listOf(sampleCategory(id = "c-1")))
        store.writeFeeds(listOf(sampleFeed(id = "f-1", categoryId = "c-1")))
        store.clearAll()
        assertTrue(store.readCategories().isEmpty())
        assertTrue(store.readFeeds().isEmpty())
    }

    @Test
    fun `root directory is recreated after wipe`() = runBlocking {
        val root = File(context.cacheDir, "offline-cache")
        if (root.exists()) root.deleteRecursively()
        assertTrue(!root.exists())
        // Reading should not throw — the store must recreate the root.
        assertTrue(store.readCategories().isEmpty())
        assertTrue(root.exists())
    }

    @Test
    fun `size cap evicts oldest files when exceeded`() = runBlocking {
        // Write 10 large article-detail entries; the cap is 8 KB so several
        // should be evicted.
        repeat(10) { idx ->
            val detail = ArticleDetail(
                id = "a-$idx",
                feedId = "f-1",
                guid = "g-$idx",
                canonicalUrl = null,
                title = "Title $idx",
                author = null,
                excerpt = null,
                contentHtml = "<p>" + "x".repeat(2_000) + "</p>",
                contentText = null,
                heroImageUrl = null,
                publishedAt = null,
                fetchedAt = null,
                hash = "h-$idx",
                feedTitle = "f",
                feedFaviconUrl = null,
                feedSiteUrl = null,
                media = emptyList(),
                isRead = false,
                isEnriched = false,
            )
            store.writeArticleDetail(detail)
        }
        val root = File(context.cacheDir, "offline-cache")
        val totalBytes = root.listFiles()?.sumOf { it.length() } ?: 0L
        assertTrue("total bytes should be under the cap", totalBytes <= 8 * 1024L)
    }

    @Test
    fun `writes are atomic (no tmp files left behind)`() = runBlocking {
        store.writeCategories(listOf(sampleCategory(id = "c-1")))
        val root = File(context.cacheDir, "offline-cache")
        val tmpFiles = root.listFiles()?.filter { it.name.endsWith(".tmp") } ?: emptyList()
        assertTrue("no .tmp files should remain after a successful write", tmpFiles.isEmpty())
    }

    private fun sampleCategory(id: String, name: String = "Cat $id"): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = name,
        slug = id,
        sortOrder = 0,
        feedCount = 0,
        unreadCount = 0,
    )

    private fun sampleFeed(id: String, categoryId: String, title: String = "Feed $id"): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed $id",
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = 0,
    )

    private fun sampleArticle(id: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "f-1",
        feedTitle = "F",
        title = "Title $id",
        isRead = false,
    )
}
