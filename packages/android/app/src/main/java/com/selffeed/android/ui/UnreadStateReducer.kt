package com.selffeed.android.ui

import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.StatsResponse

object UnreadStateReducer {
    fun applyFeedDelta(
        feeds: List<FeedWithCounts>,
        feedId: String,
        delta: Int,
    ): List<FeedWithCounts> =
        feeds.map { feed ->
            if (feed.id == feedId) {
                feed.copy(unreadCount = (feed.unreadCount + delta).coerceAtLeast(0))
            } else {
                feed
            }
        }

    fun applyCategoryDelta(
        categories: List<CategoryWithCounts>,
        categoryId: String,
        delta: Int,
    ): List<CategoryWithCounts> = applyCategoryDeltas(categories, mapOf(categoryId to delta))

    fun applyCategoryDeltas(
        categories: List<CategoryWithCounts>,
        deltas: Map<String, Int>,
    ): List<CategoryWithCounts> =
        categories.map { category ->
            val children = category.children?.let { applyCategoryDeltas(it, deltas) }
            val delta = deltas[category.id] ?: 0
            if (delta == 0 && children == category.children) {
                category
            } else {
                category.copy(
                    unreadCount = (category.unreadCount + delta).coerceAtLeast(0),
                    children = children,
                )
            }
        }

    fun applyStatsDelta(
        stats: StatsResponse,
        unreadDelta: Int,
        readDelta: Int,
    ): StatsResponse =
        stats.copy(
            totalUnread = (stats.totalUnread + unreadDelta).coerceAtLeast(0),
            totalRead = (stats.totalRead + readDelta).coerceAtLeast(0),
        )
}
