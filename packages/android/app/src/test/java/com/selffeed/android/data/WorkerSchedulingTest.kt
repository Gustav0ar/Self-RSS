package com.selffeed.android.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class WorkerSchedulingTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var workManager: WorkManager

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
        workManager = WorkManager.getInstance(context)
    }

    @After
    fun close() {
        workManager.cancelAllWork().result.get(5, TimeUnit.SECONDS)
        WorkManagerTestInitHelper.closeWorkDatabase()
    }

    @Test
    fun `startup keeps pending feed sync and outbox work`() {
        FeedSyncWorker.ensureScheduled(context).result.get(5, TimeUnit.SECONDS)
        ArticleStateSyncWorker.ensureScheduled(context).result.get(5, TimeUnit.SECONDS)
        val feed = work("rss-feed-sync-kick").single()
        val outbox = work("article-state-outbox").single()
        assertEquals(WorkInfo.State.ENQUEUED, feed.state)
        assertEquals(WorkInfo.State.ENQUEUED, outbox.state)

        repeat(3) {
            FeedSyncWorker.ensureScheduled(context).result.get(5, TimeUnit.SECONDS)
            ArticleStateSyncWorker.ensureScheduled(context).result.get(5, TimeUnit.SECONDS)
        }

        assertEquals(listOf(feed.id), work("rss-feed-sync-kick").map { it.id })
        assertEquals(listOf(outbox.id), work("article-state-outbox").map { it.id })
        assertEquals(WorkInfo.State.ENQUEUED, work("rss-feed-sync-kick").single().state)
        assertEquals(WorkInfo.State.ENQUEUED, work("article-state-outbox").single().state)
    }

    private fun work(name: String) = workManager.getWorkInfosForUniqueWork(name).get(5, TimeUnit.SECONDS)
}
