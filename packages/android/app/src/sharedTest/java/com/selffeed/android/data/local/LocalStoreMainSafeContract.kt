package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.UserPreferences
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.CoroutineContext

/** Runs on the real Android Main dispatcher in the device wrapper. */
abstract class LocalStoreMainSafeContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "main-safe-store-${UUID.randomUUID()}"
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    private val dispatchedThreads = CopyOnWriteArrayList<Thread>()
    private val detail = ArticleDetail(
        id = "large", feedId = "feed", guid = "fixture", title = "Large cached body",
        hash = "fixture", feedTitle = "Fixture", isRead = false,
        contentHtml = "<p>${"Readable body. ".repeat(80_000)}</p>",
        contentText = "Readable body.",
    )
    private val preferences = UserPreferences(
        theme = "dark", fontFamily = "sans", textSize = 16, density = "compact",
        defaultSort = "newest", hideRead = false, keyboardShortcutsEnabled = true, autoMarkReadMode = "off",
    )
    private val categories = listOf(CategoryWithCounts(
        id = "parent", name = "Parent", slug = "parent", sortOrder = 0, feedCount = 0, unreadCount = 0,
        children = listOf(CategoryWithCounts(id = "child", name = "Child", slug = "child", sortOrder = 0, feedCount = 0, unreadCount = 0)),
    ))

    protected open suspend fun onCaller(block: suspend () -> Unit) = block()

    @Before fun setup() = runBlocking<Unit> {
        val recordingDispatcher = object : CoroutineDispatcher() {
            override fun dispatch(context: CoroutineContext, block: Runnable) {
                Dispatchers.Default.dispatch(context) {
                    dispatchedThreads += Thread.currentThread()
                    block.run()
                }
            }
        }
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name).build()
        store = LocalStore(database, NetworkModule.provideJson(), processingDispatcher = recordingDispatcher)
        store.writeArticleDetail(detail)
        store.writeCategories(categories)
        store.writePreferences(preferences)
        dispatchedThreads.clear()
    }

    @After fun close() { database.close(); context.deleteDatabase(name) }

    @Test fun cachedBodyAndNestedSnapshotsDecodeOffTheCaller() = runBlocking<Unit> {
        onCaller {
            val caller = Thread.currentThread()
            assertEquals(detail, store.readArticleDetail(detail.id))
            assertEquals(categories, store.readCategories())
            assertEquals(preferences, store.readPreferences())
            assertTrue(dispatchedThreads.size >= 3)
            assertTrue("JSON decoding resumed on the caller", dispatchedThreads.none { it === caller })
        }
    }

    @Test fun preferenceEncodingIsAlsoMainSafe() = runBlocking<Unit> {
        onCaller {
            val caller = Thread.currentThread()
            store.writePreferences(preferences.copy(textSize = 20))
            assertTrue(dispatchedThreads.isNotEmpty())
            assertTrue("JSON encoding ran on the caller", dispatchedThreads.none { it === caller })
        }
    }
}
