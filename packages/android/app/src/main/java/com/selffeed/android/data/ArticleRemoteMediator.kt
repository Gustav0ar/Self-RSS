package com.selffeed.android.data

import androidx.paging.ExperimentalPagingApi
import androidx.paging.LoadType
import androidx.paging.PagingState
import androidx.paging.RemoteMediator
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem

@OptIn(ExperimentalPagingApi::class)
class ArticleRemoteMediator(
    private val queryKey: String,
    private val forceInitialRefresh: Boolean,
    private val localStore: LocalStore,
    private val loadPage: suspend (limit: Int, cursor: String?) -> AppResult<ApiListResponse<ArticleListItem>>,
) : RemoteMediator<Int, ArticleListItem>() {
    override suspend fun load(
        loadType: LoadType,
        state: PagingState<Int, ArticleListItem>,
    ): MediatorResult {
        val cursor = when (loadType) {
            LoadType.REFRESH -> null
            LoadType.PREPEND -> return MediatorResult.Success(endOfPaginationReached = true)
            LoadType.APPEND -> {
                val remoteKey = localStore.readArticleRemoteKey(queryKey)
                    ?: return MediatorResult.Success(endOfPaginationReached = true)
                if (remoteKey.endReached) return MediatorResult.Success(endOfPaginationReached = true)
                remoteKey.nextCursor
                    ?: return MediatorResult.Success(endOfPaginationReached = true)
            }
        }

        val pageSize = state.config.pageSize.coerceAtMost(MAX_PAGE_SIZE)
        return when (val result = loadPage(pageSize, cursor)) {
            is AppResult.Success -> {
                localStore.writeArticleRemotePage(
                    queryKey = queryKey,
                    payload = result.data,
                    clearExisting = loadType == LoadType.REFRESH,
                )
                MediatorResult.Success(
                    endOfPaginationReached = !result.data.hasMore || result.data.cursor.isNullOrBlank(),
                )
            }

            is AppResult.Error -> MediatorResult.Error(
                result.cause ?: IllegalStateException(result.message),
            )
        }
    }

    override suspend fun initialize(): InitializeAction {
        if (forceInitialRefresh) return InitializeAction.LAUNCH_INITIAL_REFRESH
        val remoteKey = localStore.readArticleRemoteKey(queryKey)
        return if (remoteKey == null || System.currentTimeMillis() - remoteKey.updatedAt > MAX_QUERY_AGE_MS) {
            InitializeAction.LAUNCH_INITIAL_REFRESH
        } else {
            InitializeAction.SKIP_INITIAL_REFRESH
        }
    }

    private companion object {
        const val MAX_PAGE_SIZE = 60
        const val MAX_QUERY_AGE_MS = 30_000L
    }
}
