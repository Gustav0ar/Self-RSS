package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.EnrichArticleResponse
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EnrichmentManagerTest {
    @Test
    fun `delivers a refreshed selected article back to observable view model state`() = runTest {
        val repository = mockk<SelfFeedRepository>()
        val initial = detail(content = "Feed fallback", version = 1)
        val refreshed = detail(content = "Canonical body", version = 2, enriched = true)
        coEvery { repository.enrichArticle("article-1", true) } returns
            AppResult.Success(EnrichArticleResponse(success = true, queued = true))
        coEvery { repository.article("article-1", true) } returns AppResult.Success(refreshed)
        val manager = EnrichmentManager(repository)
        manager.setScope(this)
        manager.updateSelectedArticle(initial)
        var delivered: ArticleDetail? = null
        manager.setOnArticleRefreshed { delivered = it }

        manager.maybeEnrichSelectedArticle(initial)
        advanceUntilIdle()

        assertEquals(refreshed, delivered)
    }

    private fun detail(
        content: String,
        version: Int,
        enriched: Boolean = false,
    ) = ArticleDetail(
        id = "article-1",
        feedId = "feed-1",
        guid = "article-1",
        canonicalUrl = "https://example.com/article-1",
        title = "Article",
        contentHtml = "<p>$content</p>",
        contentText = content,
        hash = "hash-$version",
        feedTitle = "Feed",
        isRead = false,
        isEnriched = enriched,
        contentStatus = if (enriched) "full_ready" else "feed_ready",
        contentVersion = version,
    )
}
