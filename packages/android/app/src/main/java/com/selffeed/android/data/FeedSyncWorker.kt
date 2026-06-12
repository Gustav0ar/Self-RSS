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
import com.selffeed.android.BuildConfig
import com.selffeed.android.SelfFeedApplication
import retrofit2.HttpException
import java.util.concurrent.TimeUnit

open class FeedSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val app = applicationContext as SelfFeedApplication
        if (!app.repository.isLoggedIn()) {
            if (BuildConfig.DEBUG) Log.d(TAG, "Skipping sync — user is not logged in")
            return Result.success()
        }
        return when (val result = app.repository.syncAllFeeds()) {
            is AppResult.Success -> Result.success()
            is AppResult.Error -> {
                val cause = result.cause
                when {
                    cause is HttpException -> {
                        // 4xx is a permanent failure (auth/config) — don't retry.
                        if (cause.code() in 400..499) {
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

        fun kickOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<FeedSyncWorker>()
                .setConstraints(syncConstraints())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                ONE_SHOT_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
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
