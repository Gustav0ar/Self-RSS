package com.selffeed.android.macrobenchmark

import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.json.JSONObject
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Survives target process death, retaining a server-side receipt whose acknowledgment was lost. */
internal class OutboxRecoveryServer(private val articleId: String) : AutoCloseable {
    val acknowledgmentsAvailable = AtomicBoolean(false)
    val readApplied = CountDownLatch(1)
    val attempts = ConcurrentHashMap<String, AtomicInteger>()
    private val effects = ConcurrentHashMap<String, String>()
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val field = when (request.url.encodedPath) {
                    "/api/v1/articles/$articleId/read" -> "read"
                    "/api/v1/articles/$articleId/saved" -> "saved"
                    else -> return MockResponse(code = 503)
                }
                if (request.method != "PATCH" || request.headers["Authorization"] != "Bearer isolated-review-fixture") {
                    return MockResponse(code = 400)
                }
                val body = JSONObject(requireNotNull(request.body).utf8())
                val mutationId = body.getString("mutationId")
                if (!body.getBoolean(field) || body.getInt("baseRevision") != 0 || mutationId.isBlank()) {
                    return MockResponse(code = 400)
                }
                attempts.computeIfAbsent(mutationId) { AtomicInteger() }.incrementAndGet()
                val duplicate = effects.putIfAbsent(mutationId, field) != null
                if (field == "read") readApplied.countDown()
                // A transient response models a lost acknowledgment after the
                // server accepted the write. A retry must reuse the same ID.
                if (!acknowledgmentsAvailable.get()) return MockResponse(code = 503)
                return MockResponse.Builder()
                    .addHeader("Content-Type", "application/json")
                    .body("""{"data":{"success":true,"applied":${!duplicate},"duplicate":$duplicate,"$field":true,"revision":1}}""")
                    .build()
            }
        }
        start(InetAddress.getByName("127.0.0.1"), 0)
    }
    val port: Int get() = server.port
    fun appliedMutations(): Map<String, String> = effects.toMap()
    override fun close() = server.close()
}
