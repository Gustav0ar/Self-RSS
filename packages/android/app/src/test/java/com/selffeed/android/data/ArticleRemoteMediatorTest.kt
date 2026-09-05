package com.selffeed.android.data

import androidx.paging.LoadType
import androidx.paging.PagingConfig
import androidx.paging.PagingState
import androidx.paging.ExperimentalPagingApi
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import io.mockk.every
import io.mockk.mockk
import retrofit2.HttpException

@OptIn(ExperimentalPagingApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ArticleRemoteMediatorTest {
    private lateinit var store: LocalStore

    @Before
    fun setUp() {
        store = LocalStore(
            context = ApplicationProvider.getApplicationContext(),
            moshi = NetworkModule.provideMoshi(),
        )
        runBlocking { store.clearAll() }
    }

    @After
    fun tearDown() {
        runBlocking { store.clearAll() }
    }

    @Test
    fun `refresh then append stores every page in query order`() = runBlocking {
        val cursors = mutableListOf<String?>()
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = true,
            localStore = store,
            loadPage = { _, cursor ->
                cursors += cursor
                AppResult.Success(
                    if (cursor == null) {
                        ApiListResponse(
                            data = listOf(article("one"), article("two")),
                            cursor = "next-page",
                            hasMore = true,
                        )
                    } else {
                        ApiListResponse(
                            data = listOf(article("three")),
                            cursor = null,
                            hasMore = false,
                        )
                    },
                )
            },
        )

        assertTrue(mediator.load(LoadType.REFRESH, pagingState()) is androidx.paging.RemoteMediator.MediatorResult.Success)
        assertTrue(mediator.load(LoadType.APPEND, pagingState()) is androidx.paging.RemoteMediator.MediatorResult.Success)

        assertEquals(listOf(null, "next-page"), cursors)
        val page = store.articlePagingSource(QUERY_KEY).load(
            androidx.paging.PagingSource.LoadParams.Refresh(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page
        assertEquals(listOf("one", "two", "three"), page.data.map(ArticleListItem::id))
    }

    @Test
    fun `fresh query cache skips the initial network refresh`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = QUERY_KEY,
            payload = ApiListResponse(data = listOf(article("cached")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = false,
            localStore = store,
            loadPage = { _, _ -> error("fresh Room data must not fetch during initialization") },
        )

        assertEquals(
            androidx.paging.RemoteMediator.InitializeAction.SKIP_INITIAL_REFRESH,
            mediator.initialize(),
        )
    }

    @Test
    fun `failed refresh keeps the previously cached queue available offline`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = QUERY_KEY,
            payload = ApiListResponse(data = listOf(article("cached")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = true,
            localStore = store,
            loadPage = { _, _ -> AppResult.Error("network unavailable") },
        )

        assertTrue(mediator.load(LoadType.REFRESH, pagingState()) is androidx.paging.RemoteMediator.MediatorResult.Error)
        val page = store.articlePagingSource(QUERY_KEY).load(
            androidx.paging.PagingSource.LoadParams.Refresh(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page
        assertEquals(listOf("cached"), page.data.map(ArticleListItem::id))
    }

    @Test
    fun `rejected append cursor restarts from page one without exposing an error`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = QUERY_KEY,
            payload = ApiListResponse(data = listOf(article("stale")), cursor = "old-cursor", hasMore = true),
            clearExisting = true,
        )
        val requestedCursors = mutableListOf<String?>()
        val cursorError = mockk<HttpException>().also { every { it.code() } returns 409 }
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = false,
            localStore = store,
            loadPage = { _, cursor ->
                requestedCursors += cursor
                if (cursor != null) {
                    AppResult.Error("Restart pagination", cursorError)
                } else {
                    AppResult.Success(
                        ApiListResponse(data = listOf(article("fresh")), cursor = null, hasMore = false),
                    )
                }
            },
        )

        val result = mediator.load(LoadType.APPEND, pagingState())

        assertTrue(result is androidx.paging.RemoteMediator.MediatorResult.Success)
        assertEquals(listOf("old-cursor", null), requestedCursors)
        val page = store.articlePagingSource(QUERY_KEY).load(
            androidx.paging.PagingSource.LoadParams.Refresh(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        ) as androidx.paging.PagingSource.LoadResult.Page
        assertEquals(listOf("fresh"), page.data.map(ArticleListItem::id))
    }

    @Test
    fun `empty saved refresh removes a saved article left by another client`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = QUERY_KEY,
            payload = ApiListResponse(data = listOf(article("removed-save").copy(isSaved = true)), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = true,
            localStore = store,
            loadPage = { _, _ -> AppResult.Success(ApiListResponse(data = emptyList(), cursor = null, hasMore = false)) },
            onCompletedRefresh = ::confirmRemovals,
        )

        mediator.load(LoadType.REFRESH, pagingState())

        val saved = store.savedArticlePagingSource().load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as androidx.paging.PagingSource.LoadResult.Page
        assertTrue(saved.data.isEmpty())
    }

    @Test
    fun `partial and failed saved pages preserve membership until a restarted mediator finishes`() = runBlocking {
        store.writeArticleRemotePage(
            QUERY_KEY,
            ApiListResponse(data = listOf(article("removed-save").copy(isSaved = true)), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = true,
            localStore = store,
            loadPage = { _, cursor ->
                if (cursor == null) AppResult.Success(
                    ApiListResponse(data = listOf(article("first").copy(isSaved = true)), cursor = "next", hasMore = true),
                ) else AppResult.Error("offline")
            },
            onCompletedRefresh = ::confirmRemovals,
        )
        mediator.load(LoadType.REFRESH, pagingState())
        assertTrue(savedIds().contains("removed-save"))
        assertTrue(mediator.load(LoadType.APPEND, pagingState()) is androidx.paging.RemoteMediator.MediatorResult.Error)
        assertTrue(savedIds().contains("removed-save"))

        store = LocalStore(ApplicationProvider.getApplicationContext(), NetworkModule.provideMoshi())
        val restarted = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = false,
            localStore = store,
            loadPage = { _, cursor ->
                assertEquals("next", cursor)
                AppResult.Success(ApiListResponse(data = listOf(article("last").copy(isSaved = true)), cursor = null, hasMore = false))
            },
            onCompletedRefresh = ::confirmRemovals,
        )
        restarted.load(LoadType.APPEND, pagingState())

        assertEquals(setOf("first", "last"), savedIds())
    }

    @Test
    fun `failed membership confirmation can retry after the last page is persisted`() = runBlocking {
        var confirmations = 0
        var pageLoads = 0
        val mediator = ArticleRemoteMediator(
            queryKey = QUERY_KEY,
            forceInitialRefresh = true,
            localStore = store,
            loadPage = { _, _ ->
                pageLoads++
                AppResult.Success(ApiListResponse(data = emptyList(), cursor = null, hasMore = false))
            },
            onCompletedRefresh = {
                confirmations++
                if (confirmations == 1) AppResult.Error("confirmation unavailable") else AppResult.Success(Unit)
            },
        )

        assertTrue(mediator.load(LoadType.REFRESH, pagingState()) is androidx.paging.RemoteMediator.MediatorResult.Error)
        assertTrue(mediator.load(LoadType.APPEND, pagingState()) is androidx.paging.RemoteMediator.MediatorResult.Success)
        assertEquals(2, confirmations)
        assertEquals(1, pageLoads)
    }

    private suspend fun confirmRemovals(): AppResult<Unit> {
        store.savedArticlesMissingFromQuery(QUERY_KEY).forEach { store.clearSavedStateIfUnchanged(it) }
        return AppResult.Success(Unit)
    }

    private suspend fun savedIds(): Set<String> {
        val page = store.savedArticlePagingSource().load(
            androidx.paging.PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as androidx.paging.PagingSource.LoadResult.Page
        return page.data.map(ArticleListItem::id).toSet()
    }

    private fun pagingState(): PagingState<Int, ArticleListItem> = PagingState(
        pages = emptyList(),
        anchorPosition = null,
        config = PagingConfig(pageSize = 30),
        leadingPlaceholderCount = 0,
    )

    private fun article(id: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = "Article $id",
        isRead = false,
    )

    private companion object {
        const val QUERY_KEY = "articles:test-query"
    }
}
