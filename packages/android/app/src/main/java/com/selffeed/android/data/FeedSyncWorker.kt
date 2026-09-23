package com.selffeed.android.data

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.hilt.work.HiltWorker
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import retrofit2.HttpException
import java.util.concurrent.TimeUnit

@HiltWorker
class FeedSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: RssRepository,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result = try {
        repository.withAuthenticatedAccount { syncFeeds() } ?: Result.success()
    } catch (_: SessionChangedException) {
        Result.success()
    }

    private suspend fun syncFeeds(): Result {
        return when (val result = repository.syncAllFeeds()) {
            // The server owns the durable job after acceptance. Keeping a worker
            // alive to observe completion adds wakeups without downloading content.
            is AppResult.Success -> Result.success()
            is AppResult.Error -> {
                val cause = result.cause
                when {
                    cause is HttpException -> {
                        // 4xx is a permanent failure (auth/config) — don't retry.
                        if (cause.code() in 400..499 && cause.code() !in RETRIABLE_CLIENT_STATUSES) {
                            Log.w(TAG, "Sync failed with HTTP ${cause.code()}, will not retry: ${result.message}")
                            Result.failure()
                        } else {
                            Log.w(TAG, "Sync failed with HTTP ${cause.code()}, will retry: ${result.message}")
                            Result.retry()
                        }
                    }
                    else -> {
                        Log.w(TAG, "Sync failed: ${result.message}")
                        Result.retry()
                    }
                }
            }
        }
    }

    companion object {
        private const val TAG = "FeedSyncWorker"
        private const val PERIODIC_WORK_NAME = "rss-feed-sync"
        private const val ONE_SHOT_WORK_NAME = "rss-feed-sync-kick"
        private const val SYNC_INTERVAL_MINUTES = 30L
        private val RETRIABLE_CLIENT_STATUSES = setOf(408, 425, 429)

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<FeedSyncWorker>(
                repeatInterval = SYNC_INTERVAL_MINUTES,
                repeatIntervalTimeUnit = TimeUnit.MINUTES,
            )
                .setConstraints(syncConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        /** Restore durable work on process start without cancelling its current attempt. */
        fun ensureScheduled(context: Context): androidx.work.Operation {
            val request = OneTimeWorkRequestBuilder<FeedSyncWorker>()
                .setConstraints(syncConstraints())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.SECONDS)
                .build()
            return WorkManager.getInstance(context).enqueueUniqueWork(
                ONE_SHOT_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }

        fun cancelOneShot(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(ONE_SHOT_WORK_NAME)
        }

        private fun syncConstraints(): Constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()
    }
}
