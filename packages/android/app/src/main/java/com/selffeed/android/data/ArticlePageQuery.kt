package com.selffeed.android.data

/**
 * Stable identity for a Room-backed article query. The generation deliberately
 * stays out of [remoteKey] so a manual refresh replaces the existing queue
 * instead of creating an unbounded set of persisted copies.
 */
data class ArticlePageQuery(
    val feedId: String? = null,
    val categoryId: String? = null,
    val unreadOnly: Boolean = false,
    val savedOnly: Boolean = false,
    val sort: String? = null,
    val generation: Long = 0L,
)

fun ArticlePageQuery.remoteKey(): String =
    "articles:${feedId.orEmpty()}:${categoryId.orEmpty()}:$unreadOnly:$savedOnly:${sort.orEmpty()}"
