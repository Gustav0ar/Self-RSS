package com.selffeed.android.ui

import com.selffeed.android.data.repository.LibraryCounts
import com.selffeed.android.network.CategoryWithCounts

/** Apply Room counts after metadata updates too, so a delayed response cannot restore old badges. */
internal fun FeedsUiState.withLibraryCounts(counts: LibraryCounts): FeedsUiState {
    fun project(categories: List<CategoryWithCounts>): List<CategoryWithCounts> = categories.map {
        it.copy(unreadCount = counts.categoryUnread[it.id] ?: it.unreadCount, children = it.children?.let(::project))
    }
    return copy(
        feeds = feeds.map { it.copy(unreadCount = counts.feedUnread[it.id] ?: it.unreadCount) },
        categories = project(categories),
    )
}

internal fun SettingsUiState.withLibraryCounts(counts: LibraryCounts): SettingsUiState = copy(
    stats = stats?.copy(
        totalRead = counts.totalRead ?: stats.totalRead,
        totalUnread = counts.totalUnread ?: stats.totalUnread,
    ),
)
