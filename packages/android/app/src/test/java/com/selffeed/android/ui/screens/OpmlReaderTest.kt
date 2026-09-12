package com.selffeed.android.ui.screens

import android.content.Context
import android.content.ContentResolver
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.os.CancellationSignal
import io.mockk.every
import io.mockk.mockk
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
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OpmlReaderTest {
    @Test
    fun `document acquisition uses the application resolver off the caller thread`() = runBlocking {
        val caller = Thread.currentThread()
        val activity = mockk<Context>()
        val application = mockk<Context>()
        val resolver = mockk<ContentResolver>()
        val descriptor = mockk<AssetFileDescriptor>()
        val uri = mockk<Uri>()
        val bytes = "<opml/>".encodeToByteArray()
        val input = mockk<java.io.FileInputStream>()
        var consumed = false
        var closes = 0
        every { activity.applicationContext } returns application
        every { activity.contentResolver } throws AssertionError("The Activity must not be retained for acquisition")
        every { application.contentResolver } answers { assertNotEquals(caller, Thread.currentThread()); resolver }
        every { uri.lastPathSegment } returns "feeds.opml"
        every { resolver.openAssetFileDescriptor(uri, "r", any()) } answers {
            assertNotEquals(caller, Thread.currentThread())
            descriptor
        }
        every { descriptor.createInputStream() } returns input
        every { input.read(any<ByteArray>()) } answers {
            assertNotEquals(caller, Thread.currentThread())
            if (consumed) -1 else {
                consumed = true
                bytes.copyInto(firstArg<ByteArray>())
                bytes.size
            }
        }
        every { input.close() } answers { closes++ }
        val reader = OpmlDocumentReader(activity)
        val result = reader.read(uri)
        assertEquals("feeds.opml", result?.fileName)
        assertArrayEquals(bytes, result?.bytes)
        assertEquals(1, closes)
        var descriptorCloses = 0
        every { descriptor.createInputStream() } throws java.io.IOException("Cannot open file slice")
        every { descriptor.close() } answers { descriptorCloses++ }
        assertNull(reader.read(uri))
        assertEquals(1, descriptorCloses)
    }

    @Test
    fun `cancelling provider acquisition signals the open even if interruption is ignored`() = runBlocking {
        val context = mockk<Context>()
        val resolver = mockk<ContentResolver>()
        val uri = mockk<Uri>()
        val opening = CountDownLatch(1)
        val release = CountDownLatch(1)
        val cancelled = AtomicBoolean()
        every { context.applicationContext } returns context
        every { context.contentResolver } returns resolver
        every { resolver.openAssetFileDescriptor(uri, "r", any()) } answers {
            val signal = thirdArg<CancellationSignal>()
            signal.setOnCancelListener { cancelled.set(true); release.countDown() }
            opening.countDown()
            while (release.count > 0) {
                try { release.await() } catch (_: InterruptedException) { /* Provider ignores interruption. */ }
            }
            signal.throwIfCanceled()
            null
        }
        val read = async(kotlinx.coroutines.Dispatchers.Default) { OpmlDocumentReader(context).read(uri) }
        try {
            assertTrue(opening.await(5, TimeUnit.SECONDS))
            read.cancel()
            kotlinx.coroutines.withTimeout(5_000) { read.join() }
            assertTrue(cancelled.get())
        } finally {
            release.countDown()
            read.cancelAndJoin()
        }
    }

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
