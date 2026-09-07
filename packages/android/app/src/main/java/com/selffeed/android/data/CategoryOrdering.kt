package com.selffeed.android.data

import com.selffeed.android.network.CategoryOrderUpdate
import com.selffeed.android.network.CategoryWithCounts

enum class CategoryMoveDirection { UP, DOWN }

/** Produces a complete sibling order; a move never changes a category's parent. */
fun categoryMoveUpdates(
    categories: List<CategoryWithCounts>,
    categoryId: String,
    direction: CategoryMoveDirection,
): List<CategoryOrderUpdate>? {
    val index = categories.indexOfFirst { it.id == categoryId }
    if (index >= 0) {
        val siblings = categories.filter { it.parentCategoryId == categories[index].parentCategoryId }.toMutableList()
        val from = siblings.indexOfFirst { it.id == categoryId }
        val to = from + if (direction == CategoryMoveDirection.UP) -1 else 1
        if (to !in siblings.indices) return null
        siblings.add(to, siblings.removeAt(from))
        return siblings.mapIndexed { order, category -> CategoryOrderUpdate(category.id, order) }
    }
    return categories.firstNotNullOfOrNull { categoryMoveUpdates(it.children.orEmpty(), categoryId, direction) }
}

/** Applies only order fields so unread counts and other concurrent updates survive. */
fun applyCategoryOrder(
    categories: List<CategoryWithCounts>,
    updates: List<CategoryOrderUpdate>,
): List<CategoryWithCounts> {
    val orders = updates.associate { it.id to it.sortOrder }
    fun apply(nodes: List<CategoryWithCounts>): List<CategoryWithCounts> = nodes.map { category ->
        category.copy(
            sortOrder = orders[category.id] ?: category.sortOrder,
            children = category.children?.let(::apply),
        )
    }.let { nodes ->
        val reordered = nodes.filter { it.id in orders }.sortedBy { it.sortOrder }.iterator()
        nodes.map { if (it.id in orders) reordered.next() else it }
    }
    return apply(categories)
}
