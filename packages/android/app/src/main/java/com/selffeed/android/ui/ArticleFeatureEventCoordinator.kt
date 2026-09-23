package com.selffeed.android.ui

interface ArticleFeatureEventSink {
    fun refreshArticleState()
    fun refreshArticleContent()
}

/** Cross-feature events request freshness; committed Room observations supply flags and counts. */
class ArticleFeatureEventCoordinator {
    fun handle(event: ArticleFeatureEvent, sink: ArticleFeatureEventSink) {
        when (event) {
            ArticleFeatureEvent.ArticleStateRefreshRequested -> sink.refreshArticleState()
            // Individual body updates do not change library membership or counts.
            is ArticleFeatureEvent.ArticlesChanged -> if (event.articleId == null) sink.refreshArticleContent()
        }
    }
}
