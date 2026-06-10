package com.selffeed.android.data

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.selffeed.android.network.ArticleListItem

data class ArticlePageQuery(
    val feedId: String? = null,
    val categoryId: String? = null,
    val unreadOnly: Boolean = false,
    val sort: String? = null,
    val generation: Long = 0L,
)

class ArticlePagingSource(
    private val repository: RssRepository,
    private val query: ArticlePageQuery,
) : PagingSource<String, ArticleListItem>() {
    override suspend fun load(params: LoadParams<String>): LoadResult<String, ArticleListItem> {
        val pageSize = params.loadSize.coerceAtMost(MAX_PAGE_SIZE)
        return when (
            val result = repository.articles(
                feedId = query.feedId,
                categoryId = query.categoryId,
                unreadOnly = query.unreadOnly,
                sort = query.sort,
                limit = pageSize,
                cursor = params.key,
            )
        ) {
            is AppResult.Success -> LoadResult.Page(
                data = result.data.data,
                prevKey = null,
                nextKey = result.data.cursor.takeIf { result.data.hasMore },
            )
            is AppResult.Error -> LoadResult.Error(IllegalStateException(result.message))
        }
    }

    override fun getRefreshKey(state: PagingState<String, ArticleListItem>): String? = null

    private companion object {
        const val MAX_PAGE_SIZE = 60
    }
}
