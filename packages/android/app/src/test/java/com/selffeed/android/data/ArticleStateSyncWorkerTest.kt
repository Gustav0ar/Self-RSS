package com.selffeed.android.data

import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ArticleStateSyncWorkerTest {
    @Test
    fun `logged out work succeeds without touching the outbox`() = runBlocking {
        val repository = mockk<RssRepository>()
        coEvery { repository.prepareSession() } returns Unit
        coEvery { repository.isLoggedIn() } returns false

        val result = worker(repository).doWork()

        assertEquals(ListenableWorker.Result.success(), result)
        coVerify(exactly = 0) { repository.flushPendingArticleStateMutations() }
    }

    @Test
    fun `fully delivered outbox succeeds`() = runBlocking {
        val repository = mockk<RssRepository>()
        coEvery { repository.prepareSession() } returns Unit
        coEvery { repository.isLoggedIn() } returns true
        coEvery { repository.flushPendingArticleStateMutations() } returns true

        assertEquals(ListenableWorker.Result.success(), worker(repository).doWork())
    }

    @Test
    fun `transiently blocked outbox retries`() = runBlocking {
        val repository = mockk<RssRepository>()
        coEvery { repository.prepareSession() } returns Unit
        coEvery { repository.isLoggedIn() } returns true
        coEvery { repository.flushPendingArticleStateMutations() } returns false

        assertEquals(ListenableWorker.Result.retry(), worker(repository).doWork())
    }

    private fun worker(repository: RssRepository) = ArticleStateSyncWorker(
        ApplicationProvider.getApplicationContext(),
        mockk<WorkerParameters>(relaxed = true),
        repository,
    )
}
