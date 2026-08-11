package com.selffeed.android.ui.screens

import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.FeedSyncAllStatus
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.SyncRun
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.network.User
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.PresentationText

/** Feature-owned immutable models and events consumed by the app shell. */
data class FeedTabState(
    val categories: List<CategoryWithCounts>,
    val feeds: List<FeedWithCounts>,
    val hideRead: Boolean,
    val totalUnread: Int,
    val selectedCategoryId: String?,
    val selectedFeedId: String?,
    val loading: Boolean = false,
    val lastImportSummary: OpmlImportSummary? = null,
    val syncStatus: FeedSyncAllStatus? = null,
    val lifecycleActionFeedId: String? = null,
    val externalFeedUrl: String? = null,
    val syncHistoryByFeed: Map<String, List<SyncRun>> = emptyMap(),
    val syncHistoryLoadingFeedId: String? = null,
    val syncHistoryErrorByFeed: Map<String, PresentationText> = emptyMap(),
)

data class FeedTabActions(
    val onHideReadChanged: (Boolean) -> Unit,
    val onCategorySelected: (String?) -> Unit,
    val onFeedSelected: (String?) -> Unit,
    val onCreateCategory: (String, String?) -> Unit = { _, _ -> },
    val onUpdateCategory: (String, String, String?) -> Unit = { _, _, _ -> },
    val onDeleteCategory: (String) -> Unit = {},
    val onCreateFeed: (String, String, String?) -> Unit = { _, _, _ -> },
    val onUpdateFeed: (String, String, String?, String?, Int?) -> Unit = { _, _, _, _, _ -> },
    val onDeleteFeed: (String) -> Unit = {},
    val onImportOpml: (String, ByteArray) -> Unit = { _, _ -> },
    val onExportOpml: () -> Unit = {},
    val onDismissImportSummary: () -> Unit = {},
    val onSelectDiscoveryCandidate: (String, String) -> Unit = { _, _ -> },
    val onCancelFeedReplacement: (String) -> Unit = {},
    val onConsumeExternalFeed: () -> Unit = {},
    val onLoadFeedSyncHistory: (String) -> Unit = {},
    val onRetryFeedSync: (String) -> Unit = {},
)

data class ArticleTabState(
    val articles: List<ArticleListItem>,
    val selectedArticleId: String?,
    val isSyncingFeeds: Boolean,
    val isStartingFeedSync: Boolean = false,
    val syncCompletedFeeds: Int = 0,
    val syncTotalFeeds: Int = 0,
    val density: DensityPreference = DensityPreference.COMFORTABLE,
    val isOffline: Boolean = false,
    val feedCount: Int = 0,
    val refreshBlockedGuidance: PresentationText? = null,
    val savedOnly: Boolean = false,
)

data class ArticleTabActions(
    val onRefresh: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onOpenArticleFromQueue: (String, List<ArticleListItem>) -> Unit = { id, _ ->
        onOpenArticle(
            id
        )
    },
    val onToggleRead: (String, Boolean) -> Unit,
    val onToggleSaved: (String, Boolean) -> Unit = { _, _ -> },
    val onReadStateChanged: (String, Boolean) -> Unit = { _, _ -> },
    val onArticleSnapshot: (List<ArticleListItem>) -> Unit,
    val onVisibleArticles: (List<ArticleListItem>) -> Unit = {},
)

data class SearchTabState(
    val query: String,
    val results: List<ArticleListItem>,
    val selectedArticleId: String?,
    val hasMoreResults: Boolean,
    val loadingResults: Boolean,
    val loadingMoreResults: Boolean,
    val currentCategoryAvailable: Boolean,
    val currentCategoryOnly: Boolean,
    val resultLimitReached: Boolean,
    val isOffline: Boolean = false,
)

data class SearchTabActions(
    val onQueryChanged: (String) -> Unit,
    val onSearchRequested: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onLoadMore: () -> Unit,
    val onCurrentCategoryOnlyChanged: (Boolean) -> Unit,
    val onToggleSaved: (String, Boolean) -> Unit = { _, _ -> },
)

data class SettingsTabState(
    val preferences: UserPreferences?,
    val preferencesLoading: Boolean = false,
    val preferencesLoadError: PresentationText? = null,
    val stats: StatsResponse?,
    val authSessions: List<AuthSession>,
    val adminRegistrationLocked: Boolean? = null,
    val adminUsers: List<User> = emptyList(),
    val isOnline: Boolean = true,
    val passwordChangePending: Boolean = false,
    val passwordChangeGeneration: Long = 0,
)

data class SettingsTabActions(
    val onThemeChanged: (com.selffeed.android.ui.ThemePreference) -> Unit,
    val onHideReadChanged: (Boolean) -> Unit,
    val onSortChanged: (com.selffeed.android.ui.ArticleSortPreference) -> Unit,
    val onDensityChanged: (DensityPreference) -> Unit,
    val onTextSizeChanged: (Int) -> Unit,
    val onFontChanged: (com.selffeed.android.ui.ReaderFontPreference) -> Unit = {},
    val onAutoMarkReadModeChanged: (com.selffeed.android.ui.AutoMarkReadPreference) -> Unit = {},
    val onRevokeAuthSession: (String) -> Unit,
    val onRegistrationLockChanged: (Boolean) -> Unit = {},
    val onRetryFeedSync: (String) -> Unit = {},
    val onCreateAdminUser: (String, String, String) -> Unit = { _, _, _ -> },
    val onUpdateAdminUser: (String, String?, Boolean?) -> Unit = { _, _, _ -> },
    val onResetAdminPassword: (String, String) -> Unit = { _, _ -> },
    val onChangePassword: (String, String) -> Unit = { _, _ -> },
    val onLogout: () -> Unit,
    val onRetryPreferences: () -> Unit = {},
)
