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
        coEvery { repository.withAuthenticatedAccount<ListenableWorker.Result>(any()) } returns null

        val result = worker(repository).doWork()

        assertEquals(ListenableWorker.Result.success(), result)
        coVerify(exactly = 0) { repository.flushPendingArticleStateMutations() }
    }

    @Test
    fun `fully delivered outbox succeeds`() = runBlocking {
        val repository = mockk<RssRepository>()
        coEvery { repository.withAuthenticatedAccount<ListenableWorker.Result>(any()) } coAnswers {
            firstArg<suspend () -> ListenableWorker.Result>().invoke()
        }
        coEvery { repository.flushPendingArticleStateMutations() } returns true

        assertEquals(ListenableWorker.Result.success(), worker(repository).doWork())
        coVerify(exactly = 0) { repository.downloadMissingSavedArticles() }
    }

    @Test
    fun `saved download job retries independently of mutation delivery`() = runBlocking {
        val repository = mockk<RssRepository>()
        coEvery { repository.withAuthenticatedAccount<ListenableWorker.Result>(any()) } coAnswers {
            firstArg<suspend () -> ListenableWorker.Result>().invoke()
        }
        coEvery { repository.downloadMissingSavedArticles() } returns false
        val parameters = mockk<WorkerParameters>(relaxed = true)
        io.mockk.every { parameters.inputData } returns androidx.work.workDataOf(ArticleStateSyncWorker.DOWNLOAD_SAVED to true)
        val worker = ArticleStateSyncWorker(ApplicationProvider.getApplicationContext(), parameters, repository)
        assertEquals(ListenableWorker.Result.retry(), worker.doWork())
        coVerify(exactly = 0) { repository.flushPendingArticleStateMutations() }
    }

    @Test
    fun `transiently blocked outbox retries`() = runBlocking {
        val repository = mockk<RssRepository>()
        coEvery { repository.withAuthenticatedAccount<ListenableWorker.Result>(any()) } coAnswers {
            firstArg<suspend () -> ListenableWorker.Result>().invoke()
        }
        coEvery { repository.flushPendingArticleStateMutations() } returns false

        assertEquals(ListenableWorker.Result.retry(), worker(repository).doWork())
    }

    private fun worker(repository: RssRepository) = ArticleStateSyncWorker(
        ApplicationProvider.getApplicationContext(),
        mockk<WorkerParameters>(relaxed = true),
        repository,
    )
}
