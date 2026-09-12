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
            is ArticleFeatureEvent.ArticlesChanged -> sink.refreshArticleContent()
        }
    }
}
