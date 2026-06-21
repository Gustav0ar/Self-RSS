package com.selffeed.android.ui

interface ArticleFeatureEventSink {
    fun applyUnreadDelta(feedId: String?, unreadDelta: Int)
    fun applyStatsDelta(unreadDelta: Int, readDelta: Int)
    fun applyArticleReadState(articleId: String, read: Boolean)
    fun applyScopeMarkedRead(feedId: String?, categoryId: String?, affectedFeedIds: Set<String>)
    fun applySearchScopeMarkedRead(feedIds: Set<String>)
    fun applyAllSearchMarkedRead()
}

class ArticleFeatureEventCoordinator {
    fun handle(
        event: ArticleFeatureEvent,
        latestFeedsState: FeedsUiState,
        sink: ArticleFeatureEventSink,
    ) {
        when (event) {
            is ArticleFeatureEvent.ArticleReadStateChanged -> {
                sink.applyUnreadDelta(event.feedId, event.unreadDelta)
                sink.applyStatsDelta(event.unreadDelta, event.readDelta)
                sink.applyArticleReadState(event.articleId, event.read)
            }

            is ArticleFeatureEvent.ScopeMarkedRead -> {
                sink.applyScopeMarkedRead(
                    feedId = event.feedId,
                    categoryId = event.categoryId,
                    affectedFeedIds = event.affectedFeedIds,
                )
                sink.applyStatsDelta(
                    unreadDelta = -event.markedCount,
                    readDelta = event.markedCount,
                )
                val searchFeedIds = searchFeedIdsFor(event, latestFeedsState)
                if (isAllFeedsScope(event)) {
                    sink.applyAllSearchMarkedRead()
                } else {
                    sink.applySearchScopeMarkedRead(searchFeedIds)
                }
            }
        }
    }

    private fun searchFeedIdsFor(
        event: ArticleFeatureEvent.ScopeMarkedRead,
        latestFeedsState: FeedsUiState,
    ): Set<String> = when {
        event.affectedFeedIds.isNotEmpty() -> event.affectedFeedIds
        event.feedId != null -> setOf(event.feedId)
        event.categoryId != null -> latestFeedsState.feeds
            .filter { it.categoryId == event.categoryId }
            .map { it.id }
            .toSet()

        else -> emptySet()
    }

    private fun isAllFeedsScope(event: ArticleFeatureEvent.ScopeMarkedRead): Boolean =
        event.feedId == null &&
            event.categoryId == null &&
            event.affectedFeedIds.isEmpty()
}
