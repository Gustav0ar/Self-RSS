package com.selffeed.android.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import coil3.ImageLoader
import com.selffeed.android.data.local.LocalDatabase
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineMediaCache
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.SessionRefreshCoordinator
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OfflineContentSyncTest {
    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var database: LocalDatabase
    private lateinit var localStore: LocalStore
    private lateinit var scope: CoroutineScope
    private lateinit var mediaCache: OfflineMediaCache
    private lateinit var repository: RssRepository

    private val onlineFlow = MutableStateFlow(true)
    private val unmeteredFlow = MutableStateFlow(true)
    private val articleRemote = mockk<ArticleRemoteDataSource>(relaxed = true)
    private val feedRemote = mockk<FeedRemoteDataSource>(relaxed = true)
    private val mediaDownloads = AtomicInteger(0)

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val json = NetworkModule.provideJson()
        database = Room.inMemoryDatabaseBuilder(context, LocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        localStore = LocalStore(database, json, Dispatchers.Unconfined)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

        val mediaHttpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                mediaDownloads.incrementAndGet()
                val bytes = byteArrayOf(1, 2, 3, 4, 5, 6)
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .header("Content-Type", "image/webp")
                    .body(bytes.toResponseBody("image/webp".toMediaType()))
                    .build()
            }
            .build()
        mediaCache = OfflineMediaCache(
            rootDir = tempFolder.newFolder("offline-media"),
            httpClient = mediaHttpClient,
        )

        val session = ApiSession(generation = 1L, apiBaseUrl = "https://rss.example/api/v1/", ownerId = "owner-1")
        val sessionStore = mockk<SessionStore>(relaxed = true)
        every { sessionStore.loadedSession() } returns session
        every { sessionStore.currentSession() } returns session
        every { sessionStore.isCurrentSession(any()) } returns true
        every { sessionStore.getApiBaseUrl() } returns session.apiBaseUrl
        every { sessionStore.getAccessToken() } returns "token"
        every { sessionStore.getRefreshCookie() } returns "rss_refresh_token=abc"

        val networkMonitor = object : NetworkMonitor {
            override val online = onlineFlow
            override val unmetered = unmeteredFlow
            override val hasBeenOnline = true
        }

        coEvery { feedRemote.feeds(any(), any()) } returns emptyList()
        coEvery { feedRemote.categories(any()) } returns emptyList()

        repository = RssRepository(
            authRemote = mockk<AuthRemoteDataSource>(relaxed = true),
            feedRemote = feedRemote,
            articleRemote = articleRemote,
            searchRemote = mockk<SearchRemoteDataSource>(relaxed = true),
            settingsRemote = mockk<SettingsRemoteDataSource>(relaxed = true),
            sessionStore = sessionStore,
            sessionRefreshCoordinator = mockk<SessionRefreshCoordinator>(relaxed = true),
            okHttpClient = OkHttpClient(),
            json = json,
            localStore = localStore,
            offlineReadStore = localStore,
            imageRequestContext = context,
            imageLoader = mockk<ImageLoader>(relaxed = true),
            networkMonitor = networkMonitor,
            refreshScope = scope,
            offlineMediaCache = mediaCache,
        )
    }

    @After
    fun tearDown() {
        scope.cancel()
        database.close()
    }

    @Test
    fun `syncOfflineContent downloads missing bodies and inline media incrementally for offline reading`() = runBlocking {
        val a1 = listItem("a1", "First Offline Article")
        val a2 = listItem("a2", "Second Offline Article")
        val d1 = detail(a1, """<p>Body 1</p><img src="https://cdn.example.com/a1.webp" />""")
        val d2 = detail(a2, """<p>Body 2</p><img src="https://cdn.example.com/a2.webp" />""")

        coEvery {
            articleRemote.articles(null, null, false, false, "latest", any(), null, any())
        } returns ApiListResponse(data = listOf(a1, a2), cursor = null, hasMore = false)
        coEvery {
            articleRemote.articles(null, null, false, true, "latest", any(), null, any())
        } returns ApiListResponse(data = emptyList(), cursor = null, hasMore = false)
        coEvery { articleRemote.article("a1", any()) } returns d1
        coEvery { articleRemote.article("a2", any()) } returns d2

        assertTrue(repository.syncOfflineContent())
        assertTrue(mediaCache.contains("https://cdn.example.com/a1.webp"))
        assertTrue(mediaCache.contains("https://cdn.example.com/a2.webp"))
        assertEquals(2, mediaDownloads.get())

        // A second sync pass skips already-cached article bodies and media.
        assertTrue(repository.syncOfflineContent())
        coVerify(exactly = 1) { articleRemote.article("a1", any()) }
        coVerify(exactly = 1) { articleRemote.article("a2", any()) }
        assertEquals(2, mediaDownloads.get())

        // Going completely offline serves both full article text and inline media.
        onlineFlow.value = false
        val offlineArticle = repository.article("a1")
        assertTrue(offlineArticle is AppResult.Success)
        assertEquals(d1.contentHtml, (offlineArticle as AppResult.Success).data.contentHtml)
        assertNotNull(mediaCache.openCachedResponse("https://cdn.example.com/a1.webp"))
    }

    @Test
    fun `syncOfflineContent skips 404 permanently and signals retry on 429 rate limit`() = runBlocking {
        val a1 = listItem("a1", "Deleted Article")
        val a2 = listItem("a2", "Available Article")
        val a3 = listItem("a3", "Rate Limited Article")
        val notFound = HttpException(
            retrofit2.Response.error<Unit>(404, "Not Found".toResponseBody("text/plain".toMediaType())),
        )
        val rateLimited = HttpException(
            retrofit2.Response.error<Unit>(429, "Too Many Requests".toResponseBody("text/plain".toMediaType())),
        )

        coEvery {
            articleRemote.articles(null, null, false, false, "latest", any(), null, any())
        } returns ApiListResponse(data = listOf(a1, a2), cursor = null, hasMore = false)
        coEvery {
            articleRemote.articles(null, null, false, true, "latest", any(), null, any())
        } returns ApiListResponse(data = emptyList(), cursor = null, hasMore = false)
        coEvery { articleRemote.article("a1", any()) } throws notFound
        coEvery { articleRemote.article("a2", any()) } returns detail(a2, "<p>Body 2</p>")

        // 404 on a deleted article does not block completion for healthy articles.
        assertTrue(repository.syncOfflineContent())
        assertEquals(
            "<p>Body 2</p>",
            localStore.readArticleDetail("a2")?.contentHtml,
        )

        // 429 rate limit pauses the batch and signals WorkManager to retry later.
        coEvery {
            articleRemote.articles(null, null, false, false, "latest", any(), null, any())
        } returns ApiListResponse(data = listOf(a3), cursor = null, hasMore = false)
        coEvery { articleRemote.article("a3", any()) } throws rateLimited

        assertFalse("429 should signal WorkManager retry", repository.syncOfflineContent())
    }

    private fun listItem(id: String, title: String) = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Test Feed",
        title = title,
        isRead = false,
    )

    private fun detail(item: ArticleListItem, html: String) = ArticleDetail(
        id = item.id,
        feedId = item.feedId,
        guid = item.id,
        title = item.title,
        contentHtml = html,
        contentText = "Plain text for ${item.title}",
        hash = "hash-${item.id}",
        feedTitle = item.feedTitle,
        isRead = item.isRead,
    )
}
