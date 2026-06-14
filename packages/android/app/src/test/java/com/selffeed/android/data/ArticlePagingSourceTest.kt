package com.selffeed.android.data

import androidx.paging.PagingSource
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticlePagingSourceTest {
    @Test
    fun load_appliesLocalReadStateOverridesToStaleServerRows() = runTest {
        val repository = mockk<RssRepository>()
        coEvery {
            repository.articles(
                feedId = null,
                categoryId = null,
                unreadOnly = false,
                sort = null,
                limit = 30,
                cursor = null,
            )
        } returns AppResult.Success(
            ApiListResponse(
                data = listOf(
                    sampleArticle(id = "a1", isRead = false),
                    sampleArticle(id = "a2", isRead = false),
                ),
                cursor = null,
                hasMore = false,
            ),
        )

        val pagingSource = ArticlePagingSource(
            repository = repository,
            query = ArticlePageQuery(),
            readStateOverrides = { mapOf("a1" to true) },
        )

        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh<String>(
                key = null,
                loadSize = 30,
                placeholdersEnabled = false,
            ),
        )

        val page = result as PagingSource.LoadResult.Page<String, ArticleListItem>
        assertTrue(page.data.first { it.id == "a1" }.isRead)
        assertFalse(page.data.first { it.id == "a2" }.isRead)
    }

    private fun sampleArticle(
        id: String,
        isRead: Boolean,
    ): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        feedFaviconUrl = null,
        title = "Article $id",
        author = null,
        excerpt = "Excerpt",
        heroImageUrl = null,
        publishedAt = null,
        isRead = isRead,
    )
}
