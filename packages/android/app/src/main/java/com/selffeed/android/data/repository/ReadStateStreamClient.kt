package com.selffeed.android.data.repository

import com.selffeed.android.BuildConfig
import com.selffeed.android.network.apiEndpointUrl
import com.selffeed.android.network.ReadStateEventPayload
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.SseEventParser
import com.selffeed.android.network.toReadStateEvent
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.coroutineContext

class ReadStateStreamClient(
    okHttpClient: OkHttpClient,
    moshi: Moshi,
    private val runtime: RepositoryRuntime,
    private val apiBaseUrl: () -> String = { BuildConfig.API_BASE_URL },
) {
    private val sseLastEventId = AtomicLong(0)
    private val readStateEventAdapter: JsonAdapter<ReadStateEventPayload> = moshi.adapter(ReadStateEventPayload::class.java)

    // Heartbeat tracking: timestamp of the last received event
    @Volatile
    private var lastEventTimestampMs: Long = 0L

    /**
     * Reuses the authenticated app client while configuring timeouts for SSE streams.
     *
     * - Read timeout: 60 seconds - allows detecting stuck connections via heartbeat.
     *   If no data arrives within this window, the connection is considered stale.
     * - Write timeout: 30 seconds - sufficient for any client-initiated writes.
     * - Call timeout: 0 (infinite) - SSE calls are long-lived; individual operations
     *   are bounded by read/write timeouts instead.
     */
    private val readStateClient: OkHttpClient = okHttpClient.newBuilder()
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .addInterceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()
            val lastId = sseLastEventId.get()
            if (lastId > 0) {
                builder.header("Last-Event-ID", lastId.toString())
            }
            chain.proceed(builder.build())
        }
        .build()

    fun events(isLoggedIn: () -> Boolean): Flow<ReadStateSyncEvent> = flow {
        var attempt = 0
        while (coroutineContext.isActive && isLoggedIn()) {
            try {
                eventsOnce().collect { event ->
                    attempt = 0
                    sseLastEventId.set(parseEventId(event.eventId))
                    emit(event)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                runtime.debugLog("Read-state stream disconnected: ${e.message ?: e::class.java.simpleName}")
            }

            if (!coroutineContext.isActive || !isLoggedIn()) break
            if (attempt >= READ_STATE_RECONNECT_MAX_ATTEMPTS) {
                runtime.debugLog("Read-state stream giving up after $attempt attempts")
                break
            }
            delay(readStateReconnectDelay(attempt))
            attempt++
        }
    }

    private fun eventsOnce(): Flow<ReadStateSyncEvent> = callbackFlow stream@ {
        // Reset heartbeat tracking for a new connection
        lastEventTimestampMs = System.currentTimeMillis()

        val request = Request.Builder()
            .url(apiEndpointUrl(apiBaseUrl(), "events/read-state"))
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .build()
        val call = readStateClient.newCall(request)

        // Launch heartbeat monitor to detect stuck connections
        val heartbeatJob = launch {
            while (isActive) {
                delay(HEARTBEAT_CHECK_INTERVAL_MS)
                val elapsed = System.currentTimeMillis() - lastEventTimestampMs
                if (elapsed > HEARTBEAT_TIMEOUT_MS) {
                    runtime.debugLog("Read-state stream heartbeat timeout after ${elapsed / 1000}s - closing connection")
                    call.cancel()
                    break
                }
            }
        }

        call.enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (call.isCanceled()) {
                        this@stream.close()
                    } else {
                        this@stream.close(e)
                    }
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (!response.isSuccessful) {
                            this@stream.close(IOException("Read-state stream failed with HTTP ${response.code}"))
                            return
                        }

                        val parser = SseEventParser()
                        try {
                            val source = response.body.source()
                            while (!call.isCanceled()) {
                                val line = source.readUtf8Line() ?: break
                                parser.pushLine(line)
                                    ?.toReadStateEvent(readStateEventAdapter)
                                    ?.also { lastEventTimestampMs = System.currentTimeMillis() }
                                    ?.let { this@stream.trySend(it) }
                            }
                            parser.flush()
                                ?.toReadStateEvent(readStateEventAdapter)
                                ?.also { lastEventTimestampMs = System.currentTimeMillis() }
                                ?.let { this@stream.trySend(it) }
                            this@stream.close()
                        } catch (e: IOException) {
                            if (call.isCanceled()) {
                                this@stream.close()
                            } else {
                                this@stream.close(e)
                            }
                        }
                    }
                }
            },
        )

        awaitClose {
            heartbeatJob.cancel()
            call.cancel()
        }
    }.flowOn(Dispatchers.IO)

    private fun readStateReconnectDelay(attempt: Int): Long =
        (READ_STATE_RECONNECT_INITIAL_DELAY_MS * (1L shl attempt.coerceAtMost(5)))
            .coerceAtMost(READ_STATE_RECONNECT_MAX_DELAY_MS)

    private fun parseEventId(raw: String): Long = raw.toLongOrNull() ?: 0L

    private companion object {
        const val READ_STATE_RECONNECT_INITIAL_DELAY_MS = 1_000L
        const val READ_STATE_RECONNECT_MAX_DELAY_MS = 30_000L
        const val READ_STATE_RECONNECT_MAX_ATTEMPTS = 50

        /** Interval between heartbeat checks for stuck connection detection. */
        const val HEARTBEAT_CHECK_INTERVAL_MS = 30_000L

        /**
         * Maximum time between SSE events before considering the connection stuck.
         * This should be larger than the read timeout (60s) to allow for slow responses.
         */
        const val HEARTBEAT_TIMEOUT_MS = 90_000L
    }
}
