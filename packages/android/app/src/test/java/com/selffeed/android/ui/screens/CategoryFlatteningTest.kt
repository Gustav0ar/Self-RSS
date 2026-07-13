package com.selffeed.android.ui.screens

import com.selffeed.android.network.CategoryWithCounts
import org.junit.Assert.assertEquals
import org.junit.Test

class CategoryFlatteningTest {
    @Test
    fun flattenCategoriesIncludesParentsAndNestedCategoriesInDisplayOrder() {
        val child = category(id = "child", name = "Child")
        val parent = category(id = "parent", name = "Parent", children = listOf(child))

        assertEquals(listOf("parent", "child"), listOf(parent).flattenCategories().map { it.id })
    }

    private fun category(
        id: String,
        name: String,
        children: List<CategoryWithCounts> = emptyList(),
    ) = CategoryWithCounts(
        id = id,
        name = name,
        slug = id,
        sortOrder = 0,
        feedCount = 0,
        unreadCount = 0,
        children = children,
    )
}
