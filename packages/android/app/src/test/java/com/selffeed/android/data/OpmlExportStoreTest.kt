package com.selffeed.android.data

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import androidx.core.content.FileProvider
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OpmlExportStoreTest {
    @Before fun attachProviderToThisTestApplication() {
        // Robolectric assigns a new cache directory per test; FileProvider caches roots by authority.
        val app = ApplicationProvider.getApplicationContext<Context>()
        val info = app.packageManager.resolveContentProvider("${app.packageName}.provider", 0)!!
        FileProvider().attachInfo(app, info)
    }

    @Test fun preparedFilesAreUniqueCompleteAndOnlyUnsharedFilesAreDiscarded() = runBlocking {
        val caller = Thread.currentThread()
        val app = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getCacheDir(): File {
                assertNotEquals("File paths must be resolved off the caller thread", caller, Thread.currentThread())
                return super.getCacheDir()
            }
        }
        val store = OpmlExportStore(context, this)
        val first = store.prepare("<opml>日本語</opml>")
        val second = store.prepare("<opml>second</opml>")
        assertNotEquals(first.uri, second.uri)
        assertEquals("<opml>日本語</opml>", app.contentResolver.openInputStream(first.uri)!!.bufferedReader().use { it.readText() })
        store.release(first, shared = false)
        store.renewRetention(second)
        store.release(second, shared = true)
        coroutineContext[kotlinx.coroutines.Job]!!.children.toList().forEach { it.join() }
        assertFalse(first.file.exists())
        assertTrue(second.file.exists())
        store.reapStaleExports()
        assertTrue(second.file.exists())
    }

    @Test fun maintenanceOnlyExpiresOwnedFilesAndProtectsPendingExports() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val store = OpmlExportStore(app, this)
        val prepared = store.prepare("<opml />")
        val directory = prepared.file.parentFile!!
        val old = System.currentTimeMillis() - 2 * 24 * 60 * 60_000L
        val legacy = File(directory, "rss-feeds-12345.opml").apply { writeText("old"); setLastModified(old) }
        val unrelated = File(directory, "other-attachment.txt").apply { writeText("keep"); setLastModified(old) }
        val subdirectory = File(directory, "rss-feeds-67890.opml").apply { mkdir() }
        val nested = File(subdirectory, "private").apply { writeText("keep") }
        prepared.file.setLastModified(old)

        store.reapStaleExports()
        assertFalse(legacy.exists())
        assertTrue(unrelated.exists())
        assertTrue(nested.exists())
        assertTrue(prepared.file.exists())

        store.renewRetention(prepared)
        store.release(prepared, shared = true)
        coroutineContext[kotlinx.coroutines.Job]!!.children.toList().forEach { it.join() }
        store.reapStaleExports()
        assertTrue("Sharing after a long screen absence renews retention", prepared.file.exists())
        prepared.file.setLastModified(old)
        store.reapStaleExports()
        assertFalse(prepared.file.exists())
    }

    @Test fun cancellationAfterWritingDeletesTheFileBeforeReturning() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val reached = CountDownLatch(1)
        val release = CountDownLatch(1)
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getPackageName(): String {
                reached.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                return super.getPackageName()
            }
        }
        val store = OpmlExportStore(context, this)
        val work = async(Dispatchers.Default) { store.prepare("<opml />") }
        try {
            assertTrue(reached.await(5, TimeUnit.SECONDS))
            assertTrue(File(app.cacheDir, "shared").listFiles().orEmpty().isNotEmpty())
            work.cancel()
            release.countDown()
            withTimeout(5_000) { work.join() }
            assertTrue(File(app.cacheDir, "shared").listFiles().orEmpty().isEmpty())
        } finally {
            release.countDown()
            work.cancelAndJoin()
        }
    }

    @Test fun providerFailureRemovesThePartiallyPreparedFile() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getPackageName(): String = "missing.test.provider"
        }
        val store = OpmlExportStore(context, this)
        val failure = runCatching { store.prepare("<opml />") }.exceptionOrNull()
        assertTrue(failure is IllegalArgumentException)
        assertTrue(File(app.cacheDir, "shared").listFiles().orEmpty().isEmpty())
    }

    @Test fun aSharedExportSurvivesProcessLossBeforeQueuedCleanupRuns() = runTest {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val queuedMaintenance = CoroutineScope(StandardTestDispatcher(testScheduler))
        val store = OpmlExportStore(app, queuedMaintenance)
        try {
            val prepared = store.prepare("<opml>still being shared</opml>")
            prepared.file.setLastModified(System.currentTimeMillis() - 2 * 24 * 60 * 60_000L)
            store.renewRetention(prepared)
            store.release(prepared, shared = true)
            // The previous process's queued cleanup and in-memory pins do not survive.
            queuedMaintenance.cancel()
            OpmlExportStore(app, this).reapStaleExports()
            assertTrue("A just-shared export must survive startup maintenance", prepared.file.exists())
        } finally { queuedMaintenance.cancel() }
    }
}
