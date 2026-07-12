package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArticleWarmingManagerTest {
    @Test
    fun `warms next articles first without enriching or refetching the current article`() = runTest {
        val repository = mockk<SelfFeedRepository>()
        every { repository.cachedArticleDetail(any()) } returns null
        every { repository.prefetchHeroImages(any()) } just Runs
        coEvery { repository.prefetchArticle(any()) } answers {
            AppResult.Success(detail(firstArg()))
        }
        val manager = ArticleWarmingManager(repository)
        manager.setScope(this)
        val items = (0..4).map { item("a$it") }

        manager.warmAdjacentArticles("a2", items)
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.prefetchArticle("a2") }
        coVerify(exactly = 1) { repository.prefetchArticle("a3") }
        coVerify(exactly = 1) { repository.prefetchArticle("a4") }
        coVerify(exactly = 1) { repository.prefetchArticle("a1") }
        coVerify(exactly = 0) { repository.enrichArticle(any(), any()) }
    }

    private fun item(id: String) = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = id,
        displayedAt = "2026-07-11T12:00:00.000Z",
        isRead = false,
    )

    private fun detail(id: String) = ArticleDetail(
        id = id,
        feedId = "feed-1",
        guid = id,
        title = id,
        hash = id,
        feedTitle = "Feed",
        isRead = false,
    )
}
