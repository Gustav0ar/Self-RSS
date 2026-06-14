package com.selffeed.android.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MemoryCacheTest {
    @Test
    fun getOrLoad_loadsOnceThenReturnsCachedValue() = runTest {
        var loads = 0
        val cache = MemoryCache(maxEntries = 4)

        val first = cache.getOrLoad("me", ttlMs = 1_000) {
            loads++
            "user"
        }
        val second = cache.getOrLoad("me", ttlMs = 1_000) {
            loads++
            "other"
        }

        assertEquals("user", first)
        assertEquals("user", second)
        assertEquals(1, loads)
    }

    @Test
    fun get_discardsExpiredEntries() {
        var now = 1_000L
        val cache = MemoryCache(maxEntries = 4, nowMs = { now })

        cache.put("article:a1", ttlMs = 100, value = "cached")
        now = 1_101L

        assertNull(cache.get<String>("article:a1"))
    }

    @Test
    fun invalidateByPrefixTreatsPrefixAsNamespace() {
        val cache = MemoryCache(maxEntries = 8)
        cache.put("articles:feed", ttlMs = 1_000, value = "list")
        cache.put("articlesList", ttlMs = 1_000, value = "unrelated")
        cache.put("article:a1", ttlMs = 1_000, value = "detail")

        val removed = cache.invalidateByPrefix("articles")

        assertEquals(1, removed)
        assertNull(cache.get<String>("articles:feed"))
        assertEquals("unrelated", cache.get("articlesList"))
        assertEquals("detail", cache.get("article:a1"))
    }

    @Test
    fun putEvictsLeastRecentlyUsedEntryWhenOverCapacity() {
        var now = 1_000L
        val cache = MemoryCache(maxEntries = 2, nowMs = { now })

        cache.put("old", ttlMs = 10_000, value = "old")
        now += 1
        cache.put("newer", ttlMs = 10_000, value = "newer")
        now += 1
        assertEquals("old", cache.get("old"))
        now += 1
        cache.put("newest", ttlMs = 10_000, value = "newest")

        assertEquals("old", cache.get("old"))
        assertNull(cache.get<String>("newer"))
        assertEquals("newest", cache.get("newest"))
    }
}
