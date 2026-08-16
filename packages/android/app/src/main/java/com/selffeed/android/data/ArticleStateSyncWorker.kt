package com.selffeed.android.data

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/** Delivers the Room-backed article outbox after process death or connectivity loss. */
@HiltWorker
class ArticleStateSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: RssRepository,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        repository.prepareSession()
        if (!repository.isLoggedIn()) return Result.success()
        return if (repository.flushPendingArticleStateMutations()) Result.success() else Result.retry()
    }

    companion object {
        private const val WORK_NAME = "article-state-outbox"

        fun kickOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<ArticleStateSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
