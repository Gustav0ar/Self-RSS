package com.selffeed.android.ui

import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import java.util.Collections

/**
 * Session-scoped read-state memory for articles whose server/list payloads may
 * arrive stale after optimistic local changes or read-state SSE events.
 */
class ArticleReadStateStore {
    private val overrides = Collections.synchronizedMap(mutableMapOf<String, Boolean>())

    fun remember(articleId: String, isRead: Boolean) {
        overrides[articleId] = isRead
    }

    fun rememberAll(articles: Iterable<ArticleListItem>, isRead: Boolean = true) {
        articles.forEach { remember(it.id, isRead) }
    }

    fun remember(article: ArticleDetail, isRead: Boolean = article.isRead) {
        remember(article.id, isRead)
    }

    fun clear() {
        overrides.clear()
    }

    fun snapshot(
        articles: List<ArticleListItem>,
        searchResults: List<ArticleListItem>,
        selectedArticle: ArticleDetail?,
    ): Map<String, Boolean> =
        buildMap {
            synchronized(overrides) {
                putAll(overrides)
            }
            articles.forEach { article -> putIfAbsent(article.id, article.isRead) }
            searchResults.forEach { article -> putIfAbsent(article.id, article.isRead) }
            selectedArticle?.let { article -> putIfAbsent(article.id, article.isRead) }
        }
}
