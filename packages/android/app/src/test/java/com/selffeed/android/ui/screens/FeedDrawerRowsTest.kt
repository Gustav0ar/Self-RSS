package com.selffeed.android.ui.screens

import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import org.junit.Assert.assertEquals
import org.junit.Test

class FeedDrawerRowsTest {
    @Test
    fun `buildFeedDrawerRows includes nested categories and feeds with depth`() {
        val child = sampleCategory(id = "child", name = "Child")
        val parent = sampleCategory(id = "parent", name = "Parent", children = listOf(child))
        val rows = buildFeedDrawerRows(
            categories = listOf(parent),
            feedsByCategory = mapOf(
                "parent" to listOf(sampleFeed(id = "parent-feed", categoryId = "parent")),
                "child" to listOf(sampleFeed(id = "child-feed", categoryId = "child")),
            ),
            isExpanded = { true },
        )

        assertEquals(
            listOf("cat-parent", "feed-parent-feed", "cat-child", "feed-child-feed"),
            rows.map { it.key },
        )
        assertEquals(listOf(0, 1, 1, 2), rows.map { it.depth })
    }

    @Test
    fun `buildFeedDrawerRows omits collapsed category descendants`() {
        val child = sampleCategory(id = "child", name = "Child")
        val parent = sampleCategory(id = "parent", name = "Parent", children = listOf(child))
        val rows = buildFeedDrawerRows(
            categories = listOf(parent),
            feedsByCategory = mapOf(
                "parent" to listOf(sampleFeed(id = "parent-feed", categoryId = "parent")),
                "child" to listOf(sampleFeed(id = "child-feed", categoryId = "child")),
            ),
            isExpanded = { categoryId -> categoryId != "parent" },
        )

        assertEquals(listOf("cat-parent"), rows.map { it.key })
    }

    private fun sampleCategory(
        id: String,
        name: String,
        children: List<CategoryWithCounts> = emptyList(),
    ): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = name,
        slug = name.lowercase(),
        sortOrder = 0,
        feedCount = 1,
        unreadCount = 0,
        children = children,
    )

    private fun sampleFeed(id: String, categoryId: String): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = id,
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = 0,
    )
}
