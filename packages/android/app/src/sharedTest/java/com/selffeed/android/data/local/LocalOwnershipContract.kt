package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID

/** The same transaction/retention contract runs against Robolectric and Android SQLite. */
abstract class LocalOwnershipContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "owned-storage-${UUID.randomUUID()}"
    private val moshi = NetworkModule.provideMoshi()
    private val detailAdapter = moshi.adapter(ArticleDetail::class.java)
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    private val dao get() = database.localStoreDao()
    private val ownerA = LocalOwnerEntity(ownerId = "session-a", apiBaseUrl = "https://a.example.invalid/api/v1/", userId = "user-a")
    private val ownerB = LocalOwnerEntity(ownerId = "session-b", apiBaseUrl = "https://b.example.invalid/api/v1/", userId = "user-b")

    @Before
    fun openStore() {
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        store = LocalStore(database, moshi)
    }

    @After
    fun closeStore() {
        database.close()
        context.deleteDatabase(name)
    }

    @Test
    fun adoptionPreservesExistingDataAndIdentitySurvivesReopening() = runBlocking {
        seedArticle("shared")
        pin("shared")
        val read = store.queueReadStateMutation("shared", true, "auto_open")
        val saved = store.queueSavedStateMutation("shared", true)
        val body = dao.readArticleDetail("shared")
        assertFalse(store.switchOwner(ownerA.copy(userId = null)))
        assertFalse(store.switchOwner(ownerA))
        assertFalse(store.switchOwner(ownerA.copy(userId = null)))
        assertEquals(ownerA, store.readOwner())
        assertEquals(listOf(read), store.readPendingReadStateMutations())
        assertEquals(listOf(saved), store.readPendingSavedStateMutations())
        assertEquals(body, dao.readArticleDetail("shared"))
        assertTrue(dao.isLegacyOfflineArticle("shared"))
        assertTrue(dao.readArchivedReadStateMutations(ownerA.ownerId).isEmpty())
        database.close()
        openStore()
        assertEquals(ownerA, store.readOwner())
        assertEquals(body, dao.readArticleDetail("shared"))
        assertEquals(2, store.observePendingArticleChanges().first())
    }

    @Test
    fun switchArchivesEveryMutationFieldIncludingMultipleBlankLegacyIds() = runBlocking {
        store.switchOwner(ownerA)
        seedArticle("shared")
        pin("shared")
        val first = PendingReadStateMutationEntity("shared", true, "", "auto_open", 11, false, 123L)
        val second = PendingReadStateMutationEntity("body-only", false, "", "manual", null, null, 456L)
        val saved = PendingSavedStateMutationEntity("shared", false, "save-id", 27, true, 789L)
        dao.upsertPendingReadStateMutation(first)
        dao.upsertPendingReadStateMutation(second)
        dao.upsertPendingSavedStateMutation(saved)

        assertTrue(store.switchOwner(ownerB))
        assertEquals(ownerB, store.readOwner())
        assertEquals(listOf(first, second).map { ArchivedReadStateMutationEntity(ownerA.ownerId, ownerA.apiBaseUrl, ownerA.userId, it) },
            dao.readArchivedReadStateMutations(ownerA.ownerId))
        assertEquals(listOf(ArchivedSavedStateMutationEntity(ownerA.ownerId, ownerA.apiBaseUrl, ownerA.userId, saved)),
            dao.readArchivedSavedStateMutations(ownerA.ownerId))
        assertEquals(0, store.observePendingArticleChanges().first())
        assertTrue(store.readPendingReadStateMutations().isEmpty())
        assertTrue(store.readPendingSavedStateMutations().isEmpty())
        assertNull(store.readArticleDetail("shared"))
        assertFalse(dao.isLegacyOfflineArticle("shared"))
        assertNull(dao.readArticle("shared"))

        val newRead = store.queueReadStateMutation("shared", false)
        store.switchOwner(ownerB.copy(ownerId = "session-c"))
        assertEquals(listOf(newRead), dao.readArchivedReadStateMutations(ownerB.ownerId).map { it.mutation })
        assertEquals(listOf(first, second), dao.readArchivedReadStateMutations(ownerA.ownerId).map { it.mutation })
    }

    @Test
    fun failureRollsBackArchivalCleanupAndOwnerTogether() = runBlocking {
        store.switchOwner(ownerA)
        seedArticle("shared")
        val pending = store.queueReadStateMutation("shared", true)
        val body = dao.readArticleDetail("shared")
        database.openHelper.writableDatabase.execSQL("""
            CREATE TRIGGER interrupt_owner_switch BEFORE DELETE ON article_details
            BEGIN SELECT RAISE(ABORT, 'fixture interrupted owner switch'); END
        """.trimIndent())
        assertNotNull(runCatching { store.switchOwner(ownerB) }.exceptionOrNull())
        assertEquals(ownerA, store.readOwner())
        assertEquals(listOf(pending), store.readPendingReadStateMutations())
        assertEquals(body, dao.readArticleDetail("shared"))
        assertTrue(dao.readArchivedReadStateMutations(ownerA.ownerId).isEmpty())
        database.openHelper.writableDatabase.execSQL("DROP TRIGGER interrupt_owner_switch")
        assertTrue(store.switchOwner(ownerB))
        assertFalse(store.switchOwner(ownerB))
        assertEquals(listOf(pending), dao.readArchivedReadStateMutations(ownerA.ownerId).map { it.mutation })
    }

    @Test
    fun ownerCannotChangeServerUserOrReactivateArchivedIntent() = runBlocking {
        store.switchOwner(ownerA)
        val pending = store.queueReadStateMutation("shared", true)
        assertNotNull(runCatching { store.switchOwner(ownerA.copy(apiBaseUrl = ownerB.apiBaseUrl)) }.exceptionOrNull())
        assertNotNull(runCatching { store.switchOwner(ownerA.copy(userId = ownerB.userId)) }.exceptionOrNull())
        assertEquals(ownerA, store.readOwner())
        assertEquals(listOf(pending), store.readPendingReadStateMutations())
        store.switchOwner(ownerB)
        val current = store.queueSavedStateMutation("shared", true)
        assertNotNull(runCatching { store.switchOwner(ownerA) }.exceptionOrNull())
        assertEquals(ownerB, store.readOwner())
        assertEquals(listOf(current), store.readPendingSavedStateMutations())
        assertEquals(listOf(pending), dao.readArchivedReadStateMutations(ownerA.ownerId).map { it.mutation })
    }

    @Test
    fun expiredLegacyPinsSurviveReadsCleanupAndRemoteBookmarkRemoval() = runBlocking {
        for (id in listOf("readable", "malformed", "orphan")) pin(id)
        val original = detailAdapter.toJson(detail("readable"))
        dao.upsertArticleDetail(ArticleDetailEntity("readable", "feed", original, 1L))
        dao.upsertArticleDetail(ArticleDetailEntity("malformed", "feed", "{recoverable raw bytes", 2L))
        assertEquals("Offline text readable", store.readArticleDetail("readable")?.contentText)
        assertEquals(false, store.readArticleDetail("readable")?.isSaved)
        assertNull(store.readArticleDetail("malformed"))
        store.writeArticleDetail(detail("other"))
        store.clearArticleDetail("readable")
        store.clearArticleDetails()
        store.clearArticleLists()
        assertEquals(original, dao.readArticleDetail("readable")?.payloadJson)
        assertEquals("{recoverable raw bytes", dao.readArticleDetail("malformed")?.payloadJson)
        assertTrue(dao.isLegacyOfflineArticle("orphan"))

        store.updateArticleSavedState("readable", false, 10)
        assertEquals("Offline text readable", store.readArticleDetail("readable")?.contentText)
        assertTrue(dao.isLegacyOfflineArticle("readable"))
        database.close()
        openStore()
        assertEquals("Offline text readable", store.readArticleDetail("readable")?.contentText)
        assertTrue(store.observeArticleTextAvailability("readable").first())
        assertEquals("{recoverable raw bytes", dao.readArticleDetail("malformed")?.payloadJson)
    }

    @Test
    fun malformedPinnedBodyCannotBlockAuthoritativeSavedListReconciliation() = runBlocking {
        seedArticle("malformed")
        pin("malformed")
        dao.updateArticleSavedState("malformed", true)
        val raw = "{preserve this legacy body"
        dao.upsertArticleDetail(ArticleDetailEntity("malformed", "feed", raw, 3L))
        assertTrue(store.clearSavedStateIfUnchanged(SavedArticleSnapshot("malformed", null)))
        assertEquals(false, dao.readArticle("malformed")?.isSaved)
        assertEquals(raw, dao.readArticleDetail("malformed")?.payloadJson)
        assertTrue(dao.isLegacyOfflineArticle("malformed"))
    }

    @Test
    fun bulkReadReconcilesPendingBodyOnlyIntentWithoutParsingItsDamagedContent() = runBlocking {
        pin("body-only")
        val raw = "{preserve damaged offline text"
        dao.upsertArticleDetail(ArticleDetailEntity("body-only", "feed", raw, 4L))
        val pending = store.queueReadStateMutation("body-only", false)
        val result = store.markArticlesReadByFeeds(setOf("feed"))
        assertEquals(setOf("body-only"), result.affectedArticleIds)
        assertEquals(mapOf("body-only" to "feed"), result.unreadArticleFeeds)
        assertEquals(listOf(pending.copy(previousState = true)), store.readPendingReadStateMutations())
        assertEquals(raw, dao.readArticleDetail("body-only")?.payloadJson)
        assertTrue(dao.isLegacyOfflineArticle("body-only"))
    }

    @Test
    fun onlyExplicitUnsaveRemovesTheSelectedLegacyPin() = runBlocking {
        for (id in listOf("selected", "retained")) {
            seedArticle(id)
            pin(id)
        }
        store.updateArticleSavedState("selected", false, 2)
        assertTrue(dao.isLegacyOfflineArticle("selected"))
        val intent = store.queueSavedStateMutation("selected", false)
        store.discardSavedStateMutation(intent)
        assertFalse(dao.isLegacyOfflineArticle("selected"))
        assertTrue(dao.isLegacyOfflineArticle("retained"))
        store.clearArticleDetails()
        assertNull(dao.readArticleDetail("selected"))
        assertNotNull(dao.readArticleDetail("retained"))
    }

    @Test
    fun slowFreshnessObserverCannotBlockAccountCleanup() = runBlocking {
        store.switchOwner(ownerA)
        store.queueReadStateMutation("shared", true)
        val observing = CompletableDeferred<Unit>()
        val blocked = CompletableDeferred<Unit>()
        val collector = launch(start = CoroutineStart.UNDISPATCHED) {
            store.invalidations.collect { observing.complete(Unit); blocked.await() }
        }
        try {
            observing.await()
            withTimeout(5_000) {
                repeat(40) { store.writeArticleDetail(detail("article-$it")) }
                assertTrue(store.switchOwner(ownerB))
            }
            assertEquals(ownerB, store.readOwner())
        } finally {
            collector.cancelAndJoin()
        }
    }

    private suspend fun seedArticle(id: String) {
        store.writeArticleRemotePage("queue-$id", ApiListResponse(
            data = listOf(ArticleListItem(id = id, feedId = "feed", feedTitle = "Local", title = id, isRead = false)),
            cursor = null, hasMore = false,
        ), clearExisting = true)
        store.writeArticleDetail(detail(id))
    }

    private fun pin(id: String) {
        database.openHelper.writableDatabase.execSQL(
            "INSERT INTO legacy_offline_articles(articleId, savedAt) VALUES (?, ?)", arrayOf<Any>(id, 123L),
        )
    }

    private fun detail(id: String) = ArticleDetail(
        id = id, feedId = "feed", guid = id, canonicalUrl = null, title = id,
        excerpt = null, contentHtml = "<p>Offline text $id</p>", contentText = "Offline text $id",
        heroImageUrl = null, publishedAt = null, fetchedAt = "2026-01-01T00:00:00Z", hash = id,
        feedTitle = "Local", isRead = false,
    )
}
