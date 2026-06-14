package com.selffeed.android.data.repository

import com.selffeed.android.BuildConfig
import com.selffeed.android.network.ReadStateEventPayload
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.SseEventParser
import com.selffeed.android.network.toReadStateEvent
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
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
) {
    private val sseLastEventId = AtomicLong(0)
    private val readStateEventAdapter: JsonAdapter<ReadStateEventPayload> = moshi.adapter(ReadStateEventPayload::class.java)

    /**
     * Reuses the authenticated app client while removing read/call timeouts so
     * the long-lived SSE stream is not interrupted by normal REST timeouts.
     */
    private val readStateClient: OkHttpClient = okHttpClient.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
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
        val request = Request.Builder()
            .url("${BuildConfig.API_BASE_URL.trimEnd('/')}/events/read-state")
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .build()
        val call = readStateClient.newCall(request)
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
                                    ?.let { this@stream.trySend(it) }
                            }
                            parser.flush()
                                ?.toReadStateEvent(readStateEventAdapter)
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

        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    private fun readStateReconnectDelay(attempt: Int): Long =
        (READ_STATE_RECONNECT_INITIAL_DELAY_MS * (1L shl attempt.coerceAtMost(5)))
            .coerceAtMost(READ_STATE_RECONNECT_MAX_DELAY_MS)

    private fun parseEventId(raw: String): Long = raw.toLongOrNull() ?: 0L

    private companion object {
        const val READ_STATE_RECONNECT_INITIAL_DELAY_MS = 1_000L
        const val READ_STATE_RECONNECT_MAX_DELAY_MS = 30_000L
        const val READ_STATE_RECONNECT_MAX_ATTEMPTS = 50
    }
}
