package com.selffeed.android.ui

import android.os.Looper
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.selffeed.android.ui.screens.readBoundedOpml
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OpmlReaderUiTest {
    @Test fun cancellingAnImportClosesABlockedAndroidPipe() = runBlocking {
        val pipe = ParcelFileDescriptor.createPipe()
        val reading = CountDownLatch(1)
        val closes = AtomicInteger()
        val published = AtomicBoolean()
        val input = object : ParcelFileDescriptor.AutoCloseInputStream(pipe[0]) {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                assertNotEquals(Looper.getMainLooper(), Looper.myLooper())
                reading.countDown()
                return super.read(buffer, offset, length)
            }
            override fun close() { closes.incrementAndGet(); super.close() }
        }
        val job = launch(Dispatchers.Main) {
            readBoundedOpml {
                assertNotEquals(Looper.getMainLooper(), Looper.myLooper())
                input
            }
            published.set(true)
        }
        try {
            assertTrue(withContext(Dispatchers.IO) { reading.await(5, TimeUnit.SECONDS) })
            job.cancel()
            val stopped = withTimeoutOrNull(3_000) { job.join(); true } ?: false
            assertTrue("Cancellation must close the descriptor without waiting for provider data", stopped)
            assertEquals(1, closes.get())
            assertFalse(published.get())
        } finally {
            // Release the producer even on failure so a broken cancellation
            // implementation cannot strand this test's consumer thread.
            pipe[1].close()
            job.cancelAndJoin()
            pipe[0].close()
        }
    }
}
