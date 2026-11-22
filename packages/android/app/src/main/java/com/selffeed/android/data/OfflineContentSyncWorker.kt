package com.selffeed.android.data

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkQuery
import androidx.work.WorkerParameters
import androidx.work.await
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

/**
 * Incrementally downloads full article text and inline/hero media into Room and
 * [com.selffeed.android.data.local.OfflineMediaCache] after feed syncs so every
 * synced feed is immediately readable offline without manual bookmarking.
 */
@HiltWorker
class OfflineContentSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: RssRepository,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result = try {
        repository.withAuthenticatedAccount {
            val complete = repository.syncOfflineContent()
            if (complete) Result.success() else Result.retry()
        } ?: Result.success()
    } catch (_: SessionChangedException) {
        Result.success()
    } catch (error: Exception) {
        if (error is kotlinx.coroutines.CancellationException) throw error
        Log.w(TAG, "Offline content sync failed; will retry: ${error.message}")
        Result.retry()
    }

    companion object {
        private const val TAG = "OfflineContentSyncWorker"
        internal const val WORK_NAME = "offline-content-sync"
        private const val POST_FEED_SYNC_DELAY_SECONDS = 15L
        private val scheduling = Mutex()

        /**
         * Coalesces foreground/sync-completion triggers without chaining duplicate
         * back-to-back runs while a pass is already in flight unless [appendIfRunning]
         * is explicitly requested (e.g. after a feed refresh produces new entries).
         */
        suspend fun kickOnce(context: Context, appendIfRunning: Boolean = false) = scheduling.withLock {
            val workManager = WorkManager.getInstance(context)
            val query = WorkQuery.Builder.fromUniqueWorkNames(listOf(WORK_NAME))
                .addStates(listOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED))
                .build()
            val unfinished = workManager.getWorkInfosFlow(query).first()
            if (unfinished.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }) {
                return@withLock
            }
            if (unfinished.isNotEmpty() && !appendIfRunning) {
                return@withLock
            }
            val policy = if (unfinished.isEmpty()) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.APPEND_OR_REPLACE
            enqueue(context, policy, initialDelaySeconds = 0L, requireBatteryNotLow = false).await()
        }

        /**
         * Scheduled after background [FeedSyncWorker] submits a server refresh.
         * A brief delay lets the server ingest fresh entries before we pull the
         * delta bodies and media, while respecting battery state.
         */
        fun kickAfterFeedSync(context: Context): androidx.work.Operation =
            enqueue(
                context = context,
                policy = ExistingWorkPolicy.KEEP,
                initialDelaySeconds = POST_FEED_SYNC_DELAY_SECONDS,
                requireBatteryNotLow = true,
            )

        /** Restore durable offline sync on startup without resetting active work. */
        fun ensureScheduled(context: Context): androidx.work.Operation =
            enqueue(
                context = context,
                policy = ExistingWorkPolicy.KEEP,
                initialDelaySeconds = 0L,
                requireBatteryNotLow = false,
            )

        private fun enqueue(
            context: Context,
            policy: ExistingWorkPolicy,
            initialDelaySeconds: Long,
            requireBatteryNotLow: Boolean,
        ): androidx.work.Operation {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(requireBatteryNotLow)
                .build()
            val builder = OneTimeWorkRequestBuilder<OfflineContentSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            if (initialDelaySeconds > 0L) {
                builder.setInitialDelay(initialDelaySeconds, TimeUnit.SECONDS)
            }
            return WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                policy,
                builder.build(),
            )
        }
    }
}
