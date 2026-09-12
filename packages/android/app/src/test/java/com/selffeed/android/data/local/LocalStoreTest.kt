package com.selffeed.android.data.local

import androidx.paging.PagingSource
import androidx.room.Room
import android.content.Context
import java.util.UUID
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertFalse
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
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val databaseName = "state-store-${UUID.randomUUID()}"
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    @Volatile private var captureQueries = false
    private val queries = java.util.concurrent.CopyOnWriteArrayList<String>()

    @Before
    fun setup() {
        store = openStore()
    }

    @After
    fun teardown() {
        database.close()
        context.deleteDatabase(databaseName)
    }

    private fun openStore(): LocalStore {
        database = Room.databaseBuilder(context, LocalDatabase::class.java, databaseName)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS)
            .setQueryCallback({ query, _ -> if (captureQueries) queries += query }, java.util.concurrent.Executor { it.run() })
            .build()
        return LocalStore(database, moshi)
    }

    private fun reopenStore(): LocalStore {
        database.close()
        return openStore().also { store = it }
    }

    @Test
    fun `an older read receipt cannot replace newer state or lower the next mutation revision`() = runBlocking {
        store.writeArticleDetail(sampleDetail("ordered-read"))
        store.updateArticleReadState("ordered-read", true, revision = 10)

        assertEquals(true, store.updateArticleReadState("ordered-read", false, revision = 9))
        assertEquals(true, store.readArticleDetail("ordered-read")?.isRead)
        assertEquals(10, store.queueReadStateMutation("ordered-read", false).baseRevision)
    }

    @Test
    fun `an older saved receipt cannot replace newer state or lower the next mutation revision`() = runBlocking {
        store.writeArticleDetail(sampleDetail("ordered-save"))
        store.updateArticleSavedState("ordered-save", true, revision = 10)

        assertEquals(true, store.updateArticleSavedState("ordered-save", false, revision = 9))
        assertEquals(true, store.readArticleDetail("ordered-save")?.isSaved)
        assertEquals(10, store.queueSavedStateMutation("ordered-save", false).baseRevision)
    }

    @Test
    fun `an acknowledgement cannot replace a newer server state received while its mutation was pending`() = runBlocking {
        store.writeArticleDetail(sampleDetail("ordered-ack"))
        val read = store.queueReadStateMutation("ordered-ack", true)
        val saved = store.queueSavedStateMutation("ordered-ack", true)
        store.updateArticleReadState("ordered-ack", false, revision = 20)
        store.updateArticleSavedState("ordered-ack", false, revision = 20)

        store.acknowledgeReadStateMutation(read, true, revision = 19)
        store.acknowledgeSavedStateMutation(saved, true, revision = 19)

        assertTrue(store.readPendingReadStateMutations().isEmpty())
        assertTrue(store.readPendingSavedStateMutations().isEmpty())
        assertEquals(false, store.readArticleDetail("ordered-ack")?.isRead)
        assertEquals(false, store.readArticleDetail("ordered-ack")?.isSaved)
        assertEquals(20, store.queueReadStateMutation("ordered-ack", true).baseRevision)
        assertEquals(20, store.queueSavedStateMutation("ordered-ack", true).baseRevision)
    }

    @Test
    fun `a stale or unversioned snapshot cannot undo a confirmed state after reopening`() = runBlocking {
        store.writeArticleDetail(sampleDetail("snapshot").copy(isRead = true, isSaved = true, readRevision = 10, savedRevision = 10))
        reopenStore()
        store.writeArticleDetail(sampleDetail("snapshot").copy(readRevision = 9, savedRevision = 9))
        store.writeArticleDetail(sampleDetail("snapshot"))

        assertEquals(true, store.readArticleDetail("snapshot")?.isRead)
        assertEquals(true, store.readArticleDetail("snapshot")?.isSaved)
        assertEquals(10, store.queueReadStateMutation("snapshot", false).baseRevision)
        assertEquals(10, store.queueSavedStateMutation("snapshot", false).baseRevision)
    }

    @Test
    fun `an old conflict cannot rebase a newer local intent or lower its known revision`() = runBlocking {
        store.writeArticleDetail(sampleDetail("conflict"))
        val oldRead = store.queueReadStateMutation("conflict", true)
        val oldSaved = store.queueSavedStateMutation("conflict", true)
        store.updateArticleReadState("conflict", true, 20)
        store.updateArticleSavedState("conflict", true, 20)
        val newRead = store.queueReadStateMutation("conflict", false)
        val newSaved = store.queueSavedStateMutation("conflict", false)

        store.rebaseReadStateMutation(oldRead, 10)
        store.rebaseSavedStateMutation(oldSaved, 10)

        assertEquals(newRead, store.readPendingReadStateMutations().single())
        assertEquals(newSaved, store.readPendingSavedStateMutations().single())
        assertEquals(20, newRead.baseRevision)
        assertEquals(20, newSaved.baseRevision)
    }

    @Test
    fun `page and search snapshots preserve known revisions and update existing offline bodies`() = runBlocking {
        store.writeArticleDetail(sampleDetail("snapshots").copy(contentText = "Keep this body", contentHtml = "<p>Keep this body</p>"))
        val fresh = sampleArticle("snapshots").copy(isRead = true, isSaved = true, readRevision = 20, savedRevision = 20)
        store.writeArticleRemotePage("state-page", ApiListResponse(listOf(fresh), null, false), true)
        val stale = fresh.copy(isRead = false, isSaved = false, readRevision = 19, savedRevision = null)
        val effective = store.reconcileArticleSnapshots(listOf(stale)).single()
        assertEquals(true, effective.isRead)
        assertEquals(true, effective.isSaved)
        assertEquals(20, effective.savedRevision)
        reopenStore()
        val detail = requireNotNull(store.readArticleDetail(fresh.id))
        assertEquals(true, detail.isRead)
        assertEquals(true, detail.isSaved)
        assertEquals("Keep this body", detail.contentText)
        assertEquals("<p>Keep this body</p>", detail.contentHtml)
    }

    @Test
    fun `bulk receipt cannot replace versioned unread state or its rejection baseline`() = runBlocking {
        store.writeArticleDetail(sampleDetail("bulk-versioned").copy(readRevision = 20))
        val pending = store.queueReadStateMutation("bulk-versioned", false)
        val result = store.markArticlesReadByFeeds(setOf("f-1"))
        assertEquals(mapOf("bulk-versioned" to "f-1"), result.unreadArticleFeeds)
        assertEquals(false, store.readPendingReadStateMutations().single().previousState)
        assertEquals(false, store.discardReadStateMutation(pending).effectiveState)
        reopenStore()
        assertEquals(false, store.readArticleDetail("bulk-versioned")?.isRead)
        assertEquals(true, store.updateArticleReadState("bulk-versioned", true, 21))
    }

    @Test
    fun `unknown legacy rejection does not promote the rejected optimistic projection`() = runBlocking {
        store.writeArticleDetail(sampleDetail("legacy-unknown").copy(isRead = true, isSaved = true))
        val dao = database.localStoreDao()
        dao.upsertArticleStateRevision(ArticleStateRevisionEntity("legacy-unknown", null, null))
        val read = store.queueReadStateMutation("legacy-unknown", true)
        val saved = store.queueSavedStateMutation("legacy-unknown", true)
        assertEquals(ArticleStateMutationResult(true, null), store.discardReadStateMutation(read))
        assertEquals(ArticleStateMutationResult(true, null), store.discardSavedStateMutation(saved))
        reopenStore()
        assertNotNull(store.readArticleDetail("legacy-unknown"))
        assertNull(store.queueReadStateMutation("legacy-unknown", false).previousState)
        assertNull(store.queueSavedStateMutation("legacy-unknown", false).previousState)
    }

    @Test
    fun `legacy revision without confirmed value keeps readable content until an equal version hydrates it`() = runBlocking {
        database.localStoreDao().upsertArticleStateRevision(ArticleStateRevisionEntity("legacy-version", 20, 20))
        store.writeArticleDetail(sampleDetail("legacy-version").copy(contentText = "Readable", readRevision = 19, savedRevision = 19))
        store.writeArticleDetail(sampleDetail("legacy-version").copy(contentText = "Still readable"))
        assertEquals("Still readable", store.readArticleDetail("legacy-version")?.contentText)
        val pending = store.queueReadStateMutation("legacy-version", false)
        assertEquals(20, pending.baseRevision)
        assertNull(pending.previousState)
        assertEquals(ArticleStateMutationResult(true, null), store.discardReadStateMutation(pending))
        assertEquals(true, store.updateArticleReadState("legacy-version", true, 20))
        assertEquals(true, store.updateArticleSavedState("legacy-version", true, 20))
        reopenStore()
        assertEquals(true, store.readArticleDetail("legacy-version")?.isRead)
        assertEquals(true, store.readArticleDetail("legacy-version")?.isSaved)
    }

    @Test
    fun `an obsolete conflict learns the new baseline without replacing the latest intent id`() = runBlocking {
        store.writeArticleDetail(sampleDetail("late-conflict"))
        val old = store.queueReadStateMutation("late-conflict", true)
        val current = store.queueReadStateMutation("late-conflict", false)
        store.rebaseReadStateMutation(old, 30, read = true)
        val remaining = store.readPendingReadStateMutations().single()
        assertEquals(current.mutationId, remaining.mutationId)
        assertEquals(false, remaining.read)
        assertEquals(true, remaining.previousState)
        assertEquals(true, store.discardReadStateMutation(current).effectiveState)
        assertEquals(true, store.readArticleDetail("late-conflict")?.isRead)
    }

    @Test
    fun `rejected stale search metadata does not invalidate a loaded paging source`() = runBlocking {
        val article = sampleArticle("stable-page").copy(readRevision = 20, savedRevision = 20)
        store.writeArticleRemotePage("stable", ApiListResponse(listOf(article), null, false), true)
        val source = store.articlePagingSource("stable", ownerId = null)
        source.load(PagingSource.LoadParams.Refresh<Int>(null, 30, false))
        store.reconcileArticleSnapshots(listOf(article))
        store.reconcileArticleSnapshots(listOf(article.copy(isRead = true, isSaved = true, readRevision = 19, savedRevision = 19)))
        database.invalidationTracker.refreshVersionsSync()
        assertFalse(source.invalid)
    }

    @Test
    fun `unchanged and stale metadata pages do not read or rewrite cached body bytes`() = runBlocking {
        val body = "<p>Cached reader body</p>".repeat(8_192)
        val articles = (1..20).map { index ->
            val id = "large-body-$index"
            store.writeArticleDetail(sampleDetail(id).copy(contentHtml = body, readRevision = 20, savedRevision = 20))
            sampleArticle(id).copy(readRevision = 20, savedRevision = 20)
        }
        captureQueries = true
        try {
            store.writeArticleRemotePage("metadata", ApiListResponse(articles, null, false), true)
            store.reconcileArticleSnapshots(articles.map { it.copy(readRevision = 19, savedRevision = null) })
        } finally { captureQueries = false }
        assertTrue("Metadata reconciliation traversed body bytes: ${queries.filter { it.contains("article_details") }}",
            queries.none { it.startsWith("SELECT * FROM article_details") || it.startsWith("INSERT OR REPLACE INTO `article_details`") })
    }

    @Test
    fun `bulk initialization preserves a legacy pending save baseline without a revision row`() = runBlocking {
        store.writeArticleDetail(sampleDetail("legacy-bulk-save").copy(isSaved = true))
        val pending = store.queueSavedStateMutation("legacy-bulk-save", false)
        database.localStoreDao().clearArticleStateRevisions()
        store.markArticlesReadByFeeds(setOf("f-1"))
        assertEquals(true, store.discardSavedStateMutation(pending).effectiveState)
        assertEquals(true, store.readArticleDetail("legacy-bulk-save")?.isSaved)
    }

    @Test
    fun `bulk initialization preserves a saved legacy body without an article row`() = runBlocking {
        store.writeArticleDetail(sampleDetail("legacy-bulk-body").copy(isSaved = true))
        database.localStoreDao().clearArticleStateRevisions()
        store.markArticlesReadByFeeds(setOf("f-1"))
        val pending = store.queueSavedStateMutation("legacy-bulk-body", false)
        assertEquals(true, pending.previousState)
        assertEquals(true, store.discardSavedStateMutation(pending).effectiveState)
        assertEquals(true, store.readArticleDetail("legacy-bulk-body")?.isSaved)
    }

    @Test
    fun `active status collectors follow committed outbox changes`() = runBlocking {
        val counts = Channel<Int>(Channel.UNLIMITED)
        val collector = launch { store.observePendingArticleChanges().collect { counts.send(it) } }
        try {
            assertEquals(0, withTimeout(5_000) { counts.receive() })
            val mutation = store.queueSavedStateMutation("a-1", true)
            assertEquals(1, withTimeout(5_000) { counts.receive() })
            store.acknowledgeSavedStateMutation(mutation, true, 1)
            assertEquals(0, withTimeout(5_000) { counts.receive() })
        } finally {
            collector.cancel()
            counts.close()
        }
    }

    @Test
    fun `pending status counts durable coalesced read and save intentions until acknowledgement`() = runBlocking {
        assertEquals(0, store.observePendingArticleChanges().first())
        val firstRead = store.queueReadStateMutation("a-1", true)
        val newestRead = store.queueReadStateMutation("a-1", false)
        val save = store.queueSavedStateMutation("a-1", true)
        assertEquals(2, store.observePendingArticleChanges().first())

        val reopened = reopenStore()
        assertEquals(2, reopened.observePendingArticleChanges().first())
        reopened.acknowledgeReadStateMutation(firstRead, true, 1)
        assertEquals(2, reopened.observePendingArticleChanges().first())
        reopened.acknowledgeReadStateMutation(newestRead, false, 2)
        assertEquals(1, reopened.observePendingArticleChanges().first())
        reopened.acknowledgeSavedStateMutation(save, true, 1)
        assertEquals(0, reopened.observePendingArticleChanges().first())
    }

    @Test
    fun `offline text availability requires persisted body and does not follow saved state`() = runBlocking {
        assertFalse(store.observeArticleTextAvailability("a-1").first())
        store.writeArticleDetail(sampleDetail("a-1").copy(isSaved = true, excerpt = "Summary only"))
        assertFalse(store.observeArticleTextAvailability("a-1").first())
        for (mediaOnlyHtml in listOf(
            "<img src='https://example.com/image.jpg' alt='Remote image'>",
            "<iframe src='https://example.com/video'></iframe>",
            "<video src='https://example.com/video.mp4'>Remote video fallback</video>",
            "<script>remotePlayer()</script><style>body { color: white; }</style>",
            "<p>&nbsp; </p>",
        )) {
            store.writeArticleDetail(sampleDetail("a-1").copy(isSaved = true, contentHtml = mediaOnlyHtml))
            assertFalse(store.observeArticleTextAvailability("a-1").first())
        }
        store.writeArticleDetail(sampleDetail("a-1").copy(contentText = "Downloaded body", isSaved = false))
        assertTrue(store.observeArticleTextAvailability("a-1").first())

        val reopened = reopenStore()
        assertTrue(reopened.observeArticleTextAvailability("a-1").first())
        reopened.writeArticleDetail(sampleDetail("a-1").copy(contentHtml = "<p>Downloaded HTML body</p>"))
        assertTrue(reopened.observeArticleTextAvailability("a-1").first())
        reopened.clearTable(LocalStore.TABLE_ARTICLE_DETAILS)
        assertFalse(reopened.observeArticleTextAvailability("a-1").first())
    }

    @Test
    fun `new account starts without old queue or offline text availability`() = runBlocking {
        store.writeArticleDetail(sampleDetail("a-1").copy(contentText = "Private text"))
        store.queueSavedStateMutation("a-1", true)
        store.clearAll()
        assertEquals(0, store.observePendingArticleChanges().first())
        assertFalse(store.observeArticleTextAvailability("a-1").first())
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
        val feeds = listOf(
            sampleFeed(
                id = "f-1",
                categoryId = "c-1",
                syncStatus = "error",
                lastSyncError = "HTTP 403: Forbidden",
                lastSyncErrorAt = "2026-06-23T09:00:00.000Z",
            ),
        )
        store.writeFeeds(feeds)
        val read = store.readFeeds()
        assertEquals(1, read.size)
        assertEquals("f-1", read[0].id)
        assertEquals("HTTP 403: Forbidden", read[0].lastSyncError)
        assertEquals("2026-06-23T09:00:00.000Z", read[0].lastSyncErrorAt)
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

        val result = store.articlePagingSource("query-1", ownerId = null).load(
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
    fun `queued read state persists and updates the canonical article row`() = runBlocking {
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

        val pagingSource = store.articlePagingSource("query-read-state", ownerId = null)
        pagingSource.load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        store.queueReadStateMutation("a-1", read = true)

        val pending = store.readPendingReadStateMutations()
        assertEquals(1, pending.size)
        assertEquals("a-1", pending.first().articleId)
        assertTrue(pending.first().read)

        assertEquals(mapOf("a-1" to true), store.readArticleReadOverrides())
        assertEquals(true, pagingSource.invalid)

        val result = store.articlePagingSource("query-read-state", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertEquals(true, page.data.first().isRead)

        store.deletePendingReadStateMutation("a-1")
        assertTrue(store.readPendingReadStateMutations().isEmpty())
    }

    @Test
    fun `acknowledged read state clears pending mutation and durable override atomically`() = runBlocking {
        store.queueReadStateMutation("a-1", read = true)

        store.acknowledgeReadStateMutation("a-1")

        assertTrue(store.readPendingReadStateMutations().isEmpty())
        assertTrue(store.readArticleReadOverrides().isEmpty())
    }

    @Test
    fun `rapid read toggles keep the newest intent when an older response arrives`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = "query-toggle",
            payload = ApiListResponse(data = listOf(sampleArticle("a-toggle")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val first = store.queueReadStateMutation("a-toggle", read = true)
        val newest = store.queueReadStateMutation("a-toggle", read = false)

        store.acknowledgeReadStateMutation(first, read = true, revision = 1)

        val pending = store.readPendingReadStateMutations().single()
        assertEquals(newest.mutationId, pending.mutationId)
        assertEquals(false, pending.read)
        val page = store.articlePagingSource("query-toggle", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(false, page.data.single().isRead)
    }

    @Test
    fun `saved intent survives offline and acknowledgement stores its revision`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = "query-save",
            payload = ApiListResponse(data = listOf(sampleArticle("a-save")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val mutation = store.queueSavedStateMutation("a-save", saved = true)

        assertEquals(true, store.readPendingSavedStateMutations().single().saved)
        store.acknowledgeSavedStateMutation(mutation, saved = true, revision = 7)

        assertTrue(store.readPendingSavedStateMutations().isEmpty())
        val page = store.articlePagingSource("query-save", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(true, page.data.single().isSaved)
        val savedPage = store.savedArticlePagingSource(ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(listOf("a-save"), savedPage.data.map { it.id })
    }

    @Test
    fun `saving a detail-only article adds it to the offline saved collection`() = runBlocking {
        store.writeArticleDetail(sampleDetail("a-detail-save"))

        store.queueSavedStateMutation("a-detail-save", saved = true)

        val page = store.savedArticlePagingSource(ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(listOf("a-detail-save"), page.data.map { it.id })
    }

    @Test
    fun `rejecting an older save cannot discard or roll back a newer intent`() = runBlocking {
        store.writeArticleDetail(sampleDetail("newer-save"))
        val old = store.queueSavedStateMutation("newer-save", saved = true)
        val current = store.queueSavedStateMutation("newer-save", saved = false)

        assertFalse(store.discardSavedStateMutation(old).removedMatchingIntent)
        assertEquals(current.mutationId, store.readPendingSavedStateMutations().single().mutationId)
        assertEquals(false, store.readArticleDetail("newer-save")?.isSaved)
    }

    @Test
    fun `rejected detail only save restores the state before inserting its article row`() = runBlocking {
        store.writeArticleDetail(sampleDetail("detail-only-rollback"))
        val mutation = store.queueSavedStateMutation("detail-only-rollback", saved = true)

        assertEquals(false, mutation.previousState)
        store.discardSavedStateMutation(mutation)

        assertEquals(false, store.readArticleDetail("detail-only-rollback")?.isSaved)
        val page = store.savedArticlePagingSource(ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertTrue(page.data.isEmpty())
    }

    @Test
    fun `permanently rejected saved intent restores its pre mutation state`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = "query-save-rollback",
            payload = ApiListResponse(data = listOf(sampleArticle("a-save")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        store.writeArticleDetail(sampleDetail("a-save"))
        val mutation = store.queueSavedStateMutation("a-save", saved = true)

        assertEquals(false, mutation.previousState)
        assertEquals(true, store.readArticleDetail("a-save")?.isSaved)
        store.discardSavedStateMutation(mutation)

        assertTrue(store.readPendingSavedStateMutations().isEmpty())
        assertEquals(false, store.readArticleDetail("a-save")?.isSaved)
        val page = store.articlePagingSource("query-save-rollback", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(false, page.data.single().isSaved)
    }

    @Test
    fun `realtime acknowledgement does not clear an unsent offline override`() = runBlocking {
        store.queueReadStateMutation("a-1", read = true)

        store.clearAcknowledgedReadStateOverride("a-1")

        assertEquals(mapOf("a-1" to true), store.readArticleReadOverrides())
        assertEquals(1, store.readPendingReadStateMutations().size)
    }

    @Test
    fun `bulk acknowledgement clears server-confirmed overrides but preserves pending mutations`() = runBlocking {
        store.queueReadStateMutation("a-pending", read = true)
        store.updateArticleReadState("a-acknowledged", read = true)

        store.clearAcknowledgedReadStateOverrides()

        assertEquals(mapOf("a-pending" to true), store.readArticleReadOverrides())
        assertEquals(listOf("a-pending"), store.readPendingReadStateMutations().map { it.articleId })
    }

    @Test
    fun `remote read state updates the canonical row without leaving an overlay`() = runBlocking {
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

        val pagingSource = store.articlePagingSource("query-retained-read", ownerId = null)
        pagingSource.load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        store.updateArticleReadState("a-1", read = true)

        assertTrue(store.readArticleReadOverrides().isEmpty())
        val result = store.articlePagingSource("query-retained-read", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertEquals(listOf("a-1"), page.data.map { it.id })
        assertEquals(true, page.data.first().isRead)
    }

    @Test
    fun `foreign state events preserve newer local read and saved intents`() = runBlocking {
        store.writeArticleRemotePage(
            queryKey = "query-concurrent",
            payload = ApiListResponse(data = listOf(sampleArticle("a-1")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        store.queueReadStateMutation("a-1", read = true)
        store.queueSavedStateMutation("a-1", saved = true)

        val visibleRead = store.updateArticleReadState("a-1", read = false, revision = 3)
        val visibleSaved = store.updateArticleSavedState("a-1", saved = false, revision = 4)

        assertEquals(true, visibleRead)
        assertEquals(true, visibleSaved)
        assertEquals(true, store.readPendingReadStateMutations().single().read)
        assertEquals(false, store.readPendingReadStateMutations().single().previousState)
        assertEquals(true, store.readPendingSavedStateMutations().single().saved)
        assertEquals(false, store.readPendingSavedStateMutations().single().previousState)
        val page = store.articlePagingSource("query-concurrent", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(true, page.data.single().isRead)
        assertEquals(true, page.data.single().isSaved)

        store.writeArticleRemotePage(
            queryKey = "query-concurrent",
            payload = ApiListResponse(data = listOf(sampleArticle("a-1")), cursor = null, hasMore = false),
            clearExisting = true,
        )
        val refreshedPage = store.articlePagingSource("query-concurrent", ownerId = null).load(
            PagingSource.LoadParams.Refresh<Int>(key = null, loadSize = 30, placeholdersEnabled = false),
        ) as PagingSource.LoadResult.Page
        assertEquals(true, refreshedPage.data.single().isRead)
        assertEquals(true, refreshedPage.data.single().isSaved)
    }

    @Test
    fun `network detail writes preserve queued local state`() = runBlocking {
        store.queueReadStateMutation("a-detail", read = true)
        store.queueSavedStateMutation("a-detail", saved = true)

        store.writeArticleDetail(sampleDetail("a-detail"))

        assertEquals(true, store.readArticleDetail("a-detail")?.isRead)
        assertEquals(true, store.readArticleDetail("a-detail")?.isSaved)
    }

    @Test
    fun `feed cache invalidation preserves saved article detail`() = runBlocking {
        store.writeArticleDetail(sampleDetail("a-saved").copy(isSaved = true))

        store.clearFeedAndArticleData()

        assertEquals(true, store.readArticleDetail("a-saved")?.isSaved)
    }

    @Test
    fun `repeated bulk receipts keep queued choices`() = runBlocking {
        val pendingRead = sampleArticle("pending-read", feedId = "f-1").copy(isRead = false)
        val pendingUnread = sampleArticle("pending-unread", feedId = "f-1").copy(isRead = true)
        val other = sampleArticle("other", feedId = "f-2")
        store.writeArticleRemotePage("bulk", ApiListResponse(listOf(pendingRead, pendingUnread, other), null, false), true)
        store.queueReadStateMutation(pendingRead.id, true)
        store.queueReadStateMutation(pendingUnread.id, false)

        val first = store.markArticlesReadByFeeds(setOf("f-1"))
        assertEquals(mapOf(pendingUnread.id to "f-1"), first.unreadArticleFeeds)
        assertEquals(mapOf(pendingRead.id to true, pendingUnread.id to false), store.readArticleReadOverrides())
        assertTrue(store.readPendingReadStateMutations().all { it.previousState == true })

        val repeated = store.markArticlesReadByFeeds(setOf("f-1"))
        assertEquals(first.unreadArticleFeeds, repeated.unreadArticleFeeds)

        val allFeeds = store.markArticlesReadByFeeds(emptySet())
        assertEquals(first.unreadArticleFeeds, allFeeds.unreadArticleFeeds)
        assertEquals(mapOf(pendingRead.id to true, pendingUnread.id to false, other.id to true), store.readArticleReadOverrides())
    }

    @Test
    fun `feed read state update persists overlays without invalidating paging`() = runBlocking {
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

        val pagingSource = store.articlePagingSource("query-feed-read-state", ownerId = null)
        store.markArticlesReadByFeeds(setOf("f-1"))

        assertEquals(false, pagingSource.invalid)
        assertEquals(mapOf("a-1" to true), store.readArticleReadOverrides())
        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh<Int>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )
        val page = result as PagingSource.LoadResult.Page
        assertEquals(listOf("a-1", "a-2"), page.data.map { it.id })
        assertEquals(false, page.data.first { it.id == "a-1" }.isRead)
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

    private fun sampleFeed(
        id: String,
        categoryId: String,
        syncStatus: String = "idle",
        lastSyncError: String? = null,
        lastSyncErrorAt: String? = null,
    ): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed $id",
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = syncStatus,
        lastSyncError = lastSyncError,
        lastSyncErrorAt = lastSyncErrorAt,
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
