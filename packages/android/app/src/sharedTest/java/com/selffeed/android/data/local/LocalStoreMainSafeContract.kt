package com.selffeed.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.UserPreferences
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.JsonReader
import com.squareup.moshi.JsonWriter
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/** Runs on the real Android Main dispatcher in the device wrapper. */
abstract class LocalStoreMainSafeContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "main-safe-store-${UUID.randomUUID()}"
    private lateinit var database: LocalDatabase
    private lateinit var store: LocalStore
    private val conversions = CopyOnWriteArrayList<Pair<String, Thread>>()
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
        val recorder = object : JsonAdapter.Factory {
            override fun create(type: java.lang.reflect.Type, annotations: Set<Annotation>, moshi: Moshi): JsonAdapter<*>? {
                if (Types.getRawType(type) !in setOf(ArticleDetail::class.java, UserPreferences::class.java, CategoryWithCounts::class.java)) return null
                val delegate = moshi.nextAdapter<Any>(this, type, annotations)
                return object : JsonAdapter<Any>() {
                    override fun fromJson(reader: JsonReader): Any? {
                        conversions += "decode" to Thread.currentThread()
                        return delegate.fromJson(reader)
                    }
                    override fun toJson(writer: JsonWriter, value: Any?) {
                        conversions += "encode" to Thread.currentThread()
                        delegate.toJson(writer, value)
                    }
                }
            }
        }
        database = Room.databaseBuilder(context, LocalDatabase::class.java, name).build()
        store = LocalStore(database, NetworkModule.provideMoshi().newBuilder().add(recorder).build())
        store.writeArticleDetail(detail)
        store.writeCategories(categories)
        store.writePreferences(preferences)
        conversions.clear()
    }

    @After fun close() { database.close(); context.deleteDatabase(name) }

    @Test fun cachedBodyAndNestedSnapshotsDecodeOffTheCaller() = runBlocking<Unit> {
        onCaller {
            val caller = Thread.currentThread()
            assertEquals(detail, store.readArticleDetail(detail.id))
            assertEquals(categories, store.readCategories())
            assertEquals(preferences, store.readPreferences())
            assertTrue(conversions.count { it.first == "decode" } >= 3)
            assertTrue("JSON decoding resumed on the caller", conversions.none { it.second === caller })
        }
    }

    @Test fun preferenceEncodingIsAlsoMainSafe() = runBlocking<Unit> {
        onCaller {
            val caller = Thread.currentThread()
            store.writePreferences(preferences.copy(textSize = 20))
            assertTrue(conversions.any { it.first == "encode" })
            assertTrue("JSON encoding ran on the caller", conversions.none { it.second === caller })
        }
    }
}
