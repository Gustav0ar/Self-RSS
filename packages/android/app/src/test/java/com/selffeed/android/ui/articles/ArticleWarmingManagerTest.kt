package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticleMedia
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
        val items = (0..12).map { item("a$it") }

        manager.warmAdjacentArticles("a6", items)
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.prefetchArticle("a6") }
        (7..12).forEach { index ->
            coVerify(exactly = 1) { repository.prefetchArticle("a$index") }
        }
        (2..5).forEach { index ->
            coVerify(exactly = 1) { repository.prefetchArticle("a$index") }
        }
        coVerify(exactly = 0) { repository.prefetchArticle("a0") }
        coVerify(exactly = 0) { repository.prefetchArticle("a1") }
        coVerify(exactly = 0) { repository.enrichArticle(any(), any()) }
    }

    @Test
    fun `visible warming prefetches the fast swipe window and prioritizes pending enrichment`() = runTest {
        val repository = mockk<SelfFeedRepository>()
        every { repository.cachedArticleDetail(any()) } returns null
        every { repository.prefetchHeroImages(any()) } just Runs
        coEvery { repository.prefetchArticle(any()) } answers {
            AppResult.Success(detail(firstArg(), contentStatus = "enrichment_pending"))
        }
        coEvery { repository.enrichArticle(any(), any()) } returns AppResult.Success(
            com.selffeed.android.network.EnrichArticleResponse(success = true, queued = true),
        )
        val manager = ArticleWarmingManager(repository)
        manager.setScope(this)
        val items = (0..5).map { item("a$it") }

        manager.warmVisibleArticles(items)
        advanceUntilIdle()
        manager.warmVisibleArticles(items)
        advanceUntilIdle()

        (0..5).forEach { index ->
            coVerify(exactly = 1) { repository.prefetchArticle("a$index") }
            coVerify(exactly = 1) { repository.enrichArticle("a$index", false) }
        }
    }

    @Test
    fun `rapid adjacent warming does not cancel an in-flight article needed for a swipe`() = runTest {
        val repository = mockk<SelfFeedRepository>()
        val firstArticle = CompletableDeferred<AppResult<ArticleDetail>>()
        every { repository.cachedArticleDetail(any()) } returns null
        every { repository.prefetchHeroImages(any()) } just Runs
        coEvery { repository.prefetchArticle(any()) } answers {
            AppResult.Success(detail(firstArg()))
        }
        coEvery { repository.prefetchArticle("a1") } coAnswers { firstArticle.await() }
        val warmedIds = mutableListOf<String>()
        val manager = ArticleWarmingManager(repository)
        manager.setScope(this)
        manager.setOnArticlesWarmed { details -> warmedIds += details.map { it.id } }
        val items = (0..12).map { item("a$it") }

        manager.warmAdjacentArticles("a0", items)
        manager.warmAdjacentArticles("a6", items)
        firstArticle.complete(AppResult.Success(detail("a1")))
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.prefetchArticle("a1") }
        assertTrue(warmedIds.contains("a1"))
    }

    @Test
    fun `publishes warmed details and prefetches embedded article images`() = runTest {
        val repository = mockk<SelfFeedRepository>()
        val imageRequests = mutableListOf<Iterable<String?>>()
        every { repository.cachedArticleDetail(any()) } returns null
        every { repository.prefetchHeroImages(capture(imageRequests)) } just Runs
        coEvery { repository.prefetchArticle(any()) } answers {
            AppResult.Success(
                detail(firstArg()).copy(
                    heroImageUrl = "https://example.com/hero.jpg",
                    media = listOf(
                        media("image", "https://example.com/body.jpg"),
                        media("video", "https://example.com/video.mp4"),
                    ),
                ),
            )
        }
        val warmed = mutableListOf<ArticleDetail>()
        val manager = ArticleWarmingManager(repository)
        manager.setScope(this)
        manager.setOnArticlesWarmed(warmed::addAll)

        manager.warmAdjacentArticles("a0", listOf(item("a0"), item("a1")))
        advanceUntilIdle()

        assertEquals(listOf("a1"), warmed.map { it.id })
        val requestedUrls = imageRequests.flatMap { it.toList() }.filterNotNull()
        assertTrue("https://example.com/hero.jpg" in requestedUrls)
        assertTrue("https://example.com/body.jpg" in requestedUrls)
        assertTrue("https://example.com/video.mp4" !in requestedUrls)
    }

    private fun item(id: String) = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = id,
        displayedAt = "2026-07-11T12:00:00.000Z",
        isRead = false,
    )

    private fun detail(id: String, contentStatus: String = "feed_ready") = ArticleDetail(
        id = id,
        feedId = "feed-1",
        guid = id,
        title = id,
        hash = id,
        feedTitle = "Feed",
        isRead = false,
        contentStatus = contentStatus,
    )

    private fun media(type: String, url: String) = ArticleMedia(
        id = "$type-$url",
        articleId = "a1",
        type = type,
        provider = "test",
        url = url,
        position = 0,
    )
}
