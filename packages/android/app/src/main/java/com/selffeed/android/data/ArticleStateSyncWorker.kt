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
import androidx.work.WorkInfo
import androidx.work.WorkQuery
import androidx.work.await
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/** Delivers the Room-backed article outbox after process death or connectivity loss. */
@HiltWorker
class ArticleStateSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: RssRepository,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result = try {
        repository.withAuthenticatedAccount {
            if (repository.flushPendingArticleStateMutations()) Result.success() else Result.retry()
        } ?: Result.success()
    } catch (_: SessionChangedException) {
        Result.success()
    }

    companion object {
        private const val WORK_NAME = "article-state-outbox"
        private val scheduling = Mutex()

        /** Coalesce pending attempts and retain one successor when delivery is already running. */
        suspend fun kickOnce(context: Context) = scheduling.withLock {
            val workManager = WorkManager.getInstance(context)
            val query = WorkQuery.Builder.fromUniqueWorkNames(listOf(WORK_NAME))
                .addStates(listOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED))
                .build()
            val unfinished = workManager.getWorkInfosFlow(query).first()
            // Intent is committed before this query. An unstarted attempt will
            // see it; a running attempt may already have observed an empty queue.
            if (unfinished.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }) {
                return@withLock
            }
            val policy = if (unfinished.isEmpty()) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.APPEND_OR_REPLACE
            enqueue(context, policy).await()
        }

        /** Restore durable work on process start without resetting retry backoff. */
        fun ensureScheduled(context: Context) = enqueue(context, ExistingWorkPolicy.KEEP)

        private fun enqueue(context: Context, policy: ExistingWorkPolicy): androidx.work.Operation {
            val request = OneTimeWorkRequestBuilder<ArticleStateSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            return WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                policy,
                request,
            )
        }
    }
}
