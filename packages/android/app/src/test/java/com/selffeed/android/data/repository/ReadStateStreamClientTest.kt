package com.selffeed.android.data.repository

import com.selffeed.android.data.ApiSession
import com.selffeed.android.network.ArticlesNewEvent
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RealtimeConnectedEvent
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class ReadStateStreamClientTest {
    @Test
    fun rejectedSubscriptionDoesNotReportAConnectionOrRefreshContent() = runBlocking {
        val events = CopyOnWriteArrayList<ReadStateSyncEvent>()
        collectThreeConnections(
            "event: read-state.error\ndata: {\"code\":\"CONNECTION_UNAVAILABLE\"}\n\n",
            events,
        )
        assertTrue("Rejected subscriptions must not trigger content refreshes: $events", events.isEmpty())
    }

    @Test
    fun repeatedlyClosedConnectionsBackOffEvenAfterReceivingAConnectionAcknowledgement() = runBlocking {
        val events = CopyOnWriteArrayList<ReadStateSyncEvent>()
        val requests = collectThreeConnections(
            "event: read-state.connected\ndata: {\"connected\":true}\n\n",
            events,
        )
        assertEquals(3, events.filterIsInstance<RealtimeConnectedEvent>().size)
        val secondDelayMs = TimeUnit.NANOSECONDS.toMillis(requests[2] - requests[1])
        assertTrue("Reconnect delay must grow after short-lived streams; got ${secondDelayMs}ms", secondDelayMs >= 1_800)
    }

    @Test
    fun acknowledgedConnectionStillDeliversNewArticles() = runBlocking {
        val body = """
            event: read-state.connected
            data: {"connected":true}

            event: read-state
            data: {"type":"articles.new","eventId":"new-1","feedId":"feed-1","articleIds":["article-1"],"count":1,"updatedAt":"2026-09-22T00:00:00.000Z"}

        """.trimIndent() + "\n"
        val http = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(body.toResponseBody()).build()
        }.build()
        val moshi = NetworkModule.provideMoshi()
        val client = ReadStateStreamClient(http, moshi, RepositoryRuntime(moshi, 2, "stream-test"))
        try {
            val events = withTimeout(5_000) {
                client.events(ApiSession(0, "https://example.test/api/v1/", "owner")) { true }
                    .take(2).toList()
            }
            assertTrue(events[0] is RealtimeConnectedEvent)
            assertEquals(listOf("article-1"), (events[1] as ArticlesNewEvent).articleIds)
        } finally {
            http.dispatcher.executorService.shutdown()
            http.connectionPool.evictAll()
        }
    }

    private suspend fun collectThreeConnections(
        body: String,
        events: MutableList<ReadStateSyncEvent>,
    ): List<Long> = kotlinx.coroutines.coroutineScope {
        val requests = CopyOnWriteArrayList<Long>()
        val http = OkHttpClient.Builder().addInterceptor { chain ->
            requests += System.nanoTime()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(body.toResponseBody()).build()
        }.build()
        val moshi = NetworkModule.provideMoshi()
        val client = ReadStateStreamClient(http, moshi, RepositoryRuntime(moshi, 2, "stream-test"))
        val collection = launch {
            client.events(ApiSession(0, "https://example.test/api/v1/", "owner")) { true }
                .collect { events += it }
        }
        try {
            withTimeout(10_000) {
                while (requests.size < 3) delay(10)
                // Let the third callback finish publishing its parsed events.
                delay(100)
            }
            requests.toList()
        } finally {
            collection.cancelAndJoin()
            http.dispatcher.executorService.shutdown()
            http.connectionPool.evictAll()
        }
    }
}
