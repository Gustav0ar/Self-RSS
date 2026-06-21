package com.selffeed.android.data.local

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.ArticlePageQuery
import com.selffeed.android.data.remoteKey
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.NetworkModule
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

/**
 * Round-trip tests for [LocalStore]. The store uses [androidx.sqlite] under
 * the hood; the tests verify that data survives a write/read cycle and
 * that the per-table clear semantics work.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class LocalStoreTest {
    // Use the production Moshi which includes the reflective
    // KotlinJsonAdapterFactory as a fallback for DTOs whose generated
    // adapters aren't on the test classpath. Without this fallback the
    // generated-adapter lookup fails for every payload in this test.
    private val moshi = NetworkModule.provideMoshi()
    private lateinit var store: LocalStore

    @Before
    fun setup() {
        store = LocalStore(ApplicationProvider.getApplicationContext(), moshi)
        runBlocking { store.clearAll() }
    }

    @After
    fun teardown() {
        runBlocking { store.clearAll() }
    }

    @Test
    fun `categories write and read round-trip`() = runBlocking {
        val cats = listOf(
            sampleCategory("c-1", "Tech"),
            sampleCategory("c-2", "News"),
        )
        store.writeCategories(cats)
        val read = store.readCategories()
        assertEquals(2, read.size)
        assertEquals("Tech", read[0].name)
    }

    @Test
    fun `feeds write and read round-trip`() = runBlocking {
        val feeds = listOf(sampleFeed("f-1", "c-1"))
        store.writeFeeds(feeds)
        val read = store.readFeeds()
        assertEquals(1, read.size)
        assertEquals("f-1", read[0].id)
    }

    @Test
    fun `articles write and read round-trip`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(sampleArticle("a-1")),
            cursor = "next-cursor",
            hasMore = true,
        )
        store.writeArticles("key-1", payload)
        val read = store.readArticles("key-1")
        assertNotNull(read)
        assertEquals(1, read!!.data.size)
        assertEquals("next-cursor", read.cursor)
        assertTrue(read.hasMore)
    }

    @Test
    fun `article remote page writes query entries and remote key`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(sampleArticle("a-1"), sampleArticle("a-2")),
            cursor = "next-cursor",
            hasMore = true,
        )

        store.writeArticleRemotePage(
            queryKey = "query-1",
            payload = payload,
            clearExisting = true,
        )

        val remoteKey = store.readArticleRemoteKey("query-1")
        assertNotNull(remoteKey)
        assertEquals("next-cursor", remoteKey!!.nextCursor)

        val result = store.articlePagingSource("query-1").load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertEquals(listOf("a-1", "a-2"), page.data.map { it.id })
    }

    @Test
    fun `article page query remote key is stable across refresh generations`() {
        val base = ArticlePageQuery(feedId = "feed-1", unreadOnly = true, sort = "newest", generation = 1)
        val refreshed = base.copy(generation = 2)

        assertEquals(base.remoteKey(), refreshed.remoteKey())
    }

    @Test
    fun `queued read state updates article row and can be cleared`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(sampleArticle("a-1")),
            cursor = null,
            hasMore = false,
        )
        store.writeArticleRemotePage(
            queryKey = "query-read-state",
            payload = payload,
            clearExisting = true,
        )

        store.queueReadStateMutation("a-1", read = true)

        val pending = store.readPendingReadStateMutations()
        assertEquals(1, pending.size)
        assertEquals("a-1", pending.first().articleId)
        assertTrue(pending.first().read)

        val result = store.articlePagingSource("query-read-state").load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertTrue(page.data.first().isRead)

        store.deletePendingReadStateMutation("a-1")
        assertTrue(store.readPendingReadStateMutations().isEmpty())
    }

    @Test
    fun `read state update keeps article in existing paging query`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(sampleArticle("a-1")),
            cursor = null,
            hasMore = false,
        )
        store.writeArticleRemotePage(
            queryKey = "query-retained-read",
            payload = payload,
            clearExisting = true,
        )

        store.updateArticleReadState("a-1", read = true)

        val result = store.articlePagingSource("query-retained-read").load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertEquals(listOf("a-1"), page.data.map { it.id })
        assertTrue(page.data.first().isRead)
    }

    @Test
    fun `feed read state update keeps matching article rows in existing paging queries`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(
                sampleArticle("a-1", feedId = "f-1"),
                sampleArticle("a-2", feedId = "f-2"),
            ),
            cursor = null,
            hasMore = false,
        )
        store.writeArticleRemotePage(
            queryKey = "query-feed-read-state",
            payload = payload,
            clearExisting = true,
        )

        store.markArticlesReadByFeeds(setOf("f-1"))

        val result = store.articlePagingSource("query-feed-read-state").load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertEquals(listOf("a-1", "a-2"), page.data.map { it.id })
        assertEquals(true, page.data.first { it.id == "a-1" }.isRead)
        assertEquals(false, page.data.first { it.id == "a-2" }.isRead)
    }

    @Test
    fun `clearing article cache preserves pending read state mutations`() = runBlocking {
        val payload = ApiListResponse(
            data = listOf(sampleArticle("a-1")),
            cursor = null,
            hasMore = false,
        )
        store.writeArticleRemotePage(
            queryKey = "query-read-state",
            payload = payload,
            clearExisting = true,
        )
        store.queueReadStateMutation("a-1", read = true)

        store.clearTable(LocalStore.TABLE_ARTICLES)

        val pending = store.readPendingReadStateMutations()
        assertEquals(1, pending.size)
        assertEquals("a-1", pending.first().articleId)
        assertTrue(pending.first().read)
    }

    @Test
    fun `article detail write and read round-trip`() = runBlocking {
        val detail = sampleDetail("a-1")
        store.writeArticleDetail(detail)
        val read = store.readArticleDetail("a-1")
        assertNotNull(read)
        assertEquals("a-1", read!!.id)
    }

    @Test
    fun `clearTable drops only the targeted table`() = runBlocking {
        store.writeCategories(listOf(sampleCategory("c-1", "Tech")))
        store.writeFeeds(listOf(sampleFeed("f-1", "c-1")))
        store.clearTable(LocalStore.TABLE_CATEGORIES)
        assertTrue(store.readCategories().isEmpty())
        // The feeds row is unaffected.
        assertEquals(1, store.readFeeds().size)
    }

    @Test
    fun `clearAll empties every table`() = runBlocking {
        store.writeCategories(listOf(sampleCategory("c-1", "Tech")))
        store.writeFeeds(listOf(sampleFeed("f-1", "c-1")))
        store.writeArticleDetail(sampleDetail("a-1"))
        store.clearAll()
        assertTrue(store.readCategories().isEmpty())
        assertTrue(store.readFeeds().isEmpty())
        assertNull(store.readArticleDetail("a-1"))
    }

    @Test
    fun `clearTable with unknown table is a no-op`() = runBlocking {
        store.writeCategories(listOf(sampleCategory("c-1", "Tech")))
        // Unknown table name — must not delete anything.
        store.clearTable("not-a-table")
        assertEquals(1, store.readCategories().size)
    }

    private fun sampleCategory(id: String, name: String): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = name,
        slug = id,
        sortOrder = 0,
        feedCount = 0,
        unreadCount = 0,
    )

    private fun sampleFeed(id: String, categoryId: String): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed $id",
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = 0,
    )

    private fun sampleArticle(id: String, feedId: String = "f-1"): ArticleListItem = ArticleListItem(
        id = id,
        feedId = feedId,
        feedTitle = "F",
        title = "T",
        isRead = false,
    )

    private fun sampleDetail(id: String): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "f-1",
        guid = id,
        canonicalUrl = null,
        title = "T",
        author = null,
        excerpt = null,
        contentHtml = null,
        contentText = null,
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = null,
        hash = id,
        feedTitle = "F",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = emptyList(),
        isRead = false,
        isEnriched = false,
    )
}
