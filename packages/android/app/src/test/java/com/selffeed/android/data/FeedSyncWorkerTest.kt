package com.selffeed.android.data

import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.network.SyncResponse
import com.selffeed.android.network.FeedSyncAllStatus
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException

/** Worker result classification; account ownership is exercised with real Room in RssRepositoryTest. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class FeedSyncWorkerTest {
    @Test
    fun `doWork returns success when sync succeeds`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = AppResult.Success(SyncResponse(syncedFeeds = 3, failedFeeds = 0)),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.success(), result)
    }

    @Test
    fun `doWork returns success when user is not logged in`() = runBlocking {
        val worker = buildWorker(loggedIn = false, syncResult = null)
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.success(), result)
    }

    @Test
    fun `doWork returns failure on 401 (no retry)`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = buildHttpError("Unauthorized", 401),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.failure(), result)
    }

    @Test
    fun `doWork returns failure on 403 (no retry)`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = buildHttpError("Forbidden", 403),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.failure(), result)
    }

    @Test
    fun `doWork returns failure on 404 (no retry)`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = buildHttpError("Not found", 404),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.failure(), result)
    }

    @Test
    fun `doWork returns retry on 500`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = buildHttpError("Internal server error", 500),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.retry(), result)
    }

    @Test
    fun `doWork returns retry on 503`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = buildHttpError("Service unavailable", 503),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.retry(), result)
    }

    @Test
    fun `doWork returns retry on transient network errors (no cause)`() = runBlocking {
        val worker = buildWorker(
            loggedIn = true,
            syncResult = AppResult.Error("Network unreachable", null),
        )
        val result = worker.doWork()
        assertEquals(androidx.work.ListenableWorker.Result.retry(), result)
    }

    private fun buildWorker(
        loggedIn: Boolean,
        syncResult: AppResult<SyncResponse>?,
    ): FeedSyncWorker {
        val repo = mockk<RssRepository>()
        coEvery { repo.withAuthenticatedAccount<androidx.work.ListenableWorker.Result>(any()) } coAnswers {
            if (loggedIn) firstArg<suspend () -> androidx.work.ListenableWorker.Result>().invoke() else null
        }
        if (syncResult != null) {
            coEvery { repo.syncAllFeeds() } returns syncResult
            coEvery { repo.syncAllFeedsStatus() } returns AppResult.Success(
                FeedSyncAllStatus(
                    queued = false,
                    running = false,
                    active = false,
                    stale = false,
                ),
            )
        }
        val params = mockk<androidx.work.WorkerParameters>(relaxed = true)
        return FeedSyncWorker(ApplicationProvider.getApplicationContext(), params, repo)
    }

    private fun buildHttpError(message: String, code: Int): AppResult.Error {
        val exception = mockk<HttpException>()
        every { exception.code() } returns code
        every { exception.message() } returns message
        return AppResult.Error(message, exception)
    }
}
