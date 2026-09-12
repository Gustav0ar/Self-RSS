package com.selffeed.android.data

import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.CancellationException
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MemoryCacheTest {
    @Test
    fun invalidationAfterMissCannotAdmitTheOldCallerIntoTheNewGeneration() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val result = cache.getOrLoad("me", 1_000, onMiss = {
            cache.clear()
            cache.put("me", 1_000, "new owner")
        }) { "old owner" }
        assertEquals("old owner", result)
        assertEquals("new owner", cache.get<String>("me"))
        assertEquals(0, cache.loadKeyCount)
    }

    @Test
    fun completedFailedAndCancelledLoadsReleaseTheirCoordinationState() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        repeat(50) { index ->
            assertTrue(runCatching {
                cache.getOrLoad("failed-$index", 1_000) { error("Fixture failure") }
            }.isFailure)
            assertEquals(0, cache.loadKeyCount)
        }
        val cancelled = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("cancelled", 1_000) { CompletableDeferred<String>().await() }
        }
        assertEquals(1, cache.loadKeyCount)
        cancelled.cancelAndJoin()
        assertEquals(0, cache.loadKeyCount)
        assertEquals("complete", cache.getOrLoad("complete", 1_000) { "complete" })
        assertEquals(0, cache.loadKeyCount)
    }

    @Test
    fun cancellingOneLoaderDoesNotCancelItsWaitingCaller() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("article:a", 1_000) { CompletableDeferred<String>().await() }
        }
        val next = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("article:a", 1_000) { "next" }
        }
        assertEquals(1, cache.loadKeyCount)
        first.cancelAndJoin()
        assertEquals("next", next.await())
        assertEquals("next", cache.get<String>("article:a"))
        assertEquals(0, cache.loadKeyCount)
    }

    @Test
    fun cancelledNonCooperativeLoaderCannotPublish() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val load = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("article:a", 1_000) {
                try { CompletableDeferred<String>().await() } catch (_: CancellationException) { "cancelled result" }
            }
        }
        load.cancelAndJoin()
        assertNull(cache.get<String>("article:a"))
        assertEquals(0, cache.loadKeyCount)
    }

    @Test
    fun waiterBeforeClearCannotConsumeOrReplaceANewGeneration() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val response = CompletableDeferred<String>()
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("me", 1_000) { response.await() }
        }
        val waiting = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("me", 1_000) { "old waiter" }
        }
        assertEquals(2, cache.activeLoadCount)
        cache.clear()
        assertEquals(0, cache.loadKeyCount)
        assertEquals(2, cache.activeLoadCount)
        assertEquals("new owner", cache.getOrLoad("me", 1_000) { "new owner" })
        response.complete("old owner")
        first.await()
        assertEquals("old waiter", waiting.await())
        assertEquals("new owner", cache.get<String>("me"))
        assertEquals(0, cache.loadKeyCount)
        assertEquals(0, cache.activeLoadCount)
    }

    @Test
    fun simultaneousCallersShareOneSuccessfulLoad() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        var invocations = 0
        val response = CompletableDeferred<String>()
        val readers = List(20) {
            async(start = CoroutineStart.UNDISPATCHED) {
                cache.getOrLoad("me", 1_000) { invocations++; response.await() }
            }
        }
        assertEquals(1, invocations)
        assertEquals(1, cache.loadKeyCount)
        assertEquals(20, cache.activeLoadCount)
        response.complete("shared")
        readers.forEach { assertEquals("shared", it.await()) }
        assertEquals(1, invocations)
        assertEquals(0, cache.loadKeyCount)
        assertEquals(0, cache.activeLoadCount)
    }

    @Test
    fun clearingDuringLoadCannotRepopulateCacheOrBlockANewLoad() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val oldResponse = CompletableDeferred<String>()
        val old = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("me", 1_000) { oldResponse.await() }
        }
        cache.clear()
        assertEquals("new", cache.getOrLoad("me", 1_000) { "new" })
        oldResponse.complete("old")
        assertEquals("old", old.await())
        assertEquals("new", cache.get<String>("me"))
    }

    @Test
    fun prefixInvalidationAlsoInvalidatesLoadsWithoutCachedEntries() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val response = CompletableDeferred<String>()
        val old = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("articles:feed", 1_000) { response.await() }
        }
        cache.put("articlesList", 1_000, "unrelated")
        assertEquals(0, cache.invalidateByPrefix("articles"))
        response.complete("stale")
        assertEquals("stale", old.await())
        assertNull(cache.get<String>("articles:feed"))
        assertEquals("unrelated", cache.get<String>("articlesList"))
    }

    @Test
    fun explicitNewerValueCannotBeReplacedByAnOlderLoad() = runTest {
        val cache = MemoryCache(maxEntries = 4)
        val response = CompletableDeferred<String>()
        val old = async(start = CoroutineStart.UNDISPATCHED) {
            cache.getOrLoad("article:a", 1_000) { response.await() }
        }
        cache.put("article:a", 1_000, "updated")
        response.complete("stale")
        old.await()
        assertEquals("updated", cache.get<String>("article:a"))
    }

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
