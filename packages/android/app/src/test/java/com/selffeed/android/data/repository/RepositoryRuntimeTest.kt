package com.selffeed.android.data.repository

import com.selffeed.android.data.AppResult
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class RepositoryRuntimeTest {
    private val runtime = RepositoryRuntime(NetworkModule.provideMoshi(), 2, "test")

    @Test fun `http error bodies read off the caller and close`() = runBlocking {
        val caller = Thread.currentThread()
        val closed = AtomicBoolean()
        val body = body(closed) { sink, _ ->
            assertNotEquals("Error body read on caller", caller, Thread.currentThread())
            sink.writeUtf8("""{"error":{"code":"FIXTURE_FAILURE","message":"Scoped failure"}}""").size
        }
        val failure = HttpException(Response.error<Unit>(503, body))
        val result = runtime.safeCall<Unit> { throw failure } as AppResult.Error
        assertEquals("Scoped failure", result.message)
        assertSame(failure, result.cause)
        assertTrue(closed.get())
    }

    @Test fun `a secondary body failure retains the original http error`() = runBlocking {
        val closed = AtomicBoolean()
        val failure = HttpException(Response.error<Unit>(503, body(closed) { _, _ -> throw IOException("broken response") }))
        val result = runtime.safeCall<Unit> { throw failure } as AppResult.Error
        assertEquals("Server error. Please try again in a moment.", result.message)
        assertSame(failure, result.cause)
        assertTrue(closed.get())
    }

    @Test fun `oversized error body is bounded before parsing`() = runBlocking {
        val closed = AtomicBoolean()
        val readBytes = AtomicLong()
        val failure = HttpException(Response.error<Unit>(503, body(closed) { sink, requested ->
            // Keep the pre-fix case bounded too, with a finite 1 MiB response.
            if (readBytes.get() >= 1024 * 1024) -1L else {
                val count = minOf(requested, 8192).toInt()
                sink.write(ByteArray(count) { 'x'.code.toByte() })
                readBytes.addAndGet(count.toLong())
                count.toLong()
            }
        }))
        val result = runtime.safeCall<Unit> { throw failure } as AppResult.Error
        assertEquals("Server error. Please try again in a moment.", result.message)
        assertTrue("Read ${readBytes.get()} bytes", readBytes.get() <= 80 * 1024)
        assertTrue(closed.get())
    }

    @Test fun `cancelling a blocked error read closes the body without publishing an error`() = runBlocking {
        val entered = CountDownLatch(1)
        val closed = AtomicBoolean()
        val returned = AtomicBoolean()
        val failure = HttpException(Response.error<Unit>(503, body(closed) { _, _ ->
            entered.countDown()
            CountDownLatch(1).await()
            -1L
        }))
        val request = async(Dispatchers.Default) {
            runtime.safeCall<Unit> { throw failure }
            returned.set(true)
        }
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            request.cancelAndJoin()
            assertTrue(closed.get())
            assertTrue(request.isCancelled)
            assertEquals(false, returned.get())
        } finally {
            request.cancelAndJoin()
        }
    }

    private fun body(closed: AtomicBoolean, read: (Buffer, Long) -> Long): ResponseBody = object : ResponseBody() {
        private var completed = false
        private val source = object : Source {
            override fun read(sink: Buffer, byteCount: Long): Long {
                if (completed) return -1
                val count = read(sink, byteCount)
                // A short fixture response ends after one read; the oversized
                // source fills each request until its explicit EOF.
                completed = count < byteCount
                return count
            }
            override fun timeout(): Timeout = Timeout.NONE
            override fun close() { closed.set(true) }
        }.buffer()
        override fun contentType() = "application/json; charset=utf-8".toMediaType()
        override fun contentLength() = -1L
        override fun source(): BufferedSource = source
    }
}
