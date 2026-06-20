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
    ): List<CategoryWithCounts> {
        fun applyNode(category: CategoryWithCounts): Pair<CategoryWithCounts, Int> {
            var totalDelta = deltas[category.id] ?: 0
            val children = category.children?.map { child ->
                val (updatedChild, childDelta) = applyNode(child)
                totalDelta += childDelta
                updatedChild
            }

            if (totalDelta == 0 && children == category.children) {
                return category to 0
            }

            return category.copy(
                unreadCount = (category.unreadCount + totalDelta).coerceAtLeast(0),
                children = children,
            ) to totalDelta
        }

        return categories.map { applyNode(it).first }
    }

    fun clearCategoryUnreadCounts(categories: List<CategoryWithCounts>): List<CategoryWithCounts> =
        categories.map { category ->
            category.copy(
                unreadCount = 0,
                children = category.children?.let(::clearCategoryUnreadCounts),
            )
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
