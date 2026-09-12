package com.selffeed.android.ui

interface ArticleFeatureEventSink {
    fun applyArticleReadState(articleId: String, read: Boolean)
    fun applyArticleSavedState(articleId: String, saved: Boolean)
    fun applySearchScopeMarkedRead(feedIds: Set<String>)
    fun applyAllSearchMarkedRead()
    fun refreshArticleContent()
}

class ArticleFeatureEventCoordinator {
    fun handle(
        event: ArticleFeatureEvent,
        latestFeedsState: FeedsUiState,
        sink: ArticleFeatureEventSink,
    ) {
        when (event) {
            is ArticleFeatureEvent.ArticleReadStateChanged -> {
                sink.applyArticleReadState(event.articleId, event.read)
            }

            is ArticleFeatureEvent.ArticleSavedStateChanged -> {
                sink.applyArticleSavedState(event.articleId, event.saved)
            }

            is ArticleFeatureEvent.ScopeMarkedRead -> {
                val searchFeedIds = searchFeedIdsFor(event, latestFeedsState)
                if (isAllFeedsScope(event)) {
                    sink.applyAllSearchMarkedRead()
                } else {
                    sink.applySearchScopeMarkedRead(searchFeedIds)
                }
                event.retainedUnreadArticleFeeds.keys.forEach { sink.applyArticleReadState(it, false) }
            }

            is ArticleFeatureEvent.ArticlesChanged -> sink.refreshArticleContent()
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
