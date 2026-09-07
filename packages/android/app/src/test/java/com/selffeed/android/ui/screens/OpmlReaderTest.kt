package com.selffeed.android.ui.screens

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OpmlReaderTest {
    @Test
    fun `opens and reads off the caller thread and closes the stream`() = runBlocking {
        val caller = Thread.currentThread()
        val closed = AtomicBoolean()
        val bytes = "<opml/>".toByteArray()
        val result = readBoundedOpml {
            assertNotEquals(caller, Thread.currentThread())
            object : ByteArrayInputStream(bytes) {
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    assertNotEquals(caller, Thread.currentThread())
                    return super.read(buffer, offset, length)
                }
                override fun close() { closed.set(true) }
            }
        }
        assertArrayEquals(bytes, result)
        assertTrue(closed.get())
    }

    @Test
    fun `accepts the size limit and rejects larger or unreadable input`() = runBlocking {
        val limit = 5 * 1024 * 1024
        assertEquals(limit, readBoundedOpml { ByteArrayInputStream(ByteArray(limit)) }?.size)
        assertNull(readBoundedOpml { ByteArrayInputStream(ByteArray(limit + 1)) })
        assertNull(readBoundedOpml { throw SecurityException("Permission revoked") })
        assertNull(readBoundedOpml { null })
    }

    @Test
    fun `cancelling a blocked read closes input and never returns import contents`() = runBlocking {
        val reading = CountDownLatch(1)
        val closed = AtomicBoolean()
        val returned = AtomicBoolean()
        val job = async(kotlinx.coroutines.Dispatchers.Default) {
            readBoundedOpml {
                object : InputStream() {
                    override fun read(): Int {
                        reading.countDown()
                        CountDownLatch(1).await()
                        return -1
                    }
                    override fun close() { closed.set(true) }
                }
            }
            returned.set(true)
        }
        assertTrue(reading.await(5, TimeUnit.SECONDS))
        job.cancelAndJoin()
        assertTrue(closed.get())
        assertFalse(returned.get())
    }
}
