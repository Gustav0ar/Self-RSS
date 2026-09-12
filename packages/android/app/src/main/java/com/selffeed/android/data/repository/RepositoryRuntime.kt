package com.selffeed.android.data.repository

import android.util.Log
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.MemoryCache
import com.selffeed.android.network.ApiErrorEnvelope
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

class RepositoryRuntime(
    moshi: Moshi,
    maxMemoryCacheEntries: Int,
    private val logTag: String,
    private val apiBaseUrl: () -> String = { BuildConfig.API_BASE_URL },
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val processingDispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val cacheEpoch: () -> Long = { 0L },
) {
    private val retryCount = AtomicLong(0)
    private val retryExhaustedCount = AtomicLong(0)
    private val cacheHitCount = AtomicLong(0)
    private val cacheMissCount = AtomicLong(0)
    private val cacheStoreCount = AtomicLong(0)
    private val cacheInvalidationCount = AtomicLong(0)
    private val cacheInvalidatedEntriesCount = AtomicLong(0)
    private val memoryCache = MemoryCache(maxMemoryCacheEntries)
    private val apiErrorAdapter: JsonAdapter<ApiErrorEnvelope> = moshi.adapter(ApiErrorEnvelope::class.java)

    suspend fun <T> safeCall(block: suspend () -> T): AppResult<T> =
        try {
            AppResult.Success(block())
        } catch (e: HttpException) {
            val rawBody = readErrorBody(e)
            val structuredMessage = withContext(processingDispatcher) { rawBody?.let(::extractApiErrorMessage) }
            val plainBodyMessage = rawBody
                ?.trim()
                ?.takeIf { it.isNotBlank() && !it.startsWith("{") }
                ?.take(240)
            val message = structuredMessage ?: plainBodyMessage ?: defaultHttpMessage(e.code())
            AppResult.Error(message, e)
        } catch (e: SocketTimeoutException) {
            AppResult.Error(
                if (BuildConfig.DEBUG) {
                    "Connection timed out. Please check if the API server is running at ${apiBaseUrl()}"
                } else {
                    "Connection timed out. Please try again."
                },
                e,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AppResult.Error(e.message ?: "Unexpected error", e)
        }

    suspend fun <T> withRetry(
        maxAttempts: Int = READ_RETRY_MAX_ATTEMPTS,
        initialDelayMs: Long = READ_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: Long = READ_RETRY_MAX_DELAY_MS,
        block: suspend () -> T,
    ): T {
        var currentDelayMs = initialDelayMs
        var attempt = 1
        var lastException: Exception? = null

        while (true) {
            try {
                return block()
            } catch (e: Exception) {
                lastException = e
                val canRetry = attempt < maxAttempts && isRetriableException(e)
                if (!canRetry) {
                    if (isRetriableException(e)) retryExhaustedCount.incrementAndGet()
                    throw e
                }

                val retryAttempt = retryCount.incrementAndGet()
                val jitter = Random.nextLong(0, currentDelayMs / 2 + 1)
                val totalDelay = (currentDelayMs + jitter).coerceAtMost(maxDelayMs)
                debugLog("Retrying request (attempt=$attempt, totalRetries=$retryAttempt, delayMs=$totalDelay, reason=${e::class.java.simpleName})")
                delay(totalDelay)
                currentDelayMs = (currentDelayMs * 2).coerceAtMost(maxDelayMs)
                attempt++
            }
        }
        @Suppress("UNREACHABLE_CODE")
        throw lastException ?: IllegalStateException("withRetry exited without resolution")
    }

    suspend fun <T> cachedGet(key: String, ttlMs: Long, loader: suspend () -> T): T {
        // Capture before suspension: a superseded load must stay in its original namespace.
        val scopedKey = cacheKey(key, cacheEpoch())
        return memoryCache.getOrLoad(
            key = scopedKey,
            ttlMs = ttlMs,
            onHit = { cacheHitCount.incrementAndGet() },
            onMiss = { cacheMissCount.incrementAndGet() },
            onStore = { cacheStoreCount.incrementAndGet() },
            loader = loader,
        )
    }

    fun <T> getCached(key: String): T? {
        val epoch = cacheEpoch()
        val value = memoryCache.get<T>(cacheKey(key, epoch))
        return value.takeIf { cacheEpoch() == epoch }
    }

    fun putCached(key: String, ttlMs: Long, value: Any?) {
        cacheStoreCount.incrementAndGet()
        memoryCache.put(cacheKey(key, cacheEpoch()), ttlMs, value)
    }

    private fun cacheKey(key: String, epoch: Long): String = "$key:epoch:$epoch"

    fun recordCacheHit() {
        cacheHitCount.incrementAndGet()
    }

    fun invalidateByPrefix(prefix: String) {
        val removedEntries = memoryCache.invalidateByPrefix(prefix)
        cacheInvalidationCount.incrementAndGet()
        if (removedEntries > 0) cacheInvalidatedEntriesCount.addAndGet(removedEntries.toLong())
    }

    fun clearCache() {
        val clearedEntries = memoryCache.clear().toLong()
        cacheInvalidationCount.incrementAndGet()
        cacheInvalidatedEntriesCount.addAndGet(clearedEntries)
    }

    fun trimMemoryCaches() {
        val cleared = memoryCache.clear()
        cacheInvalidationCount.incrementAndGet()
        cacheInvalidatedEntriesCount.addAndGet(cleared.toLong())
    }

    fun snapshot(): Map<String, Long> = mapOf(
        "memoryCacheEntries" to memoryCache.size.toLong(),
        "memoryCacheLoadKeys" to memoryCache.loadKeyCount.toLong(),
        "memoryCacheActiveLoads" to memoryCache.activeLoadCount.toLong(),
        "retryCount" to retryCount.get(),
        "retryExhaustedCount" to retryExhaustedCount.get(),
        "cacheHitCount" to cacheHitCount.get(),
        "cacheMissCount" to cacheMissCount.get(),
        "cacheStoreCount" to cacheStoreCount.get(),
        "cacheInvalidationCount" to cacheInvalidationCount.get(),
        "cacheInvalidatedEntriesCount" to cacheInvalidatedEntriesCount.get(),
    )

    fun resetMetrics() {
        retryCount.set(0)
        retryExhaustedCount.set(0)
        cacheHitCount.set(0)
        cacheMissCount.set(0)
        cacheStoreCount.set(0)
        cacheInvalidationCount.set(0)
        cacheInvalidatedEntriesCount.set(0)
        debugLog("Debug resilience metrics reset")
    }

    fun debugLog(message: String) {
        if (!BuildConfig.DEBUG) return
        Log.d(logTag, message)
    }

    /** A broken or oversized response must not replace the original HTTP failure. */
    private suspend fun readErrorBody(error: HttpException): String? = try {
        runInterruptible(ioDispatcher) {
            error.response()?.errorBody()?.use { body ->
                val source = body.source()
                if (source.request(MAX_ERROR_BODY_BYTES + 1)) null
                else source.readString(body.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)
            }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }

    private fun extractApiErrorMessage(rawBody: String): String? {
        val parsed = runCatching { apiErrorAdapter.fromJson(rawBody) }.getOrNull()
        return parsed?.error?.message?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun defaultHttpMessage(code: Int): String = when (code) {
        400 -> "Invalid request. Please review the provided data."
        401 -> "Session expired. Please sign in again."
        403 -> "You do not have permission for this action."
        404 -> "Requested resource was not found."
        408 -> "Request timed out. Please try again."
        409 -> "This action conflicts with current data."
        413 -> "Payload too large. Please reduce file/content size."
        415 -> "Unsupported content type."
        422 -> "Validation failed. Please adjust your input."
        429 -> "Too many requests. Please try again shortly."
        in 500..599 -> "Server error. Please try again in a moment."
        else -> "Request failed ($code)"
    }

    private fun isRetriableException(error: Exception): Boolean = when (error) {
        is SocketTimeoutException, is IOException -> true
        is HttpException -> error.code() in RETRIABLE_HTTP_CODES
        else -> false
    }

    private companion object {
        const val READ_RETRY_MAX_ATTEMPTS = 3
        const val READ_RETRY_INITIAL_DELAY_MS = 300L
        const val READ_RETRY_MAX_DELAY_MS = 2_000L
        val RETRIABLE_HTTP_CODES = setOf(408, 425, 429, 500, 502, 503, 504)
    }
}

private const val MAX_ERROR_BODY_BYTES = 64L * 1024
