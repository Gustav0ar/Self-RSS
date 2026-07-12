package com.selffeed.android.ui

import com.selffeed.android.network.UserPreferences

/**
 * Pure app-workflow policy shared by the Compose route and unit tests.
 *
 * Feature ViewModels continue to own their own state. This coordinator only
 * defines when cross-feature work must happen, keeping those rules out of
 * composition effects and avoiding a new root "god" ViewModel.
 */
interface AppWorkflowSink : ArticleFeatureEventSink {
    fun refreshAuthenticatedSession()
    fun clearUnauthenticatedSession()
    fun applyArticlePreferences(defaultSort: String, hideRead: Boolean, autoMarkReadMode: String)
    fun refreshAfterFeedSync()
}

class AppWorkflowCoordinator(
    private val articleEvents: ArticleFeatureEventCoordinator = ArticleFeatureEventCoordinator(),
) {
    fun onAuthenticationChanged(isAuthenticated: Boolean, sink: AppWorkflowSink) {
        if (isAuthenticated) sink.refreshAuthenticatedSession() else sink.clearUnauthenticatedSession()
    }

    fun onPreferencesChanged(preferences: UserPreferences?, sink: AppWorkflowSink) {
        preferences ?: return
        sink.applyArticlePreferences(
            defaultSort = preferences.defaultSort,
            hideRead = preferences.hideRead,
            autoMarkReadMode = preferences.autoMarkReadMode,
        )
    }

    fun onFeedSyncRevisionChanged(syncRevision: Long, sink: AppWorkflowSink) {
        if (syncRevision > 0L) sink.refreshAfterFeedSync()
    }

    fun onArticleEvent(
        event: ArticleFeatureEvent,
        latestFeedsState: FeedsUiState,
        sink: AppWorkflowSink,
    ) {
        articleEvents.handle(event, latestFeedsState, sink)
    }
}
