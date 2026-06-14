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
    private val readStateOverrides: () -> Map<String, Boolean> = { emptyMap() },
) : PagingSource<String, ArticleListItem>() {
    override suspend fun load(params: LoadParams<String>): LoadResult<String, ArticleListItem> {
        val pageSize = params.loadSize.coerceAtMost(MAX_PAGE_SIZE)
        return try {
            when (
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
                    data = result.data.data.withReadStates(readStateOverrides()),
                    prevKey = null,
                    nextKey = result.data.cursor.takeIf { result.data.hasMore },
                )
                is AppResult.Error -> LoadResult.Error(IllegalStateException(result.message))
            }
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    /**
     * Returns the key to refresh around. Returning a non-null value lets
     * Paging 3 anchor the next refresh on the user's current scroll
     * position, which is the right behavior for an "infinite scroll"
     * article list. Returning `null` would force a top-of-list refresh
     * on every pull-to-refresh.
     */
    override fun getRefreshKey(state: PagingState<String, ArticleListItem>): String? {
        val anchor = state.anchorPosition ?: return null
        val closest = state.closestPageToPosition(anchor) ?: return null
        return closest.prevKey ?: closest.nextKey
    }

    private companion object {
        const val MAX_PAGE_SIZE = 60
    }
}

private fun List<ArticleListItem>.withReadStates(
    readStates: Map<String, Boolean>,
): List<ArticleListItem> =
    map { article ->
        readStates[article.id]?.let { article.copy(isRead = it) } ?: article
    }
