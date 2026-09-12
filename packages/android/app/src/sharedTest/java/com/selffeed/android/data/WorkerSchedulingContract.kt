package com.selffeed.android.data

import android.content.Context
import android.annotation.SuppressLint
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.impl.WorkManagerImpl
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit
import java.util.UUID

abstract class WorkerSchedulingContract {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var workManager: WorkManager
    private val started = Channel<UUID>(Channel.UNLIMITED)
    private val outcomes = Channel<ListenableWorker.Result>(Channel.UNLIMITED)

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder()
                .setExecutor(SynchronousExecutor())
                .setWorkerFactory(object : WorkerFactory() {
                    override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? {
                        if (workerClassName != ArticleStateSyncWorker::class.java.name) return null
                        return object : CoroutineWorker(appContext, workerParameters) {
                            override suspend fun doWork(): Result {
                                started.send(id)
                                return outcomes.receive()
                            }
                        }
                    }
                }).build(),
        )
        workManager = WorkManager.getInstance(context)
    }

    @After
    @SuppressLint("RestrictedApi")
    fun close() {
        try {
            workManager.cancelAllWork().result.get(5, TimeUnit.SECONDS)
            WorkManagerTestInitHelper.closeWorkDatabase()
        } finally {
            // work-testing closes Room but leaves its test delegate installed.
            // Undo its setDelegate call so later tests cannot use that closed DB.
            WorkManagerImpl.setDelegate(null)
            started.close()
            outcomes.close()
        }
    }

    @Test
    fun startupKeepsPendingFeedSyncAndOutboxWork() {
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

    @Test
    fun aBurstOfLocalChangesPreservesOneQueuedDelivery() = runBlocking {
        ArticleStateSyncWorker.kickOnce(context)
        val original = work("article-state-outbox").single()

        repeat(20) { ArticleStateSyncWorker.kickOnce(context) }

        val remaining = work("article-state-outbox").filterNot { it.state.isFinished }
        assertEquals(listOf(original.id), remaining.map { it.id })
    }

    @Test
    fun editsDuringAFinishingAttemptRetainItAndOneDurableSuccessor() = runBlocking {
        val driver = requireNotNull(WorkManagerTestInitHelper.getTestDriver(context))
        ArticleStateSyncWorker.kickOnce(context)
        val original = work("article-state-outbox").single()
        driver.setAllConstraintsMet(original.id)
        assertEquals(original.id, withTimeout(5_000) { started.receive() })

        repeat(20) { ArticleStateSyncWorker.kickOnce(context) }
        val attempts = work("article-state-outbox").filterNot { it.state.isFinished }
        assertEquals(2, attempts.size)
        assertEquals(WorkInfo.State.RUNNING, attempts.single { it.id == original.id }.state)
        val successor = attempts.single { it.id != original.id }
        assertEquals(WorkInfo.State.BLOCKED, successor.state)
        driver.setAllConstraintsMet(successor.id)
        outcomes.send(ListenableWorker.Result.success())
        assertEquals(successor.id, withTimeout(5_000) { started.receive() })

        outcomes.send(ListenableWorker.Result.success())
        withTimeout(5_000) {
            workManager.getWorkInfosForUniqueWorkFlow("article-state-outbox").first { infos ->
                infos.all { it.state == WorkInfo.State.SUCCEEDED }
            }
        }
        ArticleStateSyncWorker.kickOnce(context)
        val next = work("article-state-outbox").filterNot { it.state.isFinished }.single()
        assertEquals(false, next.id in attempts.map { it.id })
        assertEquals(WorkInfo.State.ENQUEUED, next.state)
        assertEquals(1, work("article-state-outbox").size)
        repeat(4) {
            val current = work("article-state-outbox").single()
            driver.setAllConstraintsMet(current.id)
            assertEquals(current.id, withTimeout(5_000) { started.receive() })
            outcomes.send(ListenableWorker.Result.success())
            withTimeout(5_000) {
                workManager.getWorkInfosForUniqueWorkFlow("article-state-outbox").first { infos ->
                    infos.all { it.state == WorkInfo.State.SUCCEEDED }
                }
            }
            ArticleStateSyncWorker.kickOnce(context)
            assertEquals(1, work("article-state-outbox").size)
        }
    }

    private fun work(name: String) = workManager.getWorkInfosForUniqueWork(name).get(5, TimeUnit.SECONDS)
}
