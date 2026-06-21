package com.selffeed.android.data.local

import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CompositeOfflineReadStoreTest {
    private val moshi = NetworkModule.provideMoshi()
    private lateinit var localStore: LocalStore
    private lateinit var fileCacheStore: OfflineCacheStore
    private lateinit var store: CompositeOfflineReadStore

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        localStore = LocalStore(context, moshi)
        fileCacheStore = OfflineCacheStore(context, moshi)
        store = CompositeOfflineReadStore(localStore, fileCacheStore)
        runBlocking { store.clearAll() }
    }

    @After
    fun teardown() {
        runBlocking { store.clearAll() }
    }

    @Test
    fun `reads file cache when room has no categories`() = runBlocking {
        fileCacheStore.writeCategories(listOf(sampleCategory("c-file")))

        val categories = store.readCategories()

        assertEquals(listOf("c-file"), categories.map { it.id })
    }

    @Test
    fun `room data takes precedence over file cache`() = runBlocking {
        fileCacheStore.writeCategories(listOf(sampleCategory("c-file")))
        localStore.writeCategories(listOf(sampleCategory("c-room")))

        val categories = store.readCategories()

        assertEquals(listOf("c-room"), categories.map { it.id })
    }

    @Test
    fun `clearing article detail removes room and file copies`() = runBlocking {
        val detail = sampleArticleDetail("a-1")
        localStore.writeArticleDetail(detail)
        fileCacheStore.writeArticleDetail(detail.copy(title = "File title"))

        store.clearArticleDetail("a-1")

        assertNull(localStore.readArticleDetail("a-1"))
        assertNull(fileCacheStore.readArticleDetail("a-1"))
        assertNull(store.readArticleDetail("a-1"))
    }

    @Test
    fun `feed and article invalidation preserves pending read state mutations`() = runBlocking {
        localStore.queueReadStateMutation("a-1", read = true)

        store.clearFeedAndArticleData()

        assertTrue(localStore.readPendingReadStateMutations().isNotEmpty())
    }

    private fun sampleCategory(id: String): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = "Category $id",
        slug = id,
        sortOrder = 0,
        feedCount = 0,
        unreadCount = 0,
    )

    private fun sampleArticleDetail(id: String): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "feed-1",
        guid = id,
        canonicalUrl = "https://example.com/$id",
        title = "Title $id",
        author = null,
        excerpt = null,
        contentHtml = "<p>Body</p>",
        contentText = "Body",
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = null,
        hash = "h-$id",
        feedTitle = "Feed",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = emptyList(),
        isRead = false,
        isEnriched = false,
    )
}
