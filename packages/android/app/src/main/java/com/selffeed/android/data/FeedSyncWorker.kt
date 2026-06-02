package com.selffeed.android.data

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.selffeed.android.SelfFeedApplication
import java.util.concurrent.TimeUnit

class FeedSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as SelfFeedApplication).repository
        return when (repository.syncAllFeeds()) {
            is AppResult.Success -> Result.success()
            is AppResult.Error -> Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "rss-feed-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<FeedSyncWorker>(30, TimeUnit.MINUTES)
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
