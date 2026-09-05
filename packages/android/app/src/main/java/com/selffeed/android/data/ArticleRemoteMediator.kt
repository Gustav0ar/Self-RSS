package com.selffeed.android.data

import androidx.paging.ExperimentalPagingApi
import androidx.paging.LoadType
import androidx.paging.PagingState
import androidx.paging.RemoteMediator
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.ArticleListItem
import retrofit2.HttpException

@OptIn(ExperimentalPagingApi::class)
class ArticleRemoteMediator(
    private val queryKey: String,
    private val forceInitialRefresh: Boolean,
    private val localStore: LocalStore,
    private val loadPage: suspend (limit: Int, cursor: String?) -> AppResult<ApiListResponse<ArticleListItem>>,
    private val onCompletedRefresh: suspend () -> AppResult<Unit> = { AppResult.Success(Unit) },
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
                if (remoteKey.endReached) return completeRefresh()
                remoteKey.nextCursor
                    ?: return MediatorResult.Success(endOfPaginationReached = true)
            }
        }

        val pageSize = state.config.pageSize.coerceAtMost(MAX_PAGE_SIZE)
        return when (val result = loadPage(pageSize, cursor)) {
            is AppResult.Success -> storePage(result.data, clearExisting = loadType == LoadType.REFRESH)

            is AppResult.Error -> {
                // Cursor formats can legitimately change across server
                // deployments while a Room page remains cached. Restart once
                // from page one and only replace the visible queue after that
                // request succeeds, preserving the stale list if it does not.
                if (loadType == LoadType.APPEND && (result.cause as? HttpException)?.code() == 409) {
                    when (val restarted = loadPage(pageSize, null)) {
                        is AppResult.Success -> storePage(restarted.data, clearExisting = true)

                        is AppResult.Error -> MediatorResult.Error(
                            restarted.cause ?: IllegalStateException(restarted.message),
                        )
                    }
                } else {
                    MediatorResult.Error(result.cause ?: IllegalStateException(result.message))
                }
            }
        }
    }

    private suspend fun storePage(payload: ApiListResponse<ArticleListItem>, clearExisting: Boolean): MediatorResult {
        localStore.writeArticleRemotePage(queryKey, payload, clearExisting)
        return if (!payload.hasMore || payload.cursor.isNullOrBlank()) {
            completeRefresh()
        } else {
            MediatorResult.Success(endOfPaginationReached = false)
        }
    }

    private suspend fun completeRefresh(): MediatorResult = when (val result = onCompletedRefresh()) {
        is AppResult.Success -> MediatorResult.Success(endOfPaginationReached = true)
        is AppResult.Error -> MediatorResult.Error(result.cause ?: IllegalStateException(result.message))
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
