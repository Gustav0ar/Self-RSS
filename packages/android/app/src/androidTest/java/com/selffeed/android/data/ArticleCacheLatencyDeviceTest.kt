package com.selffeed.android.data

import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import javax.inject.Inject
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in measurements against an authenticated local development API; preserves durable data. */
@HiltAndroidTest
class ArticleCacheLatencyDeviceTest {
    @get:Rule val hilt = HiltAndroidRule(this)
    @Inject lateinit var repository: RssRepository

    @Test
    fun uncachedArticlesThenMemoryHits() = runBlocking {
        val ids = InstrumentationRegistry.getArguments().getString("cacheLatencyArticleIds")
        assumeTrue("Supply local-development article IDs to run this measurement", ids != null)
        InstrumentationRegistry.getInstrumentation().runOnMainSync { hilt.inject() }
        repository.prepareSession()
        val host = java.net.URI(com.selffeed.android.network.normalizeApiBaseUrl(repository.getApiBaseUrl())).host
        check(host in setOf("127.0.0.1", "localhost", "10.0.2.2")) { "Only an isolated local API is allowed" }
        var misses = 0
        for (id in ids!!.split(',').take(50)) {
            if (repository.readCachedArticleDetail(id) != null) continue
            val start = SystemClock.elapsedRealtimeNanos()
            val result = repository.article(id)
            val missMs = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0
            assertTrue("Cold read failed for $id: $result", result is AppResult.Success)
            val detail = (result as AppResult.Success).data
            assertTrue("Expected readable server content", !detail.contentHtml.isNullOrBlank() || !detail.contentText.isNullOrBlank())
            val hitStart = SystemClock.elapsedRealtimeNanos()
            assertTrue(repository.article(id) is AppResult.Success)
            val hitMs = (SystemClock.elapsedRealtimeNanos() - hitStart) / 1_000_000.0
            repository.trimMemoryCaches()
            val diskStart = SystemClock.elapsedRealtimeNanos()
            assertTrue(repository.article(id) is AppResult.Success)
            val diskMs = (SystemClock.elapsedRealtimeNanos() - diskStart) / 1_000_000.0
            Log.i("ArticleCacheLatency", "id=$id cacheMissMs=$missMs memoryHitMs=$hitMs diskHitMs=$diskMs")
            if (++misses == 10) break
        }
        assertTrue("Provide enough articles absent from the existing cache", misses >= 5)
        assertTrue(repository.getDebugResilienceSnapshot().getValue("articleInFlightLoads") == 0L)
    }
}
