package com.selffeed.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.screens.ArticleTabActions
import com.selffeed.android.ui.screens.ArticleTabState
import com.selffeed.android.ui.screens.ArticlesTab
import kotlinx.coroutines.flow.flowOf

/**
 * Keeps Compose behavior tests on the production Paging UI path while letting
 * each test describe just its visible static article fixture.
 */
@Composable
fun ArticlesTabWithStaticPaging(
    state: ArticleTabState,
    actions: ArticleTabActions,
    pagingArticles: List<ArticleListItem> = state.articles,
) {
    val pagingData = remember(pagingArticles) {
        flowOf(PagingData.from(pagingArticles))
    }
    ArticlesTab(
        state = state,
        actions = actions,
        pagedArticles = pagingData.collectAsLazyPagingItems(),
    )
}
