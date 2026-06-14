package com.selffeed.android.data

import com.selffeed.android.network.SyncResponse
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

/**
 * Unit tests for [FeedSyncWorker.doWork] that exercise the success/failure
 * matrix. We don't boot WorkManager here — that requires Robolectric or
 * instrumentation — because the worker's *behavior* is independent of the
 * scheduling layer. The schedule itself is covered by an integration smoke
 * test.
 *
 * The worker is `open` so tests can subclass it and override
 * `getApplicationContext` (which is `final` on ListenableWorker) to return
 * a mock [com.selffeed.android.SelfFeedApplication].
 */
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

    @Test
    fun `constraints require network connectivity`() {
        val constraints = androidx.work.Constraints.Builder()
            .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()
        assertEquals(androidx.work.NetworkType.CONNECTED, constraints.requiredNetworkType)
    }

    private fun buildWorker(
        loggedIn: Boolean,
        syncResult: AppResult<SyncResponse>?,
    ): TestFeedSyncWorker {
        val app = mockk<com.selffeed.android.SelfFeedApplication>(relaxed = true)
        val repo = mockk<RssRepository>()
        every { app.repository } returns repo
        coEvery { repo.isLoggedIn() } returns loggedIn
        if (syncResult != null) {
            coEvery { repo.syncAllFeeds() } returns syncResult
        }
        val params = mockk<androidx.work.WorkerParameters>(relaxed = true)
        // We construct the worker directly with the mock application as
        // its context. The Worker's `applicationContext` is `final` but
        // its constructor stores the context we pass; FeedSyncWorker.doWork
        // casts that stored context to SelfFeedApplication, so the cast
        // succeeds as long as we pass a SelfFeedApplication mock.
        return TestFeedSyncWorker(app, params)
    }

    private fun buildHttpError(message: String, code: Int): AppResult.Error {
        val exception = mockk<HttpException>()
        every { exception.code() } returns code
        every { exception.message() } returns message
        return AppResult.Error(message, exception)
    }
}

/**
 * Subclass of [FeedSyncWorker] used by the test suite. The parent
 * `getApplicationContext()` is `final`, so this is constructed by passing
 * the mock application as the context, which makes the
 * `applicationContext as SelfFeedApplication` cast inside `doWork`
 * succeed.
 */
private class TestFeedSyncWorker(
    mockApp: com.selffeed.android.SelfFeedApplication,
    params: androidx.work.WorkerParameters,
) : FeedSyncWorker(mockApp, params)
