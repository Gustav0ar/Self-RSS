package com.selffeed.android.data.local

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.selffeed.android.network.ArticleListItem

/** Keeps Room's absolute query offset when Paging presents a window without placeholders. */
internal class AnchoredArticlePagingSource(
    private val source: PagingSource<Int, ArticleListItem>,
) : PagingSource<Int, ArticleListItem>() {
    init {
        source.registerInvalidatedCallback(::invalidate)
        registerInvalidatedCallback(source::invalidate)
    }

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleListItem> = source.load(params)

    override fun getRefreshKey(state: PagingState<Int, ArticleListItem>): Int? {
        val anchor = state.anchorPosition ?: return null
        val firstPage = state.pages.firstOrNull() ?: return null
        // Room 2.8 subtracts half a page from the presented anchor, but with
        // placeholders disabled that anchor excludes previously unloaded rows.
        val absoluteAnchor = if (state.config.enablePlaceholders) anchor else firstPage.itemsBefore + anchor
        return (absoluteAnchor - state.config.initialLoadSize / 2).coerceAtLeast(0)
    }
}
